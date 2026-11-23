/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createInterface } = require("node:readline");

const candidate = path.resolve("candidate");
const temp = process.env.RUNNER_TEMP;
const project = "dmrbticnsczhyaiftrar";
const sha = "00555c03d4173ac54750677207b78252e2063257";
const dispatchModes = ["preflight", "gate-a-only", "full"];
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
  const match = /^(CINE026_HOSTED_FAILURE|CINE026_HOSTED_METRICS|CINE026_WORKER_RECOVERY|CINE026_TRANSPORT_DIAGNOSTICS) (.+)$/.exec(line);
  if (!match) return;
  let payload;
  try { payload = JSON.parse(match[2]); } catch { return; }
  if (match[1] === "CINE026_HOSTED_FAILURE") state.firstFailure ??= readFailure(payload) ?? undefined;
  if (match[1] === "CINE026_HOSTED_METRICS") state.metrics = readMetrics(payload);
  if (match[1] === "CINE026_WORKER_RECOVERY") state.worker = readWorker(payload);
  if (match[1] === "CINE026_TRANSPORT_DIAGNOSTICS") state.transport = readTransport(payload) ?? undefined;
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

let active;
let interrupted = false;
function terminateGroup(signal) {
  if (!active) return;
  try { process.kill(-active.pid, signal); } catch { /* Process group already exited. */ }
}

function runWorkload(args, env, limit) {
  const state = {};
  let deadline = false;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["scripts/cine026/run-hosted-staging.cjs", ...args], {
      cwd: candidate, env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    active = child;
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", line => observeLine(state, line));
    }
    const timer = setTimeout(() => {
      deadline = true;
      terminateGroup("SIGTERM");
    }, limit);
    const killTimer = setTimeout(() => terminateGroup("SIGKILL"), limit + 6_000);
    child.once("error", () => { state.spawnFailed = true; });
    child.once("exit", () => {
      // A descendant that still holds the pipes open must not block evidence or be counted as clean.
      try {
        process.kill(-child.pid, 0);
        state.remainingProcesses = true;
        terminateGroup("SIGKILL");
      } catch { /* The process group ended normally. */ }
    });
    child.once("close", code => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      active = undefined;
      resolve({ ...state, exitCode: code, deadline, interrupted });
    });
  });
}

function verifiedCleanup(result) {
  const m = result.metrics;
  return !result.deadline && !result.interrupted && !result.remainingProcesses &&
    m?.leaseRelease === "released" && m.cleanupVerified &&
    m.final !== null && fields.every(key => m.final[key] === 0);
}

function stableWorkload(result) {
  return result.exitCode === 0 && !result.firstFailure && !result.metrics?.firstFailure &&
    verifiedCleanup(result) && result.metrics.counts != null && result.metrics.peaks != null &&
    ["capacity", "escapedReset", "checkedOutReset", "idleReset", "providerTransport", "providerStatus"]
      .every(key => result.metrics.counts[key] === 0);
}

const preflightCodes = new Set([
  "DISPATCH_CONTEXT_REFUSED", "DISPATCH_CONSENT_REFUSED", "CHECKOUT_SHA_MISMATCH",
  "PR_CANDIDATE_MISMATCH", "STAGING_CONFIGURATION_MISSING", "SESSION_POOL_BUDGET_UNCONFIRMED",
  "STAGING_ISOLATION_FAILED", "SERVER_SESSION_BUDGET_INSUFFICIENT", "STAGING_HTTPS_HEALTH_FAILED",
  "STAGING_PG_CONNECTION_FAILED",
]);
function summarize(evidence) {
  return ["## CINE-026/063 staging qualification", "",
    "Candidate: " + evidence.candidate, "Mode: " + evidence.mode,
    "Preflight: " + evidence.preflight.status,
    ...Object.entries(evidence.gates).map(([gate, status]) => "Gate " + gate + ": " + status),
    "Verdict: " + evidence.verdict,
    ...(evidence.mode === "gate-a-only" ? ["Scope: Gate A only. Gates B and C were intentionally not run; this is not A-D acceptance."] : []),
    "", "Evidence contains allowlisted counts and timings only.", ""].join("\n");
}

