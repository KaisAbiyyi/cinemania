/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { authorize, verifyLivePR, configureStaging, observeLine, readBrowserReport, stableWorkload, verifiedCleanup } =
  require("./qualification.cjs");

const sha = "00555c03d4173ac54750677207b78252e2063257";
const dispatch = {
  GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: "KaisAbiyyi/cinemania",
  GITHUB_REF: "refs/heads/main", GITHUB_RUN_ATTEMPT: "1", DISPATCH_SHA: sha,
  DISPATCH_PROJECT: "dmrbticnsczhyaiftrar", DISPATCH_EXCLUSIVE: "true", DISPATCH_MODE: "full",
};

test("only a fresh main dispatch can authorize the exact candidate and exclusive project", () => {
  assert.doesNotThrow(() => authorize(dispatch));
  for (const [key, value] of Object.entries({
    GITHUB_EVENT_NAME: "pull_request", GITHUB_REPOSITORY: "test/fork", GITHUB_REF: "refs/tags/main",
    GITHUB_RUN_ATTEMPT: "2", DISPATCH_SHA: "a".repeat(40), DISPATCH_PROJECT: "other",
    DISPATCH_EXCLUSIVE: "false", DISPATCH_MODE: "resume",
  })) assert.throws(() => authorize({ ...dispatch, [key]: value }), /^Error: DISPATCH_/);
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
  const state = { exitCode: 0 };
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
