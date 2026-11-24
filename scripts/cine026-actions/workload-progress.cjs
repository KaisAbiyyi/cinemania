/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Structured, allowlisted progress ledger for one hosted workload (CINE-026/063).
//
// Three sources feed it, all through single lines of the form `PREFIX {json}`:
//   CINE026_PROGRESS   from the Playwright reporter: case start/tick/end, step counters, run end.
//   CINE026_DB_SAMPLE  from the supervisor adapter: aggregate counters read by the candidate's own monitor.
//   CINE026_NESTED     from the nested-process tap: generations of nested app/worker processes.
// Everything is rebuilt here from enumerations and bounded integers. No title, URL, identifier, payload,
// message or raw output line is ever stored, so the ledger can go into the artifact as it is. A line that does
// not parse is counted and dropped, never stored. A case is identified only by its index in the selection.
//
// Time is the supervisor's own arrival clock (relative to the workload start), never a child's timestamp:
// a child cannot make a stalled run look alive by claiming a time.

const { STALL_MS } = require("./execution-budget.cjs");

const PREFIXES = /^(CINE026_PROGRESS|CINE026_DB_SAMPLE|CINE026_NESTED) (.+)$/;
const CASE_STATUSES = new Set(["passed", "failed", "timedOut", "skipped", "interrupted"]);
const RUN_STATUSES = new Set(["passed", "failed", "timedout", "interrupted"]);
const KINDS = new Set(["app", "worker", "fault", "other"]);
const STEP_KEYS = ["api", "expect", "step", "hook", "fixture", "other"];
const MAX_CASES = 24;
const MAX_SAMPLES = 40;
const MAX_STREAMS = 16;
const MAX_MS = 6 * 3_600_000;

const bounded = (value, max = MAX_MS) => Number.isSafeInteger(value) && value >= 0 && value <= max;

function createProgress() {
  return {
    events: 0, rejected: 0, cases: [], samples: [], sampleCount: 0,
    peaks: { rttMs: 0, oldestPendingMs: 0, continuousPendingMs: 0 },
    runEnd: null, lastSignalAfterMs: null,
    nested: { tapReady: false, generations: { app: 0, worker: 0, fault: 0, other: 0 }, streams: [] },
  };
}

function readSteps(value) {
  if (!value || typeof value !== "object") return null;
  const steps = {};
  for (const key of STEP_KEYS) {
    if (!bounded(value[key], 1_000_000)) return null;
    steps[key] = value[key];
  }
  return steps;
}

function activeCase(progress) {
  return progress.cases.find(item => item.endedAfterMs === null);
}

function signal(progress, afterMs) {
  progress.lastSignalAfterMs = afterMs;
}

function caseFor(progress, index, afterMs, create = true) {
  let item = progress.cases.find(entry => entry.index === index && entry.endedAfterMs === null);
  if (!item && create && progress.cases.length < MAX_CASES) {
    item = { index, status: "running", startedAfterMs: afterMs, endedAfterMs: null, durationMs: null, timeoutMs: null,
      steps: null, post: null, setupMs: null, teardownMs: null, votesAtStart: progress.lastVotes ?? null,
      votesLast: progress.lastVotes ?? null, lastEventAfterMs: afterMs };
    progress.cases.push(item);
  }
  return item;
}

function observeReporter(progress, payload, afterMs) {
  if (!payload || typeof payload.ev !== "string") return false;
  if (payload.ev === "begin") return bounded(payload.total, 10_000) && (signal(progress, afterMs), true);
  if (payload.ev === "run_end") {
    if (!RUN_STATUSES.has(payload.status) || !bounded(payload.ms)) return false;
    progress.runEnd = { status: payload.status, durationMs: payload.ms, afterMs };
    signal(progress, afterMs);
    return true;
  }
  const index = payload.i;
  if (!Number.isSafeInteger(index) || index < -1 || index > 1_000) return false;
  if (payload.ev === "case_start") {
    if (!bounded(payload.timeout, 3_600_000)) return false;
    const item = caseFor(progress, index, afterMs);
    if (item) item.timeoutMs = payload.timeout;
    signal(progress, afterMs);
    return true;
  }
  if (payload.ev === "case_tick" || payload.ev === "case_end") {
    const steps = readSteps(payload.steps);
    if (!steps || !bounded(payload.post, 1_000_000)) return false;
    const ending = payload.ev === "case_end";
    if (ending && (!CASE_STATUSES.has(payload.status) || !bounded(payload.ms) || !bounded(payload.timeout, 3_600_000) ||
      !(payload.setupMs === null || bounded(payload.setupMs)) || !(payload.teardownMs === null || bounded(payload.teardownMs)))) return false;
    // A tick never opens a case (a late tick cannot revive an ended one); an end without a start still leaves evidence.
    const item = caseFor(progress, index, afterMs, ending);
    if (!item) { signal(progress, afterMs); return true; }
    item.steps = steps;
    item.post = payload.post;
    item.lastEventAfterMs = afterMs;
    if (ending) {
      item.status = payload.status;
      item.endedAfterMs = afterMs;
      item.durationMs = payload.ms;
      item.timeoutMs = payload.timeout;
      item.setupMs = payload.setupMs;
      item.teardownMs = payload.teardownMs;
      item.votesLast = progress.lastVotes ?? item.votesLast;
    }
    signal(progress, afterMs);
    return true;
  }
  return false;
}

