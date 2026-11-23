/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { mkdtempSync, unlinkSync, rmdirSync } = require("node:fs");
const { createConnection } = require("node:net");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createInterface } = require("node:readline");
const { setTimeout: delay } = require("node:timers/promises");
const { Client } = require("pg");
const { loadHostedStaging, assertEmptyHostedApplication } = require("../../tests/hosted-supabase/environment.cjs");
const LEASE_KEY = "cinematch:hosted-qualification";
// Supavisor's tenant shutdown runs after the last subscriber disconnects, on a
// two-minute timer. A connected SQL monitor itself prevents that shutdown.
const POOLER_QUIET_WINDOW_MS = 135_000;
const SAFE_ERROR_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENETDOWN", "ENETUNREACH",
  "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN", "08000", "08001", "08003", "08006",
  "57P01", "57P02", "57P03", "53300", "57014", "55P03",
]);
const LOST_CONNECTION_CODES = new Set([
  "ECONNRESET", "EPIPE", "ENETDOWN", "ENETUNREACH", "08003", "08006", "57P01", "57P02",
]);

function safeCode(error, fallback) {
  return SAFE_ERROR_CODES.has(error?.code) ? error.code : fallback;
}

function createCapabilitySecret() {
  return randomBytes(32).toString("hex");
}

function launch(args, env, observe = () => {}) {
  const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const done = new Promise(resolve => {
    child.once("error", () => resolve(1));
    child.once("close", code => resolve(code ?? 1));
  });
  for (const name of ["stdout", "stderr"]) {
    const lines = createInterface({ input: child[name] });
    lines.on("line", line => {
      observe(line);
      process[name].write(line + "\n");
    });
  }
  return {
    done,
    async stop() {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return done;
      if (process.platform === "win32") {
        // The Playwright child may also own a Next process. Stop only this run's tree.
        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      } else {
        child.kill("SIGTERM");
        const forceStop = setTimeout(() => child.kill("SIGKILL"), 6000);
        forceStop.unref();
        void done.then(() => clearTimeout(forceStop));
      }
      return done;
    },
  };
}

async function readState(db) {
  return (await db.query(`SELECT
    (SELECT count(*)::int FROM public.rooms) AS rooms,
    (SELECT count(*)::int FROM public.room_participants) AS participants,
    (SELECT count(*)::int FROM public.votes) AS votes,
    (SELECT count(*)::int FROM public.room_events) AS events,
    (SELECT count(*)::int FROM public.room_events WHERE NOT dispatched AND NOT poison) AS pending,
    (SELECT count(*)::int FROM public.room_events WHERE poison) AS poison,
    (SELECT COALESCE(sum(retry_count), 0)::int FROM public.room_events) AS retries,
    (SELECT COALESCE(EXTRACT(EPOCH FROM clock_timestamp() - min(created_at)) * 1000, 0)::float8
       FROM public.room_events WHERE NOT dispatched AND NOT poison) AS oldest_pending_ms,
    (SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND pid <> pg_backend_pid()
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS advisory_locks,
    (SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS advisory_waiters,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()
       AND backend_type = 'client backend' AND state LIKE 'idle in transaction%') AS idle_transactions,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user
       AND backend_type = 'client backend' AND pid <> pg_backend_pid()) AS other_role_sessions,
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND usename = current_user
       AND backend_type = 'client backend' AND pid <> pg_backend_pid()
       AND state IS DISTINCT FROM 'idle') AS other_role_nonidle_sessions`)).rows[0];
}

function assertQuiescent(state) {
  for (const field of ["rooms", "participants", "votes", "events", "advisory_locks", "advisory_waiters", "idle_transactions", "other_role_nonidle_sessions"]) {
    if (state[field] !== 0) throw new Error("Staging isolation check failed: " + field);
  }
}

function assertClean(state) {
  assertQuiescent(state);
  if (state.other_role_sessions !== 0) throw new Error("Staging isolation check failed: other_role_sessions");
}

async function assertNoListeners(ports) {
  await Promise.all(ports.map(port => new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("Qualification port still listening: " + port));
    });
    socket.once("error", error => {
      if (error.code === "ECONNREFUSED") resolve();
      else reject(new Error("Unable to confirm qualification port is closed: " + port));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Qualification port probe timed out: " + port));
    });
  })));
}

