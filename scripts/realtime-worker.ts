// A separately supervised process; never imported into the Next.js request runtime.
import { Pool } from "pg";
import { resolvePostgresPoolConfig } from "../src/lib/server/room/roomStore";
import { postgresOutboxStore } from "../src/lib/server/realtime/postgresOutbox";
import { dispatchPendingEvents } from "../src/lib/server/realtime/dispatch";
import { createSupabasePublisher } from "../src/lib/server/realtime/supabasePublisher";
import { startOutboxWorker } from "../src/lib/server/realtime/worker";

async function main() {
  const config = resolvePostgresPoolConfig();
  if (!config) throw new Error("PostgreSQL is required; no SQLite fallback for realtime worker");
  const publish = createSupabasePublisher(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "");
  const schema = process.env.CINEMATCH_OUTBOX_SCHEMA || "public";
  const pool = new Pool({ ...config.poolConfig, max: 2, statement_timeout: 5000, query_timeout: 7000 });
  pool.on("error", () => console.warn("Realtime worker database connection failed; durable retry remains pending."));
  try {
    const store = postgresOutboxStore(pool, schema);
    // Fail closed at startup if migration 005/authority schema is absent.
    await pool.query(`SELECT permanent_retry_count, retry_count, poison, dispatched FROM "${schema}".room_events LIMIT 0`);
    const worker = startOutboxWorker({
      scan: (after, limit) => store.scanPendingRooms(after, limit),
      dispatch: async roomId => {
        if (!await dispatchPendingEvents(roomId, store, publish)) throw new Error("Publication remains pending");
      },
      intervalMs: process.env.CINEMATCH_OUTBOX_POLL_MS === undefined ? 1000 : Number(process.env.CINEMATCH_OUTBOX_POLL_MS),
      roomsPerSweep: 20,
      // No SQL/provider errors, credentials, room payloads or guest identities in logs.
      onError: () => console.warn("Realtime worker sweep failed; durable retry remains pending."),
    });
    console.log("Realtime outbox worker ready (autonomous polling).");
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await worker.stop();
      await pool.end();
      console.log("Realtime outbox worker stopped.");
    };
    process.once("SIGTERM", () => { void stop(); });
    process.once("SIGINT", () => { void stop(); });
  } catch (error) {
    await pool.end();
    throw error;
  }
}

void main().catch(() => {
  console.error("Realtime worker startup failed; check server-only configuration, schema and database access.");
  process.exitCode = 1;
});
