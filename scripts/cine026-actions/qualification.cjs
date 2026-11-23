/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { readProbe, runColdStartProbe } = require("./cold-start-probe.cjs");
const { readWarmup, warmRealtimeTenant } = require("./realtime-warmup.cjs");

const { planWorkload, superviseWorkload } = require("./workload-supervision.cjs");

const candidate = path.resolve("candidate");
const temp = process.env.RUNNER_TEMP;
const project = "dmrbticnsczhyaiftrar";
const sha = "00555c03d4173ac54750677207b78252e2063257";
const dispatchModes = ["preflight", "cold-start-probe", "gate-a-only", "full"];
const browsers = ["chromium", "firefox", "webkit"];
const fields = ["rooms", "participants", "votes", "events", "pending", "poison",
  "retries", "oldest_pending_ms", "advisory_locks", "advisory_waiters",
  "idle_transactions", "other_role_sessions", "other_role_nonidle_sessions"];
const countFields = ["capacity", "escapedReset", "checkedOutReset", "idleReset",
  "lockTimeout", "providerTransport", "providerStatus"];
const peakFields = ["pending", "poison", "retries", "oldest_pending_ms", "advisory_waiters",
  "idle_transactions", "other_role_sessions"];
const supervisorCodes = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENETDOWN", "ENETUNREACH", "EHOSTUNREACH",
  "ENOTFOUND", "EAI_AGAIN", "08000", "08001", "08003", "08006", "57P01", "57P02", "57P03",
  "53300", "57014", "55P03", "PG_READ_TIMEOUT", "RUNNER_SETUP_FAILED", "SUPERVISOR_CONNECTION_FAILED",
  "LEASE_BUSY", "BUILD_FAILED", "WORKER_NOT_READY", "MONITOR_FAILED", "WORKER_EXITED", "WORKLOAD_FAILED",
  "SUPERVISOR_OPERATION_FAILED", "CHILD_STOP_FAILED", "PORTS_UNCONFIRMED", "SHUTDOWN_STATE_UNCONFIRMED",
  "LEASE_RELEASE_UNCONFIRMED", "SUPERVISOR_CLOSE_UNCONFIRMED", "AUDIT_CONNECTION_FAILED",
  "CLEANUP_UNCONFIRMED", "AUDIT_CLOSE_UNCONFIRMED", "MOCK_CLEANUP_FAILED",
]);
const supervisorPhases = new Set([
  "runner_setup", "connect", "lease_acquire", "preflight", "build", "worker_start", "monitor", "workload",
  "phase_stop", "worker_stop", "port_check", "shutdown_read", "lease_release", "supervisor_close",
  "cleanup_audit", "audit_close", "mock_cleanup",
]);
const rootCredentials = [
  "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWT_SECRET",
  "SUPABASE_PG_HOST", "SUPABASE_PG_USER", "SUPABASE_PG_PASSWORD",
];

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function authorize(env) {
  requireCondition(env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
    env.GITHUB_REPOSITORY === "KaisAbiyyi/cinemania" && env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_RUN_ATTEMPT === "1", "DISPATCH_CONTEXT_REFUSED");
  requireCondition(env.DISPATCH_SHA === sha && env.DISPATCH_PROJECT === project &&
    env.DISPATCH_EXCLUSIVE === "true" && dispatchModes.includes(env.DISPATCH_MODE),
  "DISPATCH_CONSENT_REFUSED");
}

function verifyCheckout() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: candidate, encoding: "utf8" }).trim();
  requireCondition(head === sha, "CHECKOUT_SHA_MISMATCH");
}

