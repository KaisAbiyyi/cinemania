"use strict";

// Playwright reporter that prints allowlisted progress lines for the hosted qualification (CINE-026/063).
// It is loaded by path (`--reporter=json,<this file>`) and lives in the workflow repository, so the pinned
// candidate is not modified. It never prints a case title, step title, URL, locator, error message, attachment or
// payload: a case is identified only by its index in the selection, which the workflow passes through
// CINE026_PROGRESS_TITLES (a JSON array of the selected titles). Only counters and durations leave this process.
//
// Output forwarding. Because this reporter claims stdio, Playwright does not add its default terminal reporter, and
// that reporter was the only thing that printed the output of the `webServer` (the application under test) and of the
// cases. The application writes its `[CINEMATCH_REALTIME_*]` diagnostics there, so this reporter forwards that output
// to its own stderr, line by line, for the supervisor in the same job to count. The forwarded text is never parsed or
// stored here; the supervisor reads it through its own allowlist and nothing raw leaves the job.

const STEP_CATEGORIES = { "pw:api": "api", expect: "expect", "test.step": "step", hook: "hook", fixture: "fixture" };
const TICK_MS = 5_000;
const MAX_MS = 6 * 3_600_000;
const MAX_PARTIAL = 65_536;
// Playwright prefixes every line of a webServer chunk, including the continuation of a line that a pipe split in two.
const SERVER_PREFIX = /^(?:\u001b\[\d+m)?\[WebServer\] (?:\u001b\[\d+m)?/;

function readTitles() {
  try {
    const value = JSON.parse(process.env.CINE026_PROGRESS_TITLES ?? "[]");
    return Array.isArray(value) ? value.filter(item => typeof item === "string").slice(0, 64) : [];
  } catch {
    return [];
  }
}

// Steps that run inside a hook or fixture (request context creation, worker setup) are setup, not case work.
function insideHook(step) {
  for (let parent = step?.parent, depth = 0; parent && depth < 32; parent = parent.parent, depth++) {
    if (parent.category === "hook" || parent.category === "fixture") return true;
  }
  return false;
}

const clamp = value => Number.isFinite(value) ? Math.min(MAX_MS, Math.max(0, Math.round(value))) : 0;
const zero = () => ({ api: 0, expect: 0, step: 0, hook: 0, fixture: 0, other: 0 });

class Cine026ProgressReporter {
  constructor(options = {}) {
    this.write = options.write ?? (line => process.stdout.write(line + "\n"));
    this.writeOutput = options.writeOutput ?? (text => process.stderr.write(text));
    this.partial = new Map(); // source -> unterminated tail of its last chunk
    this.setTimer = options.setInterval ?? setInterval;
    this.clearTimer = options.clearInterval ?? clearInterval;
    this.titles = options.titles ?? readTitles();
    this.runs = new Map(); // result -> counters of the case being executed
    this.active = null;
    this.timer = null;
    this.began = Date.now();
  }

  // This reporter owns stdout. Claiming it stops Playwright from adding its default dot/list reporter, whose
  // unterminated progress characters would otherwise be glued to the front of the progress lines.
  printsToStdio() {
    return true;
  }

  // Complete lines go out at once; an unterminated tail waits for the rest of its line. Output of the webServer
  // arrives without a test and output of a case with one; each stream of each source is reassembled separately.
  forward(type, chunk, test) {
    try {
      const source = (test ? "case:" : "server:") + type;
      let text = typeof chunk === "string" ? chunk : Buffer.from(chunk ?? "").toString("utf8");
      let tail = this.partial.get(source) ?? "";
      if (tail && !test) text = text.replace(SERVER_PREFIX, "");
      text = tail + text;
      const end = text.lastIndexOf("\n");
      tail = end < 0 ? text : text.slice(end + 1);
      if (end >= 0) this.writeOutput(text.slice(0, end + 1));
      if (tail.length > MAX_PARTIAL) {
        this.writeOutput(tail + "\n");
        tail = "";
      }
      if (tail) this.partial.set(source, tail); else this.partial.delete(source);
    } catch { /* forwarding must never fail a run */ }
  }

  flushOutput() {
    for (const tail of this.partial.values()) {
      try { this.writeOutput(tail + "\n"); } catch { /* see forward() */ }
    }
    this.partial.clear();
  }

  onStdOut(chunk, test) {
    this.forward("stdout", chunk, test);
  }

  onStdErr(chunk, test) {
    this.forward("stderr", chunk, test);
  }

  emit(payload) {
    try { this.write("CINE026_PROGRESS " + JSON.stringify(payload)); } catch { /* progress must never fail a run */ }
  }

  indexOf(test) {
    return this.titles.indexOf(test.title);
  }

  onBegin(_config, suite) {
    this.emit({ ev: "begin", total: Math.min(10_000, suite?.allTests?.().length ?? 0) });
  }

  onTestBegin(test, result) {
    const state = { i: this.indexOf(test), steps: zero(), post: 0, setupMs: null, teardownMs: null, dirty: false,
      timeout: clamp(test.timeout) };
    this.runs.set(result, state);
    this.active = state;
    this.emit({ ev: "case_start", i: state.i, timeout: state.timeout });
    this.timer ??= this.setTimer(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  tick() {
    const state = this.active;
    if (!state?.dirty) return;
    state.dirty = false;
    this.emit({ ev: "case_tick", i: state.i, steps: state.steps, post: state.post });
  }

  onStepBegin(_test, result, step) {
    const state = this.runs.get(result);
    if (!state) return;
    const key = STEP_CATEGORIES[step?.category] ?? "other";
    if (key !== "hook" && key !== "fixture" && insideHook(step)) return;
    state.dirty = true;
    state.steps[key]++;
    // API calls are counted by verb only; the step title (which can carry a URL) is never stored.
    if (key === "api" && /^(?:apiRequestContext\.post|POST)\b/.test(step.title ?? "")) state.post++;
  }

  onStepEnd(_test, result, step) {
    const state = this.runs.get(result);
    if (!state || step?.category !== "hook") return;
    if (step.title === "Before Hooks") state.setupMs = clamp(step.duration);
    if (step.title === "After Hooks") state.teardownMs = clamp(step.duration);
  }

  onTestEnd(test, result) {
    const state = this.runs.get(result);
    if (!state) return;
    this.runs.delete(result);
    if (this.active === state) this.active = null;
    this.emit({ ev: "case_end", i: state.i, status: ["passed", "failed", "timedOut", "skipped", "interrupted"].includes(result.status) ?
      result.status : "failed", ms: clamp(result.duration), timeout: clamp(test.timeout), steps: state.steps, post: state.post,
    setupMs: state.setupMs, teardownMs: state.teardownMs });
  }

  onEnd(result) {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    const status = ["passed", "failed", "timedout", "interrupted"].includes(result?.status) ? result.status : "failed";
    this.emit({ ev: "run_end", status, ms: clamp(Date.now() - this.began) });
  }

  // The webServer is stopped after onEnd, so its last lines can still arrive; onExit is the final reporter call.
  onExit() {
    this.flushOutput();
  }
}

module.exports = Cine026ProgressReporter;
module.exports.Cine026ProgressReporter = Cine026ProgressReporter;
