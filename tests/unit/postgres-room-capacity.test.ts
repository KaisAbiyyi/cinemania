// @vitest-environment node
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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
