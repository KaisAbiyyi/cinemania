/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PassThrough } = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { superviseWorkload, runSupervisor } = require("./workload-supervision.cjs");
const { observeLine, stableWorkload, verifiedCleanup, workloadPasses, nestedProblems, progressProblems, EXPECTED_NESTED } = require("./qualification.cjs");
const { RUN_END_GRACE_MS } = require("./execution-budget.cjs");

const here = name => JSON.stringify(path.join(__dirname, name));
const CANARY = "hunter2-SECRET-db.project.supabase.co/room/9f1c";
const REJECTED = { PROGRESS: 'CINE026_PROGRESS {"ev":"rejected"}', NESTED: 'CINE026_NESTED {"ev":"rejected"}' };
const zero = keys => Object.fromEntries(keys.split(" ").map(key => [key, 0]));
const metrics = {
  leaseRelease: "released", cleanupVerified: true,
  counts: zero("capacity escapedReset checkedOutReset idleReset lockTimeout providerTransport providerStatus"),
  peaks: zero("pending poison retries oldest_pending_ms advisory_waiters idle_transactions other_role_sessions"),
  final: zero("rooms participants votes events pending poison retries oldest_pending_ms advisory_locks advisory_waiters idle_transactions other_role_sessions other_role_nonidle_sessions"),
};
const transport = {
  http: { count: 8, okCount: 8, nonOkCount: 0, maxMs: 415, over1000Ms: 0, over1400Ms: 0 },
  outcomes: { marked: 8, retry_scheduled: 0, deferred: 0, permanent_rejection: 0 }, failures: [], omittedFailures: 0,
};
const worker = { appCommit: "45abb39b8706311dd791a8f09cd904498fb29287", versions: [6, 7],
  receiptToPrivateHintMs: [12, 13], receiptToDurableReadbackMs: [19, 21] };
const report = { valid: true };

// --- fixture: the candidate side of the adapter, started as the real adapter process ------------------------

// Stands in for the pinned supervisor: same injection points, one child, shutdown report, audit, terminal reports.
const HOSTED = `
module.exports.main = async ({ args, makeClient, startChild, wait, report }) => {
  const worker = args[0] === "--worker-qualification";
  const { Client } = require("pg");
  const db = makeClient({});
  await db.query("state");
  let seen = 0;
  const child = startChild([worker ? process.env.FIXTURE_GATE_B : process.env.FIXTURE_GATE_A], process.env, line => {
    if (line.includes("[CINEMATCH_REALTIME_ATTEMPT] ")) seen++;
  });
  const code = await child.done;
  report("CINE026_HOSTED_SHUTDOWN", {});
  await wait(1);
  makeClient({});
  report("CINE026_TRANSPORT_DIAGNOSTICS", JSON.parse(process.env.FIXTURE_TRANSPORT));
  if (process.env.FIXTURE_MODE !== "no-cleanup") report("CINE026_HOSTED_METRICS", { ...JSON.parse(process.env.FIXTURE_METRICS), observedAttempts: seen });
  return { exitCode: code };
};`;
const DIAGNOSTICS = `
let lines = 0;
module.exports.createTransportDiagnostics = () => ({ observe(line) { if (/\\[CINEMATCH_REALTIME_ATTEMPT\\] \\{/.test(line)) lines++; },
  summary: () => JSON.parse(process.env.FIXTURE_TRANSPORT) });`;
const PG = `
module.exports.Client = class { async query() { return { rows: [${JSON.stringify({ ...metrics.final, votes: 3, idle: 1 })}] }; } };`;

