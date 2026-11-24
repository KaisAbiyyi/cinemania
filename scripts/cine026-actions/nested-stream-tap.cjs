/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Preload for the Gate B (worker restart) process of the pinned candidate (CINE-026/063).
//
// The candidate's two-instance qualification starts nested Next.js, worker and authority-commit processes and keeps
// only the last few kilobytes of their output in memory, printing it when the run fails. The workflow therefore
// cannot tell zero transport failures from missing evidence. This preload (`--require`, injected by the adapter;
// the candidate is not modified) wraps child_process.spawn in the Gate B process and, for every nested app, worker
// and fault process:
//   * numbers its generation per kind (a restart is generation 2, 3, ...) and reports whether its output streams
//     are attached (`piped`), how many diagnostic lines were forwarded and dropped, and how it ended,
//   * forwards ONLY canonical diagnostic lines that this file rebuilds itself from allowlisted fields (see
//     sanitizeLine). The raw line is never forwarded: free text, hosts, identifiers and any extra field are dropped
//     at the source. The adapter's existing diagnostics parser reads the canonical lines and keeps counts only.
// Other children (for example the browser that Playwright launches) are neither attached to nor reported.
// The tap does not alter streams, exit codes or arguments, and an error inside it can never fail the process it observes.

const childProcess = require("node:child_process");
const { createInterface } = require("node:readline");
const { kindOf, sanitizeLine } = require("./nested-stream-lines.cjs");

const counters = { app: 0, worker: 0, fault: 0 };
function emit(payload) {
  try { process.stdout.write("CINE026_NESTED " + JSON.stringify(payload) + "\n"); } catch { /* observation only */ }
}

function attach(child, command, args) {
  const kind = kindOf(command, args);
  if (kind === "other") return;
  const n = ++counters[kind];
  const piped = Boolean(child?.stdout && child?.stderr);
  const tally = { forwarded: 0, dropped: 0 };
  emit({ ev: "spawn", kind, n, piped });
  if (piped) {
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", line => {
        const clean = sanitizeLine(line);
        if (clean === null) {
          tally.dropped++;
          return;
        }
        tally.forwarded++;
        try { process.stdout.write(clean + "\n"); } catch { /* observation only */ }
      });
    }
  }
  // `exit` is terminal evidence: it carries the tally at that instant. `close` can lag when a descendant keeps a pipe
  // open after its parent was killed; if it does arrive, it only refines the tally.
  child.once("exit", (code, signal) => {
    emit({ ev: "exit", kind, n, code: Number.isInteger(code) ? code : null, signal: signal != null,
      forwarded: tally.forwarded, dropped: tally.dropped });
  });
  child.once("close", () => emit({ ev: "lines", kind, n, forwarded: tally.forwarded, dropped: tally.dropped }));
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

