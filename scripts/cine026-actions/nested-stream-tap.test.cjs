/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { createRelay } = require("./event-relay.cjs");
const { kindOf, sanitizeLine } = require("./nested-stream-lines.cjs");
const { observeProgressLine } = require("./workload-progress.cjs");
const { EXPECTED_NESTED, nestedProblems } = require("./qualification.cjs");

const TAP = path.join(__dirname, "nested-stream-tap.cjs");
const CANARY = "hunter2-SECRET-db.project.supabase.co/room/9f1c";

test("nested processes are told apart as app, worker, fault or other", () => {
  const node = process.execPath;
  assert.equal(kindOf(node, ["/work/node_modules/next/dist/bin/next", "dev", "--turbopack", "-p", "3101"]), "app");
  assert.equal(kindOf(node, ["--conditions=react-server", "--import", "tsx", "scripts/realtime-worker.ts"]), "worker");
  assert.equal(kindOf(node, ["--conditions=react-server", "--import", "tsx", "/tmp/inst1/cine018-commit-fault.ts"]), "fault");
  assert.equal(kindOf("psql", ["-c", "select 1"]), "other");
});

test("only canonical lines rebuilt from allowlisted fields can leave a nested process (secret canaries never do)", () => {
  const cases = [
    [`[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":7,"ms":412,"kind":"http","status":202,"url":"https://${CANARY}","token":"${CANARY}","startedAt":"${CANARY}"}`,
      `[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":7,"ms":412,"kind":"http","status":202}`],
    [`[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":7,"ms":1500,"kind":"transport","category":"client_deadline","phase":"unobserved","code":"ABORT_ERR","startedAt":"2026-11-24T05:00:00.000Z","note":"${CANARY}"}`,
      `[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":7,"ms":1500,"kind":"transport","category":"client_deadline","code":"ABORT_ERR","phase":"unobserved","startedAt":"2026-11-24T05:00:00.000Z"}`],
    [`[CINEMATCH_REALTIME_OUTBOX] {"r":"abcdef01","v":7,"attempt":1,"outcome":"marked","room":"${CANARY}"}`,
      `[CINEMATCH_REALTIME_OUTBOX] {"r":"abcdef01","v":7,"attempt":1,"outcome":"marked"}`],
    [`[CINEMATCH_REALTIME_ATTEMPT_FAILURE] transport ${CANARY}`, "[CINEMATCH_REALTIME_ATTEMPT_FAILURE] transport"],
    [`[CINEMATCH_DB_CAPACITY] {"host":"${CANARY}"}`, "[CINEMATCH_DB_CAPACITY]"],
    [`[CINEMATCH_DB_CONNECTION_ERROR] {"code":"ECONNRESET","phase":"idle","host":"${CANARY}","message":"${CANARY}"}`,
      `[CINEMATCH_DB_CONNECTION_ERROR] {"code":"ECONNRESET","phase":"idle"}`],
    [`[CINEMATCH_DB_CONNECTION_ERROR] ${CANARY}`, "[CINEMATCH_DB_CONNECTION_ERROR] {}"],
    [`dispatch failed for ${CANARY} {"category":"outbox_lock_timeout"}`, 'Room notification dispatch failed; retry remains pending. {"category":"outbox_lock_timeout"}'],
    [`uncaughtException: Error: read ECONNRESET at ${CANARY}`, "uncaughtException: ECONNRESET"],
  ];
  for (const [raw, expected] of cases) {
    const clean = sanitizeLine(raw);
    assert.equal(clean, expected);
    assert.doesNotMatch(clean, /hunter2|supabase\.co|9f1c|SECRET/);
    assert.equal(sanitizeLine(clean), clean, "the canonical form is a fixed point, which the relay relies on");
  }
  for (const dropped of ["GET /api/rooms/abc 200 in 12ms", `Authorization: Bearer ${CANARY}`, "", "[CINEMATCH_REALTIME_ATTEMPT] {not json",
    `[CINEMATCH_REALTIME_ATTEMPT] {"r":"nothex","v":1,"ms":1}`, `[CINEMATCH_REALTIME_ATTEMPT] [1,2]`]) {
    assert.equal(sanitizeLine(dropped), null, dropped);
  }
});

