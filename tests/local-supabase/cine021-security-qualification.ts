// Run only against the dedicated loopback CINE-021 container with synthetic fixtures.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { dispatchPendingEvents, PublicationAuthorizationError } from "@/lib/server/realtime/dispatch";
import { postgresOutboxStore } from "@/lib/server/realtime/postgresOutbox";
import { enforceRoomRateLimit, RoomRateLimitError } from "@/lib/server/auth/roomRateLimit";
import { getRoomAuthorityStore, getRoomRateLimitPool } from "@/lib/server/room/roomStore";

const container = process.env.CINE021_TEST_CONTAINER ?? "";
assert.match(container, /^cine021-isolated-[a-z0-9-]+$/);
assert.equal(execFileSync("docker", ["inspect", "--format", '{{index .Config.Labels "cinematch.task"}}', container], { encoding: "utf8" }).trim(), "CINE-021");
const bindings = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", container], { encoding: "utf8" }));
const pgBinding = bindings["5432/tcp"];
assert.deepEqual(pgBinding, [{ HostIp: "127.0.0.1", HostPort: "55439" }]);
const uri = new URL(process.env.DATABASE_URL ?? "");
assert.equal(uri.protocol, "postgresql:");
assert.equal(uri.hostname, "127.0.0.1");
assert.equal(uri.port, "55439");
assert.equal(uri.pathname, "/postgres");
assert.equal(uri.search, "");
assert.equal(uri.hash, "");
assert(process.env.CINEMATCH_CAPABILITY_SECRET);

const migrations = [
  "001_create_room_schema.sql",
  "002_guest_capability_sessions.sql",
  "003_round_roster_freeze.sql",
  "004_vote_operation_idempotency.sql",
  "005_realtime_authorization.sql",
  "006_cinematch_security_hardening.sql",
];
const migrationSql = (file: string) => readFileSync("src/db/migrations/" + file, "utf8");
const pool = new Pool({ connectionString: uri.href, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const roomA = "00000000-0000-4000-8000-000000000021";
const roomB = "00000000-0000-4000-8000-000000000022";
const participant = "00000000-0000-4000-8000-000000000023";

async function main() {
  assert.equal((await pool.query("SELECT to_regclass('public.rooms') AS rooms")).rows[0].rooms, null);
  // Use real PostgreSQL RLS with only the provider functions necessary to
  // evaluate the policies. No WebSocket or JWT-signature result is inferred.
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, topic text);
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('realtime.topic', true)
    $$;
  `);
  await pool.query("BEGIN;\n" + migrations.map(migrationSql).join("\n") + "\nCOMMIT;");
  assert.equal((await pool.query(`
    SELECT to_regprocedure('public.is_current_user_room_participant(uuid)') IS NULL
       AND NOT has_schema_privilege('authenticated', 'cinematch_private', 'USAGE')
       AND NOT has_schema_privilege('anon', 'cinematch_private', 'USAGE')
       AND NOT has_table_privilege('authenticated', 'cinematch_private.room_request_limits', 'SELECT')
       AND NOT has_table_privilege('service_role', 'cinematch_private.room_request_limits', 'TRUNCATE')
       AND has_table_privilege('service_role', 'cinematch_private.room_request_limits', 'UPDATE') AS valid
  `)).rows[0].valid, true);

  await pool.query("INSERT INTO public.rooms(id, code) VALUES ($1,'CINEAA'), ($2,'CINEBB')", [roomA, roomB]);
  await pool.query("INSERT INTO public.room_participants(room_id, participant_id, display_name) VALUES ($1,$3,'Fixture'), ($2,$3,'Fixture')", [roomA, roomB, participant]);
  const role = await pool.connect();
  try {
    await role.query("BEGIN");
    await role.query("SET LOCAL ROLE authenticated");
    await role.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      iss: "cinematch", role: "authenticated", sub: participant, room_id: roomA,
    })]);
    assert.deepEqual((await role.query("SELECT id FROM public.rooms")).rows, [{ id: roomA }]);
    assert.deepEqual((await role.query("SELECT room_id FROM public.room_participants")).rows, [{ room_id: roomA }]);
  } finally {
    await role.query("ROLLBACK");
    role.release();
  }

  const fixture = new Request("http://localhost:3000/synthetic-fixture");
  const quota = await Promise.allSettled(Array.from({ length: 21 }, () => enforceRoomRateLimit(fixture, "create")));
  assert.equal(quota.filter(result => result.status === "fulfilled").length, 20);
  const rejected = quota.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert(rejected.reason instanceof RoomRateLimitError);
  assert(rejected.reason.retryAfter > 0 && rejected.reason.retryAfter <= 60);
  const buckets = await pool.query("SELECT hit_count, bucket_key ~ '^[a-f0-9]{64}$' AS opaque FROM cinematch_private.room_request_limits");
  assert.deepEqual(buckets.rows, [{ hit_count: 21, opaque: true }]);
  await pool.query("UPDATE cinematch_private.room_request_limits SET expires_at = NOW()");
  await enforceRoomRateLimit(fixture, "join");
  assert.deepEqual((await pool.query("SELECT hit_count FROM cinematch_private.room_request_limits")).rows, [{ hit_count: 1 }]);

  await pool.query("INSERT INTO public.room_events(room_id, version, event_type, payload) VALUES ($1, 1, 'fixture', '{}'), ($1, 2, 'fixture', '{}')", [roomA]);
  const store = postgresOutboxStore(pool);
  await dispatchPendingEvents(roomA, store, async () => { throw new PublicationAuthorizationError(); });
  const state = (await pool.query("SELECT permanent_retry_count, poison, retry_not_before > NOW() + interval '50 seconds' AS delayed FROM public.room_events WHERE version=1")).rows[0];
  assert.deepEqual(state, { permanent_retry_count: 0, poison: false, delayed: true });
  assert.deepEqual(await store.scanPendingRooms(undefined, 20), []);
  const sent: number[] = [];
  const publish = async (hint: { version: number }) => { sent.push(hint.version); };
  await dispatchPendingEvents(roomA, store, publish);
  assert.deepEqual(sent, []);
  // Advance only the disposable fixture to the next scheduled retry.
  await pool.query("UPDATE public.room_events SET retry_not_before = NOW() WHERE version=1");
  await dispatchPendingEvents(roomA, store, publish);
  assert.deepEqual(sent, [1, 2]);

  await pool.query("BEGIN;\n" + migrationSql("006_down_cinematch_security_hardening.sql") + "\nCOMMIT;");
  assert.equal((await pool.query("SELECT to_regnamespace('cinematch_private') IS NULL AS removed")).rows[0].removed, true);
  assert.equal((await pool.query("SELECT count(*)::int AS rooms FROM public.rooms")).rows[0].rooms, 2);
  await pool.query("BEGIN;\n" + migrationSql(migrations[5]) + "\nCOMMIT;");
  console.log("PASS: isolated PostgreSQL migration/rollback, schema privileges, scoped role queries, atomic quota and expiry, provider auth cooldown and ordered recovery.");
}

main().catch(error => {
  // No connection strings, SQL bind values, request content or provider details.
  console.error("CINE-021 PostgreSQL qualification failed.", error.code ?? error.name);
  process.exitCode = 1;
}).finally(async () => {
  await getRoomRateLimitPool(getRoomAuthorityStore())?.end();
  await pool.end();
});
