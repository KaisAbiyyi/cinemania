/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runGateSequence, decideVerdict, authorize, verifyLivePR, configureStaging, observeLine, readBrowserReport, stableWorkload, verifiedCleanup } =
  require("./qualification.cjs");

const sha = "45abb39b8706311dd791a8f09cd904498fb29287";
const dispatch = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "KaisAbiyyi/cinemania",
  GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1", DISPATCH_SHA: sha,
  DISPATCH_PROJECT: "dmrbticnsczhyaiftrar", DISPATCH_EXCLUSIVE: "true", DISPATCH_MODE: "gate-a-only",
};

test("only a fresh main dispatch can authorize the exact candidate and exclusive project", () => {
  assert.doesNotThrow(() => authorize(dispatch));
  for (const [key, value] of Object.entries({
    GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "test/fork", GITHUB_REF: "refs/tags/main",
    GITHUB_RUN_ATTEMPT: "2", DISPATCH_SHA: "a".repeat(40), DISPATCH_PROJECT: "other",
    DISPATCH_EXCLUSIVE: "false", DISPATCH_MODE: "resume",
  })) assert.throws(() => authorize({ ...dispatch, [key]: value }), /^Error: DISPATCH_/);
});

test("full mode is refused by the consent step itself, before any staging step, whatever else is valid", () => {
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "full" }), /^Error: FULL_MODE_NOT_ADMITTED$/);
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "gate-b-only" }), /^Error: GATE_B_NOT_ADMITTED$/);
  for (const mode of ["preflight", "cold-start-probe", "gate-a-only", "gate-c-chromium", "gate-c-firefox", "gate-c-webkit", "aggregate"]) {
    assert.doesNotThrow(() => authorize({ ...dispatch, DISPATCH_MODE: mode }));
  }
  // aggregate touches no staging and needs no exclusive window; every staged mode still does
  assert.doesNotThrow(() => authorize({ ...dispatch, DISPATCH_MODE: "aggregate", DISPATCH_EXCLUSIVE: "false" }));
  for (const mode of ["gate-c-chromium", "gate-c-webkit"]) {
    assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: mode, DISPATCH_EXCLUSIVE: "false" }), /^Error: DISPATCH_CONSENT_REFUSED$/);
  }
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "aggregate", DISPATCH_SHA: "a".repeat(40) }), /^Error: DISPATCH_CONSENT_REFUSED$/);
  // An invalid request still reports the consent failure first; only a fully consented full request reports the guard.
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "full", DISPATCH_EXCLUSIVE: "false" }), /^Error: DISPATCH_CONSENT_REFUSED$/);
});

test("missing or multiline credentials fail before touching disk", () => {
  assert.throws(() => configureStaging("/unused", { SUPABASE_PG_PASSWORD: "test\nNO" }),
    /STAGING_CONFIGURATION_MISSING/);
});

function browserReport({ status = "passed", expectedStatus = "passed", duplicates = false, delta = -19 } = {}) {
  const test = { projectName: "webkit", status: status === "passed" ? "expected" : "unexpected", expectedStatus,
    results: [{ status, attachments: [{ name: "convergence-evidence.json", body: Buffer.from(JSON.stringify({
      expectedVersion: 7,
      clients: [{ hintDelivered: true, snapshotReadAtVersion: true, snapshotStartedAfterHint: delta >= 0, hintToSnapshotStartMs: delta,
        hintAfterAnchorMs: 42, snapshotStartAfterAnchorMs: 23, renderedAfterAnchorMs: 61, token: "hidden" }],
    })).toString("base64") }] }],
  };
  return { errors: [], suites: [{ specs: [{ title: "target", tests: duplicates ? [test, test] : [test] }] }] };
}

