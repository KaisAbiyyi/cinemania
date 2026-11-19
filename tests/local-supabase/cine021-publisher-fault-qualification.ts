// CINE-021 publisher fault-injection qualification. Loopback only, synthetic fixtures.
// Real createSupabasePublisher + real dispatcher + real PostgreSQL outbox against a fake
// provider that injects 401/403/413/5xx/redirect/hang/reset. Run (after `docker run` of the
// CINE-021 container): CINE021_ADV_PGPASSWORD=... npx tsx --conditions=react-server <this file>
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client, Pool } from "pg";

const env = process.env as Record<string, string | undefined>;
env.NODE_ENV = "test";
env.CINEMATCH_ALLOW_LOCAL_REALTIME = "true";
const PG_PORT = 55440;
const PASSWORD = process.env.CINE021_ADV_PGPASSWORD ?? "";
assert(PASSWORD, "CINE021_ADV_PGPASSWORD required");
const API_SECRET = "cine021-fake-provider-key-" + crypto.randomBytes(12).toString("hex");

type Mode = "ok" | "401" | "403" | "413" | "500" | "503" | "redirect" | "hang" | "reset";
let mode: Mode = "ok";
let providerHits = 0;
let canaryHits = 0;
const seenKeys = new Set<string>();

const canary = http.createServer((req, res) => { canaryHits++; res.end("canary"); });
const provider = http.createServer((req, res) => {
  providerHits++;
  seenKeys.add(String(req.headers.apikey));
  req.resume();
  switch (mode) {
    case "ok": res.statusCode = 204; return res.end();
    case "401": case "403": case "413": case "500": case "503": res.statusCode = Number(mode); return res.end("provider-error-body-" + API_SECRET);
    case "redirect": res.statusCode = 302; res.setHeader("location", `http://127.0.0.1:${(canary.address() as AddressInfo).port}/steal`); return res.end();
    case "hang": return; // never responds
    case "reset": return req.socket.destroy();
  }
});
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
async function check(name: string, fn: () => Promise<string | void>) {
  try { const d = await fn(); results.push({ name, ok: true, detail: d ?? "" }); console.log(`PASS  ${name}${d ? "  — " + d : ""}`); }
  catch (e) { const m = String((e as Error).message ?? e).slice(0, 400); results.push({ name, ok: false, detail: m }); console.log(`FAIL  ${name}  — ${m}`); }
}

