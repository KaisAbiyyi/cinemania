/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
/**
 * CINE-021 PostgreSQL capacity qualification on a realistic multi-process topology.
 *
 * Emulates the hosted Supabase session-pooler budget (15 server sessions) with a
 * per-role CONNECTION LIMIT 15 on the dedicated CINE-021 container (127.0.0.1:55440,
 * label cinematch.task=CINE-021). Runs N production-mode Next.js processes
 * (CINEMATCH_PG_POOL_MAX=2, the session-pooler default) plus the REAL outbox worker, applies
 * mixed synthetic traffic, samples pg_stat_activity, then checks degradation and transaction
 * consistency. Limit emulation is NOT Supavisor: it models the session budget, not pooler internals.
 *
 * Usage: CINE021_ADV_PGPASSWORD=... node tests/local-supabase/cine021-capacity-qualification.cjs [--apps=1,6,8] [--seconds=8]
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "../..");
const { Client } = require(path.join(REPO, "node_modules", "pg"));
const CONTAINER = "cine021-isolated-adv";
const PG_PORT = 55440;
const PASSWORD = process.env.CINE021_ADV_PGPASSWORD || "";
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split("=")[1];
const TOPOLOGIES = arg("apps", "1,6,8").split(",").map(Number);
const SECONDS = Number(arg("seconds", "8"));
const CONCURRENCY_PER_APP = Number(arg("concurrency", "24"));
const LIMIT = 15;
const BASE_PORT = 3300;
const SECRET = "cine021-cap-" + crypto.randomBytes(24).toString("hex");
const JWT_SECRET = "cine021-cap-jwt-" + crypto.randomBytes(24).toString("hex");
const MIGRATIONS = ["001_create_room_schema.sql", "002_guest_capability_sessions.sql", "003_round_roster_freeze.sql", "004_vote_operation_idempotency.sql", "005_realtime_authorization.sql", "006_cinematch_security_hardening.sql"];

const adminCfg = (database = "postgres") => ({ host: "127.0.0.1", port: PG_PORT, user: "supabase_admin", password: PASSWORD, database });
const ownerCfg = (database) => ({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: PASSWORD, database });

function assertContainer() {
  assert.equal(execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "cinematch.task"}}', CONTAINER], { encoding: "utf8" }).trim(), "CINE-021");
  assert(PASSWORD, "CINE021_ADV_PGPASSWORD required");
}

async function createDb() {
  const name = "cinematch_adv_" + crypto.randomBytes(8).toString("hex");
  const a = new Client(adminCfg()); await a.connect();
  await a.query(`CREATE DATABASE "${name}" OWNER postgres`); await a.end();
  const o = new Client(ownerCfg(name)); await o.connect();
  await o.query(`CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated; CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE IF NOT EXISTS realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, topic text); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;`);
  await o.query("BEGIN;\n" + MIGRATIONS.map((f) => fs.readFileSync(path.join(REPO, "src/db/migrations", f), "utf8")).join("\n") + "\nCOMMIT;");
  await o.end();
  return name;
}
async function dropDb(name) {
  const a = new Client(adminCfg()); await a.connect();
  try { await a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await a.end(); }
}

function spawnProc(cmd, args, env) {
  const child = spawn(cmd, args, { cwd: REPO, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
  child.getLog = () => log; return child;
}
const nextBin = path.join(REPO, "node_modules", "next", "dist", "bin", "next");
const tsxBin = path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs");

async function waitUp(port) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/rooms/00000000-0000-4000-8000-000000000000`); if ([400, 401, 404].includes(r.status)) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("app did not start on " + port);
}

function req(base, method, p, { cookie, json, ip } = {}) {
  const headers = { origin: base, "x-vercel-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  let body; if (json !== undefined) { body = JSON.stringify(json); headers["content-type"] = "application/json"; }
  return fetch(base + p, { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(30000) })
    .then(async (r) => ({ status: r.status, retryAfter: r.headers.get("retry-after"), text: await r.text(), cookies: (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]) }))
    .catch((e) => ({ status: 0, error: e.name }));
}
const randIp = () => `${crypto.randomInt(1, 223)}.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;

async function runTopology(apps) {
  const db = await createDb();
  const url = `postgresql://postgres:${PASSWORD}@127.0.0.1:${PG_PORT}/${db}`;
  const mon = new Client(adminCfg(db)); await mon.connect();
  await mon.query(`ALTER ROLE postgres CONNECTION LIMIT ${LIMIT}`);
  // A fake always-OK provider so the real worker can run.
  const fake = http.createServer((q, s) => { q.resume(); s.statusCode = 204; s.end(); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  const fakePort = fake.address().port;
  const base = { DATABASE_URL: url, CINEMATCH_CAPABILITY_SECRET: SECRET, SUPABASE_JWT_SECRET: JWT_SECRET, CINEMATCH_PG_POOL_MAX: "2", TMDB_API_RAT: "synthetic-not-a-credential" };
  const procs = [];
  const bases = [];
  for (let i = 0; i < apps; i++) {
    const port = BASE_PORT + i; const b = `http://127.0.0.1:${port}`; bases.push(b);
    procs.push(spawnProc(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], { ...base, NODE_ENV: "production", VERCEL: "1", CINEMATCH_APP_ORIGIN: b }));
  }
  const worker = spawnProc(process.execPath, [tsxBin, "--conditions=react-server", "scripts/realtime-worker.ts"], { ...base, NODE_ENV: "development", CINEMATCH_ALLOW_LOCAL_REALTIME: "true", SUPABASE_URL: `http://127.0.0.1:${fakePort}`, SUPABASE_SECRET_KEY: "synthetic-worker-key", CINEMATCH_OUTBOX_POLL_MS: "500" });
  procs.push(worker);
  const out = { apps, limit: LIMIT };
  try {
    // Start sequentially-ish: waitUp itself opens connections, keep within budget by waiting for each.
    for (let i = 0; i < apps; i++) await waitUp(BASE_PORT + i);
    await new Promise((r) => setTimeout(r, 1500));
    // Pool usage in the app only starts at first DB call; probe each app once (also confirms cold start works at this topology).
    const samples = [];
    let stopSampling = false;
    const sampler = (async () => {
      while (!stopSampling) {
        const r = await mon.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename='postgres'");
        samples.push(r.rows[0].n);
        await new Promise((x) => setTimeout(x, 100));
      }
    })();
    const rooms = []; // {base, id, code, cookie}
    const tally = {}; const raKinds = new Set(); let leaked = 0; let created = 0;
    const record = (r) => {
      tally[r.status] = (tally[r.status] || 0) + 1;
      if (r.status === 503) {
        raKinds.add(r.retryAfter);
        if (/too many|role|postgres|EMAXCONN|53300|connection/i.test(r.text)) leaked++;
      }
    };
    const stopAt = Date.now() + SECONDS * 1000;
    const loop = async (b) => {
      while (Date.now() < stopAt) {
        const roll = Math.random(); const ip = randIp();
        let r;
        if (roll < 0.35 || rooms.length === 0) {
          r = await req(b, "POST", "/api/rooms", { json: {}, ip });
          if (r.status === 201) { created++; const d = JSON.parse(r.text); rooms.push({ b, id: d.room.roomId, code: d.room.code, cookie: r.cookies.join("; ") }); }
        } else if (roll < 0.65) {
          const x = rooms[crypto.randomInt(rooms.length)]; r = await req(x.b, "GET", `/api/rooms/${x.id}`, { cookie: x.cookie, ip });
        } else if (roll < 0.85) {
          const x = rooms[crypto.randomInt(rooms.length)]; r = await req(b, "POST", "/api/rooms/join", { json: { code: x.code }, ip });
        } else {
          const x = rooms[crypto.randomInt(rooms.length)]; r = await req(x.b, "POST", `/api/rooms/${x.id}/realtime-token`, { cookie: x.cookie, json: {}, ip });
        }
        record(r);
      }
    };
    const t0 = Date.now();
    await Promise.all(bases.flatMap((b) => Array.from({ length: CONCURRENCY_PER_APP }, () => loop(b))));
    const loadMs = Date.now() - t0;
    out.maxConnectionsDuringLoad = Math.max(...samples);
    out.samples = samples.length;
    // Post-load: wait past pg idleTimeout (10s) and observe idle connection release.
    await new Promise((r) => setTimeout(r, 13000));
    const idle = await mon.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename='postgres' AND pid <> pg_backend_pid()");
    stopSampling = true; await sampler;
    out.idleConnectionsAfter13s = idle.rows[0].n; // includes the worker's pool (min 0) and monitor excluded
    // Recovery + consistency
    const recov = await Promise.all(bases.map((b) => req(b, "POST", "/api/rooms", { json: {}, ip: randIp() })));
    out.recovery = recov.map((r) => r.status);
    await mon.query("ALTER ROLE postgres CONNECTION LIMIT -1");
    const roomsN = (await mon.query("SELECT count(*)::int n FROM public.rooms")).rows[0].n;
    const orphan = (await mon.query("SELECT count(*)::int n FROM public.rooms r WHERE NOT EXISTS (SELECT 1 FROM public.room_participants p WHERE p.room_id=r.id AND p.role='HOST')")).rows[0].n;
    const multiHost = (await mon.query("SELECT count(*)::int n FROM (SELECT room_id FROM public.room_participants WHERE role='HOST' GROUP BY room_id HAVING count(*)>1) x")).rows[0].n;
    const over5 = (await mon.query("SELECT count(*)::int n FROM (SELECT room_id FROM public.room_participants GROUP BY room_id HAVING count(*)>5) x")).rows[0].n;
    const hostMismatch = (await mon.query("SELECT count(*)::int n FROM public.rooms r WHERE r.host_participant_id IS DISTINCT FROM (SELECT participant_id FROM public.room_participants p WHERE p.room_id=r.id AND p.role='HOST' LIMIT 1)")).rows[0].n;
    const stuckPending = (await mon.query("SELECT count(*)::int n FROM public.room_events WHERE NOT dispatched AND NOT poison")).rows[0].n;
    out.statuses = tally; out.retryAfterOn503 = [...raKinds]; out.leakedDetailIn503 = leaked;
    out.created201 = created; out.recovery = out.recovery;
    out.roomsInDb = roomsN - recov.filter((r) => r.status === 201).length;
    out.orphanRooms = orphan; out.multiHostRooms = multiHost; out.roomsOver5 = over5; out.hostMismatch = hostMismatch;
    out.outboxPendingAfterWorker = stuckPending;
    out.requests = Object.values(tally).reduce((a, b) => a + b, 0); out.reqPerSec = Math.round(out.requests / (loadMs / 1000));
    out.noPlain500 = !tally[500]; out.noTransportErrors = !tally[0];
    out.workerLogHasSecrets = /synthetic-worker-key|postgresql:\/\//.test(worker.getLog());
    out.appLogHasSecrets = procs.slice(0, apps).some((p) => [PASSWORD, SECRET, JWT_SECRET].some((s) => p.getLog().includes(s)));
  } finally {
    await mon.query("ALTER ROLE postgres CONNECTION LIMIT -1").catch(() => {});
    for (const p of procs) p.kill();
    fake.close();
    await new Promise((r) => setTimeout(r, 2000));
    await mon.end().catch(() => {});
    await dropDb(db).catch((e) => console.error("cleanup failed", e.code));
  }
  return out;
}

(async () => {
  assertContainer();
  const all = [];
  for (const apps of TOPOLOGIES) {
    console.log(`--- topology: ${apps} app process(es) + 1 outbox worker, role limit ${LIMIT}`);
    const r = await runTopology(apps);
    const { samples: _s, ...rest } = r; // eslint-disable-line no-unused-vars
    console.log(JSON.stringify(rest));
    all.push(r);
  }
  const a = new Client(adminCfg()); await a.connect();
  const left = (await a.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'cinematch_adv_%'")).rows[0].n;
  const lim = (await a.query("SELECT rolconnlimit FROM pg_roles WHERE rolname='postgres'")).rows[0].rolconnlimit;
  await a.end();
  console.log(`Disposable databases remaining: ${left}; postgres role connection limit restored: ${lim}`);
  fs.writeFileSync(path.join(process.env.CINE021_EVIDENCE_DIR || process.cwd(), "cine021-capacity-results.json"), JSON.stringify(all.map(({ samples, ...r }) => r), null, 2));
})().catch((e) => { console.error("harness failure:", e && e.message); process.exitCode = 2; });