test("restricts the browser inventory and retains frame/GET ordering independently", () => {
  const result = readBrowserReport(browserReport(), { webkit: ["target"] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.counts.webkit, { selected: 1, passed: 1 });
  assert.deepEqual(result.convergence[0].clients[0], { hint: true, snapshot: true, snapshotStartedAfterHint: false,
    hintAfterAnchorMs: 42, snapshotStartAfterAnchorMs: 23, renderedAfterAnchorMs: 61 });
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  for (const [delta, observed] of [[8, true], [0, null]]) {
    const timing = readBrowserReport(browserReport({ delta }), { webkit: ["target"] });
    assert.equal(timing.convergence[0].clients[0].snapshotStartedAfterHint, observed);
  }
  assert.equal(readBrowserReport(browserReport({ status: "skipped" }), { webkit: ["target"] }).valid, false);
  assert.equal(readBrowserReport(browserReport({ expectedStatus: "failed" }), { webkit: ["target"] }).valid, false);
  assert.equal(readBrowserReport(browserReport({ duplicates: true }), { webkit: ["target"] }).valid, false);
  assert.equal(readBrowserReport(browserReport(), { webkit: ["different"] }).valid, false);
});

test("only known fields survive supervisor log capture and the first failure sticks", () => {
  const state = {};
  const at = "2026-11-23T12:00:00.000Z";
  observeLine(state, "postgres://test:should-not-leak@localhost");
  observeLine(state, "CINE026_HOSTED_FAILURE " + JSON.stringify({ phase: "monitor", code: "ECONNRESET",
    at, primary: true, raw: "should-not-leak" }));
  observeLine(state, "CINE026_HOSTED_FAILURE " + JSON.stringify({ phase: "cleanup_audit", code: "CLEANUP_UNCONFIRMED", at }));
  observeLine(state, "CINE026_WORKER_RECOVERY " + JSON.stringify({ appCommit: sha, versions: [6, 7],
    receiptToPrivateHintMs: [5, 7], receiptToDurableReadbackMs: [8, 9], token: "should-not-leak" }));
  assert.deepEqual(state.firstFailure, { phase: "monitor", code: "ECONNRESET", at });
  assert.deepEqual(state.worker.versions, [6, 7]);
  assert.equal(JSON.stringify(state).includes("should-not-leak"), false);
});

test("transport diagnostics are rebuilt from fixed enumerations and reject malformed or leaking input", () => {
  const good = {
    http: { count: 8, okCount: 8, nonOkCount: 0, maxMs: 410, over1000Ms: 0, over1400Ms: 0 },
    outcomes: { marked: 8, retry_scheduled: 1, deferred: 3, permanent_rejection: 0 },
    failures: [{ category: "client_deadline", code: null, phase: "request_written_awaiting_response", ms: 1502, version: 8,
      startedAt: "2026-11-24T00:00:01.000Z", httpResponseReceived: false, url: "https://should-not-leak.invalid",
      outbox: [{ outcome: "retry_scheduled", attempt: 1, count: 1, observedAfterFailureMs: 100, room: "should-not-leak" }] }],
    omittedFailures: 0, token: "should-not-leak",
  };
  const state = {};
  observeLine(state, "CINE026_TRANSPORT_DIAGNOSTICS " + JSON.stringify(good));
  assert.equal(state.transport.failures[0].category, "client_deadline");
  assert.equal(JSON.stringify(state).includes("should-not-leak"), false);
  const bad = { ...good, failures: [{ ...good.failures[0], category: "https://should-not-leak.invalid" }] };
  const rejected = {};
  observeLine(rejected, "CINE026_TRANSPORT_DIAGNOSTICS " + JSON.stringify(bad));
  assert.equal(rejected.transport, undefined);
  assert.equal(JSON.stringify(rejected).includes("should-not-leak"), false);
});

test("an unacknowledged release, stranded process or missing evidence never passes cleanup", () => {
  const zero = keys => Object.fromEntries(keys.split(" ").map(key => [key, 0]));
  const metrics = { leaseRelease: "released", cleanupVerified: true,
    counts: zero("capacity escapedReset checkedOutReset idleReset lockTimeout providerTransport providerStatus"),
    peaks: zero("pending poison retries oldest_pending_ms advisory_waiters idle_transactions other_role_sessions"),
    final: zero("rooms participants votes events pending poison retries oldest_pending_ms advisory_locks advisory_waiters idle_transactions other_role_sessions other_role_nonidle_sessions") };
  const state = { exitCode: 0, terminalMilestone: true, transport: { http: { okCount: 1, nonOkCount: 0 }, failures: [], omittedFailures: 0 } };
  observeLine(state, "CINE026_HOSTED_METRICS " + JSON.stringify(metrics));
  assert.equal(stableWorkload(state), true);
  assert.equal(verifiedCleanup({ ...state, remainingProcesses: true }), false);
  assert.equal(verifiedCleanup({ ...state, metrics: { ...metrics, leaseRelease: "verified_absent" } }), false);
  assert.equal(verifiedCleanup({ ...state, metrics: { ...metrics, final: {} } }), false);
  assert.equal(stableWorkload({ ...state, metrics: { ...metrics, counts: { ...metrics.counts, capacity: 1 } } }), false);
});

test("PR lookup uses the runner token without redirects and rejects failed or changed evidence", async () => {
  const pr = { state: "open", draft: true,
    head: { sha, ref: "feature/cine-026-063-integration", repo: { full_name: "KaisAbiyyi/cinemania" } } };
  const request = async (url, options) => {
    assert.equal(url, "https://api.github.com/repos/KaisAbiyyi/cinemania/pulls/66");
    assert.equal(options.headers.authorization, "Bearer test-token");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => pr };
  };
  await assert.doesNotReject(() => verifyLivePR("test-token", request));
  await assert.rejects(() => verifyLivePR("", request), /PR_LOOKUP_TOKEN_MISSING/);
  await assert.rejects(() => verifyLivePR("test-token", async () => ({ ok: false, status: 403 })),
    /PR_LOOKUP_HTTP_403/);
  pr.head.sha = "0".repeat(40);
  await assert.rejects(() => verifyLivePR("test-token", request), /PR_CANDIDATE_MISMATCH/);
});