async function verifyLivePR(token, request = fetch) {
  requireCondition(token, "PR_LOOKUP_TOKEN_MISSING");
  let response;
  try {
    response = await request("https://api.github.com/repos/KaisAbiyyi/cinemania/pulls/66", {
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json" },
      redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("PR_LOOKUP_TRANSPORT_FAILED");
  }
  requireCondition(response.ok, "PR_LOOKUP_HTTP_" + response.status);
  const pr = await response.json();
  requireCondition(pr.state === "open" && pr.draft === true && pr.head?.sha === sha &&
    pr.head?.ref === "feature/cine-026-063-integration" && pr.head?.repo?.full_name === "KaisAbiyyi/cinemania",
  "PR_CANDIDATE_MISMATCH");
}

function configureStaging(directory, env, synthetic = false) {
  const staged = { ...env };
  const values = Object.fromEntries(rootCredentials.map(key => [key, env[key]]));
  if (synthetic) {
    for (const key of rootCredentials) values[key] = "synthetic-list-only";
    values.SUPABASE_PG_HOST = "db." + project + ".supabase.co";
  }
  requireCondition(rootCredentials.every(key => typeof values[key] === "string" &&
    values[key].trim() === values[key] && values[key].length > 0 && !/[\r\n\0]/.test(values[key])),
  "STAGING_CONFIGURATION_MISSING");
  const config = { ...values, SUPABASE_URL: "https://" + project + ".supabase.co",
    SUPABASE_PG_PORT: "5432", SUPABASE_PG_DATABASE: "postgres" };
  const credentials = path.join(directory, "staging.env");
  fs.writeFileSync(credentials, Object.entries(config).map(([key, value]) => key + "=" + value).join("\n"),
    { flag: "wx", mode: 0o600 });
  for (const key of [...rootCredentials, "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED"]) {
    delete staged[key];
  }
  return { ...staged, CINE018_STAGING_PROJECT: project, CINE018_STAGING_ENV_FILE: credentials };
}

function numericFields(value, keys) {
  if (!value || !keys.every(key => Number.isFinite(value[key]) && value[key] >= 0)) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function readFailure(value) {
  if (!supervisorPhases.has(value?.phase) || !supervisorCodes.has(value?.code) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at)) return null;
  return { phase: value.phase, code: value.code, at: value.at };
}

function readMetrics(value) {
  if (!["released", "verified_absent", "unconfirmed", "not_acquired"].includes(value?.leaseRelease) ||
    typeof value.cleanupVerified !== "boolean" || (value.firstFailure && !readFailure(value.firstFailure))) return null;
  return {
    firstFailure: readFailure(value.firstFailure), leaseRelease: value.leaseRelease,
    cleanupVerified: value.cleanupVerified, final: numericFields(value.final, fields),
    counts: numericFields(value.counts, countFields), peaks: numericFields(value.peaks, peakFields),
  };
}

function readWorker(value) {
  const timings = key => Array.isArray(value[key]) && value[key].length === 2 &&
    value[key].every(ms => Number.isFinite(ms) && ms >= 0);
  if (value?.appCommit !== sha || JSON.stringify(value.versions) !== "[6,7]" ||
    !timings("receiptToPrivateHintMs") || !timings("receiptToDurableReadbackMs")) return null;
  return { appCommit: sha, versions: [6, 7], receiptToPrivateHintMs: value.receiptToPrivateHintMs,
    receiptToDurableReadbackMs: value.receiptToDurableReadbackMs };
}

const transportCategories = new Set([
  "client_deadline", "client_abort", "dns_failure", "connect_timeout", "connect_unreachable",
  "connection_reset", "connection_closed", "response_timeout", "tls_failure", "unexpected_redirect",
  "unknown_fetch_failure",
]);
const transportPhases = new Set([
  "connecting_or_queued", "request_head_written", "request_written_awaiting_response", "unobserved",
]);
const transportOutcomes = new Set(["marked", "retry_scheduled", "deferred", "permanent_rejection"]);
const count = value => Number.isSafeInteger(value) && value >= 0;

// Sanitized publisher/outbox attempt diagnostics. Every emitted value is rebuilt from fixed enumerations,
// bounded counters and ISO timestamps; nothing is copied from the child's output verbatim.
function readTransport(value) {
  const http = numericFields(value?.http, ["count", "okCount", "nonOkCount", "maxMs", "over1000Ms", "over1400Ms"]);
  const outcomes = numericFields(value?.outcomes, [...transportOutcomes]);
  if (!http || !outcomes || !Array.isArray(value.failures) || value.failures.length > 10 || !count(value.omittedFailures)) return null;
  const failures = [];
  for (const failure of value.failures) {
    if (!transportCategories.has(failure?.category) || !transportPhases.has(failure.phase) || !count(failure.ms) ||
      !count(failure.version) || !Array.isArray(failure.outbox) || failure.outbox.length > 4) return null;
    const outbox = [];
    for (const step of failure.outbox) {
      if (!transportOutcomes.has(step?.outcome) || !count(step.attempt) || !count(step.count) ||
        !count(step.observedAfterFailureMs)) return null;
      outbox.push({ outcome: step.outcome, attempt: step.attempt, count: step.count,
        observedAfterFailureMs: step.observedAfterFailureMs });
    }
    failures.push({
      category: failure.category, code: typeof failure.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(failure.code) ? failure.code : null,
      phase: failure.phase, ms: failure.ms, version: failure.version,
      startedAt: typeof failure.startedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(failure.startedAt) ? failure.startedAt : null,
      httpResponseReceived: false, outbox,
    });
  }
  return { http, outcomes, failures, omittedFailures: value.omittedFailures };
}

function observeLine(state, line) {
  const match = /^(CINE026_HOSTED_FAILURE|CINE026_HOSTED_SHUTDOWN|CINE026_HOSTED_METRICS|CINE026_WORKER_RECOVERY|CINE026_TRANSPORT_DIAGNOSTICS|CINE026_TRANSPORT_PARTIAL) (.+)$/.exec(line);
  if (!match) return;
  let payload;
  try { payload = JSON.parse(match[2]); } catch { return; }
  if (match[1] === "CINE026_HOSTED_FAILURE") state.firstFailure ??= readFailure(payload) ?? undefined;
  if (match[1] === "CINE026_HOSTED_SHUTDOWN") {
    state.shutdownSnapshot = { counts: numericFields(payload?.counts, countFields),
      peaks: numericFields(payload?.peaks, peakFields), observed: numericFields(payload?.immediate, fields) };
  }
  if (match[1] === "CINE026_HOSTED_METRICS") state.metrics = readMetrics(payload);
  if (match[1] === "CINE026_WORKER_RECOVERY") state.worker = readWorker(payload);
  if (match[1] === "CINE026_TRANSPORT_DIAGNOSTICS") state.transport = readTransport(payload) ?? undefined;
  if (match[1] === "CINE026_TRANSPORT_PARTIAL") {
    const snapshot = readTransport(payload);
    if (!snapshot) return false;
    state.partialTransport = snapshot;
  }
  return true;
}

function readBrowserReport(report, expected, listing = false) {
  const counts = Object.fromEntries(browsers.map(browser => [browser, { selected: 0, passed: 0 }]));
  const convergence = [];
  const cases = [];
  const seen = new Set();
  let valid = Array.isArray(report?.suites) && report.errors?.length === 0;
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const count = counts[test.projectName];
          if (!Object.hasOwn(counts, test.projectName) || typeof spec.title !== "string") { valid = false; continue; }
          const target = expected[test.projectName] ?? [];
          const index = target.findIndex(title => title === spec.title);
          if (index < 0) { valid = false; continue; }
          const key = test.projectName + "/" + index;
          if (seen.has(key)) valid = false;
          seen.add(key);
          count.selected++;
          const result = test.results?.[0];
          if (!listing && test.expectedStatus !== "passed") valid = false;
          if (!listing && test.status === "expected" && test.results?.length === 1 && result?.status === "passed") {
            count.passed++;
          }
          cases.push({ browser: test.projectName, scenario: target[index], status: listing ? "listed" :
            ["passed", "failed", "skipped", "timedOut", "interrupted"].includes(result?.status) ? result.status : "missing" });
          const attachment = result?.attachments?.find(item => item.name === "convergence-evidence.json");
          if (typeof attachment?.body === "string") {
            try {
              const raw = JSON.parse(Buffer.from(attachment.body, "base64").toString("utf8"));
              if (Array.isArray(raw.clients) && Number.isSafeInteger(raw.expectedVersion)) {
                convergence.push({ browser: test.projectName, version: raw.expectedVersion,
                  clients: raw.clients.slice(0, 5).map(client => ({
                    hint: client.hintDelivered === true, snapshot: client.snapshotReadAtVersion === true,
                    hintAfterAnchorMs: finiteOrNull(client.hintAfterAnchorMs),
                    snapshotStartAfterAnchorMs: finiteOrNull(client.snapshotStartAfterAnchorMs),
                    renderedAfterAnchorMs: finiteOrNull(client.renderedAfterAnchorMs),
                    snapshotStartedAfterHint: snapshotOrdering(client.hintToSnapshotStartMs),
                  })) });
              }
            } catch { /* An invalid attachment cannot count as convergence evidence. */ }
          }
        }
      }
      visit(suite.suites ?? []);
    }
  }
  if (valid) visit(report.suites);
  for (const browser of browsers) {
    const total = expected[browser]?.length ?? 0;
    if (counts[browser].selected !== total || (!listing && counts[browser].passed !== total)) valid = false;
  }
  return { valid, counts, cases, convergence };
}
function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function snapshotOrdering(delta) {
  if (!Number.isFinite(delta) || delta === 0) return null;
  return delta > 0;
}

