/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { createProgress, observeProgressLine, classifyProgress, MAX_SAMPLES, MAX_STREAMS } = require("./workload-progress.cjs");
const { superviseWorkload, runSupervisor, observeSamples, NESTED_TAP } = require("./workload-supervision.cjs");
const { observeLine, nestedEvidence, nestedProblems, warmupEndMs, stableWorkload, EXPECTED_NESTED } = require("./qualification.cjs");
const { STALL_MS, RUN_END_GRACE_MS } = require("./execution-budget.cjs");

const steps = (extra = {}) => ({ api: 0, expect: 0, step: 0, hook: 2, fixture: 0, other: 0, ...extra });
const progressLine = payload => "CINE026_PROGRESS " + JSON.stringify(payload);
const sampleLine = (extra = {}) => "CINE026_DB_SAMPLE " + JSON.stringify({ votes: 0, events: 0, pending: 0, poison: 0, rooms: 0, participants: 0,
  advisoryWaiters: 0, idleTransactions: 0, oldestPendingMs: 0, rttMs: 180, ...extra });
const nestedLine = payload => "CINE026_NESTED " + JSON.stringify(payload);

function feed(lines, startedMs = 0) {
  const state = {};
  let at = startedMs;
  const ledger = {
    state, advance: ms => { at += ms; },
    send: line => observeProgressLine(state, line, { startedMs, nowMs: () => at }),
  };
  for (const line of lines) ledger.send(line);
  return ledger;
}

test("progress lines are rebuilt from enumerations and bounded integers and never store free text", () => {
  const { state, send } = feed([]);
  const canary = "https://project.supabase.co/room/9f1c-secret-title";
  assert.equal(send(progressLine({ ev: "case_start", i: 2, timeout: 600_000, title: canary })), true);
  assert.equal(send(progressLine({ ev: "case_end", i: 2, status: "passed", ms: 5, timeout: 1, steps: steps(), post: 0, setupMs: null,
    teardownMs: null, error: canary, at: "2999-01-01T00:00:00.000Z" })), true);
  // invalid payloads are counted and dropped, never stored
  for (const bad of [{ ev: "case_end", i: 2, status: "weird", ms: 5, timeout: 1, steps: steps(), post: 0, setupMs: null, teardownMs: null },
    { ev: "case_tick", i: 1.5, steps: steps(), post: 0 }, { ev: "case_tick", i: 1, steps: { api: -1 }, post: 0 }, { ev: "nope" }, "text"]) {
    assert.equal(send(progressLine(bad)), true);
  }
  assert.equal(send("CINE026_PROGRESS {not json"), true);
  assert.equal(send("an ordinary log line"), false);
  assert.equal(state.progress.rejected, 6);
  assert.equal(state.progress.events, 2);
  assert.doesNotMatch(JSON.stringify(state.progress), /supabase|secret-title|2999/);
  assert.deepEqual(state.progress.cases.map(item => [item.index, item.status]), [[2, "passed"]]);
});

test("exhaustion progress is carried by database vote counts and durations of each stage", () => {
  const ledger = feed([]);
  ledger.send(progressLine({ ev: "begin", total: 3 }));
  ledger.send(sampleLine({ votes: 4, events: 9, rooms: 2, participants: 4 }));
  ledger.advance(10_000);
  ledger.send(progressLine({ ev: "case_start", i: 12, timeout: 600_000 }));
  for (let round = 1; round <= 20; round++) {
    ledger.advance(21_000);
    ledger.send(sampleLine({ votes: 4 + 2 * round, events: 9 + 2 * round, rooms: 2, participants: 4 }));
    ledger.send(progressLine({ ev: "case_tick", i: 12, steps: steps({ api: 4 * round, expect: 7 * round }), post: 2 * round }));
  }
  ledger.send(progressLine({ ev: "case_end", i: 12, status: "passed", ms: 420_000, timeout: 600_000,
    steps: steps({ api: 80, expect: 140 }), post: 40, setupMs: 1900, teardownMs: 130 }));
  const [exhaustion] = ledger.state.progress.cases;
  assert.equal(exhaustion.votesAtStart, 4);
  assert.equal(exhaustion.votesLast, 44); // 40 votes = 20 rounds of two vote requests
  assert.equal(exhaustion.post, 40);
  assert.equal(exhaustion.durationMs, 420_000);
  assert.equal(exhaustion.setupMs, 1900);
  assert.equal(exhaustion.teardownMs, 130);
  assert.ok(ledger.state.progress.samples.length <= MAX_SAMPLES);
});