const readyWarmup = () => ({ status: "READY", requests: [], cleanup: { leaseRelease: "released", readback: "PASS" } });
const freshEvidence = (mode, preflight = "PASS") => ({ mode, preflight: { status: preflight },
  gates: { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" }, workload: [],
  ...(mode === "gate-a-only" || mode === "full" || mode === "gate-b-only" || mode.startsWith("gate-c-") ? { warmup: readyWarmup() } : {}) });
const GATE_A_VERDICT = "WARM-PATH GATE A ONLY PASSED; COLD-PATH NOT QUALIFIED";
const FULL_VERDICT = "WARM-PATH ACCEPTANCE: ALL GATES PASSED; COLD-PATH RECOVERY NOT QUALIFIED";
const recorder = failAt => {
  const calls = [];
  const run = async (gate, browser) => { calls.push(gate + (browser ? ":" + browser : "")); return calls.length !== failAt; };
  return { calls, run };
};

test("gate-a-only is an authorized mode, and unknown modes remain refused", () => {
  assert.doesNotThrow(() => authorize({ ...dispatch, DISPATCH_MODE: "gate-a-only" }));
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "gate-a" }), /^Error: DISPATCH_CONSENT_REFUSED$/);
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "gate-a-only", DISPATCH_EXCLUSIVE: "false" }), /^Error: DISPATCH_/);
  assert.throws(() => authorize({ ...dispatch, DISPATCH_MODE: "gate-a-only", DISPATCH_SHA: "a".repeat(40) }), /^Error: DISPATCH_/);
});