async function main({
  loadStaging = loadHostedStaging,
  makeClient = config => new Client(config),
  startChild = launch,
  checkPorts = assertNoListeners,
  wait = delay,
  report = (label, value) => console.log(label + " " + JSON.stringify(value)),
  args = process.argv.slice(2),
} = {}) {
  // Fresh exact-project consent is mandatory and must be present before the credentials file is read.
  if (process.env.CINE018_STAGING_PROJECT !== "dmrbticnsczhyaiftrar") {
    throw new Error("Set CINE018_STAGING_PROJECT to the exact staging project for this invocation.");
  }
  if (!process.env.CINE018_STAGING_ENV_FILE) {
    throw new Error("Set CINE018_STAGING_ENV_FILE to the owner-designated credentials file.");
  }

  const staging = loadStaging();
  const env = { ...process.env, ...staging.appEnv };
  // Never inherit cloud-admin selectors or destructive-test consent from the caller.
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.SUPABASE_PROJECT_REF;
  delete env.SUPABASE_DB_PASSWORD;
  env.ALLOW_DESTRUCTIVE_PG_TESTS = "false";
  env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD = "false";
  // One application process serves up to five browser contexts. Keep its pool at
  // five and leave room in the hosted session-pooler budget for the inspector.
  env.CINEMATCH_PG_POOL_MAX = "5";
  env.CINEMATCH_REALTIME_DIAGNOSTICS = "1";
  // A new signing key per invocation prevents cross-run capability reuse.
  // Never print or persist this value.
  env.CINEMATCH_CAPABILITY_SECRET = createCapabilitySecret();
  env.NEXT_PUBLIC_SUPABASE_URL = staging.url;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = staging.stackEnv.ANON_KEY;
  env.TMDB_API_RAT = "cine026-staging-offline-mock-provider";
  env.NEXT_PUBLIC_TMDB_POSTER_URL = "https://image.tmdb.org/t/p";
  env.NEXT_PUBLIC_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
  env.NEXT_TELEMETRY_DISABLED = "1";

  // Do not preload the mock while Next.js invokes `tsc --showConfig`: the fixture's
  // diagnostic line would contaminate TypeScript's JSON output. The server needs it later.
  const buildEnv = { ...env };
  delete buildEnv.NODE_OPTIONS;
  const testEnv = { ...env, NODE_OPTIONS: "--require ./tests/fixtures/mock-tmdb.cjs" };
  const playwrightArgs = args;
  const workerQualification = playwrightArgs[0] === "--worker-qualification";
  if (workerQualification && playwrightArgs.length !== 1) throw new Error("Worker qualification accepts no Playwright options");
  const ports = workerQualification ? [3101, 3102] : [3065];
  await checkPorts(ports);
  // Invoke Playwright directly so Windows does not reinterpret forwarded options
  // through cmd.exe (notably regex grep filters containing `|`).
  const playwrightCli = path.join(path.dirname(require.resolve("playwright")), "cli.js");

  // One lease/monitor session, one inspector, one serial worker and up to five
  // app sessions. The owner must verify hosted capacity under this budget first.
  const db = makeClient({ ...staging.pgConfig, application_name: "cine026-hosted-supervisor", statement_timeout: 10000 });
  const counts = { capacity: 0, escapedReset: 0, checkedOutReset: 0, idleReset: 0, lockTimeout: 0, providerTransport: 0, providerStatus: 0 };
  const peaks = { pending: 0, poison: 0, retries: 0, oldest_pending_ms: 0, advisory_waiters: 0, idle_transactions: 0, other_role_sessions: 0 };
  function observe(line) {
    if (line.includes("[CINEMATCH_DB_CAPACITY]")) counts.capacity++;
    if (/uncaughtException:.*ECONNRESET/.test(line)) counts.escapedReset++;
    if (line.includes("[CINEMATCH_DB_CONNECTION_ERROR]") && line.includes('"code":"ECONNRESET"')) {
      if (line.includes('"phase":"checked_out"')) counts.checkedOutReset++;
      if (line.includes('"phase":"idle"')) counts.idleReset++;
    }
    if (line.includes('"category":"outbox_lock_timeout"')) counts.lockTimeout++;
    if (line.includes("[CINEMATCH_REALTIME_ATTEMPT_FAILURE] transport")) counts.providerTransport++;
    if (line.includes("[CINEMATCH_REALTIME_ATTEMPT_FAILURE] status")) counts.providerStatus++;
  }

  let phase;
  let worker;
  let monitor;
  let monitored = true;
  let firstFailure;
  let operation = "connect";
  let connectionLost = false;
  let leaseRelease = "not_acquired";
  let admitted = false;
  let stopping;
  let mockLogDirectory;
  let immediate;
  let final;
  let cleanupVerified = false;

  function record(failurePhase, error, fallback) {
    const failure = { phase: failurePhase, code: safeCode(error, fallback), at: new Date().toISOString() };
    const primary = firstFailure === undefined;
    firstFailure ??= failure;
    report("CINE026_HOSTED_FAILURE", { ...failure, primary });
  }

  async function attempt(failurePhase, fallback, action) {
    try {
      await action();
      return true;
    } catch (error) {
      record(failurePhase, error, fallback);
      return false;
    }
  }

  const stopWork = () => stopping ??= Promise.all([
    attempt("phase_stop", "CHILD_STOP_FAILED", () => phase?.stop()),
    attempt("worker_stop", "CHILD_STOP_FAILED", () => worker?.stop()),
  ]).then(results => results.every(Boolean));

  db.on("error", error => {
    connectionLost = true;
    record(operation, error, "SUPERVISOR_CONNECTION_FAILED");
    if (monitored && (phase || worker)) void stopWork();
  });

  async function runWork() {
    await db.connect();
    operation = "lease_acquire";
    leaseRelease = "unconfirmed";
    const lock = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [LEASE_KEY]);
    if (!lock.rows[0].acquired) {
      leaseRelease = "not_acquired";
      record(operation, null, "LEASE_BUSY");
      return;
    }
    operation = "preflight";
    await assertEmptyHostedApplication(db);
    assertClean(await readState(db));
    if (firstFailure) return;
    admitted = true;

    if (!workerQualification) {
      operation = "build";
      phase = startChild([require.resolve("next/dist/bin/next"), "build"], buildEnv, observe);
      const build = await phase.done;
      if (build !== 0) record(operation, null, "BUILD_FAILED");
      if (firstFailure) return;
      operation = "preflight";
      assertClean(await readState(db));
      if (firstFailure) return;
      mockLogDirectory = mkdtempSync(path.join(tmpdir(), "cine026-hosted-mock-"));
      testEnv.CINE026_MOCK_REQUEST_LOG = path.join(mockLogDirectory, "request-logs.json");

      let ready = false;
      operation = "worker_start";
      worker = startChild(["--conditions=react-server", "--import", "tsx", "scripts/realtime-worker.ts"], {
        ...env, CINEMATCH_PG_POOL_MAX: "1", CINEMATCH_OUTBOX_POLL_MS: "1000", NODE_OPTIONS: "",
      }, line => {
        observe(line);
        if (line === "Realtime outbox worker ready (autonomous polling).") ready = true;
      });
      const boot = await Promise.race([
        worker.done.then(() => false),
        (async () => {
          for (let i = 0; i < 150 && !ready && !firstFailure; i++) await wait(100);
          return ready;
        })(),
      ]);
      if (!boot) record(operation, null, "WORKER_NOT_READY");
      if (firstFailure) return;
    }
    // Restart qualification owns two app pools of at most two clients each,
    // two worker pools of at most two each, an inspector and the supervisor.
    operation = "monitor";
    phase = workerQualification
      ? startChild(["tests/local-supabase/two-instance-qualification.cjs", "--hosted-staging"], {
        ...buildEnv, CINEMATCH_PG_POOL_MAX: "2",
      }, observe)
      : startChild([playwrightCli, "test", "--config=playwright.cine026.staging.config.ts", ...playwrightArgs], testEnv, observe);
    monitor = (async () => {
      while (monitored) {
        const state = await readState(db);
        for (const key of Object.keys(peaks)) peaks[key] = Math.max(peaks[key], state[key]);
        await wait(3000);
      }
    })().catch(error => {
      connectionLost ||= LOST_CONNECTION_CODES.has(error?.code);
      record("monitor", error, "MONITOR_FAILED");
      void stopWork();
    });
    const completion = phase.done.then(code => ({ code, workerExited: false }));
    const outcome = worker
      ? await Promise.race([completion, worker.done.then(() => ({ code: 1, workerExited: true }))])
      : await completion;
    if (outcome.code !== 0) record("workload", null, outcome.workerExited ? "WORKER_EXITED" : "WORKLOAD_FAILED");
  }

  try {
    await runWork();
  } catch (error) {
    connectionLost ||= LOST_CONNECTION_CODES.has(error?.code);
    record(operation, error, "SUPERVISOR_OPERATION_FAILED");
  } finally {
    monitored = false;
    const stopped = await stopWork();
    await monitor;
    const portsClosed = admitted && stopped && await attempt("port_check", "PORTS_UNCONFIRMED", () => checkPorts(ports));
    if (admitted && !connectionLost) {
      operation = "shutdown_read";
      await attempt(operation, "SHUTDOWN_STATE_UNCONFIRMED", async () => {
        try {
          immediate = await readState(db);
        } catch (error) {
          connectionLost ||= LOST_CONNECTION_CODES.has(error?.code);
          throw error;
        }
        assertQuiescent(immediate);
      });
    }
    report("CINE026_HOSTED_SHUTDOWN", { counts, peaks, immediate, firstFailure });

    if (leaseRelease === "unconfirmed") {
      operation = "lease_release";
      const unlocked = !connectionLost && await attempt(operation, "LEASE_RELEASE_UNCONFIRMED", async () => {
        const unlock = await db.query("SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released", [LEASE_KEY]);
        if (unlock.rows[0].released !== true) throw new Error("Lease unlock was not acknowledged");
      });
      if (unlocked) leaseRelease = "released";
    }
    operation = "supervisor_close";
    const closed = await attempt(operation, "SUPERVISOR_CLOSE_UNCONFIRMED", () => db.end());
    if (portsClosed && (closed || connectionLost)) {
      // Owner exclusivity covers this readback after our SQL lease ends. Leave
      // the pooler quiet if retained sessions are visible or shutdown state is unknown.
      if (!immediate || immediate.other_role_sessions !== 0) await wait(POOLER_QUIET_WINDOW_MS);
      let audit;
      let auditFault = false;
      const inspected = await attempt("cleanup_audit", "CLEANUP_UNCONFIRMED", async () => {
        audit = makeClient({ ...staging.pgConfig, statement_timeout: 10000 });
        audit.on("error", error => {
          auditFault = true;
          record("cleanup_audit", error, "AUDIT_CONNECTION_FAILED");
        });
        await audit.connect();
        await audit.query("BEGIN READ ONLY");
        final = await readState(audit);
        await audit.query("COMMIT");
        assertClean(final);
      });
      const auditClosed = await attempt("audit_close", "AUDIT_CLOSE_UNCONFIRMED", () => audit?.end());
      cleanupVerified = inspected && auditClosed && !auditFault;
      if (cleanupVerified && leaseRelease === "unconfirmed") leaseRelease = "verified_absent";
    }
    if (mockLogDirectory) {
      await attempt("mock_cleanup", "MOCK_CLEANUP_FAILED", () => {
        try {
          unlinkSync(testEnv.CINE026_MOCK_REQUEST_LOG);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        rmdirSync(mockLogDirectory);
      });
    }
  }
  const result = { counts, peaks, final, firstFailure, leaseRelease, cleanupVerified };
  report("CINE026_HOSTED_METRICS", result);
  return { ...result, exitCode: firstFailure || !cleanupVerified || leaseRelease !== "released" ? 1 : 0 };
}

if (require.main === module) {
  main().then(({ exitCode }) => { process.exitCode = exitCode; }).catch((error) => {
    console.error("CINE026_HOSTED_FAILURE " + JSON.stringify({
      phase: "runner_setup", code: safeCode(error, "RUNNER_SETUP_FAILED"), at: new Date().toISOString(), primary: true,
    }));
    process.exitCode = 1;
  });
}

module.exports = { createCapabilitySecret, assertQuiescent, assertClean, main };
