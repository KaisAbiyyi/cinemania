/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { aggregate, summarizeAggregate, parseRunIds, REQUIRED, PASS_VERDICT, WORKFLOW_PATH } = require("./aggregate.cjs");
const { scopedVerdict, decideVerdict, runAggregate, GATE_C_MODES } = require("./qualification.cjs");

const candidate = "00555c03d4173ac54750677207b78252e2063257";
const workflowSha = "e264b97e04f73b0b84d67cfcf01c07dc0c56d6dd";
const modes = Object.keys(REQUIRED);

function runOf(id, extra = {}) {
  return { id: Number(id), event: "workflow_dispatch", head_branch: "main", run_attempt: 1, path: WORKFLOW_PATH,
    status: "completed", conclusion: "success", head_sha: workflowSha, ...extra };
}

function evidenceOf(id, mode, extra = {}) {
  const gate = REQUIRED[mode].gate;
  const gates = { A: "NOT RUN", B: "NOT RUN", C: "NOT RUN", D: "PASS", [gate]: "PASS" };
  return { candidate, workflowSha, runId: id, mode, preflight: { status: "PASS" }, gates, failure: undefined,
    verdict: REQUIRED[mode].verdict, artifactStatus: "terminal",
    warmup: { status: "READY", requests: [], cleanup: { leaseRelease: "released", readback: "PASS" } },
    workload: [{ gate, missingEvidence: [], transportProblems: [] }], ...extra };
}

function complete() {
  return modes.map((mode, i) => {
    const id = String(46100000000 + i);
    return { id, run: runOf(id), evidence: evidenceOf(id, mode) };
  });
}

test("the verdicts required per mode are exactly the harness's own scoped pass verdicts", () => {
  for (const mode of modes) assert.equal(REQUIRED[mode].verdict, scopedVerdict(mode));
  assert.deepEqual(modes.filter(mode => mode.startsWith("gate-c-")), Object.keys(GATE_C_MODES));
  // and each scoped evidence really decides to that verdict
  for (const mode of modes) {
    const e = evidenceOf("1", mode);
    assert.equal(decideVerdict({ ...e, verdict: "HOLD" }, false), REQUIRED[mode].verdict, mode);
  }
});

test("five passing one-gate runs on one workflow SHA are complete warm-path A-D acceptance", () => {
  const result = aggregate(complete(), candidate);
  assert.equal(result.verdict, PASS_VERDICT);
  assert.deepEqual(result.problems, []);
  assert.equal(result.workflowSha, workflowSha);
  assert.equal(result.coverage.coldPathRecovery, "NOT QUALIFIED");
  assert.match(summarizeAggregate(result), /Verdict: WARM-PATH ACCEPTANCE: ALL GATES PASSED ACROSS FIVE RUNS/);
});