function observeSample(progress, payload, afterMs) {
  const keys = ["votes", "events", "pending", "rooms", "participants", "advisoryWaiters", "idleTransactions"];
  if (!payload || keys.some(key => !bounded(payload[key], 10_000_000)) ||
    !bounded(payload.oldestPendingMs, MAX_MS) || !bounded(payload.rttMs, 600_000)) return false;
  const previous = progress.samples.at(-1);
  const changed = !previous || ["votes", "events", "rooms", "participants"].some(key => previous[key] !== payload[key]);
  if (changed) signal(progress, afterMs);
  if (payload.pending > 0) progress.pendingSinceAfterMs ??= afterMs;
  else delete progress.pendingSinceAfterMs;
  const continuous = payload.pending > 0 ? afterMs - progress.pendingSinceAfterMs : 0;
  progress.peaks.rttMs = Math.max(progress.peaks.rttMs, payload.rttMs);
  progress.peaks.oldestPendingMs = Math.max(progress.peaks.oldestPendingMs, payload.oldestPendingMs);
  progress.peaks.continuousPendingMs = Math.max(progress.peaks.continuousPendingMs, continuous);
  progress.lastVotes = payload.votes;
  const open = activeCase(progress);
  if (open) open.votesLast = payload.votes;
  progress.sampleCount++;
  progress.samples.push({ afterMs, votes: payload.votes, events: payload.events, pending: payload.pending,
    oldestPendingMs: payload.oldestPendingMs, advisoryWaiters: payload.advisoryWaiters,
    idleTransactions: payload.idleTransactions, rttMs: payload.rttMs });
  // Halve the series when it is full, keeping the first and the newest point. Peaks are kept separately.
  if (progress.samples.length > MAX_SAMPLES) {
    progress.samples = progress.samples.filter((_, i, all) => i === 0 || i === all.length - 1 || i % 2 === 0);
  }
  return true;
}

function observeNested(progress, payload) {
  const nested = progress.nested;
  if (!payload || typeof payload.ev !== "string") return false;
  if (payload.ev === "tap_ready") { nested.tapReady = true; return true; }
  if (!KINDS.has(payload.kind) || !Number.isSafeInteger(payload.n) || payload.n < 1 || payload.n > 64) return false;
  let stream = nested.streams.find(item => item.kind === payload.kind && item.n === payload.n);
  if (payload.ev === "spawn") {
    if (!stream && nested.streams.length < MAX_STREAMS) {
      stream = { kind: payload.kind, n: payload.n, forwarded: 0, dropped: 0, exit: null };
      nested.streams.push(stream);
    }
    nested.generations[payload.kind] = Math.max(nested.generations[payload.kind], payload.n);
    return true;
  }
  if (!stream) return true; // Bounded: beyond MAX_STREAMS only the generation maximum above is kept.
  if (payload.ev === "lines") {
    if (!bounded(payload.forwarded, 100_000_000) || !bounded(payload.dropped, 100_000_000)) return false;
    stream.forwarded = payload.forwarded;
    stream.dropped = payload.dropped;
    return true;
  }
  if (payload.ev === "exit") {
    stream.exit = payload.code === 0 ? "exited" : payload.signal === true ? "killed" : "failed";
    return true;
  }
  return false;
}

// Returns true when the line belongs to this ledger (valid or not); never stores the line itself.
function observeProgressLine(state, line, context = {}) {
  const match = PREFIXES.exec(line);
  if (!match) return false;
  state.progress ??= createProgress();
  const progress = state.progress;
  const afterMs = Math.max(0, Math.round((context.nowMs?.() ?? Date.now()) - (context.startedMs ?? Date.now())));
  let payload;
  try { payload = JSON.parse(match[2]); } catch { progress.rejected++; return true; }
  const accepted = match[1] === "CINE026_PROGRESS" ? observeReporter(progress, payload, afterMs) :
    match[1] === "CINE026_DB_SAMPLE" ? observeSample(progress, payload, afterMs) : observeNested(progress, payload);
  if (accepted) progress.events++;
  else progress.rejected++;
  if (payload?.ev === "run_end" && accepted) state.playwrightEnded = true;
  return true;
}

// Distinguishes a child that is still working from one that has stopped, at the moment the run ends.
function classifyProgress(progress, atAfterMs) {
  if (!progress || progress.events === 0) return "NO_PROGRESS_EVIDENCE";
  if (progress.runEnd) return "RUN_ENDED";
  const age = atAfterMs - (progress.lastSignalAfterMs ?? 0);
  const fresh = age <= STALL_MS;
  const open = Boolean(activeCase(progress));
  if (open) return fresh ? "CASE_ACTIVE_PROGRESSING" : "CASE_ACTIVE_STALLED";
  return fresh ? "BETWEEN_CASES_PROGRESSING" : "BETWEEN_CASES_STALLED";
}

module.exports = { createProgress, observeProgressLine, classifyProgress, MAX_CASES, MAX_SAMPLES };
