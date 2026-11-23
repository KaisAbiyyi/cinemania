/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { setTimeout: delay } = require("node:timers/promises");

const EXECUTION_MINUTES = { A: 7, B: 19, C: 55 };
const CLEANUP_MS = 240_000;
const FORCE_GRACE_MS = 6_000;
const JOB_MS = 120 * 60_000;
const JOB_RESERVE_MS = 180_000;
const PHASES = new Set([
  "execution_start", "build", "worker_start", "workload", "teardown", "stop_requested",
  "shutdown_observed", "quiet_window", "cleanup_audit", "terminal",
]);

function planWorkload(gate, jobStartedAt, now = Date.now(), preparationMs = 0) {
  if (!Number.isSafeInteger(jobStartedAt) || jobStartedAt <= 0 || jobStartedAt > now) return null;
  const remaining = jobStartedAt + JOB_MS - now - JOB_RESERVE_MS - preparationMs;
  const executionMs = Math.min(EXECUTION_MINUTES[gate] * 60_000, remaining - CLEANUP_MS - FORCE_GRACE_MS);
  return executionMs > 0 ? { executionMs, cleanupMs: CLEANUP_MS, forceGraceMs: FORCE_GRACE_MS } : null;
}

// This process owns the group. The graceful signal targets only the supervisor,
// leaving it alive to stop its children, release the lease and read back cleanup.
function superviseWorkload(child, {
  budget, signal, observe, onCheckpoint = () => {}, killGroup, groupAlive,
  setTimer = setTimeout, clearTimer = clearTimeout, now = () => new Date().toISOString(),
}) {
  const state = { milestones: [], terminalMilestone: false };
  let executionTimer, cleanupTimer, hardTimer, forceTimer;
  let teardown = false;
  let finished = false;

  return new Promise(resolve => {
    function recordFailure(phase, code) {
      state.firstFailure ??= { phase, code, at: now() };
    }

    function checkpoint() {
      try {
        onCheckpoint(state);
      } catch {
        if (state.evidenceWriteFailed) return;
        state.evidenceWriteFailed = true;
        recordFailure("supervisor", "EVIDENCE_CHECKPOINT_FAILED");
        stopGracefully();
      }
    }

    function finish(exitCode) {
      if (finished) return;
      finished = true;
      for (const timer of [executionTimer, cleanupTimer, hardTimer, forceTimer]) clearTimer(timer);
      signal?.removeEventListener("abort", interrupt);
      state.exitCode = exitCode;
      resolve(state);
    }

    function force(hardCeiling) {
      if (finished) return;
      state.forcedTermination = true;
      if (hardCeiling) {
        state.hardCeilingReached = true;
        recordFailure("supervisor", "WORKLOAD_HARD_CEILING");
      }
      killGroup("SIGKILL");
      checkpoint();
      // An orphan can keep the pipes open even after the supervisor dies.
      // Stop waiting at the hard ceiling. The result remains incomplete.
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish(null);
    }

    function enterTeardown() {
      if (teardown || finished) return;
      teardown = true;
      clearTimer(executionTimer);
      cleanupTimer = setTimer(() => {
        state.cleanupTimedOut = true;
        recordFailure("cleanup", "WORKLOAD_CLEANUP_TIMEOUT");
        forceTimer = setTimer(() => force(false), budget.forceGraceMs);
        child.kill("SIGTERM");
        checkpoint();
      }, budget.cleanupMs);
    }

    function stopGracefully() {
      enterTeardown();
      child.kill("SIGTERM");
    }

    function interrupt() {
      state.interrupted = true;
      recordFailure("supervisor", "WORKLOAD_INTERRUPTED");
      stopGracefully();
      checkpoint();
    }

    function consume(line) {
      if (finished) return;
      const phase = /^CINE026_SUPERVISOR_PHASE ([a-z_]+)$/.exec(line)?.[1];
      if (PHASES.has(phase)) {
        if (state.milestones.length < 20) state.milestones.push({ phase, at: now() });
        if (phase === "teardown") enterTeardown();
        if (phase === "stop_requested") recordFailure("supervisor", "WORKLOAD_SUPERVISOR_STOP_REQUESTED");
        if (phase === "terminal") state.terminalMilestone = true;
        checkpoint();
      } else if (observe(state, line)) {
        checkpoint();
      }
    }

    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on("line", consume);
    }
    executionTimer = setTimer(() => {
      state.executionTimedOut = true;
      recordFailure("execution", "WORKLOAD_EXECUTION_TIMEOUT");
      stopGracefully();
      checkpoint();
    }, budget.executionMs);
    hardTimer = setTimer(() => force(true), budget.executionMs + budget.cleanupMs + budget.forceGraceMs);
    child.once("error", () => {
      state.spawnFailed = true;
      recordFailure("supervisor", "WORKLOAD_SPAWN_FAILED");
      checkpoint();
    });
    child.once("exit", () => {
      if (!groupAlive()) return;
      state.remainingProcesses = true;
      recordFailure("cleanup", "WORKLOAD_PROCESSES_REMAIN");
      killGroup("SIGKILL");
      checkpoint();
    });
    child.once("close", finish);
    signal?.addEventListener("abort", interrupt, { once: true });
    if (signal?.aborted) interrupt();
  });
}