// Drives the real reporter class the way Playwright does, with secret-bearing noise around it.
const GATE_A = `
const fs = require("node:fs");
const Reporter = require(${here("progress-reporter.cjs")});
const mode = process.env.FIXTURE_MODE, canary = process.env.FIXTURE_CANARY;
const say = line => process.stdout.write(line + "\\n");
const reporter = new Reporter({ write: line => {
  const ev = JSON.parse(line.slice(line.indexOf("{"))).ev;
  if (mode === "missing-" + ev || mode === "silent") return;
  if (mode === "truncated-" + ev) return say(line.slice(0, -3));
  if (mode === "glued-" + ev) return say("." + line);
  if (mode === "extra-" + ev) return say(line.replace("{", '{"note":' + JSON.stringify(canary) + ","));
  say(line);
  if (mode === "duplicate-" + ev) say(line);
} });
say("ordinary output " + canary);
process.stderr.write("Authorization: Bearer " + canary + "\\n");
const specs = reporter.titles.map(title => ({ title, timeout: 180000 }));
reporter.onBegin({}, { allTests: () => specs });
(async () => {
  for (const spec of specs) {
    const result = { status: mode === "failed-case" ? "failed" : "passed", duration: 12 };
    reporter.onTestBegin(spec, result);
    reporter.onStepBegin(spec, result, { category: "pw:api", title: "POST " + canary });
    reporter.tick();
    reporter.onTestEnd(spec, result);
  }
  reporter.onEnd({ status: mode === "failed-case" ? "failed" : "passed" });
  // Playwright has reported its end but is still alive until the test releases it.
  const until = Date.now() + 30000;
  while (process.env.FIXTURE_HOLD && !fs.existsSync(process.env.FIXTURE_HOLD) && Date.now() < until) await new Promise(r => setTimeout(r, 20));
})();`;

// Spawns every generation of the pinned plan under the real tap (which the adapter itself injects).
const GATE_B = `
const { spawn } = require("node:child_process");
const mode = process.env.FIXTURE_MODE, canary = process.env.FIXTURE_CANARY;
const plan = ${JSON.stringify(EXPECTED_NESTED)};
const names = { app: "dist/bin/next", worker: "scripts/realtime-worker.ts", fault: "cine018-commit-fault.ts" };
const body = 'console.log("[CINEMATCH_REALTIME_ATTEMPT] " + JSON.stringify({ r: "abcdef01", v: 1, ms: 5, kind: "http", status: 202, token: process.env.FIXTURE_CANARY })); console.error("password=" + process.env.FIXTURE_CANARY);';
(async () => {
  console.log("room " + canary);
  for (const kind of Object.keys(plan)) for (let n = 1; n <= plan[kind] - (mode === "missing-" + kind ? 1 : 0); n++) {
    const child = spawn(process.execPath, ["-e", kind === "fault" ? "setTimeout(() => {}, 30000)" : body, names[kind]],
      { env: process.env, stdio: kind === "fault" ? "ignore" : ["ignore", "pipe", "pipe"] });
    if (kind === "fault") child.kill("SIGKILL");
    await new Promise(r => child.once("close", r));
  }
  if (mode === "malformed") console.log('CINE026_NESTED {"ev":"spawn","kind":"' + canary + '","n":1,"piped":true}');
  if (mode === "forged-line") console.log("CINE026_STREAM worker 1 Authorization: Bearer " + canary);
  if (mode === "duplicate-line") console.log("CINE026_STREAM worker 1 [CINEMATCH_DB_CAPACITY]");
  if (mode === "orphan-line") console.log("CINE026_STREAM worker 9 [CINEMATCH_DB_CAPACITY]");
  console.log("CINE026_WORKER_RECOVERY " + process.env.FIXTURE_WORKER);
})();`;

function fakeClock() {
  let time = 0;
  const timers = new Map();
  return {
    set(fn, ms) { const key = Symbol(); timers.set(key, { when: time + ms, fn }); return key; },
    clear(key) { timers.delete(key); },
    now: () => new Date(time).toISOString(), nowMs: () => time,
    advance(ms) {
      const until = time + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].when - b[1].when)[0];
        if (!next || next[1].when > until) break;
        timers.delete(next[0]);
        time = next[1].when;
        next[1].fn();
      }
      time = until;
    },
  };
}

