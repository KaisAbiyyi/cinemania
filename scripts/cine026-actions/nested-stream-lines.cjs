"use strict";

// Pure helpers for the nested-process tap (CINE-026/063). No side effects: safe to require from the workflow and
// from tests. `sanitizeLine` is the only way a nested process's output can reach the workflow: it rebuilds a
// canonical diagnostic line from allowlisted fields, or returns null.

const TOKEN = /^[A-Za-z0-9_:.-]{1,64}$/;
const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const FIELDS = {
  ATTEMPT: ["r", "v", "ms", "kind", "status", "category", "code", "phase", "startedAt"],
  OUTBOX: ["r", "v", "attempt", "outcome"],
};
const RECORD_LINE = /\[CINEMATCH_REALTIME_(ATTEMPT|OUTBOX)\] (\{[^\n]*\})\s*$/;
const FAILURE_LINE = /\[CINEMATCH_REALTIME_ATTEMPT_FAILURE\] (transport|status)\b/;
const CONNECTION_LINE = /\[CINEMATCH_DB_CONNECTION_ERROR\]\s*(\{[^\n]*\})?/;

function kindOf(command, args) {
  const text = [command, ...(Array.isArray(args) ? args : [])].map(String).join(" ");
  if (/\bnext\b.*\bdev\b|\bnext(?:\.js)?\b.* start\b/.test(text) || /dist[\\/]bin[\\/]next\b/.test(text)) return "app";
  if (text.includes("scripts/realtime-worker.ts")) return "worker";
  if (/fault/i.test(text)) return "fault";
  return "other";
}

function pick(record, names) {
  const out = {};
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) out[name] = value;
    else if (typeof value === "string" && (name === "startedAt" ? STAMP.test(value) : TOKEN.test(value))) out[name] = value;
  }
  return out;
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Rebuilds a canonical diagnostic line from allowlisted fields, or returns null when the line is not one of the
// candidate's diagnostics. Nothing from the input is copied except those validated fields.
function sanitizeLine(line) {
  const failure = FAILURE_LINE.exec(line);
  if (failure) return "[CINEMATCH_REALTIME_ATTEMPT_FAILURE] " + failure[1];
  const record = RECORD_LINE.exec(line);
  if (record) {
    const parsed = parseObject(record[2]);
    if (!parsed || typeof parsed.r !== "string" || !/^[0-9a-f]{8}$/.test(parsed.r)) return null;
    return "[CINEMATCH_REALTIME_" + record[1] + "] " + JSON.stringify(pick(parsed, FIELDS[record[1]]));
  }
  if (line.includes("[CINEMATCH_DB_CAPACITY]")) return "[CINEMATCH_DB_CAPACITY]";
  const connection = CONNECTION_LINE.exec(line);
  if (connection) {
    const parsed = connection[1] ? parseObject(connection[1]) : null;
    const out = {};
    if (typeof parsed?.code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(parsed.code)) out.code = parsed.code;
    if (typeof parsed?.phase === "string" && /^[a-z_]{1,24}$/.test(parsed.phase)) out.phase = parsed.phase;
    return "[CINEMATCH_DB_CONNECTION_ERROR] " + JSON.stringify(out);
  }
  if (line.includes('"category":"outbox_lock_timeout"')) {
    return 'Room notification dispatch failed; retry remains pending. {"category":"outbox_lock_timeout"}';
  }
  if (/uncaughtException:.*ECONNRESET/.test(line)) return "uncaughtException: ECONNRESET";
  return null;
}


// The canonical lines sanitizeLine can produce. The outer supervisor counts the lines it receives that look like
// these, to reconcile them against what the tap reports as forwarded.
const CANONICAL = /^(?:\[CINEMATCH_REALTIME_(?:ATTEMPT|OUTBOX)\] \{|\[CINEMATCH_REALTIME_ATTEMPT_FAILURE\] (?:transport|status)$|\[CINEMATCH_DB_CAPACITY\]$|\[CINEMATCH_DB_CONNECTION_ERROR\] \{|Room notification dispatch failed; retry remains pending\. \{"category":"outbox_lock_timeout"\}$|uncaughtException: ECONNRESET$)/;

module.exports = { kindOf, sanitizeLine, CANONICAL };
