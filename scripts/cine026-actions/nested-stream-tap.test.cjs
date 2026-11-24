/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const { kindOf, FORWARD } = require("./nested-stream-tap.cjs");
const { observeProgressLine } = require("./workload-progress.cjs");
const { nestedEvidence } = require("./qualification.cjs");

const TAP = path.join(__dirname, "nested-stream-tap.cjs");

test("nested processes are told apart as app, worker, fault or other", () => {
  const node = process.execPath;
  assert.equal(kindOf(node, ["/work/node_modules/next/dist/bin/next", "dev", "--turbopack", "-p", "3101"]), "app");
  assert.equal(kindOf(node, ["--conditions=react-server", "--import", "tsx", "scripts/realtime-worker.ts"]), "worker");
  assert.equal(kindOf(node, ["--import", "tsx", "tests/local-supabase/cine021-publisher-fault-qualification.ts"]), "fault");
  assert.equal(kindOf("psql", ["-c", "select 1"]), "other");
});

test("only the candidate's transport and database diagnostic lines are forwarded", () => {
  for (const line of [
    '[CINEMATCH_REALTIME_ATTEMPT] {"kind":"transport","ms":12}',
    "[CINEMATCH_REALTIME_ATTEMPT_FAILURE] status 500",
    '[CINEMATCH_DB_CONNECTION_ERROR] {"code":"ECONNRESET","phase":"idle"}',
    '[CINEMATCH_DB_CAPACITY] {"waiting":3}',
    'Room notification dispatch failed; retry remains pending. {"category":"outbox_lock_timeout"}',
    "uncaughtException: Error: read ECONNRESET",
  ]) assert.match(line, FORWARD, line);
  for (const line of ["GET /api/rooms/abc 200 in 12ms", "room 9f1c joined as host-secret", "Authorization: Bearer abc", ""]) {
    assert.doesNotMatch(line, FORWARD, line);
  }
});

// A real parent process, preloaded with the tap, starts nested processes the way the candidate's Gate B does.
const PARENT = `
const { spawn } = require("node:child_process");
const node = process.execPath;
function run(args, code) {
  return new Promise(resolve => {
    const child = spawn(node, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let own = 0;
    child.stdout.on("data", () => { own++; });
    child.once("close", () => resolve(own));
  });
}
(async () => {
  const script = (body, marker) => ["-e", body, marker];
  const worker = 'console.log("[CINEMATCH_REALTIME_ATTEMPT] {\\\\"kind\\\\":\\\\"transport\\\\"}"); console.log("room 9f1c joined host-secret"); console.error("[CINEMATCH_DB_CAPACITY] {}"); console.log("[CINEMATCH_DB_CAPACITY] opts=" + (process.env.NODE_OPTIONS ?? ""));';
  const own1 = await run(script(worker, "scripts/realtime-worker.ts"));
  await run(script("process.exit(3)", "scripts/realtime-worker.ts"));
  await run(script("console.log('Authorization: Bearer abc')", "dist/bin/next"));
  console.log("PARENT_LISTENER_SAW " + own1);
})();
`;

test("a preloaded Gate B process reports every nested generation and forwards only diagnostic lines", () => {
  const run = spawnSync(process.execPath, ["--require", TAP, "-e", PARENT], {
    encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=256 --require " + TAP },
  });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.split(/\r?\n/);
  assert.ok(lines.includes("CINE026_NESTED " + JSON.stringify({ ev: "tap_ready" })));
  // the candidate's own listener still receives every line: the tap only adds a second reader
  assert.ok(lines.some(line => /^PARENT_LISTENER_SAW [1-9]/.test(line)), run.stdout);
  // diagnostic lines (stdout and stderr) are forwarded verbatim, untagged ones are not
  assert.ok(lines.includes('[CINEMATCH_REALTIME_ATTEMPT] {"kind":"transport"}'), run.stdout);
  assert.ok(lines.includes("[CINEMATCH_DB_CAPACITY] {}"));
  assert.ok(!lines.some(line => /host-secret|Authorization|9f1c/.test(line)), "untagged output must never be forwarded");
  // the preload does not propagate into nested processes
  assert.ok(lines.includes("[CINEMATCH_DB_CAPACITY] opts=--max-old-space-size=256"), run.stdout);
  assert.ok(!lines.some(line => line.includes("opts=") && line.includes("nested-stream-tap")), run.stdout);
  // the evidence reader rebuilds generations, line counts and exits from these lines
  const state = {};
  for (const line of lines) observeProgressLine(state, line, { startedMs: 0, nowMs: () => 1 });
  const { nested } = state.progress;
  assert.deepEqual(nested.generations, { app: 1, worker: 2, fault: 0, other: 0 });
  const worker1 = nested.streams.find(item => item.kind === "worker" && item.n === 1);
  const worker2 = nested.streams.find(item => item.kind === "worker" && item.n === 2);
  assert.deepEqual([worker1.forwarded, worker1.dropped, worker1.exit], [3, 1, "exited"]);
  assert.equal(worker2.exit, "failed");
  assert.equal(nestedEvidence(state), true);
  assert.equal(state.progress.rejected, 0);
});

test("an error inside the tap cannot change a nested process or its result", () => {
  const run = spawnSync(process.execPath, ["--require", TAP, "-e", `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "process.exit(7)"], { stdio: "ignore" });
    child.once("close", code => { console.log("CHILD_CODE " + code); });
  `], { encoding: "utf8" });
  assert.match(run.stdout, /CHILD_CODE 7/);
  assert.equal(run.status, 0);
});
