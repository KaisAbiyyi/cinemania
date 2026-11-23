/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { START_DEADLINE_MS, VERIFY_DEADLINE_MS, TOTAL_DEADLINE_MS, readWarmup, warmRealtimeTenant } = require("./realtime-warmup.cjs");
const { runWarmupSession, runWarmedGates, decideVerdict, coverageOf } = require("./qualification.cjs");

const URL_BASE = "https://exampleproject.supabase.co";
const SECRET = "synthetic-secret-key-value";
const timeoutError = Object.assign(new Error("private detail"), { name: "TimeoutError" });
const GATE_A_VERDICT = "WARM-PATH GATE A ONLY PASSED; COLD-PATH NOT QUALIFIED";
const FULL_VERDICT = "WARM-PATH ACCEPTANCE: ALL GATES PASSED; COLD-PATH RECOVERY NOT QUALIFIED";

// Virtual clock: call N (1-based) takes latency[N] ms; status[N] / fail[N] override the response.
function harness({ latency = {}, status = {}, fail = {} } = {}) {
  let clock = 0;
  const calls = [];
  const deadlines = [];
  const send = async (endpoint, init) => {
    const n = calls.length + 1;
    calls.push({ url: String(endpoint), init });
    clock += latency[n] ?? 300;
    if (fail[n]) throw timeoutError;
    return new Response(null, { status: status[n] ?? 202 });
  };
  let counter = 0;
  return { calls, deadlines, options: {
    url: URL_BASE, secret: SECRET, send, now: () => clock, makeRoom: () => "ROOM-SECRET-" + counter++,
    timeout: ms => { deadlines.push(ms); return new AbortController().signal; },
  } };
}

test("a cold first request is the warm-up: it starts the Realtime tenant, then two fresh rooms verify readiness", async () => {
  const h = harness({ latency: { 1: 2600, 2: 380, 3: 400 } });
  const result = await warmRealtimeTenant(h.options);
  assert.equal(result.status, "READY");
  assert.equal(result.firstRequestOverAppDeadline, true);
  assert.deepEqual(result.requests.map(r => [r.id, r.role, r.http, r.ms]),
    [["W1", "start", 202, 2600], ["W2", "verify", 202, 380], ["W3", "verify", 202, 400]]);
  assert.deepEqual(h.deadlines, [START_DEADLINE_MS, VERIFY_DEADLINE_MS, VERIFY_DEADLINE_MS]);
  assert.equal(VERIFY_DEADLINE_MS, 1500);
  assert.ok(START_DEADLINE_MS + 2 * VERIFY_DEADLINE_MS < TOTAL_DEADLINE_MS);
});

test("it warms Realtime itself with the application's private broadcast shape, never the Auth service", async () => {
  const h = harness();
  await warmRealtimeTenant(h.options);
  assert.equal(h.calls.length, 3);
  const topics = new Set();
  for (const call of h.calls) {
    const url = new URL(call.url);
    assert.equal(url.pathname.startsWith("/realtime/v1/api/broadcast/room%3AROOM-SECRET-"), true);
    assert.equal(url.pathname.endsWith("/events/room_changed"), true);
    assert.equal(url.search, "?private=true");
    assert.equal(call.url.includes("/auth/"), false);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.headers.apikey, SECRET);
    topics.add(url.pathname);
  }
  assert.equal(topics.size, 3, "three distinct synthetic rooms");
});

test("a tenant that was already running is READY and is not reported as cold", async () => {
  const result = await warmRealtimeTenant(harness().options);
  assert.equal(result.status, "READY");
  assert.equal(result.firstRequestOverAppDeadline, false);
});

test("fail closed: any non-202 response stops the warm-up at once and never retries", async () => {
  for (const code of [401, 403, 404, 429, 500, 200]) {
    const h = harness({ status: { 1: code } });
    const result = await warmRealtimeTenant(h.options);
    assert.equal(result.status, "NOT_READY");
    assert.equal(h.calls.length, 1);
    assert.equal(result.requests[0].http, code);
  }
  const later = harness({ status: { 2: 503 } });
  assert.equal((await warmRealtimeTenant(later.options)).status, "NOT_READY");
  assert.equal(later.calls.length, 2);
});