// The whole hosted path except staging: real adapter process (runSupervisor with its own startChild), real child
// process, the adapter's emitted lines, the outer reader. Only the outer supervisor's clock is virtual.
function hosted(t, { gate = "A", mode = "", titles = ["first " + CANARY, "second " + CANARY], hold = false } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cine026-relay-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    fs.writeFileSync(path.join(cwd, name), text);
    return path.join(cwd, name);
  };
  write("scripts/cine026/run-hosted-staging.cjs", HOSTED);
  write("scripts/cine026/transport-diagnostics.cjs", DIAGNOSTICS);
  write("node_modules/pg/index.js", PG);
  const release = path.join(cwd, "release");
  const env = { ...process.env, FIXTURE_GATE_A: write("gate-a.cjs", GATE_A), FIXTURE_GATE_B: write("gate-b.cjs", GATE_B),
    FIXTURE_MODE: mode, FIXTURE_CANARY: CANARY, FIXTURE_HOLD: hold ? release : "", FIXTURE_TRANSPORT: JSON.stringify(transport),
    FIXTURE_METRICS: JSON.stringify(metrics), FIXTURE_WORKER: JSON.stringify(worker), CINE026_PROGRESS_TITLES: JSON.stringify(titles) };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [require.resolve("./workload-supervision.cjs"), ...(gate === "B" ? ["--worker-qualification"] : ["--reporter=json"])],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let raw = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { raw += chunk; });
  const clock = fakeClock();
  const checkpoints = [];
  const waiting = [];
  const signals = [];
  const kill = child.kill.bind(child);
  child.kill = name => { signals.push(name); return kill(name); };
  const done = superviseWorkload(child, {
    budget: { executionMs: 600_000, cleanupMs: 240_000, forceGraceMs: 6_000, runEndGraceMs: RUN_END_GRACE_MS },
    observe: observeLine, groupAlive: () => false, killGroup: () => kill("SIGKILL"),
    setTimer: clock.set, clearTimer: clock.clear, now: clock.now, nowMs: clock.nowMs,
    onCheckpoint: state => {
      checkpoints.push(structuredClone(state));
      for (const item of waiting) if (item.ready(checkpoints.at(-1))) item.resolve();
    },
  });
  const until = ready => new Promise((resolve, reject) => {
    if (checkpoints.some(ready)) return resolve();
    waiting.push({ ready, resolve });
    void done.then(() => reject(new Error("workload finished before the awaited state:\n" + raw)));
  });
  return { clock, done, until, checkpoints, signals, raw: () => raw, release: () => fs.writeFileSync(release, "") };
}

const passes = (result, gate = "A") => workloadPasses(gate, result, gate === "A" ? report : null, 2);
const phases = result => result.milestones.map(item => item.phase);

test("Gate A end to end: the reporter lifecycle reaches the outer reader through the real adapter and nothing else does", async t => {
  const run = hosted(t);
  const result = await run.done;
  const { progress } = result;
  assert.equal(result.exitCode, 0, run.raw());
  assert.equal(progress.reporter.total, 2);
  assert.deepEqual(progress.cases.map(item => [item.index, item.startSeen, item.status, item.durationMs, item.timeoutMs, item.post, item.steps.api]),
    [[0, true, "passed", 12, 180_000, 1, 1], [1, true, "passed", 12, 180_000, 1, 1]]);
  assert.equal(progress.runEnd.status, "passed");
  assert.equal(progress.rejected, 0);
  assert.equal(result.playwrightEnded, true);
  assert.equal(progress.sampleCount, 1);
  assert.deepEqual(phases(result), ["execution_start", "workload", "teardown", "shutdown_observed", "cleanup_audit", "terminal"]);
  const events = run.raw().split(/\r?\n/).filter(line => line.startsWith("CINE026_PROGRESS ")).map(line => JSON.parse(line.slice(17)).ev);
  assert.deepEqual(events, ["begin", "case_start", "case_tick", "case_end", "case_start", "case_tick", "case_end", "run_end"]);
  assert.deepEqual(progressProblems(result, 2), []);
  assert.equal(passes(result), true);
  // neither the adapter's output nor the stored evidence carries anything of the child's text
  assert.doesNotMatch(run.raw(), /hunter2|SECRET|supabase|9f1c|Authorization|ordinary output/);
  assert.doesNotMatch(JSON.stringify(run.checkpoints.concat(result)), /hunter2|SECRET|supabase|9f1c|Authorization/);
});