const titles = [
  "2 independent clients reach one unanimous match through the real UI",
  "5 independent clients submit concurrent LIKE votes; exactly one wins",
  "partial SKIP defeats a two-of-three majority and advances only after the final vote",
  "the sixth browser context is rejected after five independent members join",
  "refresh retains a recorded vote and does not submit it twice",
  "authenticated members cannot read or vote in another room",
  "host browser disconnect is visible, and reconnect preserves the active round",
  "WebSocket interruption reconnects and resyncs the Supabase Realtime room",
  "same-page Realtime socket interruption recovers without closing the page",
  "transport cut: the same page recovers its private Realtime socket after a real network interruption",
  "90-second disconnected-host grace expires without a wall-clock sleep",
  "natural 90-second host grace elapses in real wall-clock time (no DB backdating)",
  "all twenty cards exhaust only after both independent clients skip each card",
];
const fullMatrix = Object.fromEntries(browsers.map(browser => [browser, titles]));
const browserTargets = [
  ["chromium", [titles[2]]],
  ["firefox", [titles[6]]],
  ["webkit", [titles[8], titles[9], titles[12]]],
];

function browserArgs(browser, targets) {
  return ["--reporter=json", ...(browser ? ["--project", browser, "--grep", targets.map(title => RegExp.escape(title)).join("|")] : [])];
}