const workloadModes = ["gate-a-only", "full"];

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

// A scoped Gate A pass is never reported as complete A-D acceptance.
function decideVerdict(evidence, wasInterrupted) {
  if (evidence.failure || wasInterrupted || evidence.preflight.status !== "PASS") return "HOLD";
  if (evidence.mode === "preflight") return "READ-ONLY PREFLIGHT PASSED";
  if (evidence.mode === "gate-a-only") {
    return evidence.gates.A === "PASS" && evidence.gates.D === "PASS" &&
      evidence.gates.B === "NOT RUN" && evidence.gates.C === "NOT RUN" ? "GATE A ONLY PASSED" : "HOLD";
  }
  return Object.values(evidence.gates).every(gate => gate === "PASS") ? "ALL GATES PASSED" : "HOLD";
}

async function qualify(directory) {
  const evidence = { candidate: sha, workflowSha: process.env.GITHUB_SHA,
    mode: workloadModes.includes(process.env.DISPATCH_MODE) ? process.env.DISPATCH_MODE : "preflight", preflight: { status: "FAIL" },
    gates: { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "NOT RUN" }, workload: [] };
  try {
    authorize(process.env);
    verifyCheckout();
    const env = configureStaging(directory, process.env);
    evidence.preflight = { status: "PASS", ...await preflight(env) };
    if (workloadModes.includes(evidence.mode)) {
      const run = async (gate, browser = null, targets = null) => {
        const file = path.join(directory, "playwright.json");
        fs.rmSync(file, { force: true });
        const args = gate === "B" ? ["--worker-qualification"] :
          [...browserArgs(browser, targets), "--output", path.join(directory, "browser-output")];
        const minutes = gate === "C" ? 55 : gate === "B" ? 19 : 7;
        const result = await runWorkload(args, { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: file }, minutes * 60_000);
        const report = gate === "B" ? null : readBrowserReport(parseReport(file), browser ? { [browser]: targets } : fullMatrix);
        fs.rmSync(file, { force: true });
        evidence.workload.push({ gate, browser, ...result, ...(report ? { report } : {}) });
        return stableWorkload(result) && (gate === "B" ? Boolean(result.worker) : report.valid);
      };
      await runGateSequence(evidence.mode, run, evidence);
    }
  } catch (error) {
    evidence.failure = { phase: evidence.preflight.status === "PASS" ? "qualification" : "preflight",
      code: preflightCodes.has(error?.message) ? error.message :
        supervisorCodes.has(error?.code) ? error.code : "QUALIFICATION_SETUP_FAILED",
      at: new Date().toISOString() };
  } finally {
    if (evidence.workload.length) evidence.gates.D = evidence.workload.every(verifiedCleanup) ? "PASS" : "UNCONFIRMED";
    evidence.verdict = decideVerdict(evidence, interrupted);
    const passed = evidence.verdict !== "HOLD";
    fs.writeFileSync(path.join(temp, "cine026-qualification-evidence.json"), JSON.stringify(evidence, null, 2) + "\n",
      { flag: "wx", mode: 0o600 });
    const summary = summarize(evidence);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
    process.stdout.write(summary);
    if (!passed) process.exitCode = 1;
  }
}

function validateListings(directory) {
  verifyCheckout();
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
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      interrupted = true;
      terminateGroup("SIGTERM");
      setTimeout(() => terminateGroup("SIGKILL"), 6_000).unref();
    });
  }
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
module.exports = { runGateSequence, decideVerdict, authorize, verifyLivePR, configureStaging, observeLine, readBrowserReport, verifiedCleanup, stableWorkload };