test("any missing, duplicated, foreign, re-run, mismatched or failed run keeps the aggregate on HOLD", () => {
  const cases = {
    missing_mode: entries => entries.slice(0, 4),
    duplicate_mode: entries => { entries[4].evidence = evidenceOf(entries[4].id, "gate-a-only"); return entries; },
    run_not_dispatch: entries => { entries[0].run.event = "push"; return entries; },
    run_not_main: entries => { entries[1].run.head_branch = "feature"; return entries; },
    run_not_first_attempt: entries => { entries[2].run.run_attempt = 2; return entries; },
    run_wrong_workflow: entries => { entries[3].run.path = ".github/workflows/ci.yml"; return entries; },
    run_not_successful: entries => { entries[4].run.conclusion = "failure"; return entries; },
    run_metadata_missing: entries => { entries[0].run = null; return entries; },
    artifact_missing: entries => { entries[0].evidence = null; return entries; },
    artifact_not_terminal: entries => { entries[1].evidence.artifactStatus = "partial"; return entries; },
    artifact_run_mismatch: entries => { entries[2].evidence.runId = entries[3].id; return entries; },
    candidate_mismatch: entries => { entries[3].evidence.candidate = "0".repeat(40); return entries; },
    workflow_sha_mismatch: entries => { entries[4].evidence.workflowSha = "1".repeat(40); return entries; },
    workflow_sha_differs: entries => { entries[0].run.head_sha = "2".repeat(40); entries[0].evidence.workflowSha = "2".repeat(40); return entries; },
    verdict_not_passed: entries => { entries[1].evidence.verdict = "HOLD"; return entries; },
    failure_recorded: entries => { entries[2].evidence.failure = { phase: "qualification" }; return entries; },
    preflight_not_passed: entries => { entries[3].evidence.preflight.status = "FAIL"; return entries; },
    gates_not_scoped_pass: entries => { entries[4].evidence.gates.A = "PASS"; return entries; },
    gates_d: entries => { entries[0].evidence.gates.D = "UNCONFIRMED"; return entries; },
    warmup_not_ready: entries => { entries[1].evidence.warmup.cleanup.readback = "FAIL"; return entries; },
    workload_mismatch: entries => { entries[2].evidence.workload = []; return entries; },
    workload_evidence_incomplete: entries => { entries[3].evidence.workload[0].transportProblems = ["marked_below_dispatched"]; return entries; },
    mode_not_aggregatable: entries => { entries[4].evidence.mode = "full"; return entries; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const result = aggregate(mutate(complete()), candidate);
    assert.equal(result.verdict, "HOLD", name);
    assert.ok(result.problems.length > 0, name);
    const expected = { missing_mode: "missing_gate-c-webkit", gates_d: "gates_not_scoped_pass" }[name] ?? name;
    assert.ok(result.problems.includes(expected), name + ": " + result.problems.join(","));
  }
});

test("only five distinct numeric run ids are accepted as input", () => {
  assert.deepEqual(parseRunIds("1,2,3,4,5"), ["1", "2", "3", "4", "5"]);
  for (const bad of ["1,2,3,4", "1,2,3,4,5,6", "1,2,3,4,4", "1,2,3,4,x", "1, 2,3,4,5", "0,2,3,4,5", "", null, "1,2,3,4,5;rm -rf /"]) {
    assert.equal(parseRunIds(bad), null, String(bad));
  }
});

test("runAggregate binds downloaded artifacts to API run metadata and never needs staging", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cine026-aggregate-"));
  try {
    const entries = complete();
    for (const { id, evidence } of entries) {
      fs.mkdirSync(path.join(dir, id));
      fs.writeFileSync(path.join(dir, id, "cine026-qualification-evidence.json"), JSON.stringify(evidence));
    }
    const seen = [];
    const request = async (url, options) => {
      seen.push(url);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.authorization, "Bearer read-token");
      const id = url.split("/").at(-1);
      return { ok: true, json: async () => entries.find(entry => entry.id === id).run };
    };
    const env = { AGGREGATE_RUN_IDS: entries.map(entry => entry.id).join(","), AGGREGATE_DIR: dir, CINE026_GITHUB_TOKEN: "read-token" };
    assert.equal((await runAggregate(env, request)).verdict, PASS_VERDICT);
    assert.deepEqual(seen, entries.map(entry => "https://api.github.com/repos/KaisAbiyyi/cinemania/actions/runs/" + entry.id));
    // an unreachable API is a HOLD, never a pass
    const down = await runAggregate(env, async () => { throw new Error("offline"); });
    assert.equal(down.verdict, "HOLD");
    assert.ok(down.problems.includes("run_metadata_missing"));
    await assert.rejects(() => runAggregate({ ...env, AGGREGATE_RUN_IDS: "1,2" }, request), /AGGREGATE_RUNS_INVALID/);
    await assert.rejects(() => runAggregate({ ...env, CINE026_GITHUB_TOKEN: "" }, request), /PR_LOOKUP_TOKEN_MISSING/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the aggregate job runs only in the verify job without staging, and the staging job never runs for it", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/cine026-hosted-qualification.yml"), "utf8");
  const verify = workflow.slice(workflow.indexOf("\n  verify:"), workflow.indexOf("\n  qualify:"));
  const qualify = workflow.slice(workflow.indexOf("\n  qualify:"));
  assert.match(verify, /run: node scripts\/cine026-actions\/qualification\.cjs aggregate/);
  assert.match(verify, /actions: read/);
  assert.doesNotMatch(verify, /SUPABASE_|environment:|secrets\./, "aggregation has no staging credentials or environment");
  assert.match(qualify, /inputs\.mode != 'aggregate'/);
  assert.doesNotMatch(qualify, /qualification\.cjs aggregate/);
  // the run ids reach the shell only through an environment variable that is validated before use
  assert.match(verify, /RUNS: \$\{\{ inputs\.runs \}\}/);
  assert.doesNotMatch(verify, /run:[^\n]*\$\{\{ inputs\.runs \}\}/);
  assert.match(verify, /\[\[ "\$RUNS" =~ \^\[1-9\]/);
});
