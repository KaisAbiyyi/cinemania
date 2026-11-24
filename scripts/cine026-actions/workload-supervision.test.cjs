/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { planWorkload, superviseWorkload, runSupervisor } = require("./workload-supervision.cjs");
const { observeLine, verifiedCleanup, stableWorkload } = require("./qualification.cjs");

const MINUTE = 60_000;
const budget = { executionMs: 420_000, cleanupMs: 240_000, forceGraceMs: 6_000 };
const zero = keys => Object.fromEntries(keys.split(" ").map(key => [key, 0]));
const metrics = {
  leaseRelease: "released", cleanupVerified: true,
  counts: zero("capacity escapedReset checkedOutReset idleReset lockTimeout providerTransport providerStatus"),
  peaks: zero("pending poison retries oldest_pending_ms advisory_waiters idle_transactions other_role_sessions"),
  final: zero("rooms participants votes events pending poison retries oldest_pending_ms advisory_locks advisory_waiters idle_transactions other_role_sessions other_role_nonidle_sessions"),
};
const transport = {
  http: { count: 8, okCount: 8, nonOkCount: 0, maxMs: 415, over1000Ms: 0, over1400Ms: 0 },
  outcomes: { marked: 8, retry_scheduled: 0, deferred: 0, permanent_rejection: 0 },
  failures: [], omittedFailures: 0,
};

