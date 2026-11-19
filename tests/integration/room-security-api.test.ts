// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as create } from "@/app/api/rooms/route";
import { POST as join } from "@/app/api/rooms/join/route";
import { POST as legacySession } from "@/app/api/guest/session/route";
import { POST as vote } from "@/app/api/rooms/[roomId]/vote/route";
import { POST as token } from "@/app/api/rooms/[roomId]/realtime-token/route";
import { enforceRoomRateLimit } from "@/lib/server/auth/roomRateLimit";
import { resetRoomAuthorityStoreForTests } from "@/lib/server/room/roomStore";

const origin = "http://localhost:3000";
const roomId = "00000000-0000-4000-8000-000000000021";
const context = { params: Promise.resolve({ roomId }) };

function post(path: string, body = "{}", headers?: Record<string, string>) {
  return new NextRequest(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("CINEMATCH_SQLITE_PATH", ":memory:");
  vi.stubEnv("CINEMATCH_CAPABILITY_SECRET", "synthetic-offline-qualification-secret");
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("SUPABASE_PG_HOST", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("CINEMATCH_APP_ORIGIN", "");
  resetRoomAuthorityStoreForTests();
});

afterEach(() => {
  resetRoomAuthorityStoreForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  { operation: "create", allowance: 20, invoke: () => legacySession(post("/api/guest/session")) },
  { operation: "join", allowance: 30, invoke: () => join(post("/api/rooms/join")) },
  { operation: "vote", allowance: 60, invoke: () => vote(post(`/api/rooms/${roomId}/vote`), context) },
  { operation: "realtime-token", allowance: 24, invoke: () => token(post(`/api/rooms/${roomId}/realtime-token`), context) },
] as const)("enforces the shared quota for $operation and returns Retry-After", async ({ operation, allowance, invoke }) => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
  const request = post("/synthetic-fixture");
  for (let count = 0; count < allowance; count++) {
    await enforceRoomRateLimit(request, operation);
  }
  const response = await invoke();
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.has("set-cookie")).toBe(false);
  clock.mockReturnValue(160_000);
  await expect(enforceRoomRateLimit(request, operation)).resolves.toBeUndefined();
});

it("rejects oversized UTF-8 bodies even without a trustworthy content length", async () => {
  const bounded = await create(post("/api/rooms", JSON.stringify({ pad: "é".repeat(4096) }), { "content-length": "1" }));
  expect(bounded.status).toBe(413);
  expect(bounded.headers.has("set-cookie")).toBe(false);
  expect((await create(post("/api/rooms", "{"))).status).toBe(400);
  expect((await create(post("/api/rooms"))).status).toBe(201);
});

it("enforces the configured application origin for cookie mutations", async () => {
  vi.stubEnv("CINEMATCH_APP_ORIGIN", "https://app.example");
  const rejected = await create(post("/api/rooms", "{}", { origin: "https://other.example" }));
  expect(rejected.status).toBe(403);
  expect(rejected.headers.has("set-cookie")).toBe(false);
  const accepted = await create(post("/api/rooms", "{}", { origin: "https://app.example" }));
  expect(accepted.status).toBe(201);
  expect(accepted.headers.get("set-cookie")).toContain("Secure");
});

it("requires an existing room capability to rejoin by identifier", async () => {
  const created = await create(post("/api/rooms"));
  const cookie = created.headers.get("set-cookie")!.split(";")[0];
  const { room } = await created.json();
  const byId = JSON.stringify({ roomId: room.roomId });
  expect((await join(post("/api/rooms/join", byId))).status).toBe(401);
  expect((await legacySession(post("/api/guest/session", byId))).status).toBe(401);
  const rejoined = await join(post("/api/rooms/join", byId, { cookie }));
  expect(rejoined.status).toBe(200);
  expect((await rejoined.json()).viewer.role).toBe("HOST");
});
