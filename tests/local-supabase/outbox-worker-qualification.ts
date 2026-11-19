// Real local PostgreSQL coordination/fault tests. Publisher faults are simulated;
// actual Supabase transport is exercised separately by the two-instance suite.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { Pool } from "pg";
import { postgresOutboxStore } from "../../src/lib/server/realtime/postgresOutbox";
import { dispatchPendingEvents, PermanentPublicationError, type OutboxStore } from "../../src/lib/server/realtime/dispatch";
import { startOutboxWorker } from "../../src/lib/server/realtime/worker";

const requireLocal = createRequire(import.meta.url);
const { assertLocalStack } = requireLocal("../../scripts/local-supabase/runtime.cjs");
const { parseEnvFile, STACK_ENV_PATH } = requireLocal("../../scripts/local-supabase/generate-env.cjs");
const { loadHostedStaging } = requireLocal("../hosted-supabase/environment.cjs");
const hosted = process.argv.includes("--hosted-staging") ? loadHostedStaging() : null;
if (!hosted) assertLocalStack();
const env = hosted ? {} : parseEnvFile(STACK_ENV_PATH);
const pool = new Pool({ ...(hosted ? hosted.pgConfig : { host: "127.0.0.1", port: 55432, user: "supabase_admin", password: env.POSTGRES_PASSWORD, database: "postgres" }), max: 5, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
const schema = `cinematch_qual_${Math.floor(Date.now() / 1000)}_${crypto.randomBytes(4).toString("hex")}`;
assert.match(schema, /^cinematch_qual_[0-9]+_[a-f0-9]{8}$/);
const table = `"${schema}".room_events`;
const workers: Array<{ stop(): Promise<void> }> = [];
let created = false;

async function waitFor(probe: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + (hosted ? 60000 : 8000);
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function main() {
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE ${table} (id bigserial PRIMARY KEY, room_id uuid NOT NULL, version int NOT NULL,
      dispatched boolean NOT NULL DEFAULT false, dispatched_at timestamptz, retry_count int NOT NULL DEFAULT 0,
      permanent_retry_count int NOT NULL DEFAULT 0, poison boolean NOT NULL DEFAULT false, UNIQUE(room_id, version))`);
    const store = postgresOutboxStore(pool, schema);
    const room = crypto.randomUUID(), transient = crypto.randomUUID(), poison = crypto.randomUUID(), healthy = crypto.randomUUID(), duplicate = crypto.randomUUID();
    const seen: Record<string, number[]> = {};
    let transientFailures = 2, markFailure = true;
    // One real transaction rollback after a successful publish models ack loss.
    const ackLossStore: OutboxStore = { withRoomLock: (roomId, work) => store.withRoomLock(roomId, outbox => work({
      ...outbox, markDispatched: async id => {
        if (roomId === duplicate && markFailure) { markFailure = false; throw new Error("ack lost after publish"); }
        await outbox.markDispatched(id);
      },
    })) };
    const publish = async (hint: { roomId: string; version: number }) => {
      assert.deepEqual(Object.keys(hint).sort(), ["roomId", "version"]);
      if (hint.roomId === transient && transientFailures-- > 0) throw new Error("temporary outage");
      if (hint.roomId === poison && hint.version === 1) throw new PermanentPublicationError("oversized");
      (seen[hint.roomId] ??= []).push(hint.version);
      await new Promise(resolve => setTimeout(resolve, 10));
    };
    const launch = () => {
      const worker = startOutboxWorker({ scan: (after, limit) => store.scanPendingRooms(after, limit),
        dispatch: roomId => dispatchPendingEvents(roomId, ackLossStore, publish), intervalMs: 100, roomsPerSweep: 2 });
      workers.push(worker); return worker;
    };
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(`INSERT INTO ${table}(room_id,version) VALUES ($1,1),($1,2),($1,3),($1,4),($1,5),($1,6)`, [room]);
      launch(); launch();
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.equal(seen[room], undefined, "Worker must never publish uncommitted data");
      await writer.query("COMMIT");
    } finally { await writer.query("ROLLBACK"); writer.release(); }
    await waitFor(async () => (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE room_id=$1 AND dispatched`, [room])).rows[0].n === 6, "Concurrent workers failed to drain");
    assert.deepEqual(seen[room], [1, 2, 3, 4, 5, 6], "Two workers must serialize room sends");
    await pool.query(`INSERT INTO ${table}(room_id,version) VALUES ($1,1),($2,1),($2,2),($3,1),($4,1)`, [transient, poison, healthy, duplicate]);
    await waitFor(async () => (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE dispatched OR poison`)).rows[0].n === 11, "Retry/quarantine/fair scanning did not converge");
    const failures = await pool.query(`SELECT retry_count, permanent_retry_count, poison FROM ${table} WHERE room_id=$1`, [transient]);
    assert.deepEqual(failures.rows, [{ retry_count: 2, permanent_retry_count: 0, poison: false }]);
    const quarantined = await pool.query(`SELECT retry_count, permanent_retry_count, poison, dispatched FROM ${table} WHERE room_id=$1 AND version=1`, [poison]);
    assert.deepEqual(quarantined.rows, [{ retry_count: 3, permanent_retry_count: 3, poison: true, dispatched: false }]);
    assert.deepEqual(seen[poison], [2]);
    assert.deepEqual(seen[healthy], [1]);
    assert.deepEqual(seen[duplicate], [1, 1], "Ack loss permits duplicate hints, not duplicate outbox rows");
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE room_id=$1`, [duplicate])).rows[0].n, 1);
    await Promise.all(workers.splice(0).map(w => w.stop()));
    await pool.query(`INSERT INTO ${table}(room_id,version) VALUES ($1,7)`, [room]);
    launch();
    await waitFor(async () => (await pool.query(`SELECT dispatched FROM ${table} WHERE room_id=$1 AND version=7`, [room])).rows[0].dispatched, "Restart did not scan durable pending row");
    assert.deepEqual(seen[room], [1, 2, 3, 4, 5, 6, 7]);
    console.log(JSON.stringify({ ok: true, uncommittedEventsInvisible: true, concurrentWorkersOrdered: true,
      autonomousTransientRetry: true, durablePoisonQuarantine: true, healthyRoomNotStarved: true,
      publishBeforeAckDuplicateSafe: true, autonomousRestart: true, environment: hosted ? `hosted:${hosted.project}` : "local Docker", publisher: "simulated faults; real PostgreSQL" }));
  } finally {
    await Promise.all(workers.map(w => w.stop()));
    if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1", [schema])).rows[0].n, 0);
    await pool.end();
    console.log("Disposable outbox schema cleanup verified.");
  }
}
void main().catch(() => { console.error("Local outbox qualification failed (no credentials logged)."); process.exitCode = 1; });
