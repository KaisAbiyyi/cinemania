/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createInterface } = require("node:readline");
const { setTimeout: delay } = require("node:timers/promises");
const { Client } = require("pg");
const { loadHostedStaging, assertEmptyHostedApplication } = require("../../tests/hosted-supabase/environment.cjs");

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
       AND backend_type = 'client backend' AND pid <> pg_backend_pid()) AS other_role_sessions`)).rows[0];
}

function assertClean(state) {
  for (const field of ["rooms", "participants", "votes", "events", "advisory_locks", "advisory_waiters", "idle_transactions", "other_role_sessions"]) {
    if (state[field] !== 0) throw new Error("Staging isolation check failed: " + field);
  }
}

async function main() {
  // Fresh exact-project consent is mandatory and must be present before the credentials file is read.
  if (process.env.CINE018_STAGING_PROJECT !== "dmrbticnsczhyaiftrar") {
    throw new Error("Set CINE018_STAGING_PROJECT to the exact staging project for this invocation.");
  }
  if (!process.env.CINE018_STAGING_ENV_FILE) {
    throw new Error("Set CINE018_STAGING_ENV_FILE to the owner-designated credentials file.");
  }

  const staging = loadHostedStaging();
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
  const playwrightArgs = process.argv.slice(2);
  // Invoke Playwright directly so Windows does not reinterpret forwarded options
  // through cmd.exe (notably regex grep filters containing `|`).
  const playwrightCli = require("node:path").join(require("node:path").dirname(require.resolve("playwright")), "cli.js");

  // One lease/monitor session, one inspector, one serial worker and up to five
  // app sessions. The owner must verify hosted capacity under this budget first.
  const db = new Client({ ...staging.pgConfig, application_name: "cine026-hosted-supervisor", statement_timeout: 10000 });
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
  let supervisorFailed = false;
  db.on("error", () => {
    supervisorFailed = true;
    void phase?.stop();
  });
  try {
    await db.connect();
    const lock = await db.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", ["cinematch:hosted-qualification"]);
    if (!lock.rows[0].acquired) throw new Error("Hosted staging qualification lease is already held");
    await assertEmptyHostedApplication(db);
    assertClean(await readState(db));
    phase = launch([require.resolve("next/dist/bin/next"), "build"], buildEnv, observe);
    const build = await phase.done;
    if (build !== 0 || supervisorFailed) return build || 1;
    assertClean(await readState(db));

    let ready = false;
    worker = launch(["--conditions=react-server", "--import", "tsx", "scripts/realtime-worker.ts"], {
      ...env, CINEMATCH_PG_POOL_MAX: "1", CINEMATCH_OUTBOX_POLL_MS: "1000", NODE_OPTIONS: "",
    }, line => {
      observe(line);
      if (line === "Realtime outbox worker ready (autonomous polling).") ready = true;
    });
    const boot = await Promise.race([
      worker.done.then(() => false),
      (async () => {
        for (let i = 0; i < 150 && !ready; i++) await delay(100);
        return ready;
      })(),
    ]);
    if (!boot || supervisorFailed) throw new Error("Independent worker did not reach readiness");
    monitor = (async () => {
      while (monitored) {
        const state = await readState(db);
        for (const key of Object.keys(peaks)) peaks[key] = Math.max(peaks[key], state[key]);
        await delay(3000);
      }
    })().catch(() => {
      supervisorFailed = true;
      void phase?.stop();
    });
    phase = launch([playwrightCli, "test", "--config=playwright.cine026.staging.config.ts", ...playwrightArgs], testEnv, observe);
    const outcome = await Promise.race([
      phase.done.then(code => ({ code, workerExited: false })),
      worker.done.then(() => ({ code: 1, workerExited: true })),
    ]);
    supervisorFailed ||= outcome.workerExited;
    monitored = false;
    await monitor;
    await phase.stop();
    await worker.stop();
    // A session-pooler can take a short time to observe the closed child sockets.
    let final;
    for (let i = 0; i < 10; i++) {
      final = await readState(db);
      if (final.other_role_sessions === 0) break;
      await delay(250);
    }
    console.log("CINE026_HOSTED_METRICS " + JSON.stringify({ counts, peaks, final, supervisorFailed }));
    assertClean(final);
    return outcome.code || Number(supervisorFailed);
  } finally {
    monitored = false;
    await phase?.stop();
    await worker?.stop();
    await monitor;
    await db.end();
  }
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch((error) => {
    // Keep database error details, but never serialize environment or connection config.
    console.error("CINE-026 hosted staging qualification BLOCKED/FAILED:", error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { createCapabilitySecret };
