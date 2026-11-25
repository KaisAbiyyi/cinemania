"use strict";

// Execution budget for one hosted browser workload (CINE-026/063).
//
// The first Gate A budget was a flat 7 minutes per workload. The pinned candidate spec declares its own
// per-case limits: 180 s for every case inherited from the describe block, plus two explicit overrides
// (the natural 90 s host-grace case, 240 s; the twenty-card exhaustion case, 600 s). The three WebKit
// scenarios of Gate A alone can therefore legitimately need 180 + 180 + 600 s, which cannot fit in 420 s.
// The budget below is derived from those declared limits instead of being a free-standing number, so a
// run can no longer be cut off by the supervisor before the candidate's own timeouts have a chance to
// fire. It is finite, it is clipped by the job ceiling in planWorkload(), and a clipped budget is
// recorded as binding in the evidence so a timeout can be told apart from a stalled child.
//
// Nothing here relaxes an assertion or a case timeout. Playwright still enforces the per-case limits.

const DEFAULT_CASE_MS = 180_000; // test.setTimeout(180000) on the describe block of the pinned spec
const CASE_OVERRIDES_MS = Object.freeze({
  "natural 90-second host grace elapses in real wall-clock time (no DB backdating)": 240_000,
  "all twenty cards exhaust only after both independent clients skip each card": 600_000,
});

// Startup before the first case can run, each bounded by a declared or observed limit:
//   webServer.timeout in the staging Playwright config (120 s), worker readiness (150 polls x 100 ms), and
//   `next build`, which the pinned supervisor does not bound; observed 2-21 s on runners, allowance 120 s.
const WEB_SERVER_MS = 120_000;
const WORKER_READY_MS = 15_000;
const BUILD_ALLOWANCE_MS = 120_000;
const REPORT_MARGIN_MS = 30_000;
const STARTUP_MS = WEB_SERVER_MS + WORKER_READY_MS + BUILD_ALLOWANCE_MS;

// Longest wait inside a case that emits neither a reporter event nor a database change: the 100 s sleep of the
// natural host-grace case. The stall threshold is that wait plus a 50% margin.
const LONGEST_SILENT_WAIT_MS = 100_000;
const STALL_MS = 150_000;
// After Playwright reports the end of the run the process should exit; webServer and browser teardown get this long.
// Every case result and the JSON report already exist by then, so waiting longer costs little against a hung exit.
const RUN_END_GRACE_MS = 120_000;

function declaredCaseMs(title) {
  return Object.hasOwn(CASE_OVERRIDES_MS, title) ? CASE_OVERRIDES_MS[title] : DEFAULT_CASE_MS;
}

// Execution budget for a Playwright selection: startup, every selected case at its own declared limit,
// and a reporting margin. `titles` is the list of selected case titles for ONE browser, or, for a
// multi-browser selection, the concatenation of each browser's list.
function requiredExecutionMs(titles) {
  if (!Array.isArray(titles) || titles.length === 0) return null;
  return STARTUP_MS + titles.reduce((sum, title) => sum + declaredCaseMs(title), 0) + REPORT_MARGIN_MS;
}

// Extracts the declared limits from the source of the candidate spec so the table above cannot drift
// silently from the pinned spec. Returns { defaultMs, overrides: { title: ms } }.
function parseDeclaredTimeouts(source) {
  const timeout = /test\.setTimeout\(\s*(\d[\d_]*)\s*\)/;
  const parts = source.split(/\n\s*test\(\s*(?=["'`])/);
  const defaults = timeout.exec(parts[0]);
  const overrides = {};
  for (const part of parts.slice(1)) {
    const title = /^(["'`])((?:\\.|(?!\1).)*)\1/.exec(part)?.[2];
    const own = timeout.exec(part);
    if (title && own) overrides[title] = Number(own[1].replaceAll("_", ""));
  }
  return { defaultMs: defaults ? Number(defaults[1].replaceAll("_", "")) : null, overrides };
}

module.exports = {
  DEFAULT_CASE_MS, CASE_OVERRIDES_MS, STARTUP_MS, REPORT_MARGIN_MS, STALL_MS, RUN_END_GRACE_MS,
  LONGEST_SILENT_WAIT_MS, declaredCaseMs, requiredExecutionMs, parseDeclaredTimeouts,
};
