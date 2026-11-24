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
    const run = spawnSync(process.execPath, [cli, "test", "--config=playwright.config.js", "--reporter=" + REPORTER], {
      cwd: work, encoding: "utf8", timeout: 90_000,
      env: { ...process.env, CINE026_PROGRESS_TITLES: JSON.stringify(titles), PW_TEST_HTML_REPORT_OPEN: "never", CI: "1" },
    });
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
