/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Reporter = require("./progress-reporter.cjs");
const { observeProgressLine } = require("./workload-progress.cjs");
const { browserArgs } = require("./qualification.cjs");

const REPORTER = path.join(__dirname, "progress-reporter.cjs");

function fake(titles = ["alpha", "beta"]) {
  const lines = [];
  const reporter = new Reporter({ write: line => lines.push(line), titles, setInterval: () => ({ unref() {} }), clearInterval() {} });
  return { reporter, lines, payloads: () => lines.map(line => JSON.parse(line.slice("CINE026_PROGRESS ".length))) };
}

test("a case is reported by index, counters and durations only, never by title or step title", () => {
  const { reporter, lines, payloads } = fake(["alpha secret title"]);
  const result = { status: "passed", duration: 321 };
  const spec = { title: "alpha secret title", timeout: 180_000 };
  reporter.onBegin({}, { allTests: () => [spec] });
  reporter.onTestBegin(spec, result);
  const before = { category: "hook", title: "Before Hooks" };
  reporter.onStepBegin(spec, result, before);
  reporter.onStepBegin(spec, result, { category: "fixture", title: 'Fixture "request"', parent: before });
  reporter.onStepBegin(spec, result, { category: "pw:api", title: "Create request context", parent: { category: "fixture", parent: before } });
  reporter.onStepEnd(spec, result, { ...before, duration: 46 });
  reporter.onStepBegin(spec, result, { category: "pw:api", title: "POST" });
  reporter.onStepBegin(spec, result, { category: "pw:api", title: "GET" });
  reporter.onStepBegin(spec, result, { category: "expect", title: 'Expect "toBe"' });
  reporter.onStepBegin(spec, result, { category: "test.step", title: "inner https://example.test/room/abc" });
  reporter.onStepEnd(spec, result, { category: "hook", title: "After Hooks", duration: 9 });
  reporter.onTestEnd(spec, result);
  reporter.onEnd({ status: "passed" });
  const [begin, start, end, run] = payloads();
  assert.equal(begin.ev, "begin");
  assert.deepEqual(start, { ev: "case_start", i: 0, timeout: 180_000 });
  assert.deepEqual(end, { ev: "case_end", i: 0, status: "passed", ms: 321, timeout: 180_000, post: 1,
    steps: { api: 2, expect: 1, step: 1, hook: 1, fixture: 1, other: 0 }, setupMs: 46, teardownMs: 9 });
  assert.equal(run.ev, "run_end");
  for (const line of lines) {
    assert.doesNotMatch(line, /secret|example\.test|room\/abc|request context/i);
  }
});

test("a ticking reporter emits only changed counters and an unknown title maps to index -1", () => {
  const { reporter, payloads } = fake(["known"]);
  const result = { status: "passed", duration: 1 };
  const spec = { title: "something else", timeout: 5000 };
  reporter.onTestBegin(spec, result);
  reporter.tick();
  assert.equal(payloads().length, 1); // nothing changed yet
  reporter.onStepBegin(spec, result, { category: "expect", title: 'Expect "toBe"' });
  reporter.tick();
  reporter.tick();
  const events = payloads();
  assert.equal(events.length, 2);
  assert.equal(events[1].ev, "case_tick");
  assert.equal(events[1].i, -1);
  assert.equal(events[1].steps.expect, 1);
});

test("a failing writer cannot fail the run and an unrecognised result status is reported as failed", () => {
  const reporter = new Reporter({ write() { throw new Error("pipe closed"); }, titles: ["a"], setInterval: () => ({ unref() {} }), clearInterval() {} });
  const result = { status: "weird", duration: 5 };
  const spec = { title: "a", timeout: 1 };
  assert.doesNotThrow(() => { reporter.onTestBegin(spec, result); reporter.onTestEnd(spec, result); reporter.onEnd({ status: "weird" }); });
  const { reporter: ok, payloads } = fake(["a"]);
  ok.onTestBegin(spec, result);
  ok.onTestEnd(spec, result);
  assert.equal(payloads().at(-1).status, "failed");
});