test("continuous pending time is measured from observation and is not the age of the oldest row", () => {
  const ledger = feed([]);
  ledger.send(sampleLine({ pending: 0, oldestPendingMs: 0 }));
  ledger.advance(3_000);
  // A row stamped by the application at request start can look ten seconds old the moment it is committed.
  ledger.send(sampleLine({ pending: 1, oldestPendingMs: 10_285 }));
  ledger.advance(3_000);
  ledger.send(sampleLine({ pending: 0, oldestPendingMs: 0 }));
  ledger.advance(3_000);
  ledger.send(sampleLine({ pending: 1, oldestPendingMs: 600 }));
  ledger.advance(3_000);
  ledger.send(sampleLine({ pending: 1, oldestPendingMs: 3_900 }));
  const { peaks } = ledger.state.progress;
  assert.equal(peaks.oldestPendingMs, 10_285);
  assert.equal(peaks.continuousPendingMs, 3_000);
});

test("a long series is bounded while peaks survive", () => {
  const ledger = feed([]);
  for (let i = 0; i < 500; i++) {
    ledger.advance(3_000);
    ledger.send(sampleLine({ votes: i, rttMs: i === 250 ? 4_321 : 100 }));
  }
  const { samples, sampleCount, peaks } = ledger.state.progress;
  assert.ok(samples.length <= MAX_SAMPLES && samples.length > 10);
  assert.equal(sampleCount, 500);
  assert.equal(samples.at(-1).votes, 499);
  assert.equal(peaks.rttMs, 4_321);
});

test("the database's dispatched count is a lower bound that sums rises, ignores deletions and excludes poison", () => {
  const ledger = feed([]);
  const at = (events, pending, poison = 0) => { ledger.advance(3_000); ledger.send(sampleLine({ events, pending, poison })); };
  at(0, 0);
  at(2, 2); // two new events, none dispatched
  at(2, 0); // both dispatched
  at(5, 1, 1); // three more: one pending, one poisoned, one dispatched
  at(0, 0); // fixture cleanup deletes every row
  at(3, 0); // a new room's three events dispatched
  at(1, 4); // inconsistent sample: clamped, never negative
  assert.equal(ledger.state.progress.dispatched.lowerBound, 2 + 1 + 3);
  assert.equal(ledger.state.progress.samples.at(-1).poison, 0);
  // a sample without the poison count is rejected, not read as zero
  assert.equal(ledger.send("CINE026_DB_SAMPLE " + JSON.stringify({ votes: 0, events: 9, pending: 0, rooms: 0, participants: 0,
    advisoryWaiters: 0, idleTransactions: 0, oldestPendingMs: 0, rttMs: 1 })), true);
  assert.equal(ledger.state.progress.dispatched.lowerBound, 6);
  assert.equal(ledger.state.progress.rejected, 1);
});

test("a child's own timestamps cannot keep a stalled run looking alive", () => {
  const ledger = feed([progressLine({ ev: "case_start", i: 0, timeout: 180_000 })]);
  ledger.advance(STALL_MS + 1);
  ledger.send(progressLine({ ev: "case_tick", i: 0, steps: steps(), post: 0, at: Date.now() + 1e9 }));
  assert.equal(ledger.state.progress.lastSignalAfterMs, STALL_MS + 1);
});

test("progress is classified as no evidence, progressing, stalled, between cases or ended", () => {
  assert.equal(classifyProgress(undefined, 5), "NO_PROGRESS_EVIDENCE");
  assert.equal(classifyProgress(createProgress(), 5), "NO_PROGRESS_EVIDENCE");
  const active = feed([progressLine({ ev: "case_start", i: 1, timeout: 1 })]);
  assert.equal(classifyProgress(active.state.progress, STALL_MS), "CASE_ACTIVE_PROGRESSING");
  assert.equal(classifyProgress(active.state.progress, STALL_MS + 1), "CASE_ACTIVE_STALLED");
  active.send(progressLine({ ev: "case_end", i: 1, status: "passed", ms: 1, timeout: 1, steps: steps(), post: 0, setupMs: 0, teardownMs: 0 }));
  assert.equal(classifyProgress(active.state.progress, 1_000), "BETWEEN_CASES_PROGRESSING");
  assert.equal(classifyProgress(active.state.progress, STALL_MS + 1), "BETWEEN_CASES_STALLED");
  active.send(progressLine({ ev: "run_end", status: "passed", ms: 100 }));
  assert.equal(classifyProgress(active.state.progress, 5), "RUN_ENDED");
});

// --- supervisor integration ------------------------------------------------------------------------------

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

