// Explicit opt-in: creates and drops only a random cinematch_qual_* schema.
import crypto from "node:crypto";
import fs from "node:fs";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { dispatchPendingEvents, PermanentPublicationError } from "../../src/lib/server/realtime/dispatch";
import { postgresOutboxStore } from "../../src/lib/server/realtime/postgresOutbox";

if (fs.existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");
const ref = "dmrbticnsczhyaiftrar";
const host = process.env.SUPABASE_PG_HOST ?? "";
const user = process.env.SUPABASE_PG_USER ?? "";
if (process.env.ALLOW_DESTRUCTIVE_PG_TESTS !== "true" || (!host.includes(ref) && !user.includes(ref)) || !process.env.SUPABASE_PG_PASSWORD) throw new Error("Refusing unapproved test target");
const schema = `cinematch_qual_${Math.floor(Date.now()/1000)}_${crypto.randomBytes(4).toString("hex")}`;
if (!/^cinematch_qual_[0-9]+_[a-f0-9]{8}$/.test(schema)) throw new Error("Invalid schema");
const pool = new Pool({host, user, password: process.env.SUPABASE_PG_PASSWORD, database: process.env.SUPABASE_PG_DATABASE ?? "postgres", port: Number(process.env.SUPABASE_PG_PORT ?? 5432), ssl: { rejectUnauthorized: true, ca: fs.readFileSync("src/db/supabase-root-ca.crt", "utf8"), servername: host }, connectionTimeoutMillis: 10000});
async function main() {
let created = false;
try {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  await pool.query(`CREATE TABLE "${schema}".room_events (id bigserial primary key, room_id uuid NOT NULL, version int NOT NULL, dispatched boolean NOT NULL DEFAULT false, dispatched_at timestamptz, retry_count int NOT NULL DEFAULT 0, permanent_retry_count int NOT NULL DEFAULT 0, poison boolean NOT NULL DEFAULT false, retry_not_before timestamptz NOT NULL DEFAULT '-infinity')`);
  const room = crypto.randomUUID();
  await pool.query(`INSERT INTO "${schema}".room_events (room_id, version) VALUES ($1,1),($1,2),($1,3)`, [room]);
  const store = postgresOutboxStore(pool, schema);
  const sent: number[] = [];
  await dispatchPendingEvents(room, store, async (hint) => { sent.push(hint.version); throw new Error("network"); });
  let rows = await pool.query(`SELECT version, dispatched, retry_count FROM "${schema}".room_events ORDER BY version`);
  assert.deepEqual(rows.rows.map(r => [r.dispatched, r.retry_count]), [[false,1],[false,0],[false,0]]);
  const releaseRetry = (id: string) => pool.query(`UPDATE "${schema}".room_events SET retry_not_before='-infinity' WHERE room_id=$1 AND NOT dispatched AND NOT poison`, [id]);
  await releaseRetry(room);
  await Promise.all([1,2].map(() => dispatchPendingEvents(room, store, async (hint) => { sent.push(hint.version); await new Promise(resolve => setTimeout(resolve, 20)); })));
  rows = await pool.query(`SELECT version, dispatched, retry_count FROM "${schema}".room_events ORDER BY version`);
  assert.deepEqual(sent, [1,1,2,3]);
  assert.deepEqual(rows.rows.map(r => r.dispatched), [true,true,true]);
  const poisonedRoom = crypto.randomUUID();
  await pool.query(`INSERT INTO "${schema}".room_events (room_id, version) VALUES ($1,1),($1,2)`, [poisonedRoom]);
  for (let i = 0; i < 4; i++) {
    await dispatchPendingEvents(poisonedRoom, store, async () => { throw new Error("temporary"); });
    await releaseRetry(poisonedRoom);
  }
  rows = await pool.query(`SELECT poison FROM "${schema}".room_events WHERE room_id=$1 ORDER BY version`, [poisonedRoom]);
  assert.equal(rows.rows[0].poison, false);
  for (let i = 0; i < 3; i++) {
    await dispatchPendingEvents(poisonedRoom, store, async () => { throw new PermanentPublicationError("oversized"); });
    await releaseRetry(poisonedRoom);
  }
  const after: number[] = [];
  await dispatchPendingEvents(poisonedRoom, store, async hint => { after.push(hint.version); });
  assert.deepEqual(after, [2]);
  console.log("PASS: isolated PostgreSQL ordered retries and concurrent dispatcher serialization");
} finally {
  if (created) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  const left = await pool.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = $1", [schema]);
  console.log(`cleanup schema ${schema}: remaining=${left.rows[0].n}`);
  await pool.end();
}

}
main().catch(() => { console.error("Hosted outbox qualification failed; provider and database details withheld."); process.exitCode = 1; });