function startManagedChild(args, env, onLine) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const done = new Promise(resolve => {
    child.once("error", () => resolve(1));
    child.once("close", code => resolve(code ?? 1));
  });
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", onLine);
  }
  let stopping;
  return {
    done,
    stop() {
      return stopping ??= (async () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return done;
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), FORCE_GRACE_MS);
        force.unref();
        try { return await done; } finally { clearTimeout(force); }
      })();
    },
  };
}

// Adapter for the pinned candidate's existing injection points. Guard, fixture
// ownership, lease release and SQL audit stay in the candidate's supervisor.
async function runSupervisor({
  main, createClient, diagnostics, args, signal, start = startManagedChild, wait = delay,
  emit = line => process.stdout.write(line + "\n"), now = Date.now,
}) {
  const children = new Set();
  let tearingDown = false;
  let firstClient = true;
  let stopped = false;
  let lastSnapshot = -Infinity;
  function snapshot() {
    lastSnapshot = now();
    emit("CINE026_TRANSPORT_PARTIAL " + JSON.stringify(diagnostics.summary()));
  }
  function phase(name) {
    emit("CINE026_SUPERVISOR_PHASE " + name);
  }
  function teardown() {
    if (tearingDown) return;
    tearingDown = true;
    phase("teardown");
    snapshot();
  }
  function requestStop() {
    if (stopped) return;
    stopped = true;
    teardown();
    phase("stop_requested");
    for (const child of children) void child.stop().catch(() => {});
  }
  signal?.addEventListener("abort", requestStop, { once: true });
  phase("execution_start");
  if (signal?.aborted) requestStop();
  try {
    if (stopped) return 1;
    const result = await main({
      args,
      makeClient(config) {
        if (firstClient) firstClient = false;
        else phase("cleanup_audit");
        return createClient(config);
      },
      startChild(childArgs, env, observe) {
        if (stopped || tearingDown) throw new Error("Execution is shutting down");
        const kind = childArgs[1] === "build" ? "build" :
          childArgs.includes("scripts/realtime-worker.ts") ? "worker_start" : "workload";
        phase(kind);
        const child = start(childArgs, env, line => {
          observe(line);
          diagnostics.observe(line);
          const attemptFailed = line.includes("[CINEMATCH_REALTIME_ATTEMPT]") && line.includes('"kind":"transport"');
          if (attemptFailed || (line.includes("[CINEMATCH_REALTIME_") && now() - lastSnapshot >= 5_000)) snapshot();
          // The outer runner rebuilds the worker proof from its allowlist.
          if (kind === "workload" && args[0] === "--worker-qualification" &&
              line.startsWith("CINE026_WORKER_RECOVERY ")) emit(line);
        });
        children.add(child);
        return {
          stop() {
            teardown();
            return child.stop();
          },
          done: child.done.then(code => {
            children.delete(child);
            if (kind !== "build" || code !== 0) teardown();
            return code;
          }),
        };
      },
      wait(ms) {
        if (ms === 135_000) phase("quiet_window");
        return wait(ms);
      },
      report(label, value) {
        if (label === "CINE026_HOSTED_SHUTDOWN") {
          teardown();
          phase("shutdown_observed");
        }
        emit(label + " " + JSON.stringify(value));
        if (label === "CINE026_HOSTED_FAILURE" && value.primary === true) teardown();
      },
    });
    phase("terminal");
    return result.exitCode;
  } finally {
    signal?.removeEventListener("abort", requestStop);
  }
}

if (require.main === module) {
  const cancellation = new AbortController();
  for (const name of ["SIGINT", "SIGTERM"]) process.on(name, () => cancellation.abort());
  Promise.resolve().then(async () => {
    const { main } = require(path.resolve("scripts/cine026/run-hosted-staging.cjs"));
    const { createTransportDiagnostics } = require(path.resolve("scripts/cine026/transport-diagnostics.cjs"));
    const { Client } = require(path.resolve("node_modules/pg"));
    return runSupervisor({
      main, args: process.argv.slice(2), signal: cancellation.signal,
      createClient: config => new Client(config), diagnostics: createTransportDiagnostics(),
    });
  }).then(code => { process.exitCode = code; }).catch(() => {
    console.error("CINE026_HOSTED_FAILURE " + JSON.stringify({
      phase: "runner_setup", code: "RUNNER_SETUP_FAILED", at: new Date().toISOString(), primary: true,
    }));
    process.exitCode = 1;
  });
}

module.exports = { planWorkload, superviseWorkload, runSupervisor };
