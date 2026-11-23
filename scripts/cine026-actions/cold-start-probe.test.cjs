/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { REQUEST_DEADLINE_MS, TOTAL_DEADLINE_MS, classify, readProbe, runColdStartProbe } = require("./cold-start-probe.cjs");
const { runProbeSession, decideVerdict, authorize } = require("./qualification.cjs");

const URL_BASE = "https://exampleproject.supabase.co";
const SECRET = "synthetic-secret-key-value";
const timeoutError = Object.assign(new Error("private detail"), { name: "TimeoutError" });

// Virtual clock. Call 0 is the connection warm-up, calls 1-5 are P1-P5, calls 6-10 are P6-P10.
function harness({ latency = {}, status = {}, fail = {}, channel } = {}) {
  let clock = 0;
  const calls = [];
  const timeouts = [];
  const rooms = [];
  const send = async (endpoint, init) => {
    const index = calls.length;
    calls.push({ url: String(endpoint), init });
    if (index === 0) { clock += 20; return new Response(null, { status: 200 }); }
    const id = "P" + index;
    if (index >= 6) { await null; if (index === 6) clock += latency.concurrent ?? 300; } else clock += latency[id] ?? 300;
    if (fail[id]) { fail[id](endpoint); throw timeoutError; }
    return new Response(null, { status: status[id] ?? 202 });
  };
  let n = 0;
  const makeRoom = () => { const room = "ROOM-SECRET-" + n++; rooms.push(room); return room; };
  return { calls, timeouts, rooms, options: {
    url: URL_BASE, secret: SECRET, send, now: () => clock, makeRoom,
    timeout: ms => { timeouts.push(ms); return new AbortController().signal; },
    ...(channel ? { channel } : {}),
  } };
}

test("a cold first request above the application deadline with fast warm requests reproduces the cold-start hypothesis", async () => {
  const h = harness({ latency: { P1: 3400, P2: 280, P3: 300, P4: 270, P5: 320, concurrent: 450 } });
  const result = await runColdStartProbe(h.options);
  assert.equal(result.verdict, "COLD_START_REPRODUCED");
  assert.equal(result.coldFirstMs, 3400);
  assert.equal(result.warmMedianMs, 290);
  assert.equal(result.warmMaxMs, 320);
  assert.equal(result.concurrentMaxMs, 450);
  assert.equal(result.concurrentOverAppDeadline, 0);
  assert.deepEqual(result.requests.map(r => r.role), [
    "cold_first", "warm_same_room", "warm_other_room", "warm_same_room", "warm_other_room",
    ...Array(5).fill("warm_concurrent")]);
  assert.deepEqual(result.requests.map(r => r.id), ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]);
});

test("the plan is fixed: one warm-up plus ten requests, same and different rooms, a hard diagnostic deadline and no retries", async () => {
  const h = harness();
  const result = await runColdStartProbe(h.options);
  assert.equal(h.calls.length, 11);
  assert.ok(h.calls[0].url.endsWith("/auth/v1/health"));
  assert.equal(h.calls.slice(1).every(call => call.init.method === "POST" && call.init.redirect === "error" &&
    call.url.includes("private=true") && call.url.includes("/realtime/v1/api/broadcast/")), true);
  const topic = call => new URL(call.url).pathname;
  assert.equal(topic(h.calls[1]), topic(h.calls[2]));
  assert.equal(topic(h.calls[1]), topic(h.calls[4]));
  assert.notEqual(topic(h.calls[1]), topic(h.calls[3]));
  assert.equal(new Set(h.calls.slice(6).map(topic)).size, 5);
  assert.equal(result.requests.length, 10);
  assert.ok(h.timeouts.every(ms => ms === REQUEST_DEADLINE_MS) && REQUEST_DEADLINE_MS === 10_000);
  assert.equal(TOTAL_DEADLINE_MS, 75_000);
  assert.equal(result.totalDeadlineMs, 75_000);
  assert.equal(result.appDeadlineMs, 1500);
});

test("a first request that is already fast is inconclusive and is never repeated", async () => {
  const h = harness({ latency: { P1: 600 } });
  const result = await runColdStartProbe(h.options);
  assert.equal(result.verdict, "INCONCLUSIVE_NOT_COLD");
  assert.equal(result.requests.length, 10);
  assert.equal(h.calls.length, 11);
});