function supervised(budget = { executionMs: 600_000, cleanupMs: 240_000, forceGraceMs: 6_000 }) {
  const clock = fakeClock();
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const signals = [];
  const checkpoints = [];
  child.kill = name => signals.push(name);
  child.unref = () => {};
  const done = superviseWorkload(child, {
    budget, observe: observeLine, groupAlive: () => false, killGroup: () => {},
    setTimer: clock.set, clearTimer: clock.clear, now: clock.now, nowMs: clock.nowMs,
    onCheckpoint: state => checkpoints.push(structuredClone(state)),
  });
  const line = value => child.stdout.write(value + "\n");
  // Lines travel through a stream; let them be consumed before the clock moves.
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const close = code => { child.emit("exit", code); child.emit("close", code); };
  return { clock, done, line, settle, close, signals, checkpoints };
}

test("a slow case that is still progressing at the deadline is told apart from a stalled one", async () => {
  for (const [name, silentMs, expected] of [["progressing", 5_000, "CASE_ACTIVE_PROGRESSING"], ["stalled", STALL_MS + 30_000, "CASE_ACTIVE_STALLED"]]) {
    const run = supervised({ executionMs: 600_000, cleanupMs: 240_000, forceGraceMs: 6_000 });
    run.line("CINE026_SUPERVISOR_PHASE workload");
    run.line(progressLine({ ev: "case_start", i: 12, timeout: 600_000 }));
    await run.settle();
    run.clock.advance(600_000 - silentMs);
    run.line(sampleLine({ votes: 30, events: 40 }));
    run.line(progressLine({ ev: "case_tick", i: 12, steps: steps({ expect: 80 }), post: 30 }));
    await run.settle();
    run.clock.advance(silentMs);
    const last = run.checkpoints.at(-1);
    assert.equal(last.executionTimedOut, true, name);
    assert.equal(last.progressAtStop, expected, name);
    assert.equal(last.firstFailure.code, "WORKLOAD_EXECUTION_TIMEOUT");
    assert.deepEqual(run.signals, ["SIGTERM"]);
    run.close(1);
    const result = await run.done;
    assert.equal(stableWorkload(result), false, "a timeout never passes");
    assert.equal(result.progress.cases[0].endedAfterMs, null);
  }
});

test("killing a run in the middle of a case keeps the partial progress as partial evidence", async () => {
  const run = supervised();
  run.line(progressLine({ ev: "case_start", i: 8, timeout: 180_000 }));
  run.line(progressLine({ ev: "case_end", i: 8, status: "passed", ms: 40_000, timeout: 180_000, steps: steps({ expect: 9 }), post: 3, setupMs: 100, teardownMs: 50 }));
  run.line(progressLine({ ev: "case_start", i: 9, timeout: 180_000 }));
  await run.settle();
  run.clock.advance(1_000);
  run.close(null);
  const result = await run.done;
  assert.deepEqual(result.progress.cases.map(item => [item.index, item.status, item.endedAfterMs === null]), [[8, "passed", false], [9, "running", true]]);
  assert.equal(result.terminalMilestone, false);
  assert.equal(stableWorkload(result), false);
});

test("a run that ended but never leaves Playwright is stopped as a teardown stall, not as a timeout", async () => {
  const run = supervised();
  run.line("CINE026_SUPERVISOR_PHASE workload");
  run.line(progressLine({ ev: "case_start", i: 0, timeout: 180_000 }));
  run.line(progressLine({ ev: "case_end", i: 0, status: "passed", ms: 70_000, timeout: 180_000, steps: steps(), post: 1, setupMs: 1, teardownMs: 1 }));
  run.line(progressLine({ ev: "run_end", status: "passed", ms: 71_000 }));
  await run.settle();
  run.clock.advance(RUN_END_GRACE_MS - 1);
  assert.equal(run.checkpoints.at(-1).teardownStalled, undefined);
  run.clock.advance(1);
  const last = run.checkpoints.at(-1);
  assert.equal(last.teardownStalled, true);
  assert.equal(last.firstFailure.code, "PLAYWRIGHT_TEARDOWN_STALLED");
  assert.equal(last.progressAtStop, "RUN_ENDED");
  assert.equal(last.executionTimedOut, undefined);
  assert.deepEqual(run.signals, ["SIGTERM"]);
  run.close(1);
  assert.equal(stableWorkload(await run.done), false);
});