test("Gate A end to end: a relayed run_end arms the watchdog, which fires only without teardown and never passes", async t => {
  const run = hosted(t, { hold: true });
  await run.until(state => state.playwrightEnded);
  run.clock.advance(RUN_END_GRACE_MS - 1);
  assert.equal(run.checkpoints.at(-1).teardownStalled, undefined);
  assert.deepEqual(run.signals, []);
  run.clock.advance(1);
  const stalled = run.checkpoints.at(-1);
  assert.equal(stalled.teardownStalled, true);
  assert.equal(stalled.progressAtStop, "RUN_ENDED");
  assert.equal(stalled.firstFailure.code, "PLAYWRIGHT_TEARDOWN_STALLED");
  assert.equal(stalled.executionTimedOut, undefined);
  assert.deepEqual(run.signals, ["SIGTERM"]);
  run.release();
  const result = await run.done;
  // Every case passed and (on POSIX, where the adapter finishes its cleanup) cleanup is complete: still no pass.
  assert.equal(result.progress.runEnd.status, "passed");
  assert.equal(stableWorkload(result), false);
  assert.equal(passes(result), false);
  assert.equal(passes({ ...result, exitCode: 0, terminalMilestone: true, metrics, transport }), false);
});

test("Gate A end to end: teardown after a relayed run_end cancels the watchdog through the quiet window", async t => {
  const run = hosted(t, { hold: true });
  await run.until(state => state.playwrightEnded);
  run.clock.advance(RUN_END_GRACE_MS - 1);
  run.release();
  await run.until(state => state.milestones.some(item => item.phase === "teardown"));
  run.clock.advance(135_000 + 60_000); // far past the run-end grace, inside the cleanup budget
  const result = await run.done;
  assert.equal(result.teardownStalled, undefined);
  assert.equal(result.firstFailure, undefined);
  assert.deepEqual(run.signals, []);
  assert.equal(passes(result), true);
});

test("Gate A end to end: an execution timeout with complete cases and a missing cleanup report never pass", async t => {
  const timed = hosted(t, { hold: true, mode: "missing-run_end" });
  await timed.until(state => state.progress?.cases.filter(item => item.endedAfterMs !== null).length === 2);
  timed.clock.advance(RUN_END_GRACE_MS + 1);
  assert.equal(timed.checkpoints.at(-1).teardownStalled, undefined, "without a run_end nothing is armed");
  timed.clock.advance(600_000 - RUN_END_GRACE_MS - 1);
  timed.release();
  const result = await timed.done;
  assert.equal(result.executionTimedOut, true);
  assert.equal(result.firstFailure.code, "WORKLOAD_EXECUTION_TIMEOUT");
  assert.equal(passes(result), false);

  const dirty = await hosted(t, { mode: "no-cleanup" }).done;
  assert.deepEqual(progressProblems(dirty, 2), []);
  assert.equal(verifiedCleanup(dirty), false);
  assert.equal(passes(dirty), false);
});