// A real parent process, preloaded with the tap, starts nested processes the way the pinned Gate B does.
const PARENT = `
const { spawn } = require("node:child_process");
const node = process.execPath;
const run = (args, options = { stdio: ["ignore", "pipe", "pipe"] }) => new Promise(resolve => {
  const child = spawn(node, args, { env: process.env, ...options });
  child.stdout?.on("data", () => {});
  child.once("close", resolve);
});
(async () => {
  const body = 'console.log("[CINEMATCH_REALTIME_ATTEMPT] {\\\\"r\\\\":\\\\"abcdef01\\\\",\\\\"v\\\\":1,\\\\"ms\\\\":5,\\\\"kind\\\\":\\\\"http\\\\",\\\\"status\\\\":202,\\\\"token\\\\":\\\\"hunter2\\\\"}"); console.log("room 9f1c joined host-secret"); console.error("[CINEMATCH_DB_CAPACITY] {}"); console.log("[CINEMATCH_DB_CAPACITY] opts=" + (process.env.NODE_OPTIONS ?? ""));';
  await run(["-e", body, "scripts/realtime-worker.ts"]);
  await run(["-e", "process.exit(3)", "scripts/realtime-worker.ts"]);
  await run(["-e", "console.log('Authorization: Bearer abc')", "dist/bin/next"]);
  await run(["-e", "setTimeout(() => {}, 1000)", "cine018-commit-fault.ts"], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  await run(["-e", "1", "unrelated-tool"]);
})();
`;

test("a preloaded Gate B process reports every nested generation, lifecycle and sanitized diagnostics", () => {
  const run = spawnSync(process.execPath, ["--require", TAP, "-e", PARENT], {
    encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256 --require " + TAP },
  });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.split(/\r?\n/);
  assert.ok(lines.includes('CINE026_NESTED {"ev":"tap_ready"}'));
  assert.ok(lines.includes('CINE026_STREAM worker 1 [CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":1,"ms":5,"kind":"http","status":202}'), run.stdout);
  assert.ok(lines.includes("CINE026_STREAM worker 1 [CINEMATCH_DB_CAPACITY]"));
  assert.ok(!lines.some(line => /hunter2|host-secret|Authorization|9f1c|opts=/.test(line)), "raw and untagged output is never forwarded:\n" + run.stdout);
  const state = {};
  const relay = createRelay({ gateB: true });
  for (const line of lines) {
    const relayed = relay(line, true);
    if (relayed) observeProgressLine(state, relayed, { startedMs: 0, nowMs: () => 1 });
  }
  const { nested } = state.progress;
  assert.deepEqual(nested.generations, { app: 1, worker: 2, fault: 1 });
  const find = (kind, n) => nested.streams.find(item => item.kind === kind && item.n === n);
  assert.deepEqual([find("worker", 1).piped, find("worker", 1).forwarded, find("worker", 1).dropped, find("worker", 1).exit], [true, 3, 1, "exited"]);
  assert.equal(find("worker", 1).received, 3);
  assert.equal(find("worker", 2).exit, "failed");
  assert.deepEqual([find("app", 1).piped, find("app", 1).forwarded, find("app", 1).dropped, find("app", 1).exit], [true, 0, 1, "exited"]);
  // fault committers run with ignored stdio: reported as not attached, still with a terminal record
  assert.deepEqual([find("fault", 1).piped, find("fault", 1).exit], [false, "exited"]);
  assert.deepEqual(nested.invalid, { duplicate: 0, orphan: 0, outOfOrder: 0, overflow: 0, rejected: 0 });
  // an unrelated tool is neither attached to nor reported, and the candidate's own readers still got every line
  assert.equal(nested.streams.length, 4);
  assert.ok(nestedProblems({ progress: state.progress }).includes("worker_crashed"));
});

test("an error inside the tap cannot change a nested process or its result", () => {
  const run = spawnSync(process.execPath, ["--require", TAP, "-e", `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "process.exit(7)", "scripts/realtime-worker.ts"], { stdio: "ignore" });
    child.once("close", code => { console.log("CHILD_CODE " + code); });
  `], { encoding: "utf8" });
  assert.match(run.stdout, /CHILD_CODE 7/);
  assert.equal(run.status, 0);
});

function pinnedTwoInstanceSource() {
  const local = path.resolve("candidate/tests/local-supabase/two-instance-qualification.cjs");
  if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
  try {
    const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/cine026-hosted-qualification.yml"), "utf8");
    const pin = /CANDIDATE:\s*([0-9a-f]{40})/.exec(workflow)?.[1];
    return execFileSync("git", ["show", pin + ":tests/local-supabase/two-instance-qualification.cjs"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 5_000_000 });
  } catch {
    return null;
  }
}