test("fail closed: a timeout or transport error is NOT_READY without a retry, and a body written but unanswered is not accepted", async () => {
  const h = harness({ latency: { 1: 10_000 }, fail: { 1: true } });
  const result = await warmRealtimeTenant(h.options);
  assert.equal(result.status, "NOT_READY");
  assert.equal(h.calls.length, 1);
  assert.deepEqual([result.requests[0].http, result.requests[0].failure], [null, "client_deadline"]);
  assert.equal(result.firstRequestOverAppDeadline, null);
  const verify = harness({ fail: { 3: true } });
  const second = await warmRealtimeTenant(verify.options);
  assert.equal(second.status, "NOT_READY");
  assert.equal(verify.calls.length, 3);
});

test("fail closed: a verification that is accepted but slower than the application deadline does not make the tenant ready", async () => {
  const h = harness({ latency: { 1: 2600, 2: 1600 } });
  const result = await warmRealtimeTenant(h.options);
  assert.equal(result.status, "NOT_READY");
  assert.equal(h.calls.length, 2);
});

test("only the designated HTTPS project origin and a non-empty key are accepted, before any request", async () => {
  for (const url of ["http://exampleproject.supabase.co", "https://evil.example.com", "https://exampleproject.supabase.co/x"]) {
    const h = harness();
    await assert.rejects(warmRealtimeTenant({ ...h.options, url }), /^Error: WARMUP_CONFIGURATION_INVALID$/);
    assert.equal(h.calls.length, 0);
  }
  await assert.rejects(warmRealtimeTenant({ ...harness().options, secret: "" }), /^Error: WARMUP_CONFIGURATION_INVALID$/);
});

test("evidence is rebuilt from enumerations: no credentials, URLs, rooms or messages, and READY cannot be forged", async () => {
  const raw = await warmRealtimeTenant(harness({ latency: { 1: 2600 } }).options);
  const read = readWarmup({ ...raw, secret: SECRET, url: URL_BASE,
    requests: raw.requests.map(r => ({ ...r, room: "ROOM-SECRET-0", message: "private detail" })) });
  assert.equal(read.status, "READY");
  const serialized = JSON.stringify(read);
  for (const leak of [SECRET, URL_BASE, "ROOM-SECRET", "private detail", "supabase.co"]) assert.equal(serialized.includes(leak), false);
  assert.equal(readWarmup({ ...raw, requests: [{ ...raw.requests[0], failure: "https://leak.invalid" }, ...raw.requests.slice(1)] }), null);
  assert.equal(readWarmup({ ...raw, status: "MAYBE" }), null);
  assert.equal(readWarmup({ ...raw, requests: [...raw.requests, raw.requests[0]] }), null);
  assert.equal(readWarmup({ ...raw, requests: [{ ...raw.requests[0], id: "W2" }, ...raw.requests.slice(1)] }), null);
  assert.equal(readWarmup({ ...raw, requests: raw.requests.slice(0, 2) }), null);
  assert.equal(readWarmup({ ...raw, requests: [{ ...raw.requests[0], http: 500 }, ...raw.requests.slice(1)] }), null);
  assert.equal(readWarmup({ ...raw, requests: [raw.requests[0], { ...raw.requests[1], ms: 1600 }, raw.requests[2]] }), null);
});