test("Gate A end to end: missing, truncated, glued, extended, duplicated or failing progress is rejected without leaking", async t => {
  const modes = { silent: "reporter_not_observed", "missing-begin": "reporter_not_observed", "missing-case_start": "case_incomplete",
    "missing-case_end": "case_incomplete", "missing-run_end": "run_end_missing", "truncated-run_end": "run_end_missing",
    "truncated-case_tick": "invalid_events", "glued-case_end": "invalid_events", "extra-case_start": "invalid_events",
    "duplicate-begin": "invalid_events", "duplicate-case_start": "invalid_events", "duplicate-case_end": "case_mismatch",
    "duplicate-run_end": "invalid_events", "failed-case": "case_not_passed" };
  await Promise.all(Object.entries(modes).map(async ([mode, problem]) => {
    const run = hosted(t, { mode });
    const result = await run.done;
    // everything else about the workload is clean, so the missing evidence alone decides
    assert.equal(stableWorkload(result), true, mode + "\n" + run.raw());
    assert.ok(progressProblems(result, 2).includes(problem), mode + " " + progressProblems(result, 2));
    assert.equal(passes(result), false, mode);
    assert.doesNotMatch(run.raw() + JSON.stringify(run.checkpoints), /hunter2|SECRET|9f1c|note/, mode);
  }));
  const complete = await hosted(t).done;
  assert.equal(workloadPasses("A", complete, { valid: false }, 2), false, "progress never replaces the Playwright report");
  assert.equal(workloadPasses("A", complete, null, 2), false);
  assert.equal(workloadPasses("A", complete, report, 3), false, "a smaller selection than planned is incomplete");
  assert.equal(workloadPasses("A", { ...complete, transport: undefined }, report, 2), false);
});

test("Gate B end to end: generations and per-stream line accounting reach the outer reader with their origin", async t => {
  const run = hosted(t, { gate: "B" });
  const result = await run.done;
  assert.equal(result.exitCode, 0, run.raw());
  const { nested } = result.progress;
  assert.equal(nested.tapReady, true);
  assert.deepEqual(nested.generations, { ...EXPECTED_NESTED });
  for (const stream of nested.streams) {
    const piped = stream.kind !== "fault";
    assert.deepEqual([stream.received, stream.forwarded, stream.dropped, stream.piped, stream.exit],
      piped ? [1, 1, 1, true, "exited"] : [0, 0, 0, false, "killed"], JSON.stringify(stream));
  }
  assert.deepEqual(nestedProblems(result), []);
  assert.equal(passes(result, "B"), true);
  // the candidate's own readers still see the lines inside the adapter; only the origin leaves it
  assert.match(run.raw(), /"observedAttempts":8/);
  assert.match(run.raw(), /^CINE026_PUBLISH_FIRST \{"kind":"http","via":"workload","status":202,"ms":5\}\r?$/m);
  assert.match(run.raw(), /^CINE026_NESTED \{"ev":"diagnostic","kind":"worker","n":5\}\r?$/m);
  assert.doesNotMatch(run.raw(), /hunter2|SECRET|supabase|9f1c|password|CINEMATCH|CINE026_STREAM/);
  assert.doesNotMatch(JSON.stringify(run.checkpoints), /hunter2|SECRET|supabase|9f1c|password/);
});

test("Gate B end to end: missing, malformed, forged, duplicated or orphaned nested evidence cannot pass", async t => {
  const modes = { "missing-app": "app_generations", "missing-worker": "worker_generations", "missing-fault": "fault_generations",
    malformed: "invalid_events", "forged-line": "invalid_events", "duplicate-line": "unaccounted_lines", "orphan-line": "invalid_events" };
  await Promise.all(Object.entries(modes).map(async ([mode, problem]) => {
    const run = hosted(t, { gate: "B", mode });
    const result = await run.done;
    assert.equal(stableWorkload(result), true, mode + "\n" + run.raw());
    assert.ok(result.worker, mode);
    assert.deepEqual(nestedProblems(result), [problem], mode);
    assert.equal(passes(result, "B"), false, mode);
    assert.doesNotMatch(run.raw() + JSON.stringify(run.checkpoints), /hunter2|SECRET|9f1c|password|Bearer/, mode);
  }));
});

// --- relay rules, through runSupervisor's own callback ------------------------------------------------------