test("webServer and case output is forwarded to stderr line by line, split lines are rejoined and nothing is lost", () => {
  const out = [];
  const reporter = new Reporter({ write: () => {}, writeOutput: text => out.push(text), titles: [], setInterval: () => ({ unref() {} }), clearInterval() {} });
  const test = { title: "a" };
  // Playwright prefixes each webServer line, also the continuation of a line a pipe split in two (dim colour when on).
  reporter.onStdErr("[WebServer] one\n[WebServer] [CINEMATCH_REALTIME_ATT");
  reporter.onStdOut("case says hi\n", test);
  reporter.onStdErr("\u001b[2m[WebServer] \u001b[22mEMPT] {\"r\":\"0a1b2c3d\"}\n[WebServer] tail without newline");
  reporter.onStdErr(Buffer.from("[WebServer] buffer chunk\n"), undefined);
  reporter.onStdErr("partial case line", test);
  assert.deepEqual(out, ["[WebServer] one\n", "case says hi\n", "[WebServer] [CINEMATCH_REALTIME_ATTEMPT] {\"r\":\"0a1b2c3d\"}\n",
    "[WebServer] tail without newlinebuffer chunk\n"]);
  reporter.onExit();
  assert.deepEqual(out.slice(4), ["partial case line\n"]);
  reporter.onExit();
  assert.equal(out.length, 5, "a flushed tail is not written twice");
  // an endless line is cut, never held without bound
  reporter.onStdErr("[WebServer] " + "x".repeat(70_000));
  assert.equal(out.length, 6);
  // a failing writer never fails the run
  const broken = new Reporter({ write: () => {}, writeOutput() { throw new Error("pipe closed"); }, titles: [] });
  assert.doesNotThrow(() => { broken.onStdErr("x\n"); broken.onStdErr("y"); broken.onExit(); });
});

function playwrightCli() {
  const candidates = [process.env.CINE026_PLAYWRIGHT_CLI,
    path.resolve("candidate/node_modules/playwright/cli.js")].filter(Boolean);
  return candidates.find(file => fs.existsSync(file));
}

