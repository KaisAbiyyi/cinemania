"use strict";

// Aggregates the opt-in `[CINEMATCH_REALTIME_ATTEMPT]` / `[CINEMATCH_REALTIME_OUTBOX]` records emitted by
// the application and worker into a bounded, allowlisted summary. Nothing is copied from the input except
// values that pass the fixed enumerations and numeric checks below.

const CATEGORIES = new Set([
  "client_deadline", "client_abort", "dns_failure", "connect_timeout", "connect_unreachable",
  "connection_reset", "connection_closed", "response_timeout", "tls_failure", "unexpected_redirect",
  "unknown_fetch_failure",
]);
const PHASES = new Set([
  "connecting_or_queued", "request_head_written", "request_written_awaiting_response", "unobserved",
]);
const OUTCOMES = new Set(["marked", "retry_scheduled", "deferred", "permanent_rejection"]);
const MAX_FAILURES = 10;
const MAX_OUTBOX_PER_FAILURE = 4;
const LINE = /\[CINEMATCH_REALTIME_(ATTEMPT|OUTBOX)\] (\{[^\n]*\})/;
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const stamp = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ? value : null;

function createTransportDiagnostics(now = Date.now) {
  const http = { count: 0, okCount: 0, nonOkCount: 0, maxMs: 0, over1000Ms: 0, over1400Ms: 0 };
  const failures = [];
  const open = new Map();
  const outcomes = { marked: 0, retry_scheduled: 0, deferred: 0, permanent_rejection: 0 };
  let omittedFailures = 0;

  function attempt(record) {
    if (typeof record.r !== "string" || !/^[0-9a-f]{8}$/.test(record.r) || !nonNegative(record.v) || !nonNegative(record.ms)) return;
    if (record.kind === "http" && Number.isSafeInteger(record.status) && record.status >= 100 && record.status <= 599) {
      http.count++;
      if (record.status >= 200 && record.status < 300) http.okCount++; else http.nonOkCount++;
      http.maxMs = Math.max(http.maxMs, record.ms);
      if (record.ms > 1000) http.over1000Ms++;
      if (record.ms > 1400) http.over1400Ms++;
    } else if (record.kind === "transport" && CATEGORIES.has(record.category) && PHASES.has(record.phase)) {
      if (failures.length >= MAX_FAILURES) { omittedFailures++; return; }
      const entry = {
        category: record.category,
        code: typeof record.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(record.code) ? record.code : null,
        phase: record.phase, ms: record.ms, version: record.v, startedAt: stamp(record.startedAt),
        httpResponseReceived: false, outbox: [],
      };
      failures.push(entry);
      open.set(record.r + ":" + record.v, { entry, observedAt: now() });
    }
  }

  function outbox(record) {
    if (typeof record.r !== "string" || !/^[0-9a-f]{8}$/.test(record.r) || !nonNegative(record.v) ||
      !nonNegative(record.attempt) || !OUTCOMES.has(record.outcome)) return;
    outcomes[record.outcome]++;
    const failure = open.get(record.r + ":" + record.v);
    if (!failure) return;
    const log = failure.entry.outbox;
    const last = log[log.length - 1];
    if (last && last.outcome === record.outcome && last.attempt === record.attempt) { last.count++; return; }
    // Repeated deferrals are collapsed; the terminal "marked" outcome is always retained.
    if (log.length < MAX_OUTBOX_PER_FAILURE || record.outcome === "marked") {
      log.push({
        outcome: record.outcome, attempt: record.attempt, count: 1,
        observedAfterFailureMs: Math.max(0, now() - failure.observedAt),
      });
    }
  }

  return {
    observe(line) {
      const match = LINE.exec(line);
      if (!match) return;
      let record;
      try { record = JSON.parse(match[2]); } catch { return; }
      if (typeof record !== "object" || record === null) return;
      if (match[1] === "ATTEMPT") attempt(record); else outbox(record);
    },
    summary() {
      return { http: { ...http }, outcomes: { ...outcomes }, failures: failures.map(failure => ({ ...failure, outbox: [...failure.outbox] })), omittedFailures };
    },
  };
}

module.exports = { createTransportDiagnostics };