// Feeds child lines into the callback runSupervisor hands to startChild and returns what it emits for them.
async function emittedFor(lines, { args = ["--reporter=json"], childArgs = ["cli.js", "test"] } = {}) {
  const emitted = [];
  await runSupervisor({
    args, createClient: () => ({}), emit: line => emitted.push(line), diagnostics: { observe() {}, summary: () => ({}) },
    async main({ startChild }) {
      await startChild(childArgs, {}, () => {}).done;
      return { exitCode: 0 };
    },
    start(_args, _env, read) {
      for (const line of lines) read(line);
      return { done: Promise.resolve(0), stop: async () => {} };
    },
  });
  return emitted.filter(line => /^CINE026_(PROGRESS|NESTED|STREAM)/.test(line));
}

const steps = { api: 1, expect: 2, step: 3, hook: 4, fixture: 5, other: 6 };
const P = value => "CINE026_PROGRESS " + JSON.stringify(value);
const N = value => "CINE026_NESTED " + JSON.stringify(value);
const gateB = { args: ["--worker-qualification"] };

test("every valid event is rebuilt and relayed unchanged", async () => {
  const progress = [P({ ev: "begin", total: 3 }), P({ ev: "case_start", i: 0, timeout: 180_000 }), P({ ev: "case_tick", i: -1, steps, post: 2 }),
    P({ ev: "case_end", i: 0, status: "timedOut", ms: 5, timeout: 7, steps, post: 1, setupMs: null, teardownMs: 4 }), P({ ev: "run_end", status: "failed", ms: 9 })];
  assert.deepEqual(await emittedFor(progress), progress);
  const nested = [N({ ev: "tap_ready" }), N({ ev: "spawn", kind: "app", n: 1, piped: true }),
    N({ ev: "exit", kind: "app", n: 1, code: null, signal: true, forwarded: 1, dropped: 2 }),
    N({ ev: "exit", kind: "worker", n: 2, code: 3, signal: false, forwarded: 0, dropped: 0 }), N({ ev: "lines", kind: "fault", n: 2, forwarded: 1, dropped: 2 })];
  assert.deepEqual(await emittedFor(nested, gateB), nested);
});

test("an event with a wrong, missing, additional or unsafe value becomes a fixed rejection marker", async () => {
  const end = { ev: "case_end", i: 0, status: "passed", ms: 5, timeout: 7, steps, post: 1, setupMs: 1, teardownMs: 4 };
  const badProgress = [P({ ...end, title: CANARY }), P({ ...end, status: CANARY }), P({ ...end, steps: { ...steps, [CANARY]: 1 } }),
    P({ ...end, steps: [1, 2, 3, 4, 5, 6] }), P({ ...end, steps: null }), P({ ...end, ms: -1 }), P({ ...end, ms: 1.5 }), P({ ...end, ms: "5" }),
    P({ ...end, i: 1_001 }), P({ ...end, setupMs: undefined }), P({ ...end, ev: "case_tick" }), P({ ev: "begin", total: 10_001 }), P({ ev: "begin" }),
    P({ ev: "run_end", status: "passed", ms: 21_600_001 }), P({ ev: "constructor" }), P({ ev: ["begin"], total: 1 }), P({ ev: "rejected" }),
    P(null), P([]), P("text"), "CINE026_PROGRESS", "CINE026_PROGRESS {nope", "CINE026_PROGRESS  " + JSON.stringify({ ev: "begin", total: 1 }),
    " " + P({ ev: "begin", total: 1 }), P({ ev: "begin", total: 1 }) + " " + CANARY, P({ ev: "begin", total: 1 }) + P({ ev: "begin", total: 1 }),
    'CINE026_PROGRESS {"__proto__":{"ev":"begin"},"total":1}', P({ ev: "begin", total: 1 }).replace("{", "{" + " ".repeat(1_024))];
  for (const line of badProgress) assert.deepEqual(await emittedFor([line]), [REJECTED.PROGRESS], line.slice(0, 200));
  const exit = { ev: "exit", kind: "app", n: 1, code: 0, signal: false, forwarded: 0, dropped: 0 };
  const badNested = [N({ ...exit, kind: CANARY }), N({ ...exit, n: 0 }), N({ ...exit, n: 65 }), N({ ...exit, code: 0, signal: true }), N({ ...exit, code: null }),
    N({ ...exit, code: CANARY }), N({ ...exit, forwarded: 100_000_001 }), N({ ...exit, path: CANARY }), N({ ev: "tap_ready", pid: 1 }),
    N({ ev: "spawn", kind: "app", n: 1 }), N({ ev: "diagnostic", kind: "app", n: 1 }), "CINE026_NESTED {", "x CINE026_NESTED {}",
    "CINE026_STREAM", "CINE026_STREAM other 1 [CINEMATCH_DB_CAPACITY]", "CINE026_STREAM app 65 [CINEMATCH_DB_CAPACITY]", "CINE026_STREAM app 01 [CINEMATCH_DB_CAPACITY]",
    "CINE026_STREAM app 1 " + CANARY, "CINE026_STREAM app 1 [CINEMATCH_DB_CAPACITY] " + CANARY,
    `CINE026_STREAM app 1 [CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","token":"${CANARY}"}`];
  for (const line of badNested) assert.deepEqual(await emittedFor([line], gateB), [REJECTED.NESTED], line);
});