// Drift guard: the generations Gate B must report are the call sites on the pinned success path. A repin that
// adds, removes or reorders a nested process fails here, so the table is revisited on purpose.
test("the expected nested generations equal the spawn call sites of the pinned Gate B source", t => {
  const source = pinnedTwoInstanceSource();
  if (!source) {
    assert.ok(!process.env.CI, "the candidate source must be available in CI");
    t.skip("candidate source unavailable outside CI");
    return;
  }
  const count = pattern => (source.match(pattern) ?? []).length;
  assert.equal(count(/=\s*spawnNextInstance\(/g), EXPECTED_NESTED.app);
  assert.equal(count(/=\s*spawnWorker\(/g), EXPECTED_NESTED.worker);
  assert.equal(count(/(?<!function\s)crashAfterAuthorityCommit\(\{/g), EXPECTED_NESTED.fault);
  // no other process is started by spawn() in that file (execFileSync children are not long-lived and are not tapped)
  assert.equal(count(/(?<![\w.])spawn\(/g), 3);
});

// Feeds the tap's output of a real parent process through the relay into a fresh ledger.
function ledgerOf(stdout) {
  const state = {};
  const relay = createRelay({ gateB: true });
  for (const line of stdout.split(/\r?\n/)) {
    const relayed = relay(line, true);
    if (relayed) observeProgressLine(state, relayed, { startedMs: 0, nowMs: () => 1 });
  }
  return state.progress.nested;
}

test("a real stop through child.kill is recorded before the exit; a kill that bypasses it is not", () => {
  const run = spawnSync(process.execPath, ["--require", TAP, "-e", `
    const { spawn } = require("node:child_process");
    const start = () => spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)", "scripts/realtime-worker.ts"],
      { stdio: ["ignore", "pipe", "pipe"] });
    const ready = child => new Promise(resolve => child.stdout.once("data", resolve));
    const closed = child => new Promise(resolve => child.once("close", resolve));
    (async () => {
      const planned = start();
      await ready(planned);
      planned.kill("SIGKILL"); // how the pinned stopChild() stops every nested process
      await closed(planned);
      const outside = start();
      await ready(outside);
      process.kill(outside.pid, "SIGKILL"); // not through the child handle: nobody recorded asking for it
      await closed(outside);
    })();
  `], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const nested = ledgerOf(run.stdout);
  const [planned, outside] = nested.streams;
  assert.deepEqual([planned.killRequested, planned.exit, Boolean(planned.eof.out && planned.eof.err)], [true, "killed", true]);
  // POSIX reports the signal (an unrequested kill); Windows has no signals and reports exit code 1 (a crash). Gate B
  // rejects both, and only a requested kill passes.
  assert.deepEqual([outside.killRequested, outside.exit, Boolean(outside.eof.out && outside.eof.err)],
    [false, process.platform === "win32" ? "failed" : "killed", true]);
  assert.deepEqual(nested.invalid, { duplicate: 0, orphan: 0, outOfOrder: 0, overflow: 0, rejected: 0 });
  const kill = run.stdout.split(/\r?\n/).findIndex(line => line.includes('"ev":"kill","kind":"worker","n":1'));
  const exit = run.stdout.split(/\r?\n/).findIndex(line => line.includes('"ev":"exit","kind":"worker","n":1'));
  assert.ok(kill >= 0 && kill < exit, "the request precedes the exit");
});

function nextAppDir() {
  const dirs = [process.env.CINE026_NEXT_APP_DIR, path.resolve("candidate")].filter(Boolean);
  return dirs.find(dir => fs.existsSync(path.join(dir, "node_modules/next/dist/bin/next")));
}

// The pinned Gate B runs the app as `next dev`, which forks the real server with inherited stdio, and stops it with
// child.kill("SIGKILL") on the parent only. Requiring the end of both output streams is sound only if that server
// does not outlive its parent while holding the pipes. This runs the real `next dev` of the candidate's locked
// dependencies through the candidate's own start and stop helpers on the runner's OS and records what happens, in
// separate observations:
//   * whether each stream ended and how long it took (the real Gate B leaves only a few seconds before it exits),
//   * whether the server port closed,
//   * on POSIX, which processes of that process group are still alive.
// The observations are printed as a diagnostic. They only become assertions once Gate B is admitted: admission is
// coupled to this evidence, so it cannot be granted while the observed window does not end the streams.
test("real next dev stopped like Gate B stops it: observations are recorded, and admission requires them to be clean", { timeout: 180_000 }, async t => {
  const dir = nextAppDir();
  if (!dir) {
    assert.ok(!process.env.CI, "the candidate's locked Next.js must be available in CI");
    t.skip("no Next.js app directory outside CI");
    return;
  }
  const net = require("node:net");
  const { spawn, spawnSync } = require("node:child_process");
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port: free } = server.address();
      server.close(() => resolve(free));
    });
  });
  const posix = process.platform !== "win32";
  // Its own process group on POSIX, so that anything the test leaves behind can be removed by group.
  // The candidate's own helpers start and stop the app, exactly as the pinned Gate B does (`spawnNextInstance` adds the
  // candidate's parent guard, `stopChild` is the stop Gate B uses). Measuring a hand-written `next dev` spawn would not
  // observe the candidate's repair, so a candidate without these helpers cannot be observed at all.
  const helper = path.join(dir, "tests/local-supabase/two-instance-qualification.cjs");
  if (!fs.existsSync(helper)) {
    assert.ok(!process.env.CI, "the candidate must provide its Gate B process helpers (spawnNextInstance, stopChild)");
    t.skip("the Next.js app directory has no Gate B process helpers outside CI");
    return;
  }
  const parent = spawn(process.execPath, ["--require", TAP, "-e", `
    const { spawnNextInstance, stopChild } = require(${JSON.stringify(helper)});
    const proc = spawnNextInstance({ cwd: ${JSON.stringify(dir)}, port: ${port},
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    const child = proc.child;
    let killedAt = null;
    for (const name of ["stdout", "stderr"]) {
      child[name].on("end", () => console.log("PARENT_END " + name + " " + (killedAt === null ? -1 : Date.now() - killedAt)));
    }
    const deadline = Date.now() + 120000;
    const poll = setInterval(async () => {
      if (/ready|Ready/.test(proc.getLogs())) {
        clearInterval(poll);
        console.log("PARENT_READY");
        killedAt = Date.now();
        console.log("PARENT_STOP " + await stopChild(proc));
      } else if (Date.now() > deadline || child.exitCode !== null) {
        clearInterval(poll);
        console.log("PARENT_NOT_READY");
        await stopChild(proc);
      }
    }, 200);
  `], { env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"], detached: posix });
  let out = "";
  parent.stdout.on("data", data => { out += data; });
  let err = "";
  parent.stderr.on("data", data => { err = (err + data).slice(-600); });
  const until = async (predicate, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (predicate()) return true;
    return predicate();
  };
  const portClosed = () => new Promise(resolve => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(true));
  });
  try {
    assert.ok(await until(() => /PARENT_READY|PARENT_NOT_READY/.test(out), 150_000), "next dev never reported; probe stderr tail: " + err.replace(/\s+/g, " ").trim());
    assert.match(out, /PARENT_READY/, "next dev did not become ready");
    const ended = name => {
      const match = new RegExp("PARENT_END " + name + " (-?\\d+)").exec(out);
      return match ? Number(match[1]) : null;
    };
    const stopReport = /^PARENT_STOP ([^\r\n]+)\r?\n/m;
    await until(() => ended("stdout") !== null && ended("stderr") !== null && stopReport.test(out), 20_000);
    const nested = ledgerOf(out);
    const app = nested.streams.find(stream => stream.kind === "app" && stream.n === 1);
    // The tap itself behaves on every OS: the request is recorded and the exit is a kill.
    assert.equal(app?.killRequested, true, "the kill request is recorded");
    assert.equal(app?.exit, "killed", "the exit is a signal exit");
    const observation = {
      platform: process.platform, nextStdoutEndedAfterMs: ended("stdout"), nextStderrEndedAfterMs: ended("stderr"),
      tapEofOut: Boolean(app.eof.out), tapEofErr: Boolean(app.eof.err), portClosedAfterWait: await portClosed(),
    };
    if (posix) {
      // Names and ids of what is still alive in the process group; nothing from their environment or arguments.
      const ps = spawnSync("ps", ["-o", "pid=,ppid=,pgid=,stat=,comm=", "-g", String(parent.pid)], { encoding: "utf8" });
      observation.processGroupAfter = (ps.stdout ?? "").split("\n").map(line => line.trim()).filter(Boolean).slice(0, 10);
    }
    t.diagnostic("OBSERVATION " + JSON.stringify(observation));
    process.stdout.write("# CINE026_NEXT_DEV_OBSERVATION " + JSON.stringify(observation) + "\n");
    assert.equal(stopReport.exec(out)?.[1], "true", "candidate stopChild must report successful shutdown");
    if (require("./qualification.cjs").GATE_B_ADMITTED) {
      assert.ok(observation.nextStdoutEndedAfterMs !== null && observation.nextStderrEndedAfterMs !== null, "the forked server held the output pipes");
      assert.ok(observation.tapEofOut && observation.tapEofErr, "the tap saw the end of both streams");
      assert.equal(observation.portClosedAfterWait, true, "the server port is closed");
      assert.ok(Math.max(observation.nextStdoutEndedAfterMs, observation.nextStderrEndedAfterMs) <= 3_000, "the streams end inside the few seconds Gate B leaves");
    }
  } finally {
    parent.kill("SIGKILL");
    // Best effort: never leave a server behind on the runner or the developer machine.
    if (posix) { try { process.kill(-parent.pid, "SIGKILL"); } catch { /* group already gone */ } }
  }
});