// --- Lease, cleanup and gating (fail closed) ---
function sessionDeps({ acquired = true, released = true, readback = () => {}, warm } = {}) {
  const log = [];
  class Client {
    constructor(config) { log.push("new:" + config.application_name); }
    on() {}
    async connect() { log.push("connect"); }
    async query(sql) {
      if (sql.includes("pg_try_advisory_lock")) { log.push("lock"); return { rows: [{ acquired }] }; }
      if (sql.includes("pg_advisory_unlock")) { log.push("unlock"); return { rows: [{ released }] }; }
      throw new Error("unexpected SQL");
    }
    async end() { log.push("end"); }
  }
  const sleeps = [];
  return { log, sleeps, deps: {
    load: { loadHostedStaging: () => ({ url: URL_BASE, pgConfig: {} }) }, Client, secret: SECRET,
    readback: async () => { log.push("readback"); return readback(); },
    warm: async options => { log.push("warm"); return (warm ?? (() => warmRealtimeTenant(harness({ latency: { 1: 2600 } }).options)))(options); },
    sleep: async ms => { sleeps.push(ms); },
  } };
}
const fresh = mode => ({ mode, preflight: { status: "PASS" }, gates: { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" }, workload: [] });

test("warm-up holds the exclusive lease only around its own requests, releases it and reads the baseline back before any gate", async () => {
  const { log, deps } = sessionDeps();
  const evidence = fresh("gate-a-only");
  await runWarmupSession({}, evidence, deps);
  assert.deepEqual(log, ["new:cine026-warmup-supervisor", "connect", "lock", "warm", "unlock", "end", "readback"]);
  assert.equal(evidence.warmup.status, "READY");
  assert.deepEqual(evidence.warmup.cleanup, { leaseRelease: "released", readback: "PASS" });
  assert.match(evidence.warmup.completedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(evidence.gates.D, "NOT RUN", "Gate D belongs to the workload, never to the warm-up");
});

test("a busy lease never sends a warm-up request", async () => {
  const { log, deps } = sessionDeps({ acquired: false });
  const evidence = fresh("gate-a-only");
  await assert.rejects(runWarmupSession({}, evidence, deps), /^Error: LEASE_BUSY$/);
  assert.equal(log.includes("warm"), false);
  assert.equal(log.includes("unlock"), false);
  assert.equal(evidence.warmup.status, "NOT_RUN");
  assert.equal(decideVerdict({ ...evidence, gates: { A: "PASS", B: "NOT RUN", C: "NOT RUN", D: "PASS" } }, false), "HOLD");
});

test("a tenant that is not ready stops before every gate, after the lease is released and cleanup verified", async () => {
  const bad = sessionDeps({ warm: async () => warmRealtimeTenant(harness({ status: { 1: 403 } }).options) });
  const evidence = fresh("gate-a-only");
  const calls = [];
  await assert.rejects(runWarmedGates({}, evidence, async gate => { calls.push(gate); return true; }, bad.deps), /^Error: WARMUP_NOT_READY$/);
  assert.deepEqual(calls, []);
  assert.deepEqual(bad.log.slice(-3), ["unlock", "end", "readback"]);
  assert.equal(evidence.warmup.status, "NOT_READY");
  assert.deepEqual(evidence.gates, { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" });
  assert.equal(decideVerdict({ ...evidence, failure: { phase: "qualification" } }, false), "HOLD");
});

test("the warm-up always runs before Gate A, and gate-a-only still never reaches Gate B or C", async () => {
  const { log, deps } = sessionDeps();
  const evidence = fresh("gate-a-only");
  await runWarmedGates({}, evidence, async (gate, browser) => { log.push("gate:" + gate + ":" + browser); return true; }, deps);
  assert.ok(log.indexOf("warm") < log.indexOf("gate:A:chromium"));
  assert.ok(log.indexOf("readback") < log.indexOf("gate:A:chromium"));
  assert.deepEqual(log.filter(entry => entry.startsWith("gate:")), ["gate:A:chromium", "gate:A:firefox", "gate:A:webkit"]);
  const full = sessionDeps();
  const fullEvidence = fresh("full");
  await runWarmedGates({}, fullEvidence, async gate => { full.log.push("gate:" + gate); return true; }, full.deps);
  assert.deepEqual(full.log.filter(entry => entry.startsWith("gate:")), ["gate:A", "gate:A", "gate:A", "gate:B", "gate:C"]);
  assert.equal(full.log.filter(entry => entry === "warm").length, 1);
});

test("an unacknowledged release or a failing readback after the warm-up blocks the gates and marks Gate D unconfirmed", async () => {
  const unacknowledged = sessionDeps({ released: false });
  const a = fresh("gate-a-only");
  await assert.rejects(runWarmedGates({}, a, async () => true, unacknowledged.deps), /^Error: WARMUP_CLEANUP_UNCONFIRMED$/);
  assert.equal(a.gates.D, "UNCONFIRMED");
  assert.equal(a.gates.A, "NOT RUN");

  const dirty = sessionDeps({ readback: () => { throw new Error("STAGING_ISOLATION_FAILED"); } });
  const b = fresh("gate-a-only");
  await assert.rejects(runWarmedGates({}, b, async () => true, dirty.deps), /^Error: WARMUP_CLEANUP_UNCONFIRMED$/);
  assert.deepEqual(dirty.sleeps, [135_000]);
  assert.equal(b.gates.D, "UNCONFIRMED");
  assert.deepEqual(b.warmup.cleanup, { leaseRelease: "released", readback: "FAIL" });
});

test("a failing warm-up request still releases the lease and reads back before the error surfaces", async () => {
  const { log, deps } = sessionDeps({ warm: async () => { throw new Error("WARMUP_CONFIGURATION_INVALID"); } });
  const evidence = fresh("full");
  await assert.rejects(runWarmupSession({}, evidence, deps), /WARMUP_CONFIGURATION_INVALID/);
  assert.deepEqual(log, ["new:cine026-warmup-supervisor", "connect", "lock", "warm", "unlock", "end", "readback"]);
});

test("passing warm gates are WARM-PATH acceptance only and are never labelled as cold-path or unqualified acceptance", () => {
  const warmup = { status: "READY", requests: [], cleanup: { leaseRelease: "released", readback: "PASS" } };
  const gateA = { ...fresh("gate-a-only"), warmup, gates: { A: "PASS", B: "NOT RUN", C: "NOT RUN", D: "PASS" } };
  const full = { ...fresh("full"), warmup, gates: { A: "PASS", B: "PASS", C: "PASS", D: "PASS" } };
  assert.equal(decideVerdict(gateA, false), GATE_A_VERDICT);
  assert.equal(decideVerdict(full, false), FULL_VERDICT);
  for (const verdict of [decideVerdict(gateA, false), decideVerdict(full, false)]) {
    assert.match(verdict, /^WARM-PATH/);
    assert.match(verdict, /COLD-PATH (?:RECOVERY )?NOT QUALIFIED$/);
    assert.notEqual(verdict, "GATE A ONLY PASSED");
    assert.notEqual(verdict, "ALL GATES PASSED");
  }
  assert.deepEqual(coverageOf({ ...gateA, verdict: decideVerdict(gateA, false) }), { warmPathAcceptance: "PASS (GATE A ONLY)", coldPathRecovery: "NOT QUALIFIED" });
  assert.deepEqual(coverageOf({ ...full, verdict: decideVerdict(full, false) }), { warmPathAcceptance: "PASS (GATES A-D)", coldPathRecovery: "NOT QUALIFIED" });
  assert.deepEqual(coverageOf({ ...full, verdict: "HOLD" }), { warmPathAcceptance: "HOLD", coldPathRecovery: "NOT QUALIFIED" });
  assert.equal(coverageOf({ mode: "preflight", verdict: "READ-ONLY PREFLIGHT PASSED" }), undefined);
  assert.equal(coverageOf({ mode: "cold-start-probe", verdict: "COLD-START PROBE REPRODUCED" }), undefined);
});

test("no gate verdict is possible without a READY warm-up whose lease release and readback were confirmed", () => {
  const passed = { ...fresh("gate-a-only"), gates: { A: "PASS", B: "NOT RUN", C: "NOT RUN", D: "PASS" } };
  const good = { status: "READY", requests: [], cleanup: { leaseRelease: "released", readback: "PASS" } };
  assert.equal(decideVerdict({ ...passed, warmup: good }, false), GATE_A_VERDICT);
  for (const warmup of [undefined, { ...good, status: "NOT_READY" }, { ...good, status: "NOT_RUN" },
    { ...good, cleanup: { leaseRelease: "unconfirmed", readback: "PASS" } }, { ...good, cleanup: { leaseRelease: "released", readback: "FAIL" } }]) {
    assert.equal(decideVerdict({ ...passed, warmup }, false), "HOLD");
    assert.equal(decideVerdict({ ...passed, mode: "full", gates: { A: "PASS", B: "PASS", C: "PASS", D: "PASS" }, warmup }, false), "HOLD");
  }
  // The zero-transport-failure gate is unchanged: a failing Gate A under a ready warm-up is still HOLD.
  assert.equal(decideVerdict({ ...passed, warmup: good, gates: { ...passed.gates, A: "FAIL" } }, false), "HOLD");
});
