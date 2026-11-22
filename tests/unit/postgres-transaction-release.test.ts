import { describe, expect, it, vi } from "vitest";
import { PostgresRoomRepository } from "@/lib/server/room/postgresRoomRepository";

// Fault-injection: a failed ROLLBACK must destroy the pooled connection (release(true)),
// never return a session that may still hold an open transaction and row locks.
function makeFakePool(rollbackFails: boolean) {
  const queries: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      if (sql === "ROLLBACK;" && rollbackFails) throw new Error("connection reset during rollback");
      return { rows: [], rowCount: 0 };
    }),
    release,
  };
  const pool = { totalCount: 1, connect: vi.fn(async () => client) };
  return { pool, release, queries };
}

describe("PostgresRoomRepository.withTransaction connection release", () => {
  it("returns the client to the pool after a successful commit", async () => {
    const { pool, release, queries } = makeFakePool(false);
    const repo = new PostgresRoomRepository(pool as never);
    await expect(repo.withTransaction(async () => "ok")).resolves.toBe("ok");
    expect(queries).toContain("COMMIT;");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it("returns the client to the pool after a failed body when ROLLBACK succeeds", async () => {
    const { pool, release, queries } = makeFakePool(false);
    const repo = new PostgresRoomRepository(pool as never);
    await expect(repo.withTransaction(async () => { throw new Error("domain failure"); })).rejects.toThrow("domain failure");
    expect(queries).toContain("ROLLBACK;");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalledWith(true);
  });

  it("destroys the pooled client (release(true)) when ROLLBACK fails, and still surfaces the primary error", async () => {
    const { pool, release } = makeFakePool(true);
    const repo = new PostgresRoomRepository(pool as never);
    await expect(repo.withTransaction(async () => { throw new Error("primary failure"); })).rejects.toThrow("primary failure");
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(true);
  });
});
