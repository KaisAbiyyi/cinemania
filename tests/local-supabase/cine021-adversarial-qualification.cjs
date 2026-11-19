/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
/**
 * CINE-021 bounded adversarial qualification (synthetic fixtures, loopback only).
 *
 * Drives REAL production-mode Next.js processes (`next start`) over HTTP against a
 * DISPOSABLE database in the dedicated CINE-021 PostgreSQL container
 * (label cinematch.task=CINE-021, bound to 127.0.0.1:55440). It never touches
 * hosted Supabase, the shared GH-52 stack, or any non-synthetic data.
 *
 * Required env: CINE021_ADV_PGPASSWORD (never printed). Run `next build` first.
 * Usage: node tests/local-supabase/cine021-adversarial-qualification.cjs [--only=name,name]
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFileSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "../..");
const { Client, Pool } = require(path.join(REPO, "node_modules", "pg"));

const CONTAINER = "cine021-isolated-adv";
const PG_PORT = 55440;
const PG_PASSWORD = process.env.CINE021_ADV_PGPASSWORD || "";
const PORT_A = 3201; // plain self-hosted style (shared network bucket)
const PORT_V = 3202; // VERCEL=1 (trusted x-vercel-forwarded-for)
const SECRET = "cine021-adv-" + crypto.randomBytes(24).toString("hex");
const JWT_SECRET = "cine021-adv-jwt-" + crypto.randomBytes(24).toString("hex");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const MIGRATIONS = [
  "001_create_room_schema.sql",
  "002_guest_capability_sessions.sql",
  "003_round_roster_freeze.sql",
  "004_vote_operation_idempotency.sql",
  "005_realtime_authorization.sql",
  "006_cinematch_security_hardening.sql",
];

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
async function check(name, fn) {
  if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return;
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : "");
  } catch (e) {
    record(name, false, String(e && e.message ? e.message : e).slice(0, 400));
  }
}

function assertContainer() {
  const label = execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "cinematch.task"}}', CONTAINER], { encoding: "utf8" }).trim();
  assert.equal(label, "CINE-021");
  const ports = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", CONTAINER], { encoding: "utf8" }));
  assert.deepEqual(ports["5432/tcp"], [{ HostIp: "127.0.0.1", HostPort: String(PG_PORT) }]);
  assert(PG_PASSWORD, "CINE021_ADV_PGPASSWORD is required");
}

const admin = () => new Client({ host: "127.0.0.1", port: PG_PORT, user: "supabase_admin", password: PG_PASSWORD, database: "postgres" });

async function createDatabase() {
  const name = "cinematch_adv_" + crypto.randomBytes(8).toString("hex");
  const a = admin();
  await a.connect();
  await a.query(`CREATE DATABASE "${name}" OWNER postgres`);
  await a.end();
  const owner = new Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: PG_PASSWORD, database: name });
  await owner.connect();
  await owner.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE SCHEMA IF NOT EXISTS realtime;
    GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
    CREATE TABLE IF NOT EXISTS realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, topic text);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT ON realtime.messages TO anon, authenticated;
    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;
  `);
  const sql = MIGRATIONS.map((f) => fs.readFileSync(path.join(REPO, "src/db/migrations", f), "utf8")).join("\n");
  await owner.query("BEGIN;\n" + sql + "\nCOMMIT;");
  await owner.end();
  return name;
}

async function dropDatabase(name) {
  const a = admin();
  await a.connect();
  try {
    await a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await a.end();
  }
}

function startNext(port, env) {
  const nextBin = path.join(REPO, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: REPO,
    env: { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  child.getLog = () => log;
  return child;
}

async function waitUp(port) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/rooms/00000000-0000-4000-8000-000000000000`);
      if ([400, 401, 404].includes(r.status)) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("server did not start on " + port);
}

function setCookies(res) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  return raw.map((c) => c.split(";")[0]);
}

async function call(base, method, p, { headers = {}, body, cookie, origin = base, json } = {}) {
  const h = { ...headers };
  if (origin !== null && h.origin === undefined) h.origin = origin;
  if (h.origin === null) delete h.origin;
  if (cookie) h.cookie = cookie;
  let payload = body;
  if (json !== undefined) { payload = JSON.stringify(json); h["content-type"] = "application/json"; }
  const res = await fetch(base + p, { method, headers: h, body: payload, redirect: "manual" });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, headers: res.headers, data, cookies: setCookies(res), text };
}

// Hand-rolled mint, independent of src/ (verifies the documented token format).
function mintCookieToken({ roomId, participantId, role = "MEMBER", gen = 1, iat, exp, secret = SECRET, sig }) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { v: 1, sid: crypto.randomUUID(), rid: roomId, pid: participantId, role, gen, iat: iat ?? now, exp: exp ?? now + 3600 };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sig ?? crypto.createHmac("sha256", secret).update(`v1.${payload}`).digest("base64url");
  return `v1.${payload}.${signature}`;
}

const cookieName = (roomId) => `cm_guest_${roomId}`;
const randomUuid = () => crypto.randomUUID();
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[crypto.randomInt(31)]).join("");

function rawPost(port, p, headers, writeBody) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "POST", headers, agent: false }, (res) => {
      let t = "";
      res.on("data", (d) => { t += d; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: t }));
    });
    req.on("error", (e) => resolve({ status: 0, error: e.code || e.message }));
    writeBody(req);
  });
}

async function main() {
  assertContainer();
  const dbName = await createDatabase();
  const url = `postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${dbName}`;
  const common = {
    DATABASE_URL: url,
    CINEMATCH_CAPABILITY_SECRET: SECRET,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    CINEMATCH_PG_POOL_MAX: "2",
    TMDB_API_RAT: "synthetic-not-a-credential",
  };
  const A = `http://127.0.0.1:${PORT_A}`;
  const V = `http://127.0.0.1:${PORT_V}`;
  const procs = [
    startNext(PORT_A, { ...common, VERCEL: "" }),
    startNext(PORT_V, { ...common, VERCEL: "1", CINEMATCH_APP_ORIGIN: V }),
  ];
  const dbAdmin = new Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: PG_PASSWORD, database: dbName });
  await dbAdmin.connect();
  const resetQuota = () => dbAdmin.query("TRUNCATE cinematch_private.room_request_limits");
  const count = async (sql, args) => Number((await dbAdmin.query(sql, args)).rows[0].n);
  const makeRoom = async (base, displayName) => {
    await resetQuota();
    const r = await call(base, "POST", "/api/rooms", { json: displayName ? { displayName } : {} });
    assert.equal(r.status, 201, "room create failed: " + r.status + " " + r.text.slice(0, 200));
    return { roomId: r.data.room.roomId, code: r.data.room.code, participantId: r.data.viewer.participantId, cookie: r.cookies.join("; "), body: r.data };
  };

  try {
    await Promise.all([waitUp(PORT_A), waitUp(PORT_V)]);

    // ───────────────────────── S1 brute-force join ─────────────────────────
    await check("S1 brute-force join is capped (30/min/network) with 429+Retry-After", async () => {
      await resetQuota();
      const target = await makeRoom(A);
      await resetQuota();
      const statuses = [];
      for (let i = 0; i < 40; i++) {
        const r = await call(A, "POST", "/api/rooms/join", { json: { code: randomCode() } });
        statuses.push(r.status);
        if (r.status === 429) {
          assert.equal(r.cookies.length, 0, "429 must not set cookies");
          assert.match(r.headers.get("cache-control") || "", /no-store/);
          const ra = Number(r.headers.get("retry-after"));
          assert(ra >= 1 && ra <= 60, "Retry-After out of range: " + ra);
        }
      }
      const allowed = statuses.filter((s) => s !== 429).length;
      assert.equal(allowed, 30, "expected exactly 30 admitted attempts, got " + allowed);
      assert(statuses.slice(30).every((s) => s === 429));
      // Real invite code is also blocked once the bucket is exhausted: no bypass.
      const real = await call(A, "POST", "/api/rooms/join", { json: { code: target.code } });
      assert.equal(real.status, 429);
      return `statuses admitted=30, rest 429 (distinct admitted statuses: ${[...new Set(statuses.slice(0, 30))].join(",")})`;
    });

    await check("S1b join: unknown-code responses carry no existence oracle", async () => {
      await resetQuota();
      const room = await makeRoom(A);
      await resetQuota();
      const unknown = await call(A, "POST", "/api/rooms/join", { json: { code: "ZZZZZZ" } });
      const sh = await call(A, "POST", "/api/rooms/join", { json: { roomId: room.roomId } }); // UUID without cookie
      const rnd = await call(A, "POST", "/api/rooms/join", { json: { roomId: randomUuid() } });
      assert.equal(sh.status, rnd.status, "UUID existing vs random must be indistinguishable without a capability");
      assert.equal(sh.status, 401);
      assert([400, 404].includes(unknown.status));
      assert.deepEqual(unknown.cookies, []);
      return `unknown code=${unknown.status}; uuid-existing=${sh.status}; uuid-random=${rnd.status}`;
    });

    // ───────────────────────── S2 mass create ─────────────────────────
    await check("S2 mass create: sequential 25 → 20×201 then 429", async () => {
      await resetQuota();
      const before = await count("SELECT count(*)::int n FROM public.rooms");
      const st = [];
      for (let i = 0; i < 25; i++) st.push((await call(A, "POST", "/api/rooms", { json: {} })).status);
      assert.equal(st.filter((s) => s === 201).length, 20);
      assert(st.filter((s) => s === 429).length === 5);
      assert.equal(await count("SELECT count(*)::int n FROM public.rooms") - before, 20);
    });

    await check("S2b mass create: 150 concurrent requests admit exactly 20 (atomic quota), zero 5xx", async () => {
      await resetQuota();
      const before = await count("SELECT count(*)::int n FROM public.rooms");
      const rs = await Promise.all(Array.from({ length: 150 }, () => call(A, "POST", "/api/rooms", { json: {} })));
      const by = {};
      rs.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
      assert.equal(by[201], 20, JSON.stringify(by));
      assert.equal(by[429], 130, JSON.stringify(by));
      assert.equal(await count("SELECT count(*)::int n FROM public.rooms") - before, 20);
      return JSON.stringify(by);
    });

    await check("S2c quota is per trusted network on Vercel (x-vercel-forwarded-for), IPv6 grouped by /64", async () => {
      await resetQuota();
      const ipA = "203.0.113.10", ipB = "203.0.113.11";
      for (let i = 0; i < 20; i++) assert.equal((await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": ipA } })).status, 201);
      assert.equal((await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": ipA } })).status, 429);
      assert.equal((await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": ipB } })).status, 201, "other IP unaffected");
      // IPv6: different interface IDs in one /64 share a bucket; different /64 do not.
      for (let i = 0; i < 20; i++) assert.equal((await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": `2001:db8:1:2::${i + 1}` } })).status, 201);
      assert.equal((await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": "2001:db8:1:2:ffff::9" } })).status, 429);
      assert.equal((await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": "2001:db8:1:3::1" } })).status, 201);
      // Client-supplied x-forwarded-for / x-real-ip must NOT mint fresh buckets.
      await resetQuota();
      for (let i = 0; i < 20; i++) await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": ipA } });
      const spoof = await call(V, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": ipA, "x-forwarded-for": "198.51.100.77", "x-real-ip": "198.51.100.78", forwarded: "for=198.51.100.79" } });
      assert.equal(spoof.status, 429);
      // Non-Vercel instance ignores the header entirely (shared bucket, no spoof).
      await resetQuota();
      for (let i = 0; i < 20; i++) assert.equal((await call(A, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": `198.51.100.${i + 1}` } })).status, 201);
      assert.equal((await call(A, "POST", "/api/rooms", { json: {}, headers: { "x-vercel-forwarded-for": "198.51.100.200" } })).status, 429);
    });

    // ───────────────────────── S3 forged / expired capabilities ─────────────────────────
    await check("S3 forged, tampered, expired, wrong-room, replayed-after-rotation capabilities are rejected", async () => {
      const room = await makeRoom(A, "Host");
      const other = await makeRoom(A, "Other");
      const goodCookie = room.cookie;
      const good = await call(A, "GET", `/api/rooms/${room.roomId}`, { cookie: goodCookie });
      assert.equal(good.status, 200);
      const now = Math.floor(Date.now() / 1000);
      const cases = {
        "wrong secret": mintCookieToken({ roomId: room.roomId, participantId: room.participantId, role: "HOST", secret: "x".repeat(32) }),
        "bad signature": mintCookieToken({ roomId: room.roomId, participantId: room.participantId, role: "HOST", sig: "A".repeat(43) }),
        "expired (valid sig)": mintCookieToken({ roomId: room.roomId, participantId: room.participantId, role: "HOST", iat: now - 7300, exp: now - 100 }),
        "not-yet-valid (iat in far future)": mintCookieToken({ roomId: room.roomId, participantId: room.participantId, role: "HOST", iat: now + 86400, exp: now + 90000 }),
        "ms timestamps": mintCookieToken({ roomId: room.roomId, participantId: room.participantId, role: "HOST", iat: Date.now(), exp: Date.now() + 3600000 }),
        "other room's rid (valid sig)": mintCookieToken({ roomId: other.roomId, participantId: other.participantId, role: "HOST" }),
        "unknown participant (valid sig)": mintCookieToken({ roomId: room.roomId, participantId: randomUuid(), role: "HOST" }),
        "gen 0 (valid sig)": mintCookieToken({ roomId: room.roomId, participantId: room.participantId, role: "HOST", gen: 0 }),
        "empty": "",
        "alg-none style": "v1." + Buffer.from(JSON.stringify({ v: 1, rid: room.roomId, pid: room.participantId, role: "HOST" })).toString("base64url") + ".",
        "oversized (5000 chars)": "v1." + "A".repeat(5000) + ".AAAA",
        "no version": goodCookie.split("=")[1].split(".").slice(1).join("."),
      };
      const seen = {};
      for (const [label, token] of Object.entries(cases)) {
        const r = await call(A, "GET", `/api/rooms/${room.roomId}`, { cookie: `${cookieName(room.roomId)}=${token}` });
        assert([400, 401, 403].includes(r.status), `${label}: expected 4xx auth failure, got ${r.status}`);
        const m = await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { cookie: `${cookieName(room.roomId)}=${token}`, json: {} });
        assert([400, 401, 403].includes(m.status), `${label}: token route got ${m.status}`);
        assert.deepEqual(m.cookies, [], `${label}: must not issue cookies`);
        seen[label] = r.status;
      }
      // Cookie for room B presented as room A's cookie name: bound rid mismatch.
      // Replay after rotation: old cookie must die once generation advances.
      await resetQuota();
      const rot = await call(A, "POST", "/api/guest/session/rotate", { cookie: goodCookie, json: { roomId: room.roomId } });
      assert.equal(rot.status, 200, "rotate " + rot.status);
      const replay = await call(A, "GET", `/api/rooms/${room.roomId}`, { cookie: goodCookie });
      assert.equal(replay.status, 401, "old-generation cookie must fail after rotation");
      const fresh = await call(A, "GET", `/api/rooms/${room.roomId}`, { cookie: rot.cookies.join("; ") });
      assert.equal(fresh.status, 200);
      return JSON.stringify(seen);
    });

    await check("S3b realtime JWT: claims scoped to room/participant, ≤60s TTL, forged requests get none", async () => {
      const room = await makeRoom(A, "Host");
      await resetQuota();
      const ok = await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { cookie: room.cookie, json: {} });
      assert.equal(ok.status, 200);
      const [h, p, s] = ok.data.token.split(".");
      const claims = JSON.parse(Buffer.from(p, "base64url").toString());
      assert.equal(JSON.parse(Buffer.from(h, "base64url").toString()).alg, "HS256");
      assert.equal(claims.room_id, room.roomId);
      assert.equal(claims.sub, room.participantId);
      assert.equal(claims.iss, "cinematch");
      assert.equal(claims.role, "authenticated");
      assert(claims.exp - claims.iat <= 60, "TTL " + (claims.exp - claims.iat));
      const expectSig = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
      assert.equal(s, expectSig, "signed with configured JWT secret only");
      assert(!JSON.stringify(claims).includes(SECRET));
      assert.match(ok.headers.get("cache-control") || "", /no-store/);
      const noCookie = await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { json: {} });
      assert.equal(noCookie.status, 401);
      assert(!/token"/.test(noCookie.text));
      return `ttl=${claims.exp - claims.iat}s`;
    });

    await check("S3c per-guest realtime-token quota 12/min isolates guests; forged cookies cannot mint buckets", async () => {
      const room = await makeRoom(A, "Host");
      await resetQuota();
      const st = [];
      for (let i = 0; i < 14; i++) st.push((await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { cookie: room.cookie, json: {} })).status);
      assert.equal(st.filter((s) => s === 200).length, 12, st.join());
      assert.deepEqual(st.slice(12), [429, 429]);
      // Same network, different (anonymous) caller is on the network quota (24) and not blocked by guest bucket.
      const anon = await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { json: {} });
      assert.equal(anon.status, 401);
      // 300 garbage/forged cookies must collapse into the network bucket (bounded row count).
      await resetQuota();
      for (let i = 0; i < 300; i++) {
        await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { cookie: `${cookieName(room.roomId)}=${mintCookieToken({ roomId: room.roomId, participantId: randomUuid(), secret: "y".repeat(32) })}`, json: {} });
      }
      const rows = await count("SELECT count(*)::int n FROM cinematch_private.room_request_limits");
      assert.equal(rows, 1, "forged cookies created " + rows + " buckets");
    });

    // ───────────────────────── S4 cross-room IDOR ─────────────────────────
    await check("S4 cross-room IDOR: room A capability cannot read/write room B over HTTP", async () => {
      const a = await makeRoom(A, "Alice");
      const b = await makeRoom(A, "Bob");
      await resetQuota();
      const probes = [
        ["GET", `/api/rooms/${b.roomId}`, undefined],
        ["POST", `/api/rooms/${b.roomId}/realtime-token`, {}],
        ["POST", `/api/rooms/${b.roomId}/start`, {}],
        ["POST", `/api/rooms/${b.roomId}/leave`, {}],
        ["PUT", `/api/rooms/${b.roomId}/filters`, { filters: {} }],
        ["POST", `/api/rooms/${b.roomId}/votes`, { candidateId: 1, vote: "LIKE", operationId: randomUuid() }],
        ["GET", `/api/rooms/${b.roomId}/events?since=0`, undefined],
        ["GET", `/api/rooms/${b.roomId}/deck`, undefined],
        ["POST", "/api/guest/host-check", { roomId: b.roomId }],
        ["POST", "/api/guest/session/rotate", { roomId: b.roomId }],
        ["POST", "/api/rooms/join", { roomId: b.roomId }],
      ];
      const seen = [];
      for (const [m, p, body] of probes) {
        // Attacker holds ONLY room A's cookie and also forges B's cookie name with A's token value.
        const aTok = a.cookie.split("=")[1];
        for (const cookie of [a.cookie, `${cookieName(b.roomId)}=${aTok}`]) {
          const r = await call(A, m, p, { cookie, json: body });
          assert(![200, 201, 204].includes(r.status), `${m} ${p.split("/").slice(3).join("/")} leaked success ${r.status}`);
          assert(r.status < 500, `${m} ${p} 5xx ${r.status}`);
          assert(!r.text.includes(b.code) && !r.text.includes(b.participantId), `${m} ${p} leaked B identifiers`);
          assert.deepEqual(r.cookies, [], `${m} ${p} issued cookie`);
          seen.push(r.status);
        }
        const hostBefore = await count("SELECT count(*)::int n FROM public.rooms WHERE id=$1 AND status='LOBBY'", [b.roomId]);
        assert.equal(hostBefore, 1, "room B state mutated");
      }
      // B still works for B.
      assert.equal((await call(A, "GET", `/api/rooms/${b.roomId}`, { cookie: b.cookie })).status, 200);
      assert.equal(await count("SELECT count(*)::int n FROM public.room_participants WHERE room_id=$1", [b.roomId]), 1);
      return `statuses=${[...new Set(seen)].sort().join(",")}`;
    });

    await check("S4b random-UUID room probes without a capability are uniform (no existence oracle)", async () => {
      const b = await makeRoom(A, "Bob");
      await resetQuota();
      const a = await call(A, "GET", `/api/rooms/${b.roomId}`);
      const z = await call(A, "GET", `/api/rooms/${randomUuid()}`);
      assert.equal(a.status, z.status);
      assert.equal(JSON.stringify(a.data), JSON.stringify(z.data));
    });

    await check("S4c host-only action: MEMBER cannot start or change filters (server-derived role, body role ignored)", async () => {
      const host = await makeRoom(A, "Host");
      await resetQuota();
      const j = await call(A, "POST", "/api/rooms/join", { json: { code: host.code, displayName: "Mallory" } });
      assert.equal(j.status, 200);
      const memberCookie = j.cookies.join("; ");
      const start = await call(A, "POST", `/api/rooms/${host.roomId}/start`, { cookie: memberCookie, json: { role: "HOST", isHost: true } });
      assert.equal(start.status, 403, "start by member got " + start.status);
      const filt = await call(A, "PUT", `/api/rooms/${host.roomId}/filters`, { cookie: memberCookie, json: { role: "HOST" } });
      assert([400, 403].includes(filt.status), "filters by member got " + filt.status);
      assert.equal(await count("SELECT count(*)::int n FROM public.rooms WHERE id=$1 AND status='LOBBY'", [host.roomId]), 1);
    });

    // ───────────────────────── S5 CSRF ─────────────────────────
    await check("S5 CSRF: cross-site/null/missing/userinfo/path origins are rejected before quota or mutation", async () => {
      await resetQuota();
      const before = await count("SELECT count(*)::int n FROM public.rooms");
      const bad = [
        { origin: "https://evil.example" },
        { origin: "null" },
        { origin: `${A}/path` },
        { origin: `http://127.0.0.1:${PORT_A}@evil.example` },
        { origin: `http://evil.127.0.0.1:${PORT_A}` },
        { origin: `http://127.0.0.1:${PORT_A + 1}` },
        { origin: "https://127.0.0.1:" + PORT_A },
        { origin: "http://127.0.0.1:" + PORT_A, "sec-fetch-site": "cross-site" },
        { origin: "http://127.0.0.1:" + PORT_A, "sec-fetch-site": "none" },
        { origin: null, referer: "https://evil.example/page" },
        { origin: null, referer: `http://127.0.0.1:${PORT_A}@evil.example/` },
        { origin: null, "sec-fetch-site": "cross-site" },
        { origin: null }, // no Origin/Referer/Sec-Fetch-Site at all
        { origin: null, "sec-fetch-site": "same-site" },
      ];
      for (const h of bad) {
        const hdrs = { ...h };
        if (hdrs.origin === null) delete hdrs.origin; // explicit omission
        const r = await call(A, "POST", "/api/rooms", { json: {}, origin: null, headers: hdrs });
        assert.equal(r.status, 403, JSON.stringify(h) + " → " + r.status);
        assert.deepEqual(r.cookies, []);
        // text/plain "simple request" form-style POST from another origin
        const t = await call(A, "POST", "/api/rooms", { body: "{}", origin: null, headers: { ...hdrs, "content-type": "text/plain" } });
        assert.equal(t.status, 403);
      }
      assert.equal(await count("SELECT count(*)::int n FROM public.rooms") - before, 0, "rooms created by CSRF attempts");
      assert.equal(await count("SELECT coalesce(sum(hit_count),0)::int n FROM cinematch_private.room_request_limits"), 0, "CSRF attempts must not consume the quota of legitimate users");
      // Allowed positives
      const okOrigin = await call(A, "POST", "/api/rooms", { json: {} });
      const okReferer = await call(A, "POST", "/api/rooms", { json: {}, origin: null, headers: { referer: A + "/lobby" } });
      const okSfs = await call(A, "POST", "/api/rooms", { json: {}, origin: null, headers: { "sec-fetch-site": "same-origin" } });
      assert.deepEqual([okOrigin.status, okReferer.status, okSfs.status], [201, 201, 201]);
      // Every state-changing room endpoint enforces it.
      const room = await makeRoom(A, "Host");
      for (const [m, p, body] of [
        ["POST", `/api/rooms/${room.roomId}/start`, {}], ["POST", `/api/rooms/${room.roomId}/leave`, {}], ["PUT", `/api/rooms/${room.roomId}/filters`, {}],
        ["PATCH", `/api/rooms/${room.roomId}/filters`, {}], ["POST", `/api/rooms/${room.roomId}/votes`, {}], ["POST", `/api/rooms/${room.roomId}/realtime-token`, {}],
        ["POST", "/api/guest/session/rotate", { roomId: room.roomId }], ["POST", "/api/guest/host-check", { roomId: room.roomId }], ["POST", "/api/guest/session", {}], ["POST", "/api/rooms/join", {}],
      ]) {
        const r = await call(A, m, p, { cookie: room.cookie, json: body, origin: "https://evil.example" });
        assert.equal(r.status, 403, `${m} ${p} accepted cross-origin: ${r.status}`);
      }
    });

    // ───────────────────────── S6 XSS / display-name injection ─────────────────────────
    await check("S6 XSS: hostile display names are neutralised; API is JSON+nosniff; no raw-HTML sink in app", async () => {
      const payloads = [
        `<script>alert(1)</script>Eve`, `<img src=x onerror=alert(1)>`, `"><svg/onload=alert(1)>`, `javascript:alert(1)`,
        "Eve‮live", "Z​ero\u0000Width", `<style>*{display:none}</style>Sty`, `&lt;b&gt;ent&lt;/b&gt;`, `Ｓｃｒｉｐｔ<scr<script>ipt>`,
      ];
      const out = {};
      for (const name of payloads) {
        await resetQuota();
        const r = await call(A, "POST", "/api/rooms", { json: { displayName: name } });
        assert([201, 400].includes(r.status), `payload ${JSON.stringify(name)} → ${r.status}`);
        assert.match(r.headers.get("content-type") || "", /^application\/json/);
        assert.equal((r.headers.get("x-content-type-options") || "").toLowerCase(), "nosniff", "nosniff missing on API JSON");
        if (r.status === 201) {
          const dn = r.data.viewer.displayName ?? r.data.room.participants?.[0]?.displayName ?? "";
          assert(!/[<>]/.test(dn), "angle bracket survived: " + JSON.stringify(dn));
          assert(!/[\u0000-\u001F‪-‮​]/.test(dn), "control/bidi survived");
          out[name.slice(0, 12)] = dn;
        }
      }
      // Oversized / non-string display names
      await resetQuota();
      for (const bad of ["x".repeat(51), 123, { a: 1 }, ["a"], "   ", "<>"]) {
        const r = await call(A, "POST", "/api/rooms", { json: { displayName: bad } });
        assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 30) + " → " + r.status);
      }
      let sinks = "";
      try {
        sinks = execFileSync("git", ["-C", REPO, "grep", "-nE", "dangerouslySetInnerHTML|\\.innerHTML\\s*=|document\\.write", "--", "src"], { encoding: "utf8" }).trim();
      } catch (e) {
        if (e.status !== 1) throw e; // git grep exits 1 when there are no matches
      }
      assert.equal(sinks, "", "raw-HTML sinks found:\n" + sinks);
      return JSON.stringify(out).slice(0, 300);
    });

    await check("S6b XSS response hardening: security headers on pages and error bodies", async () => {
      const r = await fetch(`${A}/`, { redirect: "manual" });
      const h = Object.fromEntries(r.headers.entries());
      return `page headers: x-content-type-options=${h["x-content-type-options"] ?? "-"} x-frame-options=${h["x-frame-options"] ?? "-"} csp=${h["content-security-policy"] ? "set" : "unset"} referrer-policy=${h["referrer-policy"] ?? "-"}`;
    });

    // ───────────────────────── S7 payload abuse ─────────────────────────
    await check("S7 oversized / malformed payloads: 413/400, no mutation, server stays healthy", async () => {
      await resetQuota();
      const before = await count("SELECT count(*)::int n FROM public.rooms");
      const nine = JSON.stringify({ displayName: "ok", pad: "x".repeat(9000) });
      assert.equal((await call(A, "POST", "/api/rooms", { body: nine, headers: { "content-type": "application/json" } })).status, 413);
      // Lying content-length + real big body
      const big = JSON.stringify({ pad: "é".repeat(5000) });
      const r1 = await rawPost(PORT_A, "/api/rooms", { "content-type": "application/json", origin: A, "content-length": String(Buffer.byteLength(big)) }, (req) => req.end(big));
      assert.equal(r1.status, 413);
      // Chunked 5 MiB stream without content-length
      const r2 = await rawPost(PORT_A, "/api/rooms", { "content-type": "application/json", origin: A, "transfer-encoding": "chunked" }, (req) => {
        req.write('{"pad":"');
        const chunk = Buffer.alloc(65536, 0x61);
        for (let i = 0; i < 80; i++) req.write(chunk);
        req.end('"}');
      });
      assert([413, 0].includes(r2.status), "chunked big got " + r2.status);
      // Malformed variants
      const bodies = ["{", "null", "[]", '"str"', "123", "\xff\xfe{}", '{"displayName":', "{" + '"a":'.repeat(2000) + "1" + "}".repeat(1), "[".repeat(4000)];
      for (const b of bodies) {
        const r = await rawPost(PORT_A, "/api/rooms", { "content-type": "application/json", origin: A, "content-length": String(Buffer.byteLength(b, "latin1")) }, (req) => req.end(Buffer.from(b, "latin1")));
        assert([400, 413].includes(r.status), `body ${JSON.stringify(b.slice(0, 20))} → ${r.status}`);
      }
      // Prototype pollution key and unknown fields are inert
      const pp = await call(A, "POST", "/api/rooms", { body: '{"__proto__":{"isHost":true,"role":"HOST"},"constructor":{"prototype":{"x":1}},"displayName":"Pp"}', headers: { "content-type": "application/json" } });
      assert([201, 400].includes(pp.status));
      assert.equal(({}).isHost, undefined, "test process polluted?");
      assert.equal(await count("SELECT count(*)::int n FROM public.rooms") - before, pp.status === 201 ? 1 : 0);
      // Still healthy
      assert.equal((await call(A, "POST", "/api/rooms", { json: {} })).status, 201);
      // Giant cookie header / oversize URL handled by Node (431/414) without crash
      const hugeCookie = await rawPost(PORT_A, "/api/rooms", { "content-type": "application/json", origin: A, cookie: "a=" + "b".repeat(70000), "content-length": "2" }, (req) => req.end("{}"));
      assert([431, 400, 0].includes(hugeCookie.status), "huge cookie got " + hugeCookie.status);
      assert.equal((await call(A, "GET", "/api/rooms/00000000-0000-4000-8000-000000000000")).status, 401);
      return `chunked=${r2.status}, hugeCookie=${hugeCookie.status}`;
    });

    // ───────────────────────── S8 abuse of un-limited authenticated routes ─────────────────────────
    await check("S8 authenticated spam on non-quota routes does not starve other rooms (pool/503 behaviour)", async () => {
      const spammer = await makeRoom(A, "Spam");
      const victim = await makeRoom(A, "Victim");
      await resetQuota();
      const stop = Date.now() + 6000;
      let sent = 0;
      const statuses = {};
      const spam = async () => {
        while (Date.now() < stop) {
          const r = await call(A, "POST", `/api/rooms/${spammer.roomId}/leave`, { cookie: spammer.cookie, origin: "https://evil.example", json: {} }); // CSRF-rejected: cheap path
          sent++; statuses[r.status] = (statuses[r.status] || 0) + 1;
        }
      };
      const hostSpam = async () => {
        while (Date.now() < stop) {
          const r = await call(A, "POST", "/api/guest/host-check", { cookie: spammer.cookie, json: { roomId: spammer.roomId } });
          sent++; statuses[r.status] = (statuses[r.status] || 0) + 1;
        }
      };
      const probes = [];
      const probe = async () => {
        while (Date.now() < stop) {
          const t = Date.now();
          const r = await call(A, "GET", `/api/rooms/${victim.roomId}`, { cookie: victim.cookie });
          probes.push({ s: r.status, ms: Date.now() - t });
          await new Promise((x) => setTimeout(x, 100));
        }
      };
      await Promise.all([...Array.from({ length: 16 }, spam), ...Array.from({ length: 16 }, hostSpam), probe()]);
      const ok = probes.filter((p) => p.s === 200).length;
      const worst = Math.max(...probes.map((p) => p.ms));
      const bad = probes.filter((p) => p.s >= 500).length;
      // Report; assert only that failures are sanitized 503 (never 500) and victim is mostly served.
      assert.equal(probes.filter((p) => p.s === 500).length, 0, "plain 500 under load");
      return `sent=${sent} statuses=${JSON.stringify(statuses)} victim ok=${ok}/${probes.length} 5xx=${bad} worstMs=${worst}`;
    });

    // ───────────────────────── S9 RLS bypass (real PostgreSQL roles) ─────────────────────────
    await check("S9 RLS: authenticated/anon/service roles are confined to their own room; private schema sealed", async () => {
      const a = await makeRoom(A, "Alice");
      const b = await makeRoom(A, "Bob");
      const asRole = async (role, claims, sql, args) => {
        const c = new Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: PG_PASSWORD, database: dbName });
        await c.connect();
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL ROLE ${role}`);
          if (claims) await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
          const r = await c.query(sql, args);
          await c.query("ROLLBACK");
          return r.rows;
        } catch (e) {
          await c.query("ROLLBACK").catch(() => {});
          return { error: e.code };
        } finally { await c.end(); }
      };
      const claimsA = { iss: "cinematch", role: "authenticated", sub: a.participantId, room_id: a.roomId };
      const tables = ["rooms", "room_participants", "room_events", "rounds", "votes", "guest_capability_sessions", "round_participants"];
      for (const t of tables) {
        const rowsA = await asRole("authenticated", claimsA, `SELECT * FROM public.${t}`);
        const text = JSON.stringify(rowsA);
        assert(!text.includes(b.roomId) && !text.includes(b.participantId), `${t}: room B visible to A`);
        const anon = await asRole("anon", null, `SELECT * FROM public.${t}`);
        assert(Array.isArray(anon) ? anon.length === 0 : !!anon.error, `${t}: anon sees rows`);
        const w = await asRole("authenticated", claimsA, `DELETE FROM public.${t}`);
        assert(!Array.isArray(w) || w.length === 0, `${t}: delete allowed for authenticated`);
        const i = await asRole("authenticated", claimsA, `UPDATE public.${t} SET room_id = room_id`);
        assert(!Array.isArray(i) || i.length === 0, `${t}: update allowed`);
      }
      // Token whose room_id claim is B but sub is A's participant must not see B (membership by sub AND room).
      const forgedClaims = { iss: "cinematch", role: "authenticated", sub: a.participantId, room_id: b.roomId };
      const cross = JSON.stringify(await asRole("authenticated", forgedClaims, "SELECT * FROM public.room_participants"));
      assert(!cross.includes(b.participantId), "forged room_id claim leaked B participant");
      const crossRooms = JSON.stringify(await asRole("authenticated", forgedClaims, "SELECT id FROM public.rooms"));
      assert(!crossRooms.includes(b.roomId), "forged room_id claim leaked B room row");
      // Private schema / quota table sealed for API roles; old public RPC gone.
      for (const role of ["anon", "authenticated"]) {
        const q = await asRole(role, null, "SELECT * FROM cinematch_private.room_request_limits");
        assert(!Array.isArray(q) && q.error === "42501", role + " read quota table: " + JSON.stringify(q));
        const f = await asRole(role, claimsA, "SELECT public.is_current_user_room_participant($1::uuid)", [a.roomId]);
        assert(!Array.isArray(f) && ["42883", "42501"].includes(f.error), role + " old RPC callable");
        const f2 = await asRole(role, claimsA, "SELECT cinematch_private.is_current_user_room_participant($1::uuid)", [a.roomId]);
        assert(!Array.isArray(f2) && f2.error === "42501", role + " private fn callable: " + JSON.stringify(f2));
      }
      // service_role gets only what 006 granted (no TRUNCATE).
      const t = await asRole("service_role", null, "TRUNCATE cinematch_private.room_request_limits");
      assert(!Array.isArray(t) && t.error === "42501");
    });

    await check("S9b Realtime topic policy: member of A cannot receive/send on B topic (realtime.messages RLS)", async () => {
      const a = await makeRoom(A, "Alice");
      const b = await makeRoom(A, "Bob");
      const c = new Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: PG_PASSWORD, database: dbName });
      await c.connect();
      try {
        await c.query("INSERT INTO realtime.messages(topic) VALUES ($1), ($2)", [`room:${a.roomId}`, `room:${b.roomId}`]);
        const pol = (await c.query("SELECT polname, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) w, polcmd FROM pg_policy WHERE polrelid='realtime.messages'::regclass")).rows;
        const claims = JSON.stringify({ iss: "cinematch", role: "authenticated", sub: a.participantId, room_id: a.roomId });
        const read = async (topic) => {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE authenticated");
          await c.query("SELECT set_config('request.jwt.claims', $1, true)", [claims]);
          await c.query("SELECT set_config('realtime.topic', $1, true)", [topic]);
          const r = await c.query("SELECT topic FROM realtime.messages");
          await c.query("ROLLBACK");
          return r.rows.map((x) => x.topic);
        };
        const mine = await read(`room:${a.roomId}`);
        const theirs = await read(`room:${b.roomId}`);
        assert(!theirs.includes(`room:${b.roomId}`), "A could read B topic rows: " + JSON.stringify(theirs));
        return `policies=${pol.length}; A-visible-on-A=${mine.length}; A-visible-on-B=${theirs.length}`;
      } finally { await c.end(); }
    });

    // ───────────────────────── S10 log / header hygiene ─────────────────────────
    await check("S10 no secrets, cookies or capability tokens in server logs or error bodies", async () => {
      const room = await makeRoom(A, "LogCheck");
      await call(A, "GET", `/api/rooms/${room.roomId}`, { cookie: room.cookie });
      await call(A, "POST", `/api/rooms/${room.roomId}/realtime-token`, { cookie: room.cookie, json: {} });
      await call(A, "POST", "/api/rooms", { body: "{", headers: { "content-type": "application/json" } });
      const tokenValue = room.cookie.split("=")[1];
      for (const p of procs) {
        const log = p.getLog();
        for (const needle of [SECRET, JWT_SECRET, PG_PASSWORD, tokenValue]) assert(!log.includes(needle), "secret/token found in process log");
      }
      const err = await call(A, "POST", "/api/rooms", { body: "{", headers: { "content-type": "application/json" } });
      for (const needle of [SECRET, JWT_SECRET, PG_PASSWORD, "postgres://", "postgresql://", "node_modules", "at "]) assert(!err.text.includes(needle), "leak in error body: " + needle);
      const q = await count("SELECT count(*)::int n FROM cinematch_private.room_request_limits WHERE bucket_key !~ '^[a-f0-9]{64}$'");
      assert.equal(q, 0, "rate-limit keys must be opaque");
      const pii = await dbAdmin.query("SELECT column_name FROM information_schema.columns WHERE table_schema='cinematch_private' AND table_name='room_request_limits'");
      assert.deepEqual(pii.rows.map((r) => r.column_name).sort(), ["bucket_key", "expires_at", "hit_count"]);
    });
  } finally {
    await dbAdmin.end().catch(() => {});
    for (const p of procs) p.kill();
    await new Promise((r) => setTimeout(r, 1500));
    await dropDatabase(dbName).catch((e) => console.error("cleanup failed", e.code || e.message));
    const a = admin();
    await a.connect();
    const left = await a.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'cinematch_adv_%'");
    await a.end();
    console.log(`Disposable databases remaining: ${left.rows[0].n}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULT: ${results.length - failed.length}/${results.length} PASS`);
  fs.writeFileSync(path.join(process.env.CINE021_EVIDENCE_DIR || process.cwd(), "cine021-adversarial-results.json"), JSON.stringify(results, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => { console.error("harness failure:", e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e); process.exitCode = 2; });
