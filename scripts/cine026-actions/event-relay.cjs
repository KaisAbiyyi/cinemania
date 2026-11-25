/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Relay between the output of the workload child and the outer reader (CINE-026/063). The adapter is the only process
// that sees the child's lines; the outer reader sees only what the adapter emits. `relayLine` returns the line to
// emit, or null. Nothing is forwarded verbatim: a recognized event is validated against the exact fields of its
// schema and printed again from the validated values. A line that mentions an event prefix but does not validate
// becomes a fixed rejection marker, which the outer reader counts as a rejected event. All other output is dropped.

const { sanitizeLine } = require("./nested-stream-lines.cjs");

const MAX_LINE = 1_024;
const MAX_REJECTIONS = 64;
const MAX_MS = 6 * 3_600_000;
const MENTION = /CINE026_(PROGRESS|NESTED|STREAM)\b/;
const EVENT = /^CINE026_(PROGRESS|NESTED) (\{.*\})$/;
// Written by the nested-process tap in front of every canonical diagnostic line, so its origin is known.
const STREAM = /^CINE026_STREAM (app|worker|fault) ([1-9]\d?) (.+)$/;

const int = (max, min = 0) => value => Number.isSafeInteger(value) && value >= min && value <= max;
const oneOf = (...values) => value => values.includes(value);
const nullable = check => value => value === null || check(value);
const bool = value => typeof value === "boolean";
const ms = int(MAX_MS);
const timeout = int(3_600_000);
const counter = int(1_000_000);
const index = int(1_000, -1);
const tally = int(100_000_000);
const kind = oneOf("app", "worker", "fault");
const generation = int(64, 1);
const steps = { api: counter, expect: counter, step: counter, hook: counter, fixture: counter, other: counter };

const SCHEMAS = {
  PROGRESS: {
    begin: { total: int(10_000) },
    case_start: { i: index, timeout },
    case_tick: { i: index, steps, post: counter },
    case_end: { i: index, status: oneOf("passed", "failed", "timedOut", "skipped", "interrupted"), ms, timeout, steps,
      post: counter, setupMs: nullable(ms), teardownMs: nullable(ms) },
    run_end: { status: oneOf("passed", "failed", "timedout", "interrupted"), ms },
  },
  NESTED: {
    tap_ready: {},
    spawn: { kind, n: generation, piped: bool },
    exit: { kind, n: generation, code: nullable(int(0xffff_ffff, -0x8000_0000)), signal: bool, forwarded: tally, dropped: tally },
    lines: { kind, n: generation, forwarded: tally, dropped: tally },
  },
};

// Exactly the fields of the schema: a missing, additional or invalid one rejects the event as a whole.
function rebuild(value, schema) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const names = Object.keys(schema);
  if (Object.keys(value).length !== names.length) return null;
  const out = {};
  for (const name of names) {
    if (!Object.hasOwn(value, name)) return null;
    if (typeof schema[name] === "function") {
      if (!schema[name](value[name])) return null;
      out[name] = value[name];
    } else {
      out[name] = rebuild(value[name], schema[name]);
      if (!out[name]) return null;
    }
  }
  return out;
}

function rebuildEvent(source, text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  const name = value && typeof value === "object" ? value.ev : null;
  if (typeof name !== "string" || !Object.hasOwn(SCHEMAS[source], name)) return null;
  const event = rebuild(value, { ev: oneOf(name), ...SCHEMAS[source][name] });
  // A process ends with a code or by a signal, never both and never neither.
  if (event?.ev === "exit" && (event.code === null) !== event.signal) return null;
  return event;
}

// `gateB`: the child is the Gate B process (its tap may speak, the Playwright reporter may not); otherwise it is the
// Playwright process of Gate A or C. `workload` is false for the build and the standalone worker, which may not speak.
function createRelay({ gateB = false } = {}) {
  const allowed = gateB ? "NESTED" : "PROGRESS";
  let rejections = 0;
  return function relayLine(line, workload) {
    const mention = MENTION.exec(line);
    if (!mention) return null;
    if (workload && line.length <= MAX_LINE) {
      const match = EVENT.exec(line);
      const event = match && match[1] === allowed ? rebuildEvent(allowed, match[2]) : null;
      if (event) return "CINE026_" + allowed + " " + JSON.stringify(event);
      const tagged = gateB ? STREAM.exec(line) : null;
      // The text was rebuilt by the tap and must already be canonical. Only its origin goes on, not the text: the
      // candidate's counters and the transport parser read the line inside this adapter.
      if (tagged && Number(tagged[2]) <= 64 && sanitizeLine(tagged[3]) === tagged[3]) {
        return "CINE026_NESTED " + JSON.stringify({ ev: "diagnostic", kind: tagged[1], n: Number(tagged[2]) });
      }
    }
    if (++rejections > MAX_REJECTIONS) return null;
    return "CINE026_" + (mention[1] === "PROGRESS" ? "PROGRESS" : "NESTED") + ' {"ev":"rejected"}';
  };
}

module.exports = { createRelay, MAX_LINE, MAX_REJECTIONS };