test("a run that ends and tears down normally is never flagged, including through the long cleanup quiet window", async () => {
  const run = supervised();
  run.line("CINE026_SUPERVISOR_PHASE workload");
  run.line(progressLine({ ev: "case_start", i: 0, timeout: 180_000 }));
  run.line(progressLine({ ev: "run_end", status: "passed", ms: 71_000 }));
  await run.settle();
  run.clock.advance(5_000);
  run.line("CINE026_SUPERVISOR_PHASE teardown");
  await run.settle();
  run.clock.advance(135_000 + 60_000); // past the quiet window and the run-end grace would have fired, still inside the 240 s cleanup budget
  const last = run.checkpoints.at(-1);
  assert.equal(last.teardownStalled, undefined);
  assert.equal(last.firstFailure, undefined);
  assert.equal(last.cleanupTimedOut, undefined);
  run.close(0);
  await run.done;
});

test("a budget clipped by the job ceiling is recorded on the workload", async () => {
  const run = supervised({ executionMs: 100_000, cleanupMs: 240_000, forceGraceMs: 6_000, budgetBinding: true });
  run.close(0);
  assert.equal((await run.done).budgetBinding, true);
});

// --- adapter ----------------------------------------------------------------------------------------------

test("sampling the monitor is passive: results, rejections and callbacks pass through untouched", async () => {
  const emitted = [];
  const row = { rooms: 1, participants: 2, votes: 28, events: 40, pending: 1, poison: 0, retries: 0, oldest_pending_ms: 10_284.869,
    advisory_locks: 0, advisory_waiters: 2, idle_transactions: 4, other_role_sessions: 6, other_role_nonidle_sessions: 1 };
  let time = 1_000;
  const client = observeSamples({
    async query(text) {
      time += 180;
      if (text === "boom") throw new Error("pooler gone");
      return { rows: [text === "state" ? row : { n: 1 }] };
    },
  }, { emit: line => emitted.push(line), nowMs: () => time });
  assert.deepEqual((await client.query("state")).rows[0], row);
  assert.deepEqual((await client.query("other")).rows[0], { n: 1 });
  await assert.rejects(() => client.query("boom"), /pooler gone/);
  assert.equal(emitted.length, 1);
  assert.deepEqual(JSON.parse(emitted[0].slice("CINE026_DB_SAMPLE ".length)), { votes: 28, events: 40, pending: 1, poison: 0, rooms: 1, participants: 2,
    advisoryWaiters: 2, idleTransactions: 4, oldestPendingMs: 10_285, rttMs: 180 });
  const callback = observeSamples({ query(text, done) { done(null, text); return "native"; } }, { emit: () => assert.fail("no sample") });
  assert.equal(callback.query("x", () => {}), "native");
  const throwing = observeSamples({ async query() { return { rows: [row] }; } }, { emit() { throw new Error("stdout closed"); } });
  assert.deepEqual((await throwing.query("state")).rows[0], row);
  assert.equal(observeSamples({}, { emit: () => {} }) !== null, true);
});

test("only the Gate B process receives the nested-stream tap and the tap is appended to existing options", async () => {
  const seen = [];
  async function run(args) {
    return runSupervisor({
      args, createClient: () => ({}), emit: () => {}, diagnostics: { observe: () => {}, summary: () => ({}) }, wait: async () => {},
      async main(options) {
        const build = options.startChild(["next", "build"], { KEEP: "1" }, () => {});
        assert.equal(await build.done, 0);
        const child = options.startChild(["cli.js", "test"], { NODE_OPTIONS: "--require ./mock.cjs", KEEP: "1" }, () => {});
        assert.equal(await child.done, 0);
        return { exitCode: 0 };
      },
      start(childArgs, env) {
        seen.push({ childArgs, env });
        return { done: Promise.resolve(0), stop: async () => {} };
      },
    });
  }
  await run(["--worker-qualification"]);
  await run(["--reporter=json"]);
  const [gateBBuild, gateB, gateABuild, gateA] = seen;
  assert.equal(gateB.env.NODE_OPTIONS, "--require ./mock.cjs --require " + NESTED_TAP);
  assert.equal(gateB.env.KEEP, "1");
  assert.equal(gateBBuild.env.NODE_OPTIONS, undefined);
  assert.equal(gateA.env.NODE_OPTIONS, "--require ./mock.cjs");
  assert.equal(gateABuild.env.NODE_OPTIONS, undefined);
});

// --- Gate B evidence ------------------------------------------------------------------------------------

const lifecycle = {
  spawn: (kind, n, piped = kind !== "fault") => nestedLine({ ev: "spawn", kind, n, piped }),
  exit: (kind, n, { code = null, signal = true, forwarded = 0, dropped = 0 } = {}) => nestedLine({ ev: "exit", kind, n, code, signal, forwarded, dropped }),
  lines: (kind, n, forwarded, dropped) => nestedLine({ ev: "lines", kind, n, forwarded, dropped }),
};

