// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as postHostCheck } from "@/app/api/guest/host-check/route";
import { GET as getGuestSession, POST as postGuestSession } from "@/app/api/guest/session/route";
import { POST as postRotateSession } from "@/app/api/guest/session/rotate/route";
import { getGuestCookieName } from "@/lib/server/auth/guestCapability";
import { resetRoomAuthorityStoreForTests } from "@/lib/server/room/roomStore";

const ORIGIN = "http://localhost:3000";
const TEST_CAPABILITY_SECRET = "integration-test-capability-secret-32-bytes";

function extractSetCookiePair(response: Response, cookieName: string): {
  header: string;
  cookiePair: string;
} {
  const setCookie = response.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain(`${cookieName}=`);
  const cookiePair = setCookie.split(";")[0] ?? "";
  return { header: setCookie, cookiePair };
}

describe("CINE-013: Anonymous Guest Identity & Capability API Integration", () => {
  let dbPath: string;
  const originalSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
  const originalSqlitePath = process.env.CINEMATCH_SQLITE_PATH;

  beforeEach(() => {
    resetRoomAuthorityStoreForTests();
    dbPath = path.join(os.tmpdir(), `cinemania-cine013-${Date.now()}-${Math.random()}.sqlite`);
    process.env.CINEMATCH_SQLITE_PATH = dbPath;
    process.env.CINEMATCH_CAPABILITY_SECRET = TEST_CAPABILITY_SECRET;
  });

  afterEach(() => {
    resetRoomAuthorityStoreForTests();
    for (const suffix of ["", "-wal", "-shm"]) {
      const target = `${dbPath}${suffix}`;
      if (fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    }
    if (originalSecret === undefined) {
      delete process.env.CINEMATCH_CAPABILITY_SECRET;
    } else {
      process.env.CINEMATCH_CAPABILITY_SECRET = originalSecret;
    }
    if (originalSqlitePath === undefined) {
      delete process.env.CINEMATCH_SQLITE_PATH;
    } else {
      process.env.CINEMATCH_SQLITE_PATH = originalSqlitePath;
    }
  });

  it("creates anonymous room session with HttpOnly SameSite cookie, HTTPS Secure attribute, no-store, and zero raw IP persistence", async () => {
    const res = await postGuestSession(
      new Request("https://cinematch.example/api/guest/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://cinematch.example",
          "x-forwarded-for": "203.0.113.42",
        },
        body: JSON.stringify({ displayName: "HostAlice" }),
      })
    );

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(res.headers.get("vary")).toContain("Cookie");

    const data = await res.json();
    expect(data.role).toBe("HOST");
    expect(data.displayName).toBe("HostAlice");
    expect(data.capabilities.isHost).toBe(true);
    expect(JSON.stringify(data)).not.toContain(TEST_CAPABILITY_SECRET);
    expect(JSON.stringify(data)).not.toContain("203.0.113.42");

    const cookieName = getGuestCookieName(data.roomId);
    const { header } = extractSetCookiePair(res, cookieName);
    expect(header.toLowerCase()).toContain("httponly");
    expect(header.toLowerCase()).toContain("samesite=lax");
    expect(header.toLowerCase()).toContain("secure");

    // Verify guest_capability_sessions schema contains zero raw IP or PII columns
    const inspectDb = new DatabaseSync(dbPath);
    try {
      const columns = inspectDb
        .prepare("PRAGMA table_info(guest_capability_sessions);")
        .all() as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name.toLowerCase());
      expect(columnNames).not.toContain("ip");
      expect(columnNames).not.toContain("ip_address");
      expect(columnNames).not.toContain("user_agent");
    } finally {
      inspectDb.close();
    }
  });

  it("ignores user-supplied participantId/role, supports safe rejoin, and blocks MEMBER from HOST actions", async () => {
    // 1. Host creates room
    const createRes = await postGuestSession(
      new Request(`${ORIGIN}/api/guest/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ displayName: "HostAlice" }),
      })
    );
    const hostData = await createRes.json();
    const cookieName = getGuestCookieName(hostData.roomId);
    const hostCookie = extractSetCookiePair(createRes, cookieName).cookiePair;

    // 2. Attacker tries to join using Host's participantId and role="HOST" in JSON body
    const joinRes = await postGuestSession(
      new Request(`${ORIGIN}/api/guest/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({
          roomId: hostData.roomId,
          participantId: hostData.participantId,
          role: "HOST",
          displayName: "GuestEve",
        }),
      })
    );
    expect(joinRes.status).toBe(201);
    const guestData = await joinRes.json();
    expect(guestData.participantId).not.toBe(hostData.participantId);
    expect(guestData.role).toBe("MEMBER");
    expect(guestData.capabilities.isHost).toBe(false);
    expect(guestData.participantCount).toBe(2);
    const guestCookie = extractSetCookiePair(joinRes, cookieName).cookiePair;

    // 3. Host safely rejoins using existing cookie -> retains identity and participantCount=2
    const rejoinRes = await postGuestSession(
      new Request(`${ORIGIN}/api/guest/session`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: hostCookie,
        },
        body: JSON.stringify({ roomId: hostData.roomId, displayName: "HostAlice" }),
      })
    );
    expect(rejoinRes.status).toBe(200);
    const rejoinData = await rejoinRes.json();
    expect(rejoinData.rejoined).toBe(true);
    expect(rejoinData.participantId).toBe(hostData.participantId);
    expect(rejoinData.role).toBe("HOST");
    expect(rejoinData.participantCount).toBe(2);

    // 4. Host action check succeeds for Host cookie, fails 403 for Member cookie
    const hostAllowedRes = await postHostCheck(
      new Request(`${ORIGIN}/api/guest/host-check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: hostCookie,
        },
        body: JSON.stringify({ roomId: hostData.roomId }),
      })
    );
    expect(hostAllowedRes.status).toBe(200);

    const memberDeniedRes = await postHostCheck(
      new Request(`${ORIGIN}/api/guest/host-check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: guestCookie,
        },
        body: JSON.stringify({ roomId: hostData.roomId }),
      })
    );
    expect(memberDeniedRes.status).toBe(403);
    const memberDeniedJson = await memberDeniedRes.json();
    expect(memberDeniedJson.error).toBe("HOST_ONLY_ACTION");
  });

  it("rejects forged cookies, cross-room capabilities, CSRF attacks, and pre-rotation tokens", async () => {
    // Create Room A and Room B
    const roomARes = await postGuestSession(
      new Request(`${ORIGIN}/api/guest/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ displayName: "HostA" }),
      })
    );
    const roomA = await roomARes.json();
    const roomACookieName = getGuestCookieName(roomA.roomId);
    const roomACookie = extractSetCookiePair(roomARes, roomACookieName).cookiePair;

    const roomBRes = await postGuestSession(
      new Request(`${ORIGIN}/api/guest/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ displayName: "HostB" }),
      })
    );
    const roomB = await roomBRes.json();

    // Forged cookie fails 401
    const forgedRes = await getGuestSession(
      new Request(`${ORIGIN}/api/guest/session?roomId=${roomA.roomId}`, {
        headers: { cookie: `${roomACookieName}=v1.eyJmb3JnZWQiOnRydWV9.bad_signature` },
      })
    );
    expect(forgedRes.status).toBe(401);

    // Cross-room cookie replay (taking Room A token and sending it under Room B cookie name) fails 403
    const roomATokenValue = roomACookie.split("=").slice(1).join("=");
    const crossRoomCookieName = getGuestCookieName(roomB.roomId);
    const crossRoomRes = await getGuestSession(
      new Request(`${ORIGIN}/api/guest/session?roomId=${roomB.roomId}`, {
        headers: { cookie: `${crossRoomCookieName}=${roomATokenValue}` },
      })
    );
    expect(crossRoomRes.status).toBe(403);
    expect((await crossRoomRes.json()).error).toBe("CAPABILITY_ROOM_MISMATCH");

    // Cross-site CSRF requests fail 403 even with valid cookie
    const csrfBadOrigin = await postHostCheck(
      new Request(`${ORIGIN}/api/guest/host-check`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil-attacker.example",
          cookie: roomACookie,
        },
        body: JSON.stringify({ roomId: roomA.roomId }),
      })
    );
    expect(csrfBadOrigin.status).toBe(403);
    expect((await csrfBadOrigin.json()).error).toBe("CSRF_FORBIDDEN");

    const csrfMissingHeaders = await postRotateSession(
      new Request(`${ORIGIN}/api/guest/session/rotate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: roomACookie,
        },
        body: JSON.stringify({ roomId: roomA.roomId }),
      })
    );
    expect(csrfMissingHeaders.status).toBe(403);

    // Rotate Room A host capability -> gen 1 rejected, gen 2 accepted
    const rotateRes = await postRotateSession(
      new Request(`${ORIGIN}/api/guest/session/rotate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: roomACookie,
        },
        body: JSON.stringify({ roomId: roomA.roomId }),
      })
    );
    expect(rotateRes.status).toBe(200);
    const rotatedBody = await rotateRes.json();
    expect(rotatedBody.generation).toBe(2);
    expect(rotatedBody.participantId).toBe(roomA.participantId);
    const rotatedCookie = extractSetCookiePair(rotateRes, roomACookieName).cookiePair;

    const replayOldGen = await getGuestSession(
      new Request(`${ORIGIN}/api/guest/session?roomId=${roomA.roomId}`, {
        headers: { cookie: roomACookie },
      })
    );
    expect(replayOldGen.status).toBe(401);
    expect((await replayOldGen.json()).error).toBe("CAPABILITY_REVOKED");

    const useNewGen = await getGuestSession(
      new Request(`${ORIGIN}/api/guest/session?roomId=${roomA.roomId}`, {
        headers: { cookie: rotatedCookie },
      })
    );
    expect(useNewGen.status).toBe(200);
    expect((await useNewGen.json()).generation).toBe(2);
  });
});
