/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { kindOf, sanitizeLine, CANONICAL } = require("./nested-stream-lines.cjs");
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
    assert.match(clean, CANONICAL, clean);
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
  assert.ok(lines.includes('[CINEMATCH_REALTIME_ATTEMPT] {"r":"abcdef01","v":1,"ms":5,"kind":"http","status":202}'), run.stdout);
  assert.ok(lines.includes("[CINEMATCH_DB_CAPACITY]"));
  assert.ok(!lines.some(line => /hunter2|host-secret|Authorization|9f1c|opts=/.test(line)), "raw and untagged output is never forwarded:\n" + run.stdout);
  const state = {};
  for (const line of lines) observeProgressLine(state, line, { startedMs: 0, nowMs: () => 1 });
  const { nested } = state.progress;
  assert.deepEqual(nested.generations, { app: 1, worker: 2, fault: 1 });
  const find = (kind, n) => nested.streams.find(item => item.kind === kind && item.n === n);
  assert.deepEqual([find("worker", 1).piped, find("worker", 1).forwarded, find("worker", 1).dropped, find("worker", 1).exit], [true, 3, 1, "exited"]);
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
