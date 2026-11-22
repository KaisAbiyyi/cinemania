// Real local PostgreSQL coordination/fault tests. Publisher faults are simulated;
// actual Supabase transport is exercised separately by the two-instance suite.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createRoomReconciler } from "../../src/lib/realtime/roomReconciler";
import { postgresOutboxStore } from "../../src/lib/server/realtime/postgresOutbox";
import { dispatchPendingEvents, PermanentPublicationError, type OutboxStore } from "../../src/lib/server/realtime/dispatch";
import { dispatchFailureCategory } from "../../src/lib/server/realtime/notifyAfterCommit";
import { createSupabasePublisher } from "../../src/lib/server/realtime/supabasePublisher";
import { startOutboxWorker } from "../../src/lib/server/realtime/worker";

const requireLocal = createRequire(import.meta.url);
const { assertLocalStack } = requireLocal("../../scripts/local-supabase/runtime.cjs");
const { parseEnvFile, STACK_ENV_PATH } = requireLocal("../../scripts/local-supabase/generate-env.cjs");
const { assertEmptyHostedApplication, loadHostedStaging } = requireLocal("../hosted-supabase/environment.cjs");
const hosted = process.argv.includes("--hosted-staging") ? loadHostedStaging() : null;
if (!hosted) assertLocalStack();
const env = hosted ? {} : parseEnvFile(STACK_ENV_PATH);
const schema = `cinematch_qual_${Math.floor(Date.now() / 1000)}_${crypto.randomBytes(4).toString("hex")}`;
assert.match(schema, /^cinematch_qual_[0-9]+_[a-f0-9]{8}$/);
const pool = new Pool({ ...(hosted ? hosted.pgConfig : { host: "127.0.0.1", port: 55432, user: "supabase_admin", password: env.POSTGRES_PASSWORD, database: "postgres" }), application_name: schema, max: 5, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
const table = `"${schema}".room_events`;
const workers: Array<{ stop(): Promise<void> }> = [];
let created = false;

async function waitFor(probe: () => Promise<boolean>, message: string, timeoutMs = hosted ? 60000 : 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function qualifyCommitDuringDispatch(store: ReturnType<typeof postgresOutboxStore>) {
  const roomId = crypto.randomUUID();
  await pool.query(`INSERT INTO ${table}(room_id, version) VALUES ($1,1),($1,2),($1,3)`, [roomId]);
  const release = Promise.withResolvers<void>();
  const published: number[] = [];
  const publish = async ({ version }: { version: number }) => {
    published.push(version);
    if (version === 3) await release.promise;
  };
  const dispatch = () => dispatchPendingEvents(roomId, store, publish);
  const initial = dispatch();
  void initial.catch(() => {}); // The original promise is awaited after releasing the gate.
  let committedAt = 0;
  let contentionMs = 0;
  let oldestPendingMs = 0;
  try {
    await waitFor(async () => published.includes(3), "Third publication did not reach the in-flight gate");
    await pool.query(`INSERT INTO ${table}(room_id, version) VALUES ($1,4)`, [roomId]);
    committedAt = performance.now();
    const start = performance.now();
    await assert.rejects(dispatch, error => dispatchFailureCategory(error) === "outbox_lock_timeout");
    contentionMs = performance.now() - start;
    assert.deepEqual(published, [1, 2, 3], "Contender made a duplicate or out-of-order publisher call");
    oldestPendingMs = (await pool.query(`SELECT (EXTRACT(EPOCH FROM clock_timestamp() - MIN(created_at)) * 1000)::float8 AS age
      FROM ${table} WHERE room_id=$1 AND NOT dispatched AND NOT poison`, [roomId])).rows[0].age;
  } finally {
    release.resolve();
    await initial;
  }
  const pending = `SELECT count(*)::int AS n FROM ${table} WHERE room_id=$1 AND NOT dispatched`;
  assert.equal((await pool.query(pending, [roomId])).rows[0].n, 1);
  const restartedAt = performance.now();
  const worker = startOutboxWorker({
    scan: (after, limit) => store.scanPendingRooms(after, limit),
    dispatch: id => dispatchPendingEvents(id, store, publish),
  });
  try {
    await waitFor(async () => (await pool.query(pending, [roomId])).rows[0].n === 0,
      "Independent sweep did not drain the commit missed by request dispatch");
  } finally {
    await worker.stop();
  }
  assert.deepEqual(published, [1, 2, 3, 4]);
  console.log(JSON.stringify({
    scenario: "commit-during-publication",
    lockTimeouts: 1, providerFailures: 0, publisherCalls: published.length,
    contentionMs: Math.round(contentionMs), oldestPendingMs: Math.round(oldestPendingMs),
    commitToDrainMs: Math.round(performance.now() - committedAt), restartToDrainMs: Math.round(performance.now() - restartedAt),
    pendingAfterRecovery: 0, published,
  }));
}

async function qualifyBatchAcknowledgementLoss(store: OutboxStore) {
  const roomId = crypto.randomUUID();
  await pool.query(`INSERT INTO ${table}(room_id, version) VALUES ($1,1),($1,2),($1,3)`, [roomId]);
  const fault = new Error("synthetic failure before second acknowledgement");
  let lastPublished = 0;
  const faultStore: OutboxStore = {
    withRoomLock: (id, work) => store.withRoomLock(id, outbox => work({
      ...outbox,
      async markDispatched(eventId) {
        if (lastPublished === 2) throw fault;
        await outbox.markDispatched(eventId);
      },
    })),
  };
  const attempts: number[] = [];
  const accepted: number[] = [];
  const reconciler = createRoomReconciler({
    loadSnapshot: async () => ({ stateVersion: lastPublished }),
    onSnapshot: snapshot => { accepted.push(snapshot.stateVersion); },
  });
  const publish = async ({ version }: { version: number }) => {
    lastPublished = version;
    attempts.push(version);
    await reconciler.notify(version);
  };
  await assert.rejects(dispatchPendingEvents(roomId, faultStore, publish), error => error === fault);
  const durableAfterFault = (await pool.query(`SELECT version FROM ${table} WHERE room_id=$1 AND dispatched ORDER BY version`, [roomId]))
    .rows.map(row => row.version);
  await dispatchPendingEvents(roomId, store, publish);
  const pending = (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE room_id=$1 AND NOT dispatched`, [roomId])).rows[0].n;
  console.log(JSON.stringify({ scenario: "acknowledgement-loss", durableAfterFault, attempts, accepted, pending }));
  assert.deepEqual(durableAfterFault, [1], "An earlier successful send lost its durable acknowledgement");
  assert.deepEqual(attempts, [1, 2, 2, 3], "Only the unresolved head should be replayed");
  assert.deepEqual(accepted, [1, 2, 3], "Consumer must apply each snapshot version once");
  assert.equal(pending, 0);
}

async function qualifyProviderRecovery(store: ReturnType<typeof postgresOutboxStore>) {
  const roomId = crypto.randomUUID();
  await pool.query(`INSERT INTO ${table}(room_id, version) VALUES ($1,1),($1,2)`, [roomId]);
  const startedAt = performance.now();
  const sent: number[] = [];
  let calls = 0;
  let transportTimeouts = 0;
  let unavailableResponses = 0;
  let lockTimeouts = 0;
  const publish = createSupabasePublisher("https://fixture.supabase.co", "synthetic-key", async (_url, init) => {
    const { version } = JSON.parse(String(init?.body));
    calls++;
    if (calls === 1) {
      // The real publisher's deadline cancels this synthetic request.
      await delay(30_000, undefined, { signal: init?.signal ?? undefined }).catch(error => {
        if (error.name === "AbortError") transportTimeouts++;
        throw error;
      });
      throw new Error("Publisher deadline did not cancel the request");
    }
    if (calls === 2) {
      unavailableResponses++;
      return new Response(null, { status: 503 });
    }
    sent.push(version);
    return new Response(null, { status: 204 });
  });
  const worker = startOutboxWorker({
    scan: (after, limit) => store.scanPendingRooms(after, limit),
    dispatch: id => dispatchPendingEvents(id, store, publish),
    onError: error => { if (dispatchFailureCategory(error) === "outbox_lock_timeout") lockTimeouts++; },
  });
  const state = async () => (await pool.query(
    `SELECT version, dispatched, retry_count, permanent_retry_count, poison FROM ${table} WHERE room_id=$1 ORDER BY version`,
    [roomId],
  )).rows;
  try {
    await waitFor(async () => (await state()).every(row => row.dispatched), "Provider recovery did not drain pending rows", 25_000);
  } finally {
    await worker.stop();
  }
  const rows = await state();
  assert.deepEqual(sent, [1, 2]);
  assert.equal(transportTimeouts, 1);
  assert.equal(unavailableResponses, 1);
  assert.equal(lockTimeouts, 0);
  assert.equal(calls, 4);
  assert.deepEqual(rows, [
    { version: 1, dispatched: true, retry_count: 2, permanent_retry_count: 0, poison: false },
    { version: 2, dispatched: true, retry_count: 0, permanent_retry_count: 0, poison: false },
  ]);
  console.log(JSON.stringify({
    scenario: "provider-recovery", calls, transportTimeouts, unavailableResponses, lockTimeouts,
    recoveryMs: Math.round(performance.now() - startedAt), rows, sent,
  }));
}

async function main() {
  try {
    if (hosted) await assertEmptyHostedApplication(pool);
    await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
    await pool.query(`CREATE TABLE ${table} (id bigserial PRIMARY KEY, room_id uuid NOT NULL, version int NOT NULL,
      dispatched boolean NOT NULL DEFAULT false, dispatched_at timestamptz, retry_count int NOT NULL DEFAULT 0,
      permanent_retry_count int NOT NULL DEFAULT 0, poison boolean NOT NULL DEFAULT false,
      retry_not_before timestamptz NOT NULL DEFAULT '-infinity', created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(room_id, version))`);
    const store = postgresOutboxStore(pool, schema);
    await qualifyCommitDuringDispatch(store);
    await qualifyBatchAcknowledgementLoss(store);
    await qualifyProviderRecovery(store);
    await pool.query(`TRUNCATE ${table}`);
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
      transientRetries: failures.rows[0].retry_count, quarantined: 1, permanentRetries: quarantined.rows[0].permanent_retry_count,
      publishBeforeAckDuplicateSafe: true, autonomousRestart: true, environment: hosted ? `hosted:${hosted.project}` : "local Docker", publisher: "simulated faults; real PostgreSQL" }));
  } finally {
    await Promise.all(workers.map(w => w.stop()));
    try {
      if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      const fixtures = (await pool.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname=$1", [schema])).rows[0].n;
      const locks = (await pool.query(`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a USING (pid)
        WHERE a.application_name=$1 AND l.locktype='advisory'`, [schema])).rows[0].n;
      assert.equal(fixtures, 0);
      assert.equal(locks, 0);
      console.log(JSON.stringify({ scenario: "cleanup", fixtures, advisoryLocks: locks }));
    } finally {
      await pool.end();
    }
  }
}
void main().catch(() => { console.error("Local outbox qualification failed (no credentials logged)."); process.exitCode = 1; });