// Every generation the pinned Gate B starts on its success path, ended by an intentional kill.
function completeGateB({ without = () => false, forwardedBy = () => 0 } = {}) {
  const lines = [nestedLine({ ev: "tap_ready" })];
  for (const [kind, expected] of Object.entries(EXPECTED_NESTED)) {
    for (let n = 1; n <= expected; n++) {
      if (without(kind, n, "spawn")) continue;
      lines.push(lifecycle.spawn(kind, n));
      if (!without(kind, n, "exit")) lines.push(lifecycle.exit(kind, n, { forwarded: forwardedBy(kind, n), dropped: 4 }));
    }
  }
  return lines;
}

const diagnostics = (kind, n, count) => Array.from({ length: count }, () => nestedLine({ ev: "diagnostic", kind, n }));

function gateB(lines) {
  return { progress: feed(lines).state.progress };
}

test("a complete Gate B lifecycle is accepted, including intentionally killed children and restarts", () => {
  const result = gateB(completeGateB({ forwardedBy: (kind, n) => (kind === "worker" && n === 1 ? 6 : 0) }).concat(diagnostics("worker", 1, 6)));
  assert.deepEqual(nestedProblems(result), []);
  assert.equal(nestedEvidence(result), true);
  assert.deepEqual(result.progress.nested.generations, EXPECTED_NESTED);
  // a restarted worker is its own generation and nothing here needed HTTP traffic from every idle generation
  assert.equal(result.progress.nested.streams.find(item => item.kind === "worker" && item.n === 5).forwarded, 0);
  // a child that ended by itself with code 0 is also terminal
  const clean = gateB(completeGateB().map(line => line.includes('"kind":"app","n":3,"code"') ? lifecycle.exit("app", 3, { code: 0, signal: false }) : line));
  assert.deepEqual(nestedProblems(clean), []);
});

test("Gate B rejects absent nested evidence instead of reading it as zero failures", () => {
  assert.deepEqual(nestedProblems({}), ["tap_not_loaded"]);
  assert.deepEqual(nestedProblems(gateB([])), ["tap_not_loaded"]);
  assert.deepEqual(nestedProblems(gateB(completeGateB().slice(1))), ["tap_not_loaded"], "the tap never reported ready");
  for (const result of [{}, gateB([])]) assert.equal(nestedEvidence(result), false);
});

test("Gate B rejects spawn-only evidence: every generation needs a terminal record", () => {
  const spawnOnly = completeGateB({ without: (_kind, _n, part) => part === "exit" });
  const problems = nestedProblems(gateB(spawnOnly));
  assert.deepEqual(problems.sort(), ["app_no_terminal_record", "fault_no_terminal_record", "worker_no_terminal_record"]);
  // one stream with a terminal record does not vouch for the others
  const one = completeGateB({ without: (kind, n, part) => part === "exit" && !(kind === "worker" && n === 1) });
  assert.ok(nestedProblems(gateB(one)).includes("worker_no_terminal_record"));
});

test("Gate B rejects a run where one stream is successful and another generation is missing", () => {
  // the failed-worker generation (the restart) never reported at all
  const missingRestart = gateB(completeGateB({ without: (kind, n) => kind === "worker" && n === 5 }));
  assert.deepEqual(nestedProblems(missingRestart), ["worker_generations"]);
  // only one app instance reported although the pinned Gate B starts three
  const oneApp = gateB(completeGateB({ without: (kind, n) => kind === "app" && n > 1 }));
  assert.deepEqual(nestedProblems(oneApp), ["app_generations"]);
  // a missing fault committer is as incomplete as a missing worker
  assert.deepEqual(nestedProblems(gateB(completeGateB({ without: kind => kind === "fault" }))), ["fault_generations"]);
  // surplus generations are also refused: the plan is exact, not a minimum
  const extra = completeGateB().concat([lifecycle.spawn("worker", 6), lifecycle.exit("worker", 6)]);
  assert.ok(nestedProblems(gateB(extra)).includes("worker_generations"));
});

test("Gate B rejects a child whose output was never attached, but not a fault committer that has none by design", () => {
  const unpiped = completeGateB().map(line => line.includes('"kind":"app","n":2,"piped"') ? lifecycle.spawn("app", 2, false) : line);
  assert.deepEqual(nestedProblems(gateB(unpiped)), ["app_not_attached"]);
  const worker = completeGateB().map(line => line.includes('"kind":"worker","n":3,"piped"') ? lifecycle.spawn("worker", 3, false) : line);
  assert.deepEqual(nestedProblems(gateB(worker)), ["worker_not_attached"]);
  assert.deepEqual(nestedProblems(gateB(completeGateB())), [], "fault children are unpiped in the pinned source");
});

