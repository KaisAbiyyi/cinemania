import type { Pool } from "pg";
import { assertValidPgSchema } from "@/lib/server/room/postgresRoomRepository";
import type { LockedOutbox, OutboxStore, PendingEvent } from "./dispatch";

/** Separate transaction and advisory lock: no uncommitted domain event can be read. */
export function postgresOutboxStore(pool: Pool, requestedSchema = "public"): OutboxStore & {
  scanPendingRooms(after: string | undefined, limit: number): Promise<string[]>;
} {
  const schema = assertValidPgSchema(requestedSchema);
  const table = `"${schema}".room_events`;
  return {
    async scanPendingRooms(after, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid outbox page size");
      const result = await pool.query<{ room_id: string }>(
        `SELECT room_id FROM (
           SELECT DISTINCT ON (room_id) room_id, retry_not_before FROM ${table}
           WHERE NOT dispatched AND NOT poison AND ($1::uuid IS NULL OR room_id > $1::uuid)
           ORDER BY room_id, version
         ) AS heads WHERE retry_not_before <= NOW() ORDER BY room_id LIMIT $2`,
        [after ?? null, limit],
      );
      return result.rows.map(row => row.room_id);
    },
    async withRoomLock<T>(roomId: string, work: (outbox: LockedOutbox) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '250ms'");
        // Per-room transaction lock ensures competing app instances cannot reorder sends.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`cinematch-outbox:${schema}:${roomId}`]);
        const outbox: LockedOutbox = {
          async pending(): Promise<PendingEvent[]> {
            const result = await client.query<{ id: string; version: number; ready: boolean }>(
              `SELECT id::text, version, retry_not_before <= NOW() AS ready FROM ${table}
               WHERE room_id = $1 AND NOT dispatched AND NOT poison ORDER BY version ASC LIMIT 3`,
              [roomId],
            );
            const delayed = result.rows.findIndex(event => !event.ready);
            return delayed < 0 ? result.rows : result.rows.slice(0, delayed);
          },
          async markDispatched(id) {
            await client.query(`UPDATE ${table} SET dispatched = TRUE, dispatched_at = NOW() WHERE room_id = $1 AND id = $2 AND NOT dispatched`, [roomId, id]);
          },
          async recordFailure(id, permanent, authorization) {
            const initialDelay = authorization ? 60 : 1;
            const maxDelay = authorization ? 900 : 60;
            await client.query(
              `UPDATE ${table}
               SET retry_count = LEAST(retry_count::bigint + 1, 2147483647),
                   permanent_retry_count = permanent_retry_count + CASE WHEN $3 THEN 1 ELSE 0 END,
                   poison = poison OR ($3 AND permanent_retry_count + 1 >= 3),
                   retry_not_before = clock_timestamp() +
                     make_interval(secs => LEAST($5::integer, $4::integer * (1 << LEAST(retry_count, 6))))
               WHERE room_id = $1 AND id = $2 AND NOT dispatched`,
              [roomId, id, permanent, initialDelay, maxDelay],
            );
          },
        };
        const result = await work(outbox);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
