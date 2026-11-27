/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const budget = require("./execution-budget.cjs");
const { planWorkload, CLEANUP_MS, FORCE_GRACE_MS, JOB_MS, JOB_RESERVE_MS } = require("./workload-supervision.cjs");
const { checkGateAEnvelope, gateAPlan } = require("./qualification.cjs");

const MINUTE = 60_000;
const EXHAUSTION = "all twenty cards exhaust only after both independent clients skip each card";
const NATURAL = "natural 90-second host grace elapses in real wall-clock time (no DB backdating)";

test("the Gate A budgets follow the declared case limits and WebKit needs far more than the old 420 s", () => {
  const plan = Object.fromEntries(gateAPlan().map(item => [item.browser, item.requiredMs]));
  // startup 255 s + cases at their declared limit + 30 s reporting margin
  assert.equal(budget.STARTUP_MS, 255_000);
  assert.deepEqual(plan, { chromium: 465_000, firefox: 465_000, webkit: 1_245_000 });
  // The reported conflict: one case declares 600 s, the supervisor allowed 420 s for three serial WebKit cases.
  assert.ok(budget.declaredCaseMs(EXHAUSTION) > 420_000);
  assert.ok(plan.webkit > 420_000 + 2 * budget.DEFAULT_CASE_MS);
  assert.equal(budget.requiredExecutionMs([]), null);
});

test("every Gate A workload is finite and the whole Gate A sequence fits inside the job ceiling", () => {
  const jobStarted = 1_800_000_000_000;
  const headroom = 150_000 + 8 * MINUTE;
  const total = gateAPlan().reduce((sum, item) => sum + item.requiredMs + CLEANUP_MS + FORCE_GRACE_MS, 0);
  assert.ok(total < JOB_MS - JOB_RESERVE_MS - headroom, "Gate A worst case " + total);
  assert.doesNotThrow(() => checkGateAEnvelope(jobStarted, headroom, jobStarted + 1_000));
  // The same plan is refused up front, before staging is touched, once too little of the job is left.
  assert.throws(() => checkGateAEnvelope(jobStarted, headroom, jobStarted + 75 * MINUTE), /WORKFLOW_BUDGET_EXHAUSTED/);
  assert.throws(() => checkGateAEnvelope(NaN, headroom), /WORKFLOW_BUDGET_EXHAUSTED/);
});

test("a derived budget is clipped by the job ceiling and the clipping is recorded as binding", () => {
  const jobStarted = 1_800_000_000_000;
  const fresh = planWorkload("A", jobStarted, jobStarted + 20 * MINUTE, 0, 1_245_000);
  assert.equal(fresh.executionMs, 1_245_000);
  assert.equal(fresh.budgetBinding, false);
  assert.equal(fresh.runEndGraceMs, budget.RUN_END_GRACE_MS);
  const late = planWorkload("A", jobStarted, jobStarted + 100 * MINUTE, 0, 1_245_000);
  assert.ok(late.executionMs < 1_245_000 && late.executionMs > 0);
  assert.equal(late.budgetBinding, true);
  assert.equal(late.executionMs + CLEANUP_MS + FORCE_GRACE_MS, jobStarted + JOB_MS - JOB_RESERVE_MS - (jobStarted + 100 * MINUTE));
  assert.equal(planWorkload("A", jobStarted, jobStarted + 118 * MINUTE, 0, 1_245_000), null);
  // Without a derived requirement the nominal per-gate minutes still apply (Gate B and C are unchanged).
  assert.equal(planWorkload("B", jobStarted, jobStarted + 20 * MINUTE).executionMs, 19 * MINUTE);
  assert.equal(planWorkload("C", jobStarted, jobStarted + 20 * MINUTE).executionMs, 55 * MINUTE);
});

test("the full matrix cannot be guaranteed inside one 120 minute job from declared limits alone", () => {
  // Documented limitation (docs/cine026-hosted-qualification.md): three browsers, thirteen cases each.
  const perBrowser = 11 * budget.DEFAULT_CASE_MS + budget.declaredCaseMs(NATURAL) + budget.declaredCaseMs(EXHAUSTION);
  const fullWorstCase = 3 * perBrowser + budget.STARTUP_MS + budget.REPORT_MARGIN_MS;
  assert.equal(perBrowser, 2_820_000);
  assert.ok(fullWorstCase > JOB_MS, "declared worst case " + fullWorstCase + " ms");
});

test("each one-gate mode, including one browser's 13 Gate C cases, fits one job from its declared limits", () => {
  const { modePlan, checkEnvelope } = require("./qualification.cjs");
  const MINUTE = 60_000;
  const headroom = 150_000 + 8 * MINUTE; // preflight + warm-up, as in qualify()
  const started = 1_700_000_000_000;
  for (const mode of ["gate-a-only", "gate-b-only", "gate-c-chromium", "gate-c-firefox", "gate-c-webkit"]) {
    assert.doesNotThrow(() => checkEnvelope(modePlan(mode), started, headroom, started + 1_000), mode);
  }
  const [c] = modePlan("gate-c-webkit");
  assert.equal(c.requiredMs, budget.STARTUP_MS + 2_820_000 + budget.REPORT_MARGIN_MS);
  // a job that has already lost most of its time is refused before staging is touched
  assert.throws(() => checkEnvelope(modePlan("gate-c-webkit"), started, headroom, started + 60 * MINUTE), /WORKFLOW_BUDGET_EXHAUSTED/);
});

test("the declared-limit parser reads the describe default and per-case overrides", () => {
  const parsed = budget.parseDeclaredTimeouts([
    'test.describe("x", () => {',
    "  test.setTimeout(180000);",
    '  test("plain case", async () => { await run(); });',
    '  test("long case", async () => {',
    "    test.setTimeout(600_000);",
    "  });",
    '  test("another plain", async () => {});',
    "});",
  ].join("\n"));
  assert.deepEqual(parsed, { defaultMs: 180_000, overrides: { "long case": 600_000 } });
});

function candidateSpec() {
  const local = path.resolve("candidate/tests/e2e/cine026-staging.spec.ts");
  if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
  try {
    const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/cine026-hosted-qualification.yml"), "utf8");
    const pin = /CANDIDATE:\s*([0-9a-f]{40})/.exec(workflow)?.[1];
    return execFileSync("git", ["show", pin + ":tests/e2e/cine026-staging.spec.ts"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 5_000_000 });
  } catch {
    return null;
  }
}

// Drift guard: the table above must equal what the pinned spec declares. A candidate repin that changes a
// case limit fails here, so the budget is re-derived on purpose instead of going stale.
test("the declared limits equal the limits in the pinned candidate spec", t => {
  const source = candidateSpec();
  if (!source) {
    assert.ok(!process.env.CI, "the candidate spec must be available in CI");
    t.skip("candidate spec unavailable outside CI");
    return;
  }
  const parsed = budget.parseDeclaredTimeouts(source);
  assert.equal(parsed.defaultMs, budget.DEFAULT_CASE_MS);
  assert.deepEqual(parsed.overrides, budget.CASE_OVERRIDES_MS);
});
