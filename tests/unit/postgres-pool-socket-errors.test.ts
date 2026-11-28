// @vitest-environment node
import { Client, type PoolClient } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { createPostgresPool } from "@/lib/server/room/postgresPool";

// Only the connection handshake is substituted. pg handles the error event,
// outstanding queries and session disposal through its installed implementations.
class FixtureClient extends Client {
  connect(): Promise<Client>;
  connect(callback: ((error: Error) => void) | ((error: null, client: Client) => void)): void;
  connect(callback?: ((error: Error) => void) | ((error: null, client: Client) => void)): Promise<Client> | void {
    if (!callback) return Promise.resolve(this);
    queueMicrotask(() => (callback as (error: null, client: Client) => void)(null, this));
  }

  end(): Promise<void>;
  end(callback: (error: Error) => void): void;
  end(callback?: (error: Error) => void): Promise<void> | void {
    if (!callback) return Promise.resolve();
    queueMicrotask(() => (callback as (error?: Error) => void)());
  }
}

function emitSocketFailure(client: PoolClient, error: Error) {
  (client as PoolClient & { _handleErrorEvent(err: Error): void })._handleErrorEvent(error);
}

afterEach(() => vi.restoreAllMocks());

it("handles a checked-out socket reset, propagates the query error and replaces the dead session", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const pool = createPostgresPool({ Client: FixtureClient as typeof Client, max: 1 }, "room");
  const reset = Object.assign(new Error("fixture-private-details"), { code: "ECONNRESET" });
  try {
    const client = await pool.connect();
    try {
      const query = client.query("SELECT 1").catch((error: unknown) => error);
      expect(() => emitSocketFailure(client, reset)).not.toThrow();
      expect(await query).toBe(reset);
    } finally {
      client.release();
    }
    const replacement = await pool.connect();
    replacement.release();
    expect(replacement).not.toBe(client);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[CINEMATCH_DB_CONNECTION_ERROR]", '{"component":"room","phase":"checked_out","code":"ECONNRESET"}',
    );
  } finally {
    await pool.end();
  }
});

it("reports one idle reset after repeated checkout and redacts unknown error details", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const pool = createPostgresPool({ Client: FixtureClient as typeof Client, max: 1 }, "outbox_worker");
  try {
    const client = await pool.connect();
    client.release();
    const reused = await pool.connect();
    expect(reused).toBe(client);
    reused.release();
    emitSocketFailure(reused, Object.assign(new Error("fixture-private-details"), { code: "PRIVATE_DETAIL" }));
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "[CINEMATCH_DB_CONNECTION_ERROR]", '{"component":"outbox_worker","phase":"idle","code":"other"}',
    );
  } finally {
    await pool.end();
  }
});