function parseReport(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

async function preflight(stagedEnv) {
  const load = require(path.join(candidate, "tests/hosted-supabase/environment.cjs"));
  const { Client } = require(path.join(candidate, "node_modules/pg"));
  const budget = Number(process.env.CINE026_SESSION_POOL_SIZE);
  requireCondition(Number.isSafeInteger(budget) && budget >= 10, "SESSION_POOL_BUDGET_UNCONFIRMED");
  process.env.CINE018_STAGING_PROJECT = stagedEnv.CINE018_STAGING_PROJECT;
  process.env.CINE018_STAGING_ENV_FILE = stagedEnv.CINE018_STAGING_ENV_FILE;
  const staging = load.loadHostedStaging();
  const db = new Client({ ...staging.pgConfig, statement_timeout: 10_000, query_timeout: 12_000 });
  let firstError;
  db.on("error", error => { firstError ??= error; });
  try {
    await db.connect();
    await db.query("BEGIN READ ONLY");
    await load.assertEmptyHostedApplication(db);
    const { rows: [state] } = await db.query(`SELECT
      (SELECT count(*)::int FROM public.room_participants) AS participants,
      (SELECT count(*)::int FROM public.votes) AS votes,
      (SELECT count(*)::int FROM public.room_events) AS events,
      (SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory'
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS advisory,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()
         AND backend_type = 'client backend' AND pid <> pg_backend_pid()
         AND (usename = current_user OR state LIKE 'idle in transaction%')) AS competing,
      current_setting('max_connections')::int - current_setting('superuser_reserved_connections')::int
        - current_setting('reserved_connections')::int
        - (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend') AS server_slots`);
    requireCondition(["participants", "votes", "events", "advisory", "competing"].every(k => state[k] === 0),
      "STAGING_ISOLATION_FAILED");
    requireCondition(state.server_slots >= 9, "SERVER_SESSION_BUDGET_INSUFFICIENT");
    await db.query("COMMIT");
    for (let i = 0; i < 3; i++) {
      await db.query("SELECT 1");
      const response = await fetch(staging.url + "/auth/v1/health", {
        redirect: "error", headers: { apikey: staging.stackEnv.ANON_KEY }, signal: AbortSignal.timeout(10_000),
      });
      await response.body?.cancel();
      requireCondition(response.ok, "STAGING_HTTPS_HEALTH_FAILED");
    }
  } catch (error) {
    firstError ??= error;
  } finally {
    try { await db.end(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
  return { tls: "verify-full", probes: 3, sessionPoolLowerBound: budget, baselineEmpty: true };
}

const cancellation = new AbortController();

function runWorkload(args, env, budget, onCheckpoint) {
  const child = spawn(process.execPath, [require.resolve("./workload-supervision.cjs"), ...args], {
    cwd: candidate, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  function signalGroup(signal) {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      // A missing group is normal after exit. Other errors cannot prove it stopped.
      return signal === 0 && error.code !== "ESRCH";
    }
  }
  return superviseWorkload(child, {
    budget, signal: cancellation.signal, observe: observeLine, onCheckpoint,
    groupAlive: () => signalGroup(0), killGroup: signalGroup,
  });
}

function verifiedCleanup(result) {
  const m = result.metrics;
  return result.terminalMilestone === true && !result.cleanupTimedOut && !result.forcedTermination &&
    !result.interrupted && !result.remainingProcesses && !result.spawnFailed && !result.evidenceWriteFailed &&
    m?.leaseRelease === "released" && m.cleanupVerified &&
    m.final != null && fields.every(key => m.final[key] === 0);
}

function stableWorkload(result) {
  return result.exitCode === 0 && !result.executionTimedOut && !result.firstFailure && !result.metrics?.firstFailure &&
    verifiedCleanup(result) && result.transport?.failures?.length === 0 && result.transport.omittedFailures === 0 &&
    result.metrics.counts != null && result.metrics.peaks != null &&
    ["capacity", "escapedReset", "checkedOutReset", "idleReset", "providerTransport", "providerStatus"]
      .every(key => result.metrics.counts[key] === 0);
}

const preflightCodes = new Set([
  "DISPATCH_CONTEXT_REFUSED", "DISPATCH_CONSENT_REFUSED", "CHECKOUT_SHA_MISMATCH",
  "PR_CANDIDATE_MISMATCH", "STAGING_CONFIGURATION_MISSING", "SESSION_POOL_BUDGET_UNCONFIRMED",
  "STAGING_ISOLATION_FAILED", "SERVER_SESSION_BUDGET_INSUFFICIENT", "STAGING_HTTPS_HEALTH_FAILED",
  "STAGING_PG_CONNECTION_FAILED", "CANDIDATE_SUPERVISOR_UNSUPPORTED", "LEASE_BUSY", "WARMUP_CONFIGURATION_INVALID", "WARMUP_NOT_READY",
  "WARMUP_CLEANUP_UNCONFIRMED", "WORKFLOW_BUDGET_EXHAUSTED", "WORKLOAD_INTERRUPTED",
]);
function summarize(evidence) {
  return ["## CINE-026/063 staging qualification", "",
    "Candidate: " + evidence.candidate, "Mode: " + evidence.mode,
    "Preflight: " + evidence.preflight.status,
    ...Object.entries(evidence.gates).map(([gate, status]) => "Gate " + gate + ": " + status),
    "Verdict: " + evidence.verdict,
    ...(evidence.warmup ? ["Realtime warm-up (qualification-only): " + evidence.warmup.status + "; " +
      evidence.warmup.requests.map(r => r.id + " " + (r.http ?? r.failure) + " " + r.ms + " ms").join(", ") + "."] : []),
    ...(evidence.coverage ? ["Warm-path acceptance: " + evidence.coverage.warmPathAcceptance +
      ". Cold-path recovery: " + evidence.coverage.coldPathRecovery + " (not measured in this run)."] : []),
    ...(evidence.mode === "cold-start-probe" && evidence.probe ? ["Probe: " + evidence.probe.verdict + "; cold first " + evidence.probe.coldFirstMs +
      " ms, warm median " + evidence.probe.warmMedianMs + " ms, warm max " + evidence.probe.warmMaxMs + " ms, concurrent max " +
      evidence.probe.concurrentMaxMs + " ms. Diagnostic only: not Gate A-D acceptance."] : []),
    ...(evidence.mode === "gate-a-only" ? ["Scope: Gate A only. Gates B and C were intentionally not run; this is not A-D acceptance."] : []),
    "", "Evidence contains allowlisted counts and timings only.", ""].join("\n");
}

const workloadModes = ["gate-a-only", "full"];
const LEASE_KEY = "cinematch:hosted-qualification";
const POOLER_QUIET_WINDOW_MS = 135_000;

// One exclusive-lease probe session. The probe itself never touches PostgreSQL; the lease only fences other
// staging users. Cleanup is fail-closed: lease release must be acknowledged and an independent fresh
// session must read back the clean baseline, otherwise Gate D is UNCONFIRMED and the verdict is HOLD.
const probeDependencies = () => ({
  load: require(path.join(candidate, "tests/hosted-supabase/environment.cjs")),
  Client: require(path.join(candidate, "node_modules/pg")).Client,
  readback: preflight, probe: runColdStartProbe, warm: warmRealtimeTenant,
  secret: process.env.SUPABASE_SECRET_KEY, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
});

// Runs `action` while this process holds the exclusive staging lease on a dedicated session. `cleanup` is
// updated in place. The lease release must be acknowledged, then an independent fresh session reads back
// the clean baseline (retained pooler sessions may need one bounded quiet window). Returns the first
// error instead of throwing so the caller can record evidence before failing.
async function leasedSession(env, deps, action, cleanup, applicationName) {
  const { load, Client } = deps;
  const staging = load.loadHostedStaging();
  const db = new Client({ ...staging.pgConfig, statement_timeout: 10_000, query_timeout: 12_000, application_name: applicationName });
  let firstError;
  let released = false;
  db.on("error", error => { firstError ??= error; });
  try {
    await db.connect();
    const lock = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [LEASE_KEY]);
    requireCondition(lock.rows[0].acquired === true, "LEASE_BUSY");
    cleanup.leaseRelease = "unconfirmed";
    await action(staging);
  } catch (error) {
    firstError ??= error;
  } finally {
    if (cleanup.leaseRelease === "unconfirmed") {
      try {
        const unlock = await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released", [LEASE_KEY]);
        released = unlock.rows[0].released === true;
      } catch (error) { firstError ??= error; }
      cleanup.leaseRelease = released ? "released" : "unconfirmed";
    }
    try { await db.end(); } catch (error) { firstError ??= error; }
  }
  for (let attempt = 0; attempt < 2 && cleanup.readback !== "PASS"; attempt++) {
    if (attempt === 1) await deps.sleep(POOLER_QUIET_WINDOW_MS);
    try {
      await deps.readback(env);
      cleanup.readback = "PASS";
    } catch { cleanup.readback = "FAIL"; }
  }
  return firstError;
}

// One exclusive-lease probe session. The probe itself never touches PostgreSQL; the lease only fences other
// staging users. Cleanup is fail-closed: lease release must be acknowledged and an independent fresh
// session must read back the clean baseline, otherwise Gate D is UNCONFIRMED and the verdict is HOLD.
async function runProbeSession(env, evidence, deps = probeDependencies()) {
  evidence.cleanup = { leaseRelease: "not_acquired", readback: "NOT RUN" };
  const firstError = await leasedSession(env, deps, async staging => {
    const probe = readProbe(await deps.probe({ url: staging.url, secret: deps.secret }));
    requireCondition(probe, "QUALIFICATION_SETUP_FAILED");
    evidence.probe = probe;
  }, evidence.cleanup, "cine026-probe-supervisor");
  evidence.gates.D = evidence.cleanup.leaseRelease === "released" && evidence.cleanup.readback === "PASS" ? "PASS" : "UNCONFIRMED";
  if (firstError) throw firstError;
}

// Qualification-only Realtime tenant warm-up before the hosted gates. It holds the exclusive lease while it
// runs, releases it with confirmation and reads the clean baseline back from a fresh session BEFORE the
// workload starts (the workload takes its own lease). A warm-up that is not READY, or whose cleanup is not
// confirmed, stops the run before any gate: failing closed is never a silent pass.
async function runWarmupSession(env, evidence, deps = probeDependencies()) {
  const cleanup = { leaseRelease: "not_acquired", readback: "NOT RUN" };
  let warmup;
  const firstError = await leasedSession(env, deps, async staging => {
    warmup = readWarmup(await deps.warm({ url: staging.url, secret: deps.secret }));
    requireCondition(warmup, "QUALIFICATION_SETUP_FAILED");
  }, cleanup, "cine026-warmup-supervisor");
  evidence.warmup = warmup ? { ...warmup, completedAt: new Date().toISOString(), cleanup } : { status: "NOT_RUN", requests: [], cleanup };
  const cleaned = cleanup.leaseRelease === "released" && cleanup.readback === "PASS";
  if (!cleaned) evidence.gates.D = "UNCONFIRMED";
  if (firstError) throw firstError;
  requireCondition(cleaned, "WARMUP_CLEANUP_UNCONFIRMED");
  requireCondition(warmup.status === "READY", "WARMUP_NOT_READY");
}

// Warm-path acceptance is the only thing the hosted gates can establish after a warm-up. Cold-path recovery
// (bounded outbox recovery and first-event delivery after tenant idle) is a separate criterion that is
// designed in docs/cine026-hosted-qualification.md and is NOT measured here, so it is never reported as passed.
function coverageOf(evidence) {
  if (!workloadModes.includes(evidence.mode)) return undefined;
  const passed = evidence.verdict !== "HOLD";
  return { warmPathAcceptance: !passed ? "HOLD" : evidence.mode === "full" ? "PASS (GATES A-D)" : "PASS (GATE A ONLY)",
    coldPathRecovery: "NOT QUALIFIED" };
}

// Gate order. `gate-a-only` runs the five targeted browser scenarios and never dispatches Gate B or C,
// even when Gate A passes completely. Execution stops at the first failing Gate A workload.
async function runGateSequence(mode, run, evidence) {
  for (const [browser, targets] of browserTargets) {
    evidence.gates.A = await run("A", browser, targets) ? "PASS" : "FAIL";
    if (evidence.gates.A === "FAIL") break;
  }
  if (mode !== "full") return;
  if (evidence.gates.A === "PASS") evidence.gates.B = await run("B") ? "PASS" : "FAIL";
  if (evidence.gates.B === "PASS") evidence.gates.C = await run("C") ? "PASS" : "FAIL";
}

// Hosted gates never start on a tenant whose warm-up is not READY with confirmed cleanup.
async function runWarmedGates(env, evidence, run, deps) {
  await runWarmupSession(env, evidence, deps);
  await runGateSequence(evidence.mode, run, evidence);
}

// A scoped Gate A pass is never reported as complete A-D acceptance.
function decideVerdict(evidence, wasInterrupted) {
  if (evidence.failure || wasInterrupted || evidence.preflight.status !== "PASS") return "HOLD";
  if (evidence.mode === "preflight") return "READ-ONLY PREFLIGHT PASSED";
  if (evidence.mode === "cold-start-probe") {
    // A diagnostic, not acceptance: Gates A-C must stay NOT RUN and cleanup must be verified.
    if (evidence.gates.D !== "PASS" || !evidence.probe ||
      [evidence.gates.A, evidence.gates.B, evidence.gates.C].some(gate => gate !== "NOT RUN")) return "HOLD";
    return { COLD_START_REPRODUCED: "COLD-START PROBE REPRODUCED", PER_ROOM_EFFECT_OBSERVED: "COLD-START PROBE COMPLETE: PER-ROOM EFFECT",
      WARM_PATH_NOT_CLEAN: "COLD-START PROBE COMPLETE: WARM PATH NOT CLEAN" }[evidence.probe.verdict] ?? "COLD-START PROBE INCONCLUSIVE";
  }
  // Hosted gates run on a warmed tenant, so a pass is warm-path evidence only and says nothing about cold-path recovery.
  const warmed = evidence.warmup?.status === "READY" && evidence.warmup.cleanup?.leaseRelease === "released" &&
    evidence.warmup.cleanup?.readback === "PASS";
  if (!warmed) return "HOLD";
  if (evidence.mode === "gate-a-only") {
    return evidence.gates.A === "PASS" && evidence.gates.D === "PASS" &&
      evidence.gates.B === "NOT RUN" && evidence.gates.C === "NOT RUN" ? "WARM-PATH GATE A ONLY PASSED; COLD-PATH NOT QUALIFIED" : "HOLD";
  }
  return Object.values(evidence.gates).every(gate => gate === "PASS") ?
    "WARM-PATH ACCEPTANCE: ALL GATES PASSED; COLD-PATH RECOVERY NOT QUALIFIED" : "HOLD";
}

function writeEvidence(evidence, status) {
  const artifact = path.join(temp, "cine026-qualification-evidence.json");
  const next = artifact + ".tmp";
  fs.writeFileSync(next, JSON.stringify({ ...evidence, artifactStatus: status }, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(next, artifact);
}

async function qualify(directory) {
  const evidence = { candidate: sha, workflowSha: process.env.GITHUB_SHA,
    mode: [...workloadModes, "cold-start-probe"].includes(process.env.DISPATCH_MODE) ? process.env.DISPATCH_MODE : "preflight", preflight: { status: "FAIL" },
    gates: { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" }, workload: [], verdict: "HOLD" };
  writeEvidence(evidence, "partial");
  try {
    authorize(process.env);
    verifyCheckout();
    requireCondition(!cancellation.signal.aborted, "WORKLOAD_INTERRUPTED");
    const env = configureStaging(directory, process.env);
    evidence.preflight = { status: "PASS", ...await preflight(env) };
    requireCondition(!cancellation.signal.aborted, "WORKLOAD_INTERRUPTED");
    if (evidence.mode === "cold-start-probe") await runProbeSession(env, evidence);
    if (workloadModes.includes(evidence.mode)) {
      const jobStartedAt = Number(process.env.CINE026_JOB_STARTED_MS);
      requireCondition(planWorkload("A", jobStartedAt), "WORKFLOW_BUDGET_EXHAUSTED");
      const run = async (gate, browser = null, targets = null) => {
        requireCondition(!cancellation.signal.aborted, "WORKLOAD_INTERRUPTED");
        const budget = planWorkload(gate, jobStartedAt);
        requireCondition(budget, "WORKFLOW_BUDGET_EXHAUSTED");
        const workload = { gate, browser, budget, startedAt: new Date().toISOString() };
        const file = path.join(directory, "playwright.json");
        fs.rmSync(file, { force: true });
        const args = gate === "B" ? ["--worker-qualification"] :
          [...browserArgs(browser, targets), "--output", path.join(directory, "browser-output")];
        function checkpoint(state) {
          evidence.activeWorkload = { ...workload, ...state };
          writeEvidence(evidence, "partial");
        }
        checkpoint({});
        const result = await runWorkload(args, { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: file }, budget, checkpoint);
        const report = gate === "B" ? null : readBrowserReport(parseReport(file), browser ? { [browser]: targets } : fullMatrix);
        evidence.workload.push({ ...workload, ...result,
          missingEvidence: [!result.terminalMilestone && "terminal_milestone", !result.metrics && "terminal_metrics",
            !result.transport && "terminal_transport"].filter(Boolean),
          ...(report ? { report } : {}) });
        delete evidence.activeWorkload;
        fs.rmSync(file, { force: true });
        writeEvidence(evidence, "partial");
        return stableWorkload(result) && (gate === "B" ? Boolean(result.worker) : report.valid);
      };
      await runWarmedGates(env, evidence, run);
    }
  } catch (error) {
    evidence.failure = { phase: evidence.preflight.status === "PASS" ? "qualification" : "preflight",
      code: preflightCodes.has(error?.message) ? error.message :
        supervisorCodes.has(error?.code) ? error.code : "QUALIFICATION_SETUP_FAILED",
      at: new Date().toISOString() };
  } finally {
    if (evidence.workload.length) evidence.gates.D = evidence.workload.every(verifiedCleanup) ? "PASS" : "UNCONFIRMED";
    evidence.verdict = decideVerdict(evidence, cancellation.signal.aborted);
    evidence.coverage = coverageOf(evidence);
    writeEvidence(evidence, "terminal");
    const summary = summarize(evidence);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
    if (evidence.verdict === "HOLD") process.exitCode = 1;
  }
}

function validateListings(directory) {
  verifyCheckout();
  requireCondition(typeof require(path.join(candidate, "scripts/cine026/run-hosted-staging.cjs")).main === "function" &&
    typeof require(path.join(candidate, "scripts/cine026/transport-diagnostics.cjs")).createTransportDiagnostics === "function",
  "CANDIDATE_SUPERVISOR_UNSUPPORTED");
  const env = configureStaging(directory, process.env, true);
  const playwright = path.join(candidate, "node_modules/playwright/cli.js");
  for (const [browser, targets] of [[null, null], ...browserTargets]) {
    const file = path.join(directory, "list.json");
    fs.rmSync(file, { force: true });
    execFileSync(process.execPath, [playwright, "test", "--config=playwright.cine026.staging.config.ts", "--list",
      ...browserArgs(browser, targets)], {
      cwd: candidate, env: { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: file }, stdio: "pipe", timeout: 30_000,
    });
    const listing = readBrowserReport(parseReport(file), browser ? { [browser]: targets } : fullMatrix, true);
    requireCondition(listing.valid, "STAGING_TEST_INVENTORY_MISMATCH");
    console.log(browser ?? "full matrix", JSON.stringify(listing.counts));
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "check-pr") {
    verifyCheckout();
    await verifyLivePR(process.env.CINE026_GITHUB_TOKEN);
    return;
  }
  if (mode === "authorize") {
    authorize(process.env);
    verifyCheckout();
    return;
  }
  requireCondition(temp && (mode === "list" || (mode === "run" && process.platform === "linux")), "INVALID_INVOCATION");
  process.umask(0o077);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => cancellation.abort());
  const directory = fs.mkdtempSync(path.join(temp, "cine026-private-"));
  try {
    if (mode === "list") validateListings(directory);
    else await qualify(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) main().catch(error => {
  const message = error?.message;
  const safe = preflightCodes.has(message) || /^PR_LOOKUP_(?:HTTP_[1-5]\d\d|TOKEN_MISSING|TRANSPORT_FAILED)$/.test(message);
  process.stderr.write((safe ? message : "QUALIFICATION_HARNESS_FAILED") + "\n");
  process.exitCode = 1;
});
module.exports = { runProbeSession, runWarmupSession, runWarmedGates, coverageOf, runGateSequence, decideVerdict, authorize, verifyLivePR, configureStaging, observeLine, readBrowserReport, verifiedCleanup, stableWorkload };