test("a body that was written but never answered is not treated as accepted", async () => {
  const handlers = {};
  const channel = { subscribe: (name, fn) => { handlers[name] = fn; }, unsubscribe() {} };
  const h = harness({ channel, fail: { P1: endpoint => {
    handlers["undici:request:bodySent"]({ request: { path: endpoint.pathname + endpoint.search } });
  } } });
  const result = await runColdStartProbe(h.options);
  const [first] = result.requests;
  assert.equal(first.http, null);
  assert.equal(first.failure, "client_deadline");
  assert.notEqual(first.bodyWrittenAfterMs, null);
  assert.equal(result.verdict, "INCONCLUSIVE_FIRST_PROBE_FAILED");
  assert.equal(result.coldFirstMs, null);
});

test("an authorization rejection of the first request stops the probe instead of producing a latency result", async () => {
  const h = harness({ status: { P1: 403 } });
  const result = await runColdStartProbe(h.options);
  assert.equal(result.requests.length, 1);
  assert.equal(h.calls.length, 2);
  assert.equal(result.verdict, "INCONCLUSIVE_FIRST_PROBE_FAILED");
});

test("slow warm requests are reported honestly: same-room slowness invalidates the cold-start result, other-room slowness is a per-room effect", async () => {
  const sameRoom = await runColdStartProbe(harness({ latency: { P1: 3400, P2: 2100 } }).options);
  assert.equal(sameRoom.verdict, "WARM_PATH_NOT_CLEAN");
  const otherRoom = await runColdStartProbe(harness({ latency: { P1: 3400, P3: 2100 } }).options);
  assert.equal(otherRoom.verdict, "PER_ROOM_EFFECT_OBSERVED");
  const failedWarm = await runColdStartProbe(harness({ latency: { P1: 3400 }, status: { P4: 503 } }).options);
  assert.equal(failedWarm.verdict, "WARM_PATH_NOT_CLEAN");
  const slowConcurrent = await runColdStartProbe(harness({ latency: { P1: 3400, concurrent: 2000 } }).options);
  assert.equal(slowConcurrent.verdict, "COLD_START_REPRODUCED");
  assert.equal(slowConcurrent.concurrentOverAppDeadline, 5);
});

test("evidence is rebuilt from enumerations and never contains credentials, URLs, rooms or error messages", async () => {
  const h = harness({ latency: { P1: 3400 }, fail: { P3: () => {} } });
  const raw = await runColdStartProbe(h.options);
  const probe = readProbe(JSON.parse(JSON.stringify(raw)));
  assert.ok(probe);
  const text = JSON.stringify(probe);
  for (const forbidden of [SECRET, "supabase.co", "private detail", "http", ...h.rooms]) {
    if (forbidden === "http") continue;
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(text.includes("https://"), false);
  assert.equal(readProbe({ ...raw, requests: [{ ...raw.requests[0], failure: "https://leak.invalid" }] }), null);
  assert.equal(readProbe({ ...raw, verdict: "ALL GOOD" }), null);
  assert.equal(readProbe({ ...raw, requests: [...raw.requests, ...raw.requests] }), null);
  assert.equal(classify(Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("10.0.0.1"), { code: "ECONNRESET" }) })), "connection_reset");
});

test("only the designated HTTPS project origin and a non-empty key are accepted", async () => {
  for (const url of ["http://exampleproject.supabase.co", "https://evil.example.com", "https://exampleproject.supabase.co/x", "https://a.supabase.co.evil.com"]) {
    await assert.rejects(runColdStartProbe({ ...harness().options, url }), /^Error: PROBE_CONFIGURATION_INVALID$/);
  }
  await assert.rejects(runColdStartProbe({ ...harness().options, secret: "" }), /^Error: PROBE_CONFIGURATION_INVALID$/);
});

