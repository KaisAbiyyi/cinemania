// @vitest-environment node
import { EventEmitter } from "node:events";
import { Pool } from "pg";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { handleGuestApiError } from "@/lib/server/auth/guestResponse";
import { resolvePostgresPoolConfig } from "@/lib/server/room/roomStore";

const pooler = "aws-1-ap-northeast-2.pooler.supabase.com";

beforeEach(() => {
  for (const key of ["DATABASE_URL", "SUPABASE_PG_HOST", "SUPABASE_PG_PASSWORD", "SUPABASE_PG_PORT",
    "SUPABASE_PG_SSLMODE", "CINEMATCH_PG_POOL_MAX"]) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("returns 503 for the actual pg-pool new-client timeout", async () => {
  vi.useFakeTimers();
  const cause = new Error("synthetic private connection details");

  class StalledClient extends EventEmitter {
    private callback?: (error: Error) => void;

    connection = { stream: { destroy: () => this.callback?.(cause) } };

    connect(callback: (error: Error) => void) {
      this.callback = callback;
    }
  }

  // The fake client only implements the acquisition path exercised by pg-pool.
  const pool = new Pool({ connectionTimeoutMillis: 10, Client: StalledClient as unknown as typeof import("pg").Client });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = pool.connect().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    const error = await result;
    expect(error).toMatchObject({ message: "Connection terminated due to connection timeout", cause });
    expect(pool.totalCount).toBe(0);
    const response = handleGuestApiError(error);
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(await response.json()).toMatchObject({ error: "DATABASE_CAPACITY" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(cause.message);
  } finally {
    await pool.end();
  }
});

it.each([
  Object.assign(new Error("synthetic lock timeout"), { code: "55P03" }),
  Object.assign(new Error("synthetic query cancellation"), { code: "57014" }),
  Object.assign(new Error("synthetic unrelated network error"), { code: "ETIMEDOUT" }),
  new Error("synthetic prefix: Connection terminated due to connection timeout"),
])("leaves unrelated database failures on the sanitized 500 path", async (error) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = handleGuestApiError(error);
  expect(response.status).toBe(500);
  expect(response.headers.get("Retry-After")).toBeNull();
  expect(await response.json()).toEqual({ error: "INTERNAL_ERROR", message: "Unexpected guest session failure." });
  expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
});

it("defaults to two sessions per Supabase session pool and preserves TLS settings", () => {
  vi.stubEnv("SUPABASE_PG_HOST", pooler);
  vi.stubEnv("SUPABASE_PG_PASSWORD", "synthetic-password");
  expect(resolvePostgresPoolConfig()?.poolConfig).toMatchObject({
    max: 2,
    ssl: { rejectUnauthorized: true, servername: pooler },
  });
  vi.stubEnv("DATABASE_URL", `postgresql://example:synthetic-password@${pooler}:5432/example?sslmode=verify-full`);
  expect(resolvePostgresPoolConfig()?.poolConfig.max).toBe(2);
  vi.stubEnv("DATABASE_URL", "postgresql://example@127.0.0.1/example");
  expect(resolvePostgresPoolConfig()?.poolConfig.max).toBe(10);
});

it("validates a per-pool override and changes the cached pool fingerprint", () => {
  vi.stubEnv("DATABASE_URL", `postgresql://example:synthetic-password@${pooler}/example`);
  const initial = resolvePostgresPoolConfig()!;
  vi.stubEnv("CINEMATCH_PG_POOL_MAX", "1");
  const resized = resolvePostgresPoolConfig()!;
  expect(resized.poolConfig.max).toBe(1);
  expect(resized.fingerprint).not.toBe(initial.fingerprint);
  for (const invalid of ["0", "11", "1.5", "1e1"]) {
    vi.stubEnv("CINEMATCH_PG_POOL_MAX", invalid);
    expect(resolvePostgresPoolConfig).toThrow(/CINEMATCH_PG_POOL_MAX/);
  }
});

it.each([
  new Error("EMAXCONNSESSION: synthetic internal details"),
  new Error("timeout exceeded when trying to connect"),
  Object.assign(new Error("synthetic internal details"), { code: "53300" }),
])("returns a privacy-preserving busy response when PostgreSQL is at capacity", async error => {
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const response = handleGuestApiError(error);
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("3");
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(await response.json()).toMatchObject({ error: "DATABASE_CAPACITY" });
  expect(log).toHaveBeenCalledWith("[CINEMATCH_DB_CAPACITY] Room database connection capacity reached.");
  expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic internal details");
});
