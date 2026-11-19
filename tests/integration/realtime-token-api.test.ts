// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { POST as createRoom } from "@/app/api/rooms/route";
import { POST as token } from "@/app/api/rooms/[roomId]/realtime-token/route";
import { resetRoomAuthorityStoreForTests } from "@/lib/server/room/roomStore";

const capabilitySecret = "test-capability-signing-secret-cine-018-64-characters-long-abcdef01";
let dir: string;
function request(url: string, cookie = "") {
  return new NextRequest(url, { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", cookie }, body: JSON.stringify({ displayName: "Host" }) });
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cine018-auth-"));
  process.env.CINEMATCH_SQLITE_PATH = path.join(dir, "test.sqlite");
  process.env.CINEMATCH_CAPABILITY_SECRET = capabilitySecret;
  process.env.SUPABASE_JWT_SECRET = "unit-test-realtime-signing-secret";
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_PG_HOST;
  resetRoomAuthorityStoreForTests();
});
afterEach(() => {
  resetRoomAuthorityStoreForTests();
  delete process.env.CINEMATCH_SQLITE_PATH;
  delete process.env.CINEMATCH_CAPABILITY_SECRET;
  delete process.env.SUPABASE_JWT_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});
describe("realtime token endpoint", () => {
  it("issues a short lived room-scoped token only to a valid room member", async () => {
    const created = await createRoom(request("http://localhost:3000/api/rooms"));
    const body = await created.json();
    const roomId = body.room.roomId as string;
    const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
    const ctx = { params: Promise.resolve({ roomId }) };
    const unauthorized = await token(request(`http://localhost:3000/api/rooms/${roomId}/realtime-token`), ctx);
    expect(unauthorized.status).toBe(401);
    const response = await token(request(`http://localhost:3000/api/rooms/${roomId}/realtime-token`, cookie), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const payload = await response.json();
    const claims = JSON.parse(Buffer.from(payload.token.split(".")[1], "base64url").toString());
    expect(claims.room_id).toBe(roomId);
    expect(claims.sub).toBe(body.viewer.participantId);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
  });

  it("denies a member's cookie when requesting another room's capability", async () => {
    const first = await createRoom(request("http://localhost:3000/api/rooms"));
    const second = await createRoom(request("http://localhost:3000/api/rooms"));
    const firstCookie = first.headers.get("set-cookie")!.split(";")[0]!;
    const otherId = (await second.json()).room.roomId as string;
    const response = await token(request("http://localhost:3000/api/rooms/" + otherId + "/realtime-token", firstCookie), { params: Promise.resolve({ roomId: otherId }) });
    expect(response.status).toBe(401);
  });
});

it("replays only authorized room event versions and no event payloads", async () => {
  const created = await createRoom(request("http://localhost:3000/api/rooms"));
  const body = await created.json();
  const roomId = body.room.roomId as string;
  const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
  const { GET } = await import("@/app/api/rooms/[roomId]/events/route");
  const ctx = { params: Promise.resolve({ roomId }) };
  const url = "http://localhost:3000/api/rooms/" + roomId + "/events?since=0";
  expect((await GET(new NextRequest(url), ctx)).status).toBe(401);
  const response = await GET(new NextRequest(url, { headers: { cookie } }), ctx);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.events).toEqual([{ version: 1 }]);
  expect(JSON.stringify(data)).not.toContain("LIKE");
  expect((await GET(new NextRequest(url.replace("since=0", "since=-1"), { headers: { cookie } }), ctx)).status).toBe(400);
  expect((await GET(new NextRequest(url.replace("since=0", "since=2147483648"), { headers: { cookie } }), ctx)).status).toBe(400);
});