// --- Lease, cleanup and verdict (fail closed) ---
const fresh = () => ({ mode: "cold-start-probe", preflight: { status: "PASS" },
  gates: { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" }, workload: [] });
const probeResult = async () => runColdStartProbe(harness({ latency: { P1: 3400 } }).options);
function sessionDeps({ acquired = true, released = true, readback = () => {}, probe = probeResult } = {}) {
  const log = [];
  class Client {
    constructor() { log.push("new"); }
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
    probe: async options => { log.push("probe"); return probe(options); },
    sleep: async ms => { sleeps.push(ms); },
  } };
}

test("a successful session holds the lease only around the probe, releases it and verifies an independent readback", async () => {
  const { log, deps } = sessionDeps();
  const evidence = fresh();
  await runProbeSession({}, evidence, deps);
  assert.deepEqual(log, ["new", "connect", "lock", "probe", "unlock", "end", "readback"]);
  assert.equal(evidence.gates.D, "PASS");
  assert.deepEqual(evidence.cleanup, { leaseRelease: "released", readback: "PASS" });
  assert.equal(decideVerdict(evidence, false), "COLD-START PROBE REPRODUCED");
});

test("a busy lease never sends a probe request", async () => {
  const { log, deps } = sessionDeps({ acquired: false });
  const evidence = fresh();
  await assert.rejects(runProbeSession({}, evidence, deps), /^Error: LEASE_BUSY$/);
  assert.equal(log.includes("probe"), false);
  assert.equal(log.includes("unlock"), false);
  assert.equal(evidence.probe, undefined);
  assert.equal(evidence.gates.D, "UNCONFIRMED");
  assert.equal(decideVerdict({ ...evidence, failure: { phase: "qualification" } }, false), "HOLD");
});

test("an unacknowledged lease release or a failing readback keeps Gate D unconfirmed and the verdict on HOLD", async () => {
  const unacknowledged = sessionDeps({ released: false });
  const a = fresh();
  await runProbeSession({}, a, unacknowledged.deps);
  assert.equal(a.gates.D, "UNCONFIRMED");
  assert.equal(decideVerdict(a, false), "HOLD");

  const dirty = sessionDeps({ readback: () => { throw new Error("STAGING_ISOLATION_FAILED"); } });
  const b = fresh();
  await runProbeSession({}, b, dirty.deps);
  assert.deepEqual(dirty.sleeps, [135_000]);
  assert.equal(dirty.log.filter(entry => entry === "readback").length, 2);
  assert.equal(b.gates.D, "UNCONFIRMED");
  assert.deepEqual(b.cleanup, { leaseRelease: "released", readback: "FAIL" });
  assert.equal(decideVerdict(b, false), "HOLD");
});

test("a failing probe still releases the lease and reads back before the error surfaces", async () => {
  const { log, deps } = sessionDeps({ probe: async () => { throw new Error("PROBE_CONFIGURATION_INVALID"); } });
  const evidence = fresh();
  await assert.rejects(runProbeSession({}, evidence, deps), /PROBE_CONFIGURATION_INVALID/);
  assert.deepEqual(log, ["new", "connect", "lock", "probe", "unlock", "end", "readback"]);
  assert.equal(evidence.gates.D, "PASS");
  assert.equal(decideVerdict(evidence, false), "HOLD");
});

test("the scoped probe verdict is diagnostic only: gates A-C stay NOT RUN and nothing becomes acceptance", async () => {
  const { deps } = sessionDeps();
  const evidence = fresh();
  await runProbeSession({}, evidence, deps);
  assert.doesNotMatch(decideVerdict(evidence, false), /GATE|ALL/);
  for (const gate of ["A", "B", "C"]) {
    assert.equal(decideVerdict({ ...evidence, gates: { ...evidence.gates, [gate]: "PASS" } }, false), "HOLD");
  }
  assert.equal(decideVerdict(evidence, true), "HOLD");
  assert.equal(decideVerdict({ ...evidence, probe: undefined }, false), "HOLD");
  assert.equal(decideVerdict({ ...evidence, probe: { ...evidence.probe, verdict: "INCONCLUSIVE_NOT_COLD" } }, false), "COLD-START PROBE INCONCLUSIVE");
  assert.equal(decideVerdict({ ...evidence, probe: { ...evidence.probe, verdict: "WARM_PATH_NOT_CLEAN" } }, false), "COLD-START PROBE COMPLETE: WARM PATH NOT CLEAN");
});

test("the probe mode needs the same exact-candidate exclusive dispatch as the other hosted modes", () => {
  const dispatch = {
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "KaisAbiyyi/cinemania", GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1", DISPATCH_SHA: "00555c03d4173ac54750677207b78252e2063257",
    DISPATCH_PROJECT: "dmrbticnsczhyaiftrar", DISPATCH_EXCLUSIVE: "true", DISPATCH_MODE: "cold-start-probe",
  };
  assert.doesNotThrow(() => authorize(dispatch));
  assert.throws(() => authorize({ ...dispatch, DISPATCH_EXCLUSIVE: "false" }), /^Error: DISPATCH_/);
  assert.throws(() => authorize({ ...dispatch, DISPATCH_SHA: "a".repeat(40) }), /^Error: DISPATCH_/);
  assert.throws(() => authorize({ ...dispatch, DISPATCH_PROJECT: "other" }), /^Error: DISPATCH_/);
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "cold-start" }), /^Error: DISPATCH_/);
});
