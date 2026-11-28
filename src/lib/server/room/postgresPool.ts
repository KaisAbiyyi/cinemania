import { Pool, type PoolConfig } from "pg";

const CONNECTION_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "08006", "57P01"]);

export function createPostgresPool(config: PoolConfig, component: "room" | "outbox_worker" | "staging_inspector"): Pool {
  const pool = new Pool(config);
  const report = (phase: "checked_out" | "idle", error: Error) => {
    const code = "code" in error && typeof error.code === "string" && CONNECTION_CODES.has(error.code)
      ? error.code
      : "other";
    console.warn("[CINEMATCH_DB_CONNECTION_ERROR]", JSON.stringify({ component, phase, code }));
  };
  const reportCheckedOut = (error: Error) => report("checked_out", error);

  // pg-pool removes its idle listener on checkout. pg still emits socket errors
  // on the client while rejecting queries and making the dead session unusable.
  pool.on("acquire", client => client.on("error", reportCheckedOut));
  pool.on("release", (_error, client) => client.off("error", reportCheckedOut));
  pool.on("error", error => report("idle", error));
  return pool;
}
