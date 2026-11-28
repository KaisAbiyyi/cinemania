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
  const pool = new Pool({ ...config.poolConfig, max: Math.min(config.poolConfig.max ?? 2, 2), statement_timeout: 5000, query_timeout: 7000 });
  pool.on("error", () => console.warn("Realtime worker database connection failed; durable retry remains pending."));
  try {
    const store = postgresOutboxStore(pool, schema);
    // Fail closed at startup if the outbox migration/authority schema is absent.
    await pool.query(`SELECT permanent_retry_count, retry_count, poison, dispatched, retry_not_before FROM "${schema}".room_events LIMIT 0`);
    const worker = startOutboxWorker({
      scan: (after, limit) => store.scanPendingRooms(after, limit),
      dispatch: roomId => dispatchPendingEvents(roomId, store, publish),
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

void main().catch((error: unknown) => {
  const safeName = error instanceof Error && /^[A-Za-z][A-Za-z0-9]*$/.test(error.name) ? error.name : "UnknownError";
  const rawCode = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const safeCode = typeof rawCode === "string" && /^[A-Z0-9_]{2,32}$/.test(rawCode) ? rawCode : undefined;
  const missingColumn = error instanceof Error ? error.message.match(/column "([A-Za-z_][A-Za-z0-9_]*)" does not exist/i)?.[1] : undefined;
  console.error(
    "Realtime worker startup failed; check server-only configuration, schema and database access.",
    safeName,
    ...(safeCode ? [safeCode] : []),
    ...(missingColumn ? [`column=${missingColumn}`] : [])
  );
  process.exitCode = 1;
});