test("a fully passing Gate A under gate-a-only never dispatches Gate B or C", async () => {
  const { calls, run } = recorder(0);
  const evidence = freshEvidence("gate-a-only");
  await runGateSequence("gate-a-only", run, evidence);
  assert.deepEqual(calls, ["A:chromium", "A:firefox", "A:webkit"]);
  assert.deepEqual(evidence.gates, { A: "PASS", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" });
  evidence.gates.D = "PASS";
  assert.equal(decideVerdict(evidence, false), GATE_A_VERDICT);
});

test("full mode still proceeds from Gate A to B and C, and only then reports complete acceptance", async () => {
  const { calls, run } = recorder(0);
  const evidence = freshEvidence("full");
  await runGateSequence("full", run, evidence);
  assert.deepEqual(calls, ["A:chromium", "A:firefox", "A:webkit", "B", "C"]);
  evidence.gates.D = "PASS";
  assert.equal(decideVerdict(evidence, false), FULL_VERDICT);
});

test("a gate-c mode runs only its own browser's 13 source-bound cases and reports only its scoped verdict", async () => {
  const { titles } = { titles: require("./qualification.cjs").modePlan("gate-c-chromium")[0].targets };
  assert.equal(titles.length, 13);
  for (const [mode, browser] of [["gate-c-chromium", "chromium"], ["gate-c-firefox", "firefox"], ["gate-c-webkit", "webkit"]]) {
    const seen = [];
    const evidence = freshEvidence(mode);
    await runGateSequence(mode, async (gate, b, targets) => { seen.push([gate, b, targets]); return true; }, evidence);
    assert.deepEqual(seen, [["C", browser, titles]]);
    assert.deepEqual(evidence.gates, { A: "NOT RUN", B: "NOT RUN", C: "PASS", D: "NOT RUN" });
    assert.equal(decideVerdict(evidence, false), "HOLD", "Gate D is required");
    evidence.gates.D = "PASS";
    assert.equal(decideVerdict(evidence, false), "WARM-PATH GATE C " + browser.toUpperCase() + " ONLY PASSED; COLD-PATH NOT QUALIFIED");
    assert.equal(decideVerdict({ ...evidence, gates: { ...evidence.gates, A: "PASS" } }, false), "HOLD", "another gate running is not scoped");
    assert.equal(decideVerdict({ ...evidence, warmup: undefined }, false), "HOLD", "an unwarmed run is never a pass");
    const failed = freshEvidence(mode);
    await runGateSequence(mode, async () => false, failed);
    failed.gates.D = "PASS";
    assert.equal(failed.gates.C, "FAIL");
    assert.equal(decideVerdict(failed, false), "HOLD");
  }
  const b = freshEvidence("gate-b-only");
  const calls = [];
  await runGateSequence("gate-b-only", async (gate, browser) => { calls.push([gate, browser]); return true; }, b);
  assert.deepEqual(calls, [["B", undefined]]);
  b.gates.D = "PASS";
  assert.equal(decideVerdict(b, false), "WARM-PATH GATE B ONLY PASSED; COLD-PATH NOT QUALIFIED");
});

test("a per-browser Gate C workload needs complete case progress exactly like Gate A", () => {
  const { workloadPasses } = require("./qualification.cjs");
  const stable = { exitCode: 0, terminalMilestone: true, metrics: { leaseRelease: "released", cleanupVerified: true,
    final: Object.fromEntries("rooms participants votes events pending poison retries oldest_pending_ms advisory_locks advisory_waiters idle_transactions other_role_sessions other_role_nonidle_sessions".split(" ").map(k => [k, 0])),
    counts: Object.fromEntries("capacity escapedReset checkedOutReset idleReset lockTimeout providerTransport providerStatus".split(" ").map(k => [k, 0])),
    peaks: {} }, transport: { http: { okCount: 1, nonOkCount: 0 }, outcomes: { marked: 1, retry_scheduled: 0, permanent_rejection: 0 }, failures: [], omittedFailures: 0 },
  progress: { sampleCount: 1, dispatched: { lowerBound: 1 }, retried: { lowerBound: 0 }, reporter: { total: null, rejected: 0 }, cases: [], runEnd: null } };
  assert.equal(workloadPasses("C", stable, { valid: true }), true, "the refused all-browser Gate C keeps its old rule");
  assert.equal(workloadPasses("C", stable, { valid: true }, 13), false, "a per-browser selection without progress never passes");
});

test("a Gate A failure stops execution before later browsers and never passes", async () => {
  for (const mode of ["gate-a-only", "full"]) {
    const { calls, run } = recorder(2);
    const evidence = freshEvidence(mode);
    await runGateSequence(mode, run, evidence);
    assert.deepEqual(calls, ["A:chromium", "A:firefox"]);
    assert.deepEqual(evidence.gates, { A: "FAIL", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" });
    evidence.gates.D = "PASS";
    assert.equal(decideVerdict(evidence, false), "HOLD");
  }
});

test("unconfirmed cleanup, setup failure, interruption or missing workload keep gate-a-only on HOLD", async () => {
  const { run } = recorder(0);
  const passed = () => ({ ...freshEvidence("gate-a-only") });
  const evidence = passed();
  await runGateSequence("gate-a-only", run, evidence);
  assert.equal(decideVerdict({ ...evidence, gates: { ...evidence.gates, D: "UNCONFIRMED" } }, false), "HOLD");
  assert.equal(decideVerdict({ ...evidence, gates: { ...evidence.gates, D: "NOT RUN" } }, false), "HOLD");
  const clean = { ...evidence, gates: { ...evidence.gates, D: "PASS" } };
  assert.equal(decideVerdict(clean, false), GATE_A_VERDICT);
  assert.equal(decideVerdict(clean, true), "HOLD");
  assert.equal(decideVerdict({ ...clean, failure: { phase: "qualification" } }, false), "HOLD");
  assert.equal(decideVerdict({ ...clean, preflight: { status: "FAIL" } }, false), "HOLD");
  // B or C ever running under the scoped mode cannot yield the scoped verdict.
  assert.equal(decideVerdict({ ...clean, gates: { ...clean.gates, B: "PASS" } }, false), "HOLD");
  assert.equal(decideVerdict(freshEvidence("preflight"), false), "READ-ONLY PREFLIGHT PASSED");
});

test("a workload with unverified cleanup fails its Gate A stage, so cleanup failures stay blocking", () => {
  const zero = keys => Object.fromEntries(keys.split(" ").map(key => [key, 0]));
  const metrics = { leaseRelease: "released", cleanupVerified: true,
    counts: zero("capacity escapedReset checkedOutReset idleReset lockTimeout providerTransport providerStatus"),
    peaks: zero("pending poison retries oldest_pending_ms advisory_waiters idle_transactions other_role_sessions"),
    final: zero("rooms participants votes events pending poison retries oldest_pending_ms advisory_locks advisory_waiters idle_transactions other_role_sessions other_role_nonidle_sessions") };
  const ok = { exitCode: 0, terminalMilestone: true, metrics, transport: { http: { okCount: 1, nonOkCount: 0 }, failures: [], omittedFailures: 0 } };
  assert.equal(stableWorkload(ok), true);
  for (const broken of [
    { ...ok, metrics: { ...metrics, cleanupVerified: false } },
    { ...ok, metrics: { ...metrics, final: { ...metrics.final, rooms: 1 } } },
    { ...ok, metrics: { ...metrics, counts: { ...metrics.counts, providerTransport: 1 } } },
    { ...ok, transport: { http: { okCount: 0 }, failures: [], omittedFailures: 0 } },
    { ...ok, transport: { http: { okCount: 1, nonOkCount: 0 }, failures: [], omittedFailures: 1 } },
    { ...ok, remainingProcesses: true }, { ...ok, executionTimedOut: true }, { ...ok, interrupted: true },
  ]) assert.equal(stableWorkload(broken), false);
});

test("reproduction (run 45775582526, Chromium): eight events dispatched in the database but one marked outcome observed never passes", () => {
  const { observeProgressLine } = require("./workload-progress.cjs");
  const { transportProblems, workloadPasses } = require("./qualification.cjs");
  const zero = keys => Object.fromEntries(keys.split(" ").map(key => [key, 0]));
  const metrics = { leaseRelease: "released", cleanupVerified: true,
    counts: zero("capacity escapedReset checkedOutReset idleReset lockTimeout providerTransport providerStatus"),
    peaks: zero("pending poison retries oldest_pending_ms advisory_waiters idle_transactions other_role_sessions"),
    final: zero("rooms participants votes events pending poison retries oldest_pending_ms advisory_locks advisory_waiters idle_transactions other_role_sessions other_role_nonidle_sessions") };
  const transport = (n, marked = n, retry = 0) => ({ http: { count: n, okCount: n, nonOkCount: 0, maxMs: 409, over1000Ms: 0, over1400Ms: 0 },
    outcomes: { marked, retry_scheduled: retry, deferred: 0, permanent_rejection: 0 }, failures: [], omittedFailures: 0 });
  const sampled = (series, base) => {
    const state = { ...base };
    for (const [events, pending, retries = 0] of series) {
      observeProgressLine(state, "CINE026_DB_SAMPLE " + JSON.stringify({ votes: 3, events, pending, poison: 0, retries, rooms: 1, participants: 2,
        advisoryWaiters: 0, idleTransactions: 0, oldestPendingMs: 0, rttMs: 147 }), { startedMs: 0, nowMs: () => 1 });
    }
    return state;
  };
  const series = [[0, 0], [2, 2], [4, 1], [6, 0], [8, 1], [8, 0]];
  const base = { exitCode: 0, terminalMilestone: true, metrics };
  // Only the worker's single attempt was observed; the application server's seven were lost (T1).
  const lost = sampled(series, { ...base, transport: transport(1) });
  assert.equal(stableWorkload(lost), true, "the old decision passes vacuously");
  assert.deepEqual(transportProblems(lost), ["marked_below_dispatched", "http_ok_below_dispatched"]);
  // Gate C decides on the stable workload and the report alone, so the completeness check is the only difference.
  assert.equal(workloadPasses("C", lost, { valid: true }), false);
  const complete = sampled(series, { ...base, transport: transport(8) });
  assert.deepEqual(transportProblems(complete), []);
  assert.equal(workloadPasses("C", complete, { valid: true }), true);
  // an ambiguous acknowledgement replays the head, so more marked outcomes than events are fine
  assert.deepEqual(transportProblems(sampled(series, { ...base, transport: transport(9) })), []);
  assert.deepEqual(transportProblems(sampled(series, { ...base, transport: transport(8, 7) })), ["marked_below_dispatched"]);
  assert.deepEqual(transportProblems({ ...base, transport: transport(8) }), ["db_samples_missing"], "no independent count is no pass");
  assert.deepEqual(transportProblems(sampled(series, base)), ["transport_missing"]);
  // Failure side: the database recorded a failed attempt (retry_count 1) that the diagnostics never showed.
  const retriedSeries = [[0, 0], [2, 2], [2, 1, 1], [2, 0, 1]];
  assert.deepEqual(transportProblems(sampled(retriedSeries, { ...base, transport: transport(2) })), ["failures_below_db_retries"]);
  assert.deepEqual(transportProblems(sampled(retriedSeries, { ...base, transport: transport(2, 2, 1) })), []);
});

// The refusal of full mode must happen in the job that has no staging access, before the staging job can start.
test("the consent step that refuses full mode runs in the verify job and the staging job depends on it", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/cine026-hosted-qualification.yml"), "utf8");
  const verify = workflow.slice(workflow.indexOf("\n  verify:"), workflow.indexOf("\n  qualify:"));
  const qualify = workflow.slice(workflow.indexOf("\n  qualify:"));
  assert.match(verify, /run: node scripts\/cine026-actions\/qualification\.cjs authorize/);
  assert.match(verify, /DISPATCH_MODE: \$\{\{ inputs\.mode \}\}/);
  assert.doesNotMatch(verify, /SUPABASE_|environment:/, "the verify job has no staging credentials or environment");
  assert.match(qualify, /needs: verify/);
  assert.match(qualify, /environment: cine026-staging/);
});