test("Gate B rejects an unexpected crash but accepts an intentional kill", () => {
  const crash = completeGateB().map(line => line.includes('"kind":"worker","n":2,"code"') ? lifecycle.exit("worker", 2, { code: 1, signal: false }) : line);
  assert.deepEqual(nestedProblems(gateB(crash)), ["worker_crashed"]);
  assert.deepEqual(nestedProblems(gateB(completeGateB())), []);
});

test("Gate B rejects invalid, duplicate, out-of-order, orphaned and overflowing records", () => {
  const base = completeGateB();
  const cases = {
    duplicateSpawn: base.concat(lifecycle.spawn("app", 2)),
    duplicateExit: base.concat(lifecycle.exit("worker", 1)),
    duplicateTap: base.concat(nestedLine({ ev: "tap_ready" })),
    outOfOrder: base.concat(lifecycle.spawn("worker", 9)),
    orphanExit: base.concat(lifecycle.exit("worker", 12)),
    orphanLines: base.concat(lifecycle.lines("app", 20, 1, 1)),
    malformed: base.concat(nestedLine({ ev: "spawn", kind: "evil", n: 1, piped: true })),
    malformedExit: base.concat(nestedLine({ ev: "exit", kind: "app", n: 1, code: "x", signal: true, forwarded: 0, dropped: 0 })),
    notJson: base.concat("CINE026_NESTED {nope"),
    missingPiped: base.concat(nestedLine({ ev: "spawn", kind: "fault", n: 3 })),
  };
  for (const [name, lines] of Object.entries(cases)) {
    const problems = nestedProblems(gateB(lines));
    assert.ok(problems.includes("invalid_events"), name + " " + JSON.stringify(problems));
  }
  // overflow: more generations than the table can hold is invalid, never silently truncated
  const flood = [nestedLine({ ev: "tap_ready" })];
  for (let n = 1; n <= 20; n++) flood.push(lifecycle.spawn("worker", n), lifecycle.exit("worker", n));
  const overflow = gateB(flood);
  assert.ok(overflow.progress.nested.invalid.overflow > 0);
  assert.ok(nestedProblems(overflow).includes("invalid_events"));
  assert.ok(overflow.progress.nested.streams.length <= MAX_STREAMS);
});

test("forwarded lines are reconciled against what the supervisor actually received", () => {
  const lines = completeGateB({ forwardedBy: (kind, n) => (kind === "worker" ? n : 0) }); // 1+2+3+4+5 = 15 forwarded
  const arrived = extra => lines.concat([1, 2, 3, 4, 5].flatMap(n => diagnostics("worker", n, n + (extra[n] ?? 0))));
  assert.deepEqual(nestedProblems(gateB(arrived({}))), []);
  assert.deepEqual(nestedProblems(gateB(arrived({ 5: -1 }))), ["forwarded_lines_lost"]);
  assert.deepEqual(nestedProblems(gateB(arrived({ 2: 1 }))), ["unaccounted_lines"]);
  // the total matches (15 of 15) but one generation's surplus must not cover another one's loss
  assert.deepEqual(nestedProblems(gateB(arrived({ 2: 1, 5: -1 }))).sort(), ["forwarded_lines_lost", "unaccounted_lines"]);
  assert.ok(nestedProblems(gateB(completeGateB().concat(diagnostics("worker", 9, 1)))).includes("invalid_events"));
  // a canonical line without a relayed origin is not evidence for any generation
  const state = {};
  for (const line of ['[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":1,"ms":5,"kind":"http","status":202}', "[CINEMATCH_DB_CAPACITY]",
    "[CINEMATCH_REALTIME_ATTEMPT_FAILURE] transport", "an ordinary line"]) observeLine(state, line, { startedMs: 0, nowMs: () => 1 });
  assert.equal(state.progress, undefined);
});

test("a successful HTTP attempt elsewhere cannot make incomplete nested evidence stable", () => {
  const worker = { gate: "B" };
  const result = { exitCode: 0, worker: { versions: [6, 7] }, transport: { http: { count: 8, okCount: 8, nonOkCount: 0 }, failures: [], omittedFailures: 0 },
    progress: gateB(completeGateB({ without: (kind, n) => kind === "worker" && n === 5 })).progress, ...worker };
  assert.equal(nestedEvidence(result), false);
  assert.equal(stableWorkload({ ...result, terminalMilestone: true }), false);
});

