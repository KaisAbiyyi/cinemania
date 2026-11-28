import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { postgresOutboxStore } from "@/lib/server/realtime/postgresOutbox";

function setup(failures: Record<string, Error> = {}) {
  const client = {
    query: vi.fn(async (sql: string) => {
      if (failures[sql]) throw failures[sql];
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { client, store: postgresOutboxStore(pool as unknown as Pool) };
}

describe("Postgres outbox transaction release", () => {
  it("returns the work result and releases the session after COMMIT", async () => {
    const { client, store } = setup();
    await expect(store.withRoomLock("fixture", async () => "ok")).resolves.toBe("ok");
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(client.query.mock.invocationCallOrder.at(-1)).toBeLessThan(client.release.mock.invocationCallOrder[0]!);
  });

  it("reuses a rolled-back session and surfaces the original dispatch error", async () => {
    const { client, store } = setup();
    const primary = new Error("synthetic dispatch error");
    await expect(store.withRoomLock("fixture", async () => { throw primary; })).rejects.toBe(primary);
    expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(client.query.mock.invocationCallOrder.at(-1)).toBeLessThan(client.release.mock.invocationCallOrder[0]!);
  });

  it.each(["BEGIN", "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "COMMIT"])(
    "discards the session if rollback after %s fails",
    async (failedStatement) => {
      const primary = new Error("synthetic transaction error");
      const { client, store } = setup({
        [failedStatement]: primary,
        ROLLBACK: new Error("synthetic rollback error"),
      });
      await expect(store.withRoomLock("fixture", async () => "ok")).rejects.toBe(primary);
      expect(client.query).toHaveBeenLastCalledWith("ROLLBACK");
      expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
      expect(client.query.mock.invocationCallOrder.at(-1)).toBeLessThan(client.release.mock.invocationCallOrder[0]!);
    },
  );
});
