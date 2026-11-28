"use strict";

// Complete A-D acceptance from five one-gate runs (CINE-026/063).
//
// All gates in one job do not fit the 120 minute ceiling, so acceptance is split by the owner's decision (2026-11-28):
// gate-a-only, gate-b-only and one gate-c mode per browser each run in their own dispatch, with their own warm-up,
// lease, cleanup and Gate D. This module decides whether five such runs together are complete acceptance. It never
// re-judges a gate: each run's own verdict was computed by the harness at that run's workflow SHA. What it adds is the
// binding between the runs:
//   * exactly one run per required mode, nothing missing, duplicated or extra;
//   * every run is a completed, successful, first-attempt workflow_dispatch of this workflow on main, and its artifact
//     names that run (so an artifact cannot be swapped between runs);
//   * every run used the same workflow SHA (the same harness and the same decision rules: run A is never evidence
//     for SHA B) and the same pinned candidate;
//   * every artifact is terminal, carries its mode's own pass verdict, a passing Gate D, a READY warm-up with
//     confirmed cleanup, no failure, and no recorded missing evidence or transport problem in any workload.
// The result lists every problem as an enumeration and is HOLD unless there are none. It reads only allowlisted
// fields; nothing from an artifact is copied into the result except enumerations, run ids and SHAs that passed checks.

const WORKFLOW_PATH = ".github/workflows/cine026-hosted-qualification.yml";
const REQUIRED = Object.freeze({
  "gate-a-only": { gate: "A", verdict: "WARM-PATH GATE A ONLY PASSED; COLD-PATH NOT QUALIFIED" },
  "gate-b-only": { gate: "B", verdict: "WARM-PATH GATE B ONLY PASSED; COLD-PATH NOT QUALIFIED" },
  "gate-c-chromium": { gate: "C", verdict: "WARM-PATH GATE C CHROMIUM ONLY PASSED; COLD-PATH NOT QUALIFIED" },
  "gate-c-firefox": { gate: "C", verdict: "WARM-PATH GATE C FIREFOX ONLY PASSED; COLD-PATH NOT QUALIFIED" },
  "gate-c-webkit": { gate: "C", verdict: "WARM-PATH GATE C WEBKIT ONLY PASSED; COLD-PATH NOT QUALIFIED" },
});
const PASS_VERDICT = "WARM-PATH ACCEPTANCE: ALL GATES PASSED ACROSS FIVE RUNS; COLD-PATH RECOVERY NOT QUALIFIED";
const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9]\d{0,19}$/;

// Parses the dispatch input: exactly five distinct run ids, comma separated, nothing else.
function parseRunIds(value) {
  if (typeof value !== "string" || value.length > 120) return null;
  const ids = value.split(",");
  if (ids.length !== 5 || !ids.every(id => RUN_ID.test(id)) || new Set(ids).size !== 5) return null;
  return ids;
}

function runProblems(id, run) {
  const problems = [];
  if (!run || String(run.id) !== id) return ["run_metadata_missing"];
  if (run.event !== "workflow_dispatch") problems.push("run_not_dispatch");
  if (run.head_branch !== "main") problems.push("run_not_main");
  if (run.run_attempt !== 1) problems.push("run_not_first_attempt");
  if (run.path !== WORKFLOW_PATH) problems.push("run_wrong_workflow");
  if (run.status !== "completed" || run.conclusion !== "success") problems.push("run_not_successful");
  if (!SHA.test(run.head_sha ?? "")) problems.push("run_sha_invalid");
  return problems;
}