// --- first application publish ----------------------------------------------------------------------------

const firstLine = (payload = {}) => "CINE026_PUBLISH_FIRST " + JSON.stringify({ kind: "http", via: "workload", status: 202, ms: 412, ...payload });

test("the first publish attempt is timed from W3 by the supervisor's own clock and labelled as such", () => {
  const w3EndMs = 1_000_000;
  const state = {};
  const at = nowMs => observeProgressLine(state, firstLine(), { startedMs: 1_030_000, nowMs: () => nowMs, w3EndMs });
  at(1_062_400);
  assert.deepEqual(state.progress.firstPublish, { kind: "http", via: "workload", status: 202, attemptMs: 412,
    observedAfterWorkloadStartMs: 32_400, observedAfterW3Ms: 62_400, basis: "supervisor_arrival" });
  // only the first attempt counts; a later line is rejected, not allowed to move the timing
  at(1_090_000);
  assert.equal(state.progress.firstPublish.observedAfterW3Ms, 62_400);
  assert.equal(state.progress.rejected, 1);
});

test("first publish timing stays bounded and honest when W3 is unknown, the clock is inconsistent or the line is malformed", () => {
  const noW3 = {};
  observeProgressLine(noW3, firstLine({ via: "worker", kind: "transport", status: null, ms: 1500 }), { startedMs: 0, nowMs: () => 5_000 });
  assert.deepEqual([noW3.progress.firstPublish.observedAfterW3Ms, noW3.progress.firstPublish.via, noW3.progress.firstPublish.status], [null, "worker", null]);
  const early = {};
  observeProgressLine(early, firstLine(), { startedMs: 0, nowMs: () => 900_000, w3EndMs: 1_000_000 });
  assert.equal(early.progress.firstPublish.observedAfterW3Ms, null, "a publish that appears to precede W3 is not reported as a duration");
  for (const bad of [{ kind: "grpc" }, { via: "browser" }, { status: 99 }, { status: "202" }, { ms: -1 }, { ms: 700_000 }]) {
    const state = {};
    observeProgressLine(state, firstLine(bad), { startedMs: 0, nowMs: () => 1 });
    assert.equal(state.progress.firstPublish, null, JSON.stringify(bad));
    assert.equal(state.progress.rejected, 1);
  }
  const free = {};
  observeProgressLine(free, firstLine({ url: "https://project.supabase.co/x", room: "9f1c" }), { startedMs: 0, nowMs: () => 1 });
  assert.doesNotMatch(JSON.stringify(free.progress.firstPublish), /supabase|9f1c|url|room/);
});

test("W3 end is taken from the warm-up evidence and refused when it is incomplete", () => {
  const warmup = { requests: [{ startedAt: "2026-11-24T04:43:49.412Z", ms: 2947 }, { startedAt: "2026-11-24T04:43:52.360Z", ms: 376 },
    { startedAt: "2026-11-24T04:43:52.736Z", ms: 340 }] };
  assert.equal(warmupEndMs(warmup), Date.parse("2026-11-24T04:43:52.736Z") + 340);
  assert.equal(warmupEndMs(undefined), null);
  assert.equal(warmupEndMs({ requests: [{}, {}] }), null);
  assert.equal(warmupEndMs({ requests: [{}, {}, { startedAt: "nope", ms: 3 }] }), null);
});

test("the adapter reports the first publish attempt once, from enumerations and bounded integers only", async () => {
  const emitted = [];
  const canary = "https://project.supabase.co/room/9f1c-secret";
  let onLine;
  let finish;
  const outcome = runSupervisor({
    args: ["--reporter=json"], createClient: () => ({}), emit: line => emitted.push(line), wait: async () => {},
    diagnostics: { observe: () => {}, summary: () => ({}) },
    async main(options) {
      const worker = options.startChild(["--conditions=react-server", "--import", "tsx", "scripts/realtime-worker.ts"], {}, () => {});
      const workload = options.startChild(["cli.js", "test"], {}, () => {});
      await Promise.all([worker.done, workload.done]);
      return { exitCode: 0 };
    },
    start(childArgs, _env, read) {
      if (childArgs.includes("scripts/realtime-worker.ts")) {
        onLine = read;
        return { done: Promise.resolve(0), stop: async () => {} };
      }
      return { done: new Promise(resolve => { finish = resolve; }), stop: async () => {} };
    },
  });
  onLine("[CINEMATCH_REALTIME_ATTEMPT] {not json");
  onLine('[CINEMATCH_REALTIME_ATTEMPT] {"r":"nothex","v":1,"ms":5,"kind":"http","status":202}');
  onLine(`[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":3,"ms":412,"kind":"http","status":202,"url":"${canary}"}`);
  onLine('[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef02","v":4,"ms":90,"kind":"http","status":202}');
  finish(0);
  await outcome;
  const first = emitted.filter(line => line.startsWith("CINE026_PUBLISH_FIRST "));
  assert.deepEqual(first, ['CINE026_PUBLISH_FIRST {"kind":"http","via":"worker","status":202,"ms":412}']);
  assert.ok(!emitted.some(line => line.includes("supabase") || line.includes("9f1c")));
});