function fakeClock() {
  let time = 0;
  const timers = new Map();
  return {
    set(fn, ms) {
      const key = Symbol();
      timers.set(key, { when: time + ms, fn });
      return key;
    },
    clear(key) { timers.delete(key); },
    now: () => new Date(time).toISOString(),
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

function fakeSupervisor({ groupAlive = () => false, onCheckpoint, signal } = {}) {
  const clock = fakeClock();
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const directSignals = [];
  const groupSignals = [];
  const checkpoints = [];
  child.kill = name => { directSignals.push(name); };
  child.unref = () => {};
  const done = superviseWorkload(child, {
    budget, observe: observeLine, signal, groupAlive,
    killGroup: name => groupSignals.push(name),
    setTimer: clock.set, clearTimer: clock.clear, now: clock.now,
    onCheckpoint: onCheckpoint ?? (state => checkpoints.push(structuredClone(state))),
  });
  const line = value => child.stdout.write(value + "\n");
  function terminal(code = 0, terminalTransport = transport) {
    line("CINE026_TRANSPORT_DIAGNOSTICS " + JSON.stringify(terminalTransport));
    line("CINE026_HOSTED_METRICS " + JSON.stringify(metrics));
    line("CINE026_SUPERVISOR_PHASE terminal");
    child.emit("exit", code);
    child.emit("close", code);
  }
  return { clock, child, done, line, terminal, directSignals, groupSignals, checkpoints };
}

test("a passing browser gets its own 135-second cleanup window even near the execution cutoff", async () => {
  const f = fakeSupervisor();
  f.clock.advance(410_000);
  f.line("CINE026_SUPERVISOR_PHASE teardown");
  f.clock.advance(135_000);
  f.line("CINE026_SUPERVISOR_PHASE cleanup_audit");
  f.clock.advance(22_000);
  f.terminal();
  const result = await f.done;
  assert.equal(stableWorkload(result), true);
  assert.equal(verifiedCleanup(result), true);
  assert.deepEqual(f.directSignals, []);
  assert.deepEqual(f.groupSignals, []);
});

test("execution timeout stops only the supervisor gracefully and cannot become a pass after cleanup", async () => {
  const f = fakeSupervisor();
  f.clock.advance(420_000);
  assert.deepEqual(f.directSignals, ["SIGTERM"]);
  assert.deepEqual(f.groupSignals, []);
  f.clock.advance(145_000);
  f.terminal();
  const result = await f.done;
  assert.equal(result.executionTimedOut, true);
  assert.equal(result.firstFailure.code, "WORKLOAD_EXECUTION_TIMEOUT");
  assert.equal(verifiedCleanup(result), true);
  assert.equal(stableWorkload(result), false);
});

test("a late terminal record cannot turn a cleanup timeout into a pass", async () => {
  const f = fakeSupervisor();
  f.clock.advance(50_000);
  f.line("CINE026_SUPERVISOR_PHASE teardown");
  f.line("CINE026_TRANSPORT_PARTIAL " + JSON.stringify(transport));
  f.clock.advance(240_000);
  f.terminal();
  const result = await f.done;
  assert.equal(result.cleanupTimedOut, true);
  assert.equal(result.firstFailure.code, "WORKLOAD_CLEANUP_TIMEOUT");
  assert.equal(verifiedCleanup(result), false);
  assert.equal(stableWorkload(result), false);
  assert.deepEqual(f.directSignals, ["SIGTERM"]);
  assert.equal(f.checkpoints.some(state => state.partialTransport?.http.count === 8), true);
});

test("a hung supervisor cannot hold pipes past the absolute ceiling or overwrite an earlier failure", async () => {
  const f = fakeSupervisor();
  f.clock.advance(419_000);
  f.line("CINE026_HOSTED_FAILURE " + JSON.stringify({
    phase: "monitor", code: "ECONNRESET", at: "2026-11-24T00:00:00.000Z", primary: true,
  }));
  f.clock.advance(247_000);
  const result = await f.done;
  assert.deepEqual(f.directSignals, ["SIGTERM", "SIGTERM"]);
  assert.deepEqual(f.groupSignals, ["SIGKILL"]);
  assert.equal(f.child.stdout.destroyed, true);
  assert.equal(result.hardCeilingReached, true);
  assert.equal(result.exitCode, null);
  assert.equal(result.firstFailure.code, "ECONNRESET");
  assert.equal(stableWorkload(result), false);
});

test("a stalled cleanup is killed after its own grace period rather than waiting for the absolute ceiling", async () => {
  const f = fakeSupervisor();
  f.line("CINE026_SUPERVISOR_PHASE teardown");
  f.clock.advance(246_000);
  const result = await f.done;
  assert.deepEqual(f.groupSignals, ["SIGKILL"]);
  assert.equal(result.cleanupTimedOut, true);
  assert.equal(result.forcedTermination, true);
  assert.equal(result.hardCeilingReached, undefined);
  assert.equal(verifiedCleanup(result), false);
});

test("partial transport plus exit 0 does not replace terminal metrics or transport", async () => {
  const f = fakeSupervisor();
  f.line("CINE026_SUPERVISOR_PHASE teardown");
  f.line("CINE026_TRANSPORT_PARTIAL " + JSON.stringify({ ...transport, credential: "not-recorded" }));
  f.line("CINE026_SUPERVISOR_PHASE terminal");
  f.child.emit("close", 0);
  const result = await f.done;
  assert.equal(result.partialTransport.http.count, 8);
  assert.equal(Object.hasOwn(result.partialTransport, "credential"), false);
  assert.equal(stableWorkload(result), false);
  assert.equal(verifiedCleanup(result), false);
  const cleanWithoutTransport = { ...result, metrics };
  assert.equal(verifiedCleanup(cleanWithoutTransport), true);
  assert.equal(stableWorkload(cleanWithoutTransport), false);
  assert.equal(stableWorkload({ ...cleanWithoutTransport, transport, terminalMilestone: false }), false);
});

test("external interruption preserves partial evidence and kills descendants of a dead supervisor", async () => {
  const cancellation = new AbortController();
  const f = fakeSupervisor({ signal: cancellation.signal, groupAlive: () => true });
  f.line("CINE026_TRANSPORT_PARTIAL " + JSON.stringify(transport));
  cancellation.abort();
  f.child.emit("exit", null);
  f.child.emit("close", null);
  const result = await f.done;
  assert.deepEqual(f.directSignals, ["SIGTERM"]);
  assert.deepEqual(f.groupSignals, ["SIGKILL"]);
  assert.equal(result.remainingProcesses, true);
  assert.equal(result.partialTransport.http.count, 8);
  assert.equal(result.firstFailure.code, "WORKLOAD_INTERRUPTED");
  assert.equal(verifiedCleanup(result), false);
});

test("checkpoint write failure stops work gracefully and remains fail-closed", async () => {
  const f = fakeSupervisor({ onCheckpoint: () => { throw new Error("disk full"); } });
  f.line("CINE026_SUPERVISOR_PHASE workload");
  f.terminal();
  const result = await f.done;
  assert.equal(result.evidenceWriteFailed, true);
  assert.equal(result.firstFailure.code, "EVIDENCE_CHECKPOINT_FAILED");
  assert.deepEqual(f.directSignals, ["SIGTERM"]);
  assert.equal(stableWorkload(result), false);
});

test("all five workloads share the job envelope and reserve cleanup plus artifact upload", () => {
  const jobStarted = 1_800_000_000_000;
  let now = jobStarted + 18 * MINUTE;
  const first = planWorkload("A", jobStarted, now);
  assert.deepEqual(first, budget);
  for (const gate of ["A", "A", "A", "B"]) {
    const stage = planWorkload(gate, jobStarted, now);
    now += stage.executionMs + stage.cleanupMs + stage.forceGraceMs;
  }
  const last = planWorkload("C", jobStarted, now);
  assert.ok(last.executionMs > 0 && last.executionMs < 55 * MINUTE);
  assert.equal(now + last.executionMs + last.cleanupMs + last.forceGraceMs, jobStarted + 117 * MINUTE);
  assert.equal(planWorkload("C", jobStarted, jobStarted + 113 * MINUTE), null);
  assert.equal(planWorkload("C", NaN, now), null);
  assert.equal(planWorkload("A", jobStarted, jobStarted + 103 * MINUTE, 630_000), null);
});

test("the bridge checkpoints while a child runs and emits teardown before independent audit", async () => {
  const emitted = [];
  const observed = [];
  let close;
  let onLine;
  let waitForChild;
  const started = new Promise(resolve => { waitForChild = resolve; });
  const outcome = runSupervisor({
    args: [], createClient: config => ({ config }), emit: line => emitted.push(line),
    diagnostics: { observe: line => observed.push(line), summary: () => transport },
    async main(options) {
      options.makeClient({ supervisor: true });
      const workload = options.startChild(["cli.js", "test"], {}, () => {});
      assert.equal(await workload.done, 0);
      options.report("CINE026_HOSTED_SHUTDOWN", {});
      await options.wait(135_000);
      options.makeClient({ audit: true });
      options.report("CINE026_TRANSPORT_DIAGNOSTICS", transport);
      options.report("CINE026_HOSTED_METRICS", metrics);
      return { exitCode: 0 };
    },
    start(_args, _env, read) {
      onLine = read;
      const done = new Promise(resolve => { close = resolve; });
      waitForChild();
      return { done, stop: async () => {} };
    },
    wait: async () => {}, now: () => 1,
  });
  await started;
  onLine("[CINEMATCH_REALTIME_ATTEMPT] {}");
  onLine('[CINEMATCH_REALTIME_ATTEMPT] {"kind":"transport"}');
  assert.equal(observed.length, 2);
  assert.equal(emitted.filter(line => line.startsWith("CINE026_TRANSPORT_PARTIAL ")).length, 2);
  assert.equal(emitted.includes("CINE026_SUPERVISOR_PHASE terminal"), false);
  close(0);
  assert.equal(await outcome, 0);
  assert.deepEqual(emitted.filter(line => line.startsWith("CINE026_SUPERVISOR_PHASE ")).map(line => line.split(" ").at(-1)),
    ["execution_start", "workload", "teardown", "shutdown_observed", "quiet_window", "cleanup_audit", "terminal"]);
});

test("the bridge cooperatively stops the active child and preserves the supervisor cleanup path", async () => {
  const cancellation = new AbortController();
  const emitted = [];
  let close;
  let stopCalls = 0;
  const result = await runSupervisor({
    args: [], signal: cancellation.signal, createClient: () => ({}), emit: line => emitted.push(line),
    diagnostics: { observe: () => {}, summary: () => transport }, wait: async () => {},
    async main(options) {
      const child = options.startChild(["cli.js", "test"], {}, () => {});
      cancellation.abort();
      assert.equal(await child.done, 1);
      assert.throws(() => options.startChild(["other.js"], {}, () => {}), /shutting down/);
      options.report("CINE026_HOSTED_METRICS", metrics);
      return { exitCode: 1 };
    },
    start() {
      return { done: new Promise(resolve => { close = resolve; }), async stop() { stopCalls++; close(1); } };
    },
  });
  assert.equal(result, 1);
  assert.equal(stopCalls, 1);
  assert.equal(emitted.includes("CINE026_SUPERVISOR_PHASE stop_requested"), true);
  assert.equal(emitted.includes("CINE026_SUPERVISOR_PHASE terminal"), true);
});

test("a worker recovery proof cannot certify zero failures from an empty terminal transport report", async () => {
  const f = fakeSupervisor();
  f.line("CINE026_WORKER_RECOVERY " + JSON.stringify({
    appCommit: "00555c03d4173ac54750677207b78252e2063257", versions: [6, 7],
    receiptToPrivateHintMs: [12, 13], receiptToDurableReadbackMs: [19, 21],
  }));
  f.terminal(0, { ...transport, http: { ...transport.http, count: 0, okCount: 0, maxMs: 0 } });
  const result = await f.done;
  assert.deepEqual(result.worker.versions, [6, 7]);
  assert.equal(verifiedCleanup(result), true);
  assert.equal(stableWorkload(result), false);
});

test("an unsolicited supervisor stop cannot pass even with exit 0 and complete cleanup", async () => {
  const f = fakeSupervisor();
  f.line("CINE026_SUPERVISOR_PHASE teardown");
  f.line("CINE026_SUPERVISOR_PHASE stop_requested");
  f.terminal();
  const result = await f.done;
  assert.equal(result.firstFailure.code, "WORKLOAD_SUPERVISOR_STOP_REQUESTED");
  assert.equal(stableWorkload(result), false);
});

test("an authorization or rejected HTTP response cannot pass as healthy provider traffic", async () => {
  const f = fakeSupervisor();
  f.terminal(0, { ...transport, http: { ...transport.http, count: 9, nonOkCount: 1 } });
  const result = await f.done;
  assert.equal(result.metrics.counts.providerStatus, 0);
  assert.equal(result.transport.http.nonOkCount, 1);
  assert.equal(stableWorkload(result), false);
});