function evidenceProblems(id, run, evidence, candidate) {
  const problems = [];
  const required = REQUIRED[evidence?.mode];
  if (!evidence || typeof evidence !== "object") return ["artifact_missing"];
  if (!required) return ["mode_not_aggregatable"];
  if (evidence.artifactStatus !== "terminal") problems.push("artifact_not_terminal");
  if (evidence.runId !== id) problems.push("artifact_run_mismatch");
  if (evidence.candidate !== candidate) problems.push("candidate_mismatch");
  if (!SHA.test(evidence.workflowSha ?? "") || evidence.workflowSha !== run?.head_sha) problems.push("workflow_sha_mismatch");
  if (evidence.verdict !== required.verdict) problems.push("verdict_not_passed");
  if (evidence.failure) problems.push("failure_recorded");
  if (evidence.preflight?.status !== "PASS") problems.push("preflight_not_passed");
  const gates = evidence.gates ?? {};
  if (gates[required.gate] !== "PASS" || gates.D !== "PASS" ||
    ["A", "B", "C"].some(gate => gate !== required.gate && gates[gate] !== "NOT RUN")) problems.push("gates_not_scoped_pass");
  const warmup = evidence.warmup;
  if (warmup?.status !== "READY" || warmup.cleanup?.leaseRelease !== "released" || warmup.cleanup?.readback !== "PASS") {
    problems.push("warmup_not_ready");
  }
  const workloads = Array.isArray(evidence.workload) ? evidence.workload : [];
  if (workloads.length === 0 || workloads.some(item => item?.gate !== required.gate)) problems.push("workload_mismatch");
  if (workloads.some(item => !Array.isArray(item?.missingEvidence) || item.missingEvidence.length > 0 ||
    !Array.isArray(item?.transportProblems) || item.transportProblems.length > 0)) problems.push("workload_evidence_incomplete");
  return problems;
}

// `entries`: one { id, run, evidence } per requested run id, where `run` is the GitHub API run object and `evidence`
// the parsed artifact (or null when it could not be read).
function aggregate(entries, candidate) {
  const runs = [];
  const problems = new Set();
  const modes = new Map();
  for (const { id, run, evidence } of entries) {
    const found = [...runProblems(id, run), ...evidenceProblems(id, run, evidence, candidate)];
    const mode = REQUIRED[evidence?.mode] ? evidence.mode : null;
    if (mode) {
      if (modes.has(mode)) found.push("duplicate_mode");
      modes.set(mode, id);
    }
    for (const problem of found) problems.add(problem);
    runs.push({ id, mode, workflowSha: SHA.test(run?.head_sha ?? "") ? run.head_sha : null, problems: found });
  }
  for (const mode of Object.keys(REQUIRED)) if (!modes.has(mode)) problems.add("missing_" + mode);
  const shas = new Set(runs.map(run => run.workflowSha));
  if (shas.size !== 1 || shas.has(null)) problems.add("workflow_sha_differs");
  const list = [...problems].sort();
  return {
    verdict: list.length === 0 && entries.length === 5 ? PASS_VERDICT : "HOLD",
    candidate, workflowSha: shas.size === 1 ? [...shas][0] : null,
    problems: list, runs,
    coverage: { warmPathAcceptance: list.length === 0 ? "PASS (GATES A-D, FIVE RUNS)" : "HOLD", coldPathRecovery: "NOT QUALIFIED" },
  };
}

function summarizeAggregate(result) {
  return ["## CINE-026/063 aggregated qualification", "",
    "Candidate: " + result.candidate, "Workflow SHA: " + (result.workflowSha ?? "differs or invalid"),
    ...result.runs.map(run => "Run " + run.id + ": " + (run.mode ?? "unknown mode") +
      (run.problems.length ? " (" + run.problems.join(", ") + ")" : " (ok)")),
    "Verdict: " + result.verdict,
    ...(result.problems.length ? ["Problems: " + result.problems.join(", ")] : []),
    "Warm-path acceptance: " + result.coverage.warmPathAcceptance + ". Cold-path recovery: NOT QUALIFIED (tracked separately, #81).",
    "", "Evidence contains allowlisted enumerations, run ids and SHAs only.", ""].join("\n");
}

module.exports = { aggregate, summarizeAggregate, parseRunIds, REQUIRED, PASS_VERDICT, WORKFLOW_PATH };