test("the shared observer still reads the existing terminal lines next to progress lines", () => {
  const state = {};
  const context = { startedMs: 0, nowMs: () => 10 };
  assert.equal(observeLine(state, sampleLine({ votes: 3 }), context), true);
  assert.equal(observeLine(state, "CINE026_HOSTED_METRICS " + JSON.stringify({ leaseRelease: "released", cleanupVerified: true }), context), true);
  assert.equal(state.progress.samples.length, 1);
  assert.equal(state.metrics.leaseRelease, "released");
  assert.equal(observeLine(state, "unrelated output", context), undefined);
});

// --- offline reproduction of the epoch 10 WebKit shape ------------------------------------------------------

// Virtual-time model of the three serial WebKit cases of Gate A (same-page interruption, transport cut, twenty-card
// exhaustion) with the rates the provider logs imply: about 21 s per exhaustion round. It is a model of the
// supervisor and budget interaction, not of staging: it shows the old flat budget cutting a progressing case off
// and the derived budget letting the same timeline finish, with the declared case limits untouched.
async function webkitTimeline(executionMs) {
  const run = supervised({ executionMs, cleanupMs: 240_000, forceGraceMs: 6_000 });
  const at = [];
  let votes = 0;
  async function step(ms, ...lines) {
    run.clock.advance(ms);
    for (const line of lines) run.line(line);
    await run.settle();
    at.push(votes);
  }
  const ended = (i, ms, extra = {}) => progressLine({ ev: "case_end", i, status: "passed", ms, timeout: 180_000,
    steps: steps(extra), post: 0, setupMs: 100, teardownMs: 50 });
  await step(0, "CINE026_SUPERVISOR_PHASE workload", progressLine({ ev: "begin", total: 3 }));
  await step(25_000, progressLine({ ev: "case_start", i: 8, timeout: 180_000 }));
  votes = 2;
  await step(50_000, sampleLine({ votes, events: 6 }), ended(8, 50_000));
  await step(5_000, progressLine({ ev: "case_start", i: 9, timeout: 180_000 }));
  votes = 4;
  await step(60_000, sampleLine({ votes, events: 12 }), ended(9, 60_000));
  await step(5_000, progressLine({ ev: "case_start", i: 12, timeout: 600_000 }));
  for (let round = 1; round <= 20; round++) {
    votes = 4 + 2 * round;
    await step(21_000, sampleLine({ votes, events: 12 + 2 * round }), progressLine({ ev: "case_tick", i: 12, steps: steps({ expect: 7 * round }), post: 2 * round }));
  }
  await step(1_000, ended(12, 430_000, { expect: 140 }), progressLine({ ev: "run_end", status: "passed", ms: 640_000 }));
  await step(2_000, "CINE026_SUPERVISOR_PHASE teardown");
  return run;
}

test("reproduction: the old flat budget cuts a progressing exhaustion case off, the derived budget lets it finish", async () => {
  const old = await webkitTimeline(420_000);
  const cut = old.checkpoints.find(state => state.executionTimedOut);
  assert.ok(cut, "420 s ends the run mid-exhaustion");
  assert.equal(cut.progressAtStop, "CASE_ACTIVE_PROGRESSING");
  const open = cut.progress.cases.find(item => item.endedAfterMs === null);
  assert.equal(open.index, 12);
  assert.ok(open.votesLast < 44, "exhaustion unfinished: " + open.votesLast + " of 44 votes");
  assert.equal(cut.progress.runEnd, null);

  const derived = await webkitTimeline(1_245_000);
  assert.equal(derived.checkpoints.some(state => state.executionTimedOut), false);
  const last = derived.checkpoints.at(-1);
  assert.equal(last.progress.runEnd.status, "passed");
  assert.deepEqual(last.progress.cases.map(item => item.status), ["passed", "passed", "passed"]);
  assert.equal(last.progress.cases.at(-1).votesLast, 44);
  assert.equal(last.teardownStalled, undefined);
});