// Real Playwright run against a synthetic spec: the reporter contract (step categories, titles, hook steps,
// case and run end) is proven with the actual runner rather than with imitations of its objects.
test("real Playwright run: passing, slow-but-passing and timed-out cases are reported without titles", { skip: !playwrightCli() && !process.env.CI && "no Playwright available" }, () => {
  const cli = playwrightCli();
  assert.ok(cli, "Playwright must be available in CI (the candidate's locked dependencies)");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cine026-reporter-"));
  try {
    // The spec resolves @playwright/test through the node_modules directory that holds the runner.
    fs.symlinkSync(path.resolve(path.dirname(cli), ".."), path.join(work, "node_modules"), "junction");
    fs.writeFileSync(path.join(work, "playwright.config.js"),
      'module.exports = { testDir: ".", testMatch: "fixture.spec.js", workers: 1, retries: 0, timeout: 8000, reporter: "dot" };\n');
    fs.writeFileSync(path.join(work, "fixture.spec.js"), `
const http = require("node:http");
const { test, expect } = require("@playwright/test");
let server, origin;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { server = http.createServer((q, r) => r.end("{}")); await new Promise(r => server.listen(0, "127.0.0.1", r)); origin = "http://127.0.0.1:" + server.address().port; });
test.afterAll(() => server.close());
test("case alpha", async ({ request }) => {
  expect((await request.post(origin + "/api/secret-room?token=abc", { data: { a: 1 } })).status()).toBe(200);
  await test.step("inner private step", async () => { await request.get(origin + "/room/abc"); });
});
test("case beta slow", async () => { await new Promise(r => setTimeout(r, 1500)); expect(1).toBe(1); });
test("case gamma timeout", async () => { test.setTimeout(700); await new Promise(r => setTimeout(r, 4000)); });
`);
    const titles = ["case alpha", "case beta slow", "case gamma timeout"];
    // The exact reporter argument the workflow passes for runs, with the JSON reporter writing its file as in production.
    const reporterArg = browserArgs("chromium", titles, true)[0];
    assert.equal(reporterArg, "--reporter=json," + REPORTER);
    const jsonFile = path.join(work, "playwright.json");
    const run = spawnSync(process.execPath, [cli, "test", "--config=playwright.config.js", reporterArg], {
      cwd: work, encoding: "utf8", timeout: 90_000,
      env: { ...process.env, CINE026_PROGRESS_TITLES: JSON.stringify(titles), PLAYWRIGHT_JSON_OUTPUT_FILE: jsonFile, CI: "1" },
    });
    const report = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    assert.equal(report.stats.expected, 2);
    assert.equal(report.stats.unexpected, 1);
    const progress = run.stdout.split(/\r?\n/).filter(line => line.startsWith("CINE026_PROGRESS "));
    assert.ok(progress.length >= 7, run.stdout + run.stderr);
    for (const line of progress) assert.doesNotMatch(line, /secret-room|token=abc|inner private|room\/abc|case (alpha|beta|gamma)/);
    const state = {};
    const clock = { startedMs: 0, nowMs: () => 1000 };
    for (const line of progress) assert.equal(observeProgressLine(state, line, clock), true);
    const cases = state.progress.cases;
    assert.deepEqual(cases.map(item => [item.index, item.status]), [[0, "passed"], [1, "passed"], [2, "timedOut"]]);
    assert.ok(cases[0].post >= 1 && cases[0].steps.expect >= 1 && cases[0].steps.step >= 1 && cases[0].steps.hook >= 2, JSON.stringify(cases[0]));
    assert.ok(cases[1].durationMs >= 1400 && cases[1].durationMs < 5000);
    assert.equal(cases[2].timeoutMs, 700);
    assert.ok(cases[0].setupMs >= 0 && cases[0].teardownMs >= 0);
    assert.equal(state.progress.runEnd.status, "failed");
    assert.equal(state.progress.rejected, 0);
    assert.equal(state.playwrightEnded, true);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

function freePort() {
  const net = require("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Real Playwright run with a real webServer that writes the application's diagnostic line to stderr in two writes.
// With the workflow's reporter argument the line reaches the run's stderr whole and exactly once; with a reporter that
// claims stdio but does not forward output (the state after PR #75) the same line is lost, which is the T1 defect.
test("real Playwright run: webServer diagnostics reach the supervisor's stream, and are lost without forwarding", { skip: !playwrightCli() && !process.env.CI && "no Playwright available" }, async () => {
  const cli = playwrightCli();
  assert.ok(cli, "Playwright must be available in CI (the candidate's locked dependencies)");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cine026-webserver-"));
  try {
    fs.symlinkSync(path.resolve(path.dirname(cli), ".."), path.join(work, "node_modules"), "junction");
    const port = await freePort();
    const origin = "http://127.0.0.1:" + port;
    const attempt = '[CINEMATCH_REALTIME_ATTEMPT] {"r":"0a1b2c3d","v":7,"kind":"http","status":202,"ms":12}';
    const marked = '[CINEMATCH_REALTIME_OUTBOX] {"r":"0a1b2c3d","v":7,"attempt":1,"outcome":"marked"}';
    fs.writeFileSync(path.join(work, "server.js"), `
const http = require("node:http");
http.createServer((request, response) => {
  if (request.url !== "/publish") return response.end("ok");
  process.stderr.write(${JSON.stringify(attempt.slice(0, 31))});
  setTimeout(() => {
    process.stderr.write(${JSON.stringify(attempt.slice(31) + "\n")});
    console.warn(${JSON.stringify(marked)});
    response.end("{}");
  }, 200);
}).listen(${port}, "127.0.0.1");
`);
    fs.writeFileSync(path.join(work, "playwright.config.js"), `module.exports = { testDir: ".", testMatch: "fixture.spec.js",
  workers: 1, retries: 0, timeout: 20000, reporter: "dot",
  webServer: { command: "node server.js", url: ${JSON.stringify(origin)}, reuseExistingServer: false, timeout: 20000 } };
`);
    fs.writeFileSync(path.join(work, "fixture.spec.js"), `
const { test, expect } = require("@playwright/test");
test("case publish", async ({ request }) => {
  expect((await request.get(${JSON.stringify(origin + "/publish")})).status()).toBe(200);
});
`);
    // The pre-fix shape: a reporter that claims stdio (so Playwright adds no terminal reporter) and forwards nothing.
    const control = path.join(work, "control-reporter.cjs");
    fs.writeFileSync(control, "module.exports = class { printsToStdio() { return true; } };\n");
    const titles = ["case publish"];
    const run = reporterArg => spawnSync(process.execPath, [cli, "test", "--config=playwright.config.js", reporterArg], {
      cwd: work, encoding: "utf8", timeout: 90_000,
      env: { ...process.env, CINE026_PROGRESS_TITLES: JSON.stringify(titles), PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(work, "pw.json"), CI: "1" },
    });
    const LINE = /\[CINEMATCH_REALTIME_(ATTEMPT|OUTBOX)\] (\{[^\n]*\})/;
    const records = text => text.split(/\r?\n/).map(line => LINE.exec(line)).filter(Boolean).map(match => [match[1], JSON.parse(match[2])]);

    const fixed = run(browserArgs("chromium", titles, true)[0]);
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
    assert.deepEqual(records(fixed.stderr), [["ATTEMPT", JSON.parse(attempt.slice(attempt.indexOf("{")))],
      ["OUTBOX", JSON.parse(marked.slice(marked.indexOf("{")))]], fixed.stderr);
    assert.deepEqual(records(fixed.stdout), [], "forwarded output stays off the progress stream");
    const state = {};
    for (const line of fixed.stdout.split(/\r?\n/).filter(line => line.startsWith("CINE026_PROGRESS "))) {
      assert.equal(observeProgressLine(state, line, { startedMs: 0, nowMs: () => 1 }), true);
    }
    assert.equal(state.progress.rejected, 0);
    assert.equal(state.progress.runEnd.status, "passed");

    const lost = run("--reporter=json," + control);
    assert.equal(lost.status, 0, lost.stdout + lost.stderr);
    assert.deepEqual(records(lost.stdout + lost.stderr), [], "control: without forwarding the application's lines are lost");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
