/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Preload for the Gate B (worker restart) process of the pinned candidate (CINE-026/063).
//
// The candidate's two-instance qualification starts nested Next.js and worker processes and keeps only the
// last few kilobytes of their output in memory, printing it when the run fails. The workflow therefore cannot
// tell zero transport failures from missing evidence. This preload (`--require`, injected by the adapter, the
// candidate is not modified) wraps child_process.spawn in the Gate B process and, for every nested process:
//   * counts generations per kind (app, worker, fault, other) so a restart is visible as generation 2,
//   * forwards ONLY lines that carry the candidate's own transport/database diagnostic tags to this process's
//     stdout, where the adapter's existing diagnostics parser and counters read them. The parser keeps counts
//     and allowlisted fields; raw lines are never stored or published,
//   * reports per-generation forwarded/dropped line counts and how the process ended.
// Output of untagged lines is counted and dropped, never forwarded. The tap does not alter streams, exit codes
// or arguments, and an error inside it can never fail the process it observes.

const childProcess = require("node:child_process");
const { createInterface } = require("node:readline");

const FORWARD = /^(?:\[CINEMATCH_(?:REALTIME|DB)_[A-Z_]+\]|.*"category":"outbox_lock_timeout"|.*uncaughtException:.*ECONNRESET)/;
const counters = { app: 0, worker: 0, fault: 0, other: 0 };

function emit(payload) {
  try { process.stdout.write("CINE026_NESTED " + JSON.stringify(payload) + "\n"); } catch { /* observation only */ }
}

function kindOf(command, args) {
  const text = [command, ...(Array.isArray(args) ? args : [])].map(String).join(" ");
  if (/\bnext\b.*\bdev\b|\bnext(?:\.js)?\b.* start\b/.test(text) || /dist[\\/]bin[\\/]next\b/.test(text)) return "app";
  if (text.includes("scripts/realtime-worker.ts")) return "worker";
  if (/fault/i.test(text)) return "fault";
  return "other";
}

function attach(child, command, args) {
  if (!child?.stdout || !child.stderr) return;
  const kind = kindOf(command, args);
  const n = ++counters[kind];
  const tally = { forwarded: 0, dropped: 0 };
  emit({ ev: "spawn", kind, n });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", line => {
      if (FORWARD.test(line)) {
        tally.forwarded++;
        try { process.stdout.write(line + "\n"); } catch { /* observation only */ }
      } else {
        tally.dropped++;
      }
    });
  }
  child.once("close", (code, signal) => {
    emit({ ev: "lines", kind, n, forwarded: tally.forwarded, dropped: tally.dropped });
    emit({ ev: "exit", kind, n, code: Number.isInteger(code) ? code : null, signal: signal != null });
  });
}

if (!childProcess.spawn.__cine026Tap) {
  const original = childProcess.spawn;
  const wrapped = function spawn(command, args, ...rest) {
    const child = original.call(this, command, args, ...rest);
    try { attach(child, command, args); } catch { /* observation only */ }
    return child;
  };
  wrapped.__cine026Tap = true;
  childProcess.spawn = wrapped;
  // Nested processes inherit the environment of this one: drop this preload from it so only the Gate B process taps.
  const self = __filename.replaceAll("\\", "/");
  process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS ?? "").split(/\s+(?=--)/)
    .filter(option => !option.replaceAll("\\", "/").includes(self)).join(" ");
  emit({ ev: "tap_ready" });
}

module.exports = { kindOf, FORWARD };