const MIGRATIONS = ["001_create_room_schema.sql", "002_guest_capability_sessions.sql", "003_round_roster_freeze.sql", "004_vote_operation_idempotency.sql", "005_realtime_authorization.sql", "006_cinematch_security_hardening.sql"];
async function main() {
  const fs = await import("node:fs");
  const dbName = "cinematch_adv_" + crypto.randomBytes(8).toString("hex");
  const admin = new Client({ host: "127.0.0.1", port: PG_PORT, user: "supabase_admin", password: PASSWORD, database: "postgres" });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}" OWNER postgres`);
  const cfg = { host: "127.0.0.1", port: PG_PORT, user: "postgres", password: PASSWORD, database: dbName };
  const setup = new Client(cfg);
  await setup.connect();
  await setup.query(`CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated; CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE IF NOT EXISTS realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, topic text); ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('realtime.topic', true) $$;`);
  await setup.query("BEGIN;\n" + MIGRATIONS.map((f) => fs.readFileSync("src/db/migrations/" + f, "utf8")).join("\n") + "\nCOMMIT;");
  const providerPort = await listen(provider);
  await listen(canary);
  const pool = new Pool({ ...cfg, max: 2, connectionTimeoutMillis: 10000 });
  const logs: string[] = [];
  const origErr = console.error, origWarn = console.warn;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };

  const { createSupabasePublisher } = await import("@/lib/server/realtime/supabasePublisher");
  const { dispatchPendingEvents } = await import("@/lib/server/realtime/dispatch");
  const { postgresOutboxStore } = await import("@/lib/server/realtime/postgresOutbox");
  const store = postgresOutboxStore(pool);
  const url = `http://127.0.0.1:${providerPort}`;

  const newRoom = async (versions = 3) => {
    const id = crypto.randomUUID();
    await setup.query("INSERT INTO public.rooms(id, code) VALUES ($1, $2)", [id, crypto.randomBytes(3).toString("hex").toUpperCase()]);
    for (let v = 1; v <= versions; v++) await setup.query("INSERT INTO public.room_events(room_id, version, event_type, payload) VALUES ($1,$2,'fixture','{}')", [id, v]);
    return id;
  };
  const state = async (roomId: string) => (await setup.query("SELECT version, dispatched, poison, retry_count, permanent_retry_count, retry_not_before > NOW() AS delayed, EXTRACT(EPOCH FROM retry_not_before - NOW()) AS secs FROM public.room_events WHERE room_id=$1 ORDER BY version", [roomId])).rows;
  const readyNow = (roomId: string) => setup.query("UPDATE public.room_events SET retry_not_before='-infinity' WHERE room_id=$1", [roomId]);

  try {
    await check("P1 destination allow-list: SSRF-style/odd provider URLs are refused", async () => {
      const bad = ["http://169.254.169.254", "https://evil.example", "https://abc.supabase.co.evil.com", "https://user:pw@abc.supabase.co", "https://abc.supabase.co/x", "https://abc.supabase.co/?a=1", "http://abc.supabase.co", "http://localhost.evil.com:80", "http://127.0.0.1.evil.com", "http://[::1]:54321", "file:///etc/passwd", "", "not a url"];
      for (const b of bad) assert.throws(() => createSupabasePublisher(b, "k"), /Invalid Supabase broadcast configuration/, b);
      assert.throws(() => createSupabasePublisher("https://abc.supabase.co", ""), /Invalid/);
      createSupabasePublisher("https://abc.supabase.co", "k");
      // Loopback only outside production and only with the explicit opt-in.
      env.NODE_ENV = "production";
      assert.throws(() => createSupabasePublisher(url, "k"), /Invalid/);
      env.NODE_ENV = "test";
      env.CINEMATCH_ALLOW_LOCAL_REALTIME = "false";
      assert.throws(() => createSupabasePublisher(url, "k"), /Invalid/);
      env.CINEMATCH_ALLOW_LOCAL_REALTIME = "true";
      return `${bad.length} URLs refused`;
    });

    await check("P2 redirect is never followed (no credential forward) and counts as a retryable failure", async () => {
      mode = "redirect"; canaryHits = 0;
      const room = await newRoom(2);
      const publish = createSupabasePublisher(url, API_SECRET);
      const ok = await dispatchPendingEvents(room, store, publish);
      assert.equal(ok, false);
      assert.equal(canaryHits, 0, "redirect target was contacted");
      const s = await state(room);
      assert(s.every((e) => !e.dispatched && !e.poison));
      assert.equal(s[0].retry_count, 1);
      assert.equal(s[1].retry_count, 0, "later events must not be attempted before the head");
    });

    await check("P3 transient 500/503/reset/hang: bounded backoff ≤60s, strict ordering, no loss, no quarantine", async () => {
      const room = await newRoom(3);
      const delays: number[] = [];
      for (const m of ["500", "503", "reset", "hang"] as Mode[]) {
        mode = m;
        await readyNow(room);
        const publish = createSupabasePublisher(url, API_SECRET);
        const t = Date.now();
        assert.equal(await dispatchPendingEvents(room, store, publish), false, m);
        const dt = Date.now() - t;
        if (m === "hang") assert(dt < 2500, "hang not bounded: " + dt + "ms");
        const s = await state(room);
        assert(s[0].delayed && Number(s[0].secs) <= 60.5, m + " delay " + s[0].secs);
        delays.push(Math.round(Number(s[0].secs)));
        assert(s.every((e) => !e.dispatched && !e.poison && e.permanent_retry_count === 0));
        assert(s[1].retry_count === 0 && s[2].retry_count === 0, "head-of-line ordering violated");
      }
      // Heavy retry count: delay stays capped.
      await setup.query("UPDATE public.room_events SET retry_count=2147483000, retry_not_before='-infinity' WHERE room_id=$1 AND version=1", [room]);
      mode = "500";
      await dispatchPendingEvents(room, store, createSupabasePublisher(url, API_SECRET));
      assert(Number((await state(room))[0].secs) <= 60.5);
      // Recovery: all three published in order.
      mode = "ok"; await readyNow(room);
      const order: number[] = [];
      const real = createSupabasePublisher(url, API_SECRET);
      assert.equal(await dispatchPendingEvents(room, store, async (h) => { order.push(h.version); await real(h); }), true);
      assert.deepEqual(order, [1, 2, 3]);
      return `backoff seconds by fault: ${delays.join(",")}`;
    });

    await check("P4 401/403: ≥60s auth cooldown, no hammering, events stay pending (not quarantined), alert is sanitized", async () => {
      logs.length = 0;
      const room = await newRoom(2);
      const publish = createSupabasePublisher(url, API_SECRET);
      mode = "401"; providerHits = 0;
      assert.equal(await dispatchPendingEvents(room, store, publish), false);
      const first = providerHits;
      const s = await state(room);
      assert(s[0].delayed && Number(s[0].secs) > 50 && Number(s[0].secs) <= 61, "auth delay " + s[0].secs);
      assert(!s[0].poison && s[0].permanent_retry_count === 0);
      // Same publisher instance must short-circuit without any network I/O during cooldown, even for other rooms.
      const other = await newRoom(1);
      mode = "ok";
      assert.equal(await dispatchPendingEvents(other, store, publish), false);
      assert.equal(providerHits, first, "publisher contacted provider during auth cooldown");
      mode = "403"; await readyNow(room);
      const publish2 = createSupabasePublisher(url, API_SECRET);
      await dispatchPendingEvents(room, store, publish2);
      const s2 = await state(room);
      assert(!s2[0].poison && Number(s2[0].secs) > 100, "second auth failure must back off further, got " + s2[0].secs);
      const joined = logs.join("\n");
      assert(!joined.includes(API_SECRET), "api key in logs");
      assert(!joined.includes("provider-error-body"), "provider body in logs");
      assert(!joined.includes(url), "provider URL in logs");
      assert(/CINEMATCH_REALTIME_AUTH/.test(joined));
    });

    await check("P5 413 permanent failure: quarantined only after 3 strikes; later events keep flowing", async () => {
      mode = "413";
      const room = await newRoom(2);
      const publish = createSupabasePublisher(url, API_SECRET);
      for (let i = 0; i < 3; i++) { await readyNow(room); await dispatchPendingEvents(room, store, publish); }
      const s = await state(room);
      assert(s[0].poison && s[0].permanent_retry_count === 3);
      mode = "ok"; await readyNow(room);
      const sent: number[] = [];
      const real = createSupabasePublisher(url, API_SECRET);
      await dispatchPendingEvents(room, store, async (h) => { sent.push(h.version); await real(h); });
      assert.deepEqual(sent, [2]);
    });

    await check("P6 apikey only reaches the configured origin and payload is hint-only (no vote/private data)", async () => {
      mode = "ok"; seenKeys.clear();
      const room = await newRoom(1);
      const bodies: string[] = [];
      const captureProvider = http.createServer((req, res) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => { bodies.push(b); res.statusCode = 204; res.end(); }); });
      const port = await listen(captureProvider);
      await setup.query("UPDATE public.room_events SET payload='{\"secretVote\":\"LIKE\",\"participant\":\"p\"}' WHERE room_id=$1", [room]);
      await dispatchPendingEvents(room, store, createSupabasePublisher(`http://127.0.0.1:${port}`, API_SECRET));
      captureProvider.close();
      assert.deepEqual(bodies.map((b) => Object.keys(JSON.parse(b)).sort()), [["roomId", "version"]]);
      assert(!bodies[0].includes("secretVote"));
    });

    await check("P7 provider hang cannot starve the 2-connection pool: cooldown bounds ordinary-read latency", async () => {
      // Request path: each mutation awaits store.dispatchRoomNotifications after commit while the
      // outbox lock pins a pooled connection. Pool max=2 (the Supabase session-pooler default).
      mode = "hang";
      env.SUPABASE_URL = url; env.SUPABASE_SECRET_KEY = API_SECRET;
      const { PostgresRoomAuthorityStore } = await import("@/lib/server/room/roomStore");
      const requestStore = new PostgresRoomAuthorityStore(pool);
      const rooms = await Promise.all(Array.from({ length: 6 }, () => newRoom(1)));
      const t0 = Date.now();
      const mutating = rooms.map((r) => requestStore.dispatchRoomNotifications!(r).catch(() => undefined));
      const readLatencies: number[] = [];
      const reads = Array.from({ length: 8 }, async () => {
        const t = Date.now();
        try { await pool.query("SELECT 1"); readLatencies.push(Date.now() - t); } catch { readLatencies.push(-1); }
      });
      await Promise.all([...mutating, ...reads]);
      const worst = Math.max(...readLatencies);
      const first = Date.now() - t0;
      assert(!readLatencies.includes(-1), "a read failed outright");
      // While the provider is known-down, further request-path dispatches must be near-instant.
      const t1 = Date.now();
      await Promise.all(Array.from({ length: 12 }, async () => { await requestStore.dispatchRoomNotifications!(rooms[0]); await pool.query("SELECT 1"); }));
      const cooled = Date.now() - t1;
      mode = "ok";
      assert(worst < 3000, "worst ordinary read " + worst + "ms (pre-cooldown baseline was ~4.5s)");
      assert(cooled < 500, "dispatch during cooldown took " + cooled + "ms");
      assert((await state(rooms[0]))[0].retry_count === 1, "deferred dispatches must not inflate retry_count");
      return `6 hanging dispatches + 8 reads on pool(2): total=${first}ms worstRead=${worst}ms; 12 dispatches during cooldown=${cooled}ms; retry_count stays 1`;
    });
  } finally {
    console.error = origErr; console.warn = origWarn;
    provider.close(); canary.close();
    await pool.end(); await setup.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    const left = await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'cinematch_adv_%'");
    console.log(`Disposable databases remaining: ${left.rows[0].n}`);
    await admin.end();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nRESULT: ${results.length - failed.length}/${results.length} PASS`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((e) => { console.error("harness failure:", (e as Error).message); process.exitCode = 2; });