test("events are accepted only from the process that owns them", async () => {
  const progress = P({ ev: "run_end", status: "passed", ms: 1 });
  const nested = N({ ev: "tap_ready" });
  const tagged = "CINE026_STREAM app 1 [CINEMATCH_DB_CAPACITY]";
  assert.deepEqual(await emittedFor([progress, nested, tagged]), [progress, REJECTED.NESTED, REJECTED.NESTED]);
  assert.deepEqual(await emittedFor([progress, nested, tagged], gateB), [REJECTED.PROGRESS, nested, N({ ev: "diagnostic", kind: "app", n: 1 })]);
  for (const childArgs of [["next", "build"], ["--import", "tsx", "scripts/realtime-worker.ts"]]) {
    assert.deepEqual(await emittedFor([progress], { childArgs }), [REJECTED.PROGRESS]);
    assert.deepEqual(await emittedFor([nested, tagged], { ...gateB, childArgs }), [REJECTED.NESTED, REJECTED.NESTED]);
  }
});

test("other output is never relayed, rejections are bounded, and valid events survive a flood of invalid ones", async () => {
  assert.deepEqual(await emittedFor(["", CANARY, "CINE026_PROGRESS_TITLES=" + CANARY, "[CINEMATCH_DB_CAPACITY]", '{"ev":"begin","total":1}']), []);
  const flood = Array.from({ length: 5_000 }, () => "CINE026_PROGRESS " + CANARY);
  const last = P({ ev: "run_end", status: "passed", ms: 1 });
  const emitted = await emittedFor([...flood, last]);
  assert.equal(emitted.length, 65);
  assert.equal(emitted.at(-1), last);
  const state = {};
  for (const line of emitted) observeLine(state, line, { startedMs: 0, nowMs: () => 1 });
  assert.equal(state.progress.reporter.rejected, 64);
  assert.ok(progressProblems(state, 0).length > 0);
});

// A sanity check of the harness itself: the outer reader gets nothing it was not sent.
test("without any relayed event the outer supervisor has no progress and no watchdog", async () => {
  const { EventEmitter } = require("node:events");
  const clock = fakeClock();
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), unref() {}, kill: () => assert.fail("no signal") });
  const done = superviseWorkload(child, { budget: { executionMs: 600_000, cleanupMs: 1, forceGraceMs: 1 }, observe: observeLine,
    groupAlive: () => false, killGroup() {}, setTimer: clock.set, clearTimer: clock.clear, now: clock.now, nowMs: clock.nowMs });
  child.stdout.write("CINE026_SUPERVISOR_PHASE workload\n");
  clock.advance(RUN_END_GRACE_MS * 2);
  child.emit("close", 0);
  const result = await done;
  assert.deepEqual(progressProblems(result, 2), ["reporter_not_observed"]);
  assert.equal(passes(result), false);
});
