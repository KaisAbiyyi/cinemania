// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { POST as createRoomPost } from "@/app/api/rooms/route";
import { POST as joinRoomPost } from "@/app/api/rooms/join/route";
import { GET as getRoomSnapshotGet } from "@/app/api/rooms/[roomId]/route";
import { resetRoomAuthorityStoreForTests } from "@/lib/server/room/roomStore";
import { handleGuestApiError } from "@/lib/server/auth/guestResponse";
import { RoomCodeGenerationError } from "@/lib/server/room/roomCode";

const TEST_SECRET = "test-capability-signing-secret-cine-014-64-characters-long-abcdef01";

function createSameOriginJsonRequest(
  url: string,
  body?: unknown,
  cookieHeader?: string
): Request {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  };
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function extractSetCookiePair(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return "";
  return setCookie.split(";")[0];
}

describe("CINE-014 Room Create/Join/Code/Capacity API Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine014-api-"));
    process.env.CINEMATCH_CAPABILITY_SECRET = TEST_SECRET;
    process.env.CINEMATCH_SQLITE_PATH = path.join(tmpDir, "rooms.sqlite");
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_PG_HOST;
    delete process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD;
    resetRoomAuthorityStoreForTests();
  });

  afterEach(() => {
    resetRoomAuthorityStoreForTests();
    delete process.env.CINEMATCH_CAPABILITY_SECRET;
    delete process.env.CINEMATCH_SQLITE_PATH;
    delete process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD;
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it("supports guest room creation, normalized invite-link join without account, and authenticated room snapshot", async () => {
    // 1. Host creates room (empty-body displayName fallback or custom name)
    const createRes = await createRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms", { displayName: "  Alice   Host  " })
    );
    expect(createRes.status).toBe(201);
    const hostCookieHeader = createRes.headers.get("set-cookie") ?? "";
    expect(hostCookieHeader).toContain("HttpOnly");
    expect(hostCookieHeader).toContain("SameSite=lax");
    const hostCookie = extractSetCookiePair(createRes);

    const created = await createRes.json();
    expect(created.viewer).toMatchObject({
      displayName: "Alice Host",
      role: "HOST",
    });
    expect(created.room.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(created.room.invitePath).toBe(`/join/${created.room.code}`);
    expect(created.room.status).toBe("LOBBY");
    expect(created.room.participantCount).toBe(1);
    expect(created.room.maxParticipants).toBe(5);
    expect(created.room.minParticipantsToStart).toBe(2);
    expect(created.room.canStart).toBe(false);
    // Invite path and JSON payload must never expose capability secret
    expect(created.room.invitePath).not.toContain("cm_guest_");
    expect(JSON.stringify(created)).not.toContain(TEST_SECRET);

    // 2. Guest joins using mixed-case hyphenated invite URL carrying a decoy query token
    const dashedLower = `${created.room.code.slice(0, 3).toLowerCase()}-${created.room.code
      .slice(3)
      .toLowerCase()}`;
    const joinRes = await joinRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
        inviteLink: `https://example.com/join/${dashedLower}?token=should-never-leak`,
        displayName: "Bob Guest",
      })
    );
    expect(joinRes.status).toBe(200);
    const guestCookie = extractSetCookiePair(joinRes);
    expect(guestCookie).toMatch(new RegExp(`^cm_guest_${created.room.roomId}=`));

    const joined = await joinRes.json();
    expect(joined.viewer).toMatchObject({
      displayName: "Bob Guest",
      role: "MEMBER",
    });
    expect(joined.room.participantCount).toBe(2);
    expect(joined.room.stateVersion).toBe(2);
    expect(joined.room.canStart).toBe(true);
    expect(
      joined.room.participants.map((p: { displayName: string; role: string; isSelf: boolean }) => ({
        displayName: p.displayName,
        role: p.role,
        isSelf: p.isSelf,
      }))
    ).toEqual([
      { displayName: "Alice Host", role: "HOST", isSelf: false },
      { displayName: "Bob Guest", role: "MEMBER", isSelf: true },
    ]);
    for (const p of joined.room.participants) {
      expect("participantId" in p).toBe(false);
    }
    expect(JSON.stringify(joined.room)).not.toContain(created.viewer.participantId);
    expect(JSON.stringify(joined.room)).not.toContain(joined.viewer.participantId);

    // 3. Authenticated snapshot fetch works for members, enforces peer privacy, and fails closed for strangers
    const authedGet = await getRoomSnapshotGet(
      new NextRequest(`http://localhost:3000/api/rooms/${created.room.roomId}`, {
        headers: { cookie: hostCookie },
      }),
      { params: Promise.resolve({ roomId: created.room.roomId }) }
    );
    expect(authedGet.status).toBe(200);
    const snapshot = await authedGet.json();
    expect(snapshot.room.participantCount).toBe(2);
    expect(snapshot.room.stateVersion).toBe(2);
    expect(snapshot.viewer.role).toBe("HOST");
    expect(snapshot.viewer.participantId).toBe(created.viewer.participantId);
    expect(
      snapshot.room.participants.map((p: { displayName: string; isSelf: boolean }) => ({
        displayName: p.displayName,
        isSelf: p.isSelf,
      }))
    ).toEqual([
      { displayName: "Alice Host", isSelf: true },
      { displayName: "Bob Guest", isSelf: false },
    ]);
    expect(JSON.stringify(snapshot.room)).not.toContain(created.viewer.participantId);
    expect(JSON.stringify(snapshot.room)).not.toContain(joined.viewer.participantId);

    const guestGet = await getRoomSnapshotGet(
      new NextRequest(`http://localhost:3000/api/rooms/${created.room.roomId}`, {
        headers: { cookie: guestCookie },
      }),
      { params: Promise.resolve({ roomId: created.room.roomId }) }
    );
    expect(guestGet.status).toBe(200);
    const guestSnapshot = await guestGet.json();
    expect(guestSnapshot.viewer.participantId).toBe(joined.viewer.participantId);
    expect(guestSnapshot.viewer.participantId).not.toBe(created.viewer.participantId);
    expect(guestSnapshot.room.participants.map((p: { isSelf: boolean }) => p.isSelf)).toEqual([
      false,
      true,
    ]);
    expect(JSON.stringify(guestSnapshot.room)).not.toContain(created.viewer.participantId);
    expect(JSON.stringify(guestSnapshot.room)).not.toContain(joined.viewer.participantId);

    const unauthedGet = await getRoomSnapshotGet(
      new NextRequest(`http://localhost:3000/api/rooms/${created.room.roomId}`),
      { params: Promise.resolve({ roomId: created.room.roomId }) }
    );
    expect(unauthedGet.status).toBe(401);
    expect(await unauthedGet.json()).toMatchObject({ error: "CAPABILITY_MISSING" });
  });

  it("accepts 10 parallel join requests safely: admits up to ceiling 5 and rejects concurrent 6th+ joins", async () => {
    const createRes = await createRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms", { displayName: "Room Host" })
    );
    expect(createRes.status).toBe(201);
    const hostCookie = extractSetCookiePair(createRes);
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const roomCode: string = created.room.code;

    // Host occupies 1 slot. Firing 10 concurrent guest joins can only admit 4 more (total = 5).
    const parallelResponses = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        joinRoomPost(
          createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
            code: roomCode,
            displayName: `Parallel Guest ${idx + 1}`,
          })
        )
      )
    );

    const accepted: Response[] = [];
    const rejected: Response[] = [];
    for (const res of parallelResponses) {
      if (res.status === 200) {
        accepted.push(res);
      } else {
        rejected.push(res);
      }
    }

    expect(accepted).toHaveLength(4);
    expect(rejected).toHaveLength(6);

    for (const fullRes of rejected) {
      expect(fullRes.status).toBe(409);
      expect(fullRes.headers.get("set-cookie")).toBeNull();
      const body = await fullRes.json();
      expect(body.error).toBe("ROOM_FULL");
    }

    // Sequential/additional join at 5/5 must also reject cleanly without Set-Cookie
    const seventhJoin = await joinRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
        code: roomCode,
        displayName: "Latecomer",
      })
    );
    expect(seventhJoin.status).toBe(409);
    expect(seventhJoin.headers.get("set-cookie")).toBeNull();
    expect(await seventhJoin.json()).toMatchObject({ error: "ROOM_FULL" });

    // Existing HOST or MEMBER can still idempotently rejoin at 5/5 without exceeding capacity
    const hostRejoin = await joinRoomPost(
      createSameOriginJsonRequest(
        "http://localhost:3000/api/rooms/join",
        { code: roomCode },
        hostCookie
      )
    );
    expect(hostRejoin.status).toBe(200);
    const rejoinedBody = await hostRejoin.json();
    expect(rejoinedBody.viewer.role).toBe("HOST");
    expect(rejoinedBody.room.participantCount).toBe(5);

    const finalGet = await getRoomSnapshotGet(
      new NextRequest(`http://localhost:3000/api/rooms/${roomId}`, {
        headers: { cookie: hostCookie },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(finalGet.status).toBe(200);
    const finalSnapshot = await finalGet.json();
    expect(finalSnapshot.room.participantCount).toBe(5);
    expect(finalSnapshot.room.participants).toHaveLength(5);
  });

  it("rejects invalid codes, nonexistent codes, expired rooms, non-LOBBY rooms, and CSRF failures safely", async () => {
    const createRes = await createRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms", { displayName: "Host" })
    );
    const hostCookie = extractSetCookiePair(createRes);
    const created = await createRes.json();

    // 1. Invalid code formats -> 400 INVALID_ROOM_CODE
    for (const badCode of ["", "AB", "TOO_LONG", "000000", "O1I2AB", "<script>alert(1)</script>"]) {
      const res = await joinRoomPost(
        createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", { code: badCode })
      );
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
      const errBody = await res.json();
      expect(errBody.error).toBe("INVALID_ROOM_CODE");
      expect(errBody.message).not.toContain("<script>");
    }

    // 2. Nonexistent well-formed code -> 404 ROOM_NOT_FOUND
    const notFoundRes = await joinRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", { code: "ZZZZZZ" })
    );
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.headers.get("set-cookie")).toBeNull();
    expect(await notFoundRes.json()).toMatchObject({ error: "ROOM_NOT_FOUND" });

    // 3. Cross-origin CSRF rejected
    const csrfRes = await createRoomPost(
      new Request("http://localhost:3000/api/rooms", {
        method: "POST",
        headers: { origin: "https://evil.example" },
      })
    );
    expect(csrfRes.status).toBe(403);
    expect(await csrfRes.json()).toMatchObject({ error: "CSRF_FORBIDDEN" });

    // 4. Non-LOBBY (ACTIVE) room rejects new joins -> 409 ROOM_NOT_JOINABLE
    const directDb = new DatabaseSync(process.env.CINEMATCH_SQLITE_PATH!);
    try {
      directDb
        .prepare("UPDATE rooms SET status = 'ACTIVE' WHERE id = ?")
        .run(created.room.roomId);

      const activeJoin = await joinRoomPost(
        createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
          code: created.room.code,
          displayName: "Midround Outsider",
        })
      );
      expect(activeJoin.status).toBe(409);
      expect(activeJoin.headers.get("set-cookie")).toBeNull();
      expect(await activeJoin.json()).toMatchObject({ error: "ROOM_NOT_JOINABLE" });

      // 5. Expired room (both past expires_at deadline & status = 'EXPIRED') -> 410 ROOM_EXPIRED
      const pastIso = new Date(Date.now() - 120_000).toISOString();
      directDb
        .prepare("UPDATE rooms SET status = 'LOBBY', expires_at = ? WHERE id = ?")
        .run(pastIso, created.room.roomId);

      const lazyExpiredJoin = await joinRoomPost(
        createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
          code: created.room.code,
          displayName: "Too Late",
        })
      );
      expect(lazyExpiredJoin.status).toBe(410);
      expect(lazyExpiredJoin.headers.get("set-cookie")).toBeNull();
      expect(await lazyExpiredJoin.json()).toMatchObject({ error: "ROOM_EXPIRED" });

      // Authenticated GET on past-TTL room also fails closed with 410 ROOM_EXPIRED
      const lazyExpiredGet = await getRoomSnapshotGet(
        new NextRequest(`http://localhost:3000/api/rooms/${created.room.roomId}`, {
          headers: { cookie: hostCookie },
        }),
        { params: Promise.resolve({ roomId: created.room.roomId }) }
      );
      expect(lazyExpiredGet.status).toBe(410);
      expect(await lazyExpiredGet.json()).toMatchObject({ error: "ROOM_EXPIRED" });

      directDb
        .prepare("UPDATE rooms SET status = 'EXPIRED' WHERE id = ?")
        .run(created.room.roomId);

      const statusExpiredJoin = await joinRoomPost(
        createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
          code: created.room.code,
          displayName: "Also Too Late",
        })
      );
      expect(statusExpiredJoin.status).toBe(410);
      expect(statusExpiredJoin.headers.get("set-cookie")).toBeNull();
      expect(await statusExpiredJoin.json()).toMatchObject({ error: "ROOM_EXPIRED" });

      // Authenticated GET on EXPIRED room returns 410 ROOM_EXPIRED
      const expiredGet = await getRoomSnapshotGet(
        new NextRequest(`http://localhost:3000/api/rooms/${created.room.roomId}`, {
          headers: { cookie: hostCookie },
        }),
        { params: Promise.resolve({ roomId: created.room.roomId }) }
      );
      expect(expiredGet.status).toBe(410);
      expect(await expiredGet.json()).toMatchObject({ error: "ROOM_EXPIRED" });
    } finally {
      directDb.close();
    }
  });

  it("maps RoomCodeGenerationError cleanly to HTTP 503 and fails closed in misconfigured production", async () => {
    const mapped = handleGuestApiError(new RoomCodeGenerationError("exhausted retries"));
    expect(mapped.status).toBe(503);
    expect(await mapped.json()).toMatchObject({ error: "ROOM_CODE_GENERATION_FAILED" });

    const prevEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    resetRoomAuthorityStoreForTests();
    try {
      const prodRes = await createRoomPost(
        createSameOriginJsonRequest("http://localhost:3000/api/rooms", { displayName: "Host" })
      );
      expect(prodRes.status).toBe(500);
      const body = await prodRes.json();
      expect(body.error).toBe("DURABLE_STORE_UNCONFIGURED");
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
      resetRoomAuthorityStoreForTests();
    }
  });

  it("maintains snapshot stateVersion, participantCount, outbox versions, and peer confidentiality across interleaved joins and reads", async () => {
    const createRes = await createRoomPost(
      createSameOriginJsonRequest("http://localhost:3000/api/rooms", { displayName: "Coherent Host" })
    );
    expect(createRes.status).toBe(201);
    const hostCookie = extractSetCookiePair(createRes);
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const roomCode: string = created.room.code;

    const ops: Array<Promise<{ kind: "join" | "get"; body: { room: { stateVersion: number; participantCount: number; participants: Array<Record<string, unknown>> }; viewer: { participantId: string } } }>> = [];
    for (let i = 0; i < 4; i++) {
      ops.push(
        joinRoomPost(
          createSameOriginJsonRequest("http://localhost:3000/api/rooms/join", {
            code: roomCode,
            displayName: `Concurrent ${i + 2}`,
          })
        ).then(async (res) => {
          expect(res.status).toBe(200);
          return { kind: "join" as const, body: await res.json() };
        })
      );
      ops.push(
        getRoomSnapshotGet(
          new NextRequest(`http://localhost:3000/api/rooms/${roomId}`, {
            headers: { cookie: hostCookie },
          }),
          { params: Promise.resolve({ roomId }) }
        ).then(async (res) => {
          expect(res.status).toBe(200);
          return { kind: "get" as const, body: await res.json() };
        })
      );
      ops.push(
        getRoomSnapshotGet(
          new NextRequest(`http://localhost:3000/api/rooms/${roomId}`, {
            headers: { cookie: hostCookie },
          }),
          { params: Promise.resolve({ roomId }) }
        ).then(async (res) => {
          expect(res.status).toBe(200);
          return { kind: "get" as const, body: await res.json() };
        })
      );
    }

    const results = await Promise.all(ops);
    const knownIds = new Set<string>([created.viewer.participantId]);
    for (const r of results) {
      knownIds.add(r.body.viewer.participantId);
      expect(r.body.room.participantCount).toBe(r.body.room.participants.length);
      expect(r.body.room.stateVersion).toBe(r.body.room.participantCount);
      for (const participant of r.body.room.participants) {
        expect("participantId" in participant).toBe(false);
      }
      expect(r.body.room.participants.filter((p) => p.isSelf === true)).toHaveLength(1);
    }

    const finalGet = await getRoomSnapshotGet(
      new NextRequest(`http://localhost:3000/api/rooms/${roomId}`, {
        headers: { cookie: hostCookie },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(finalGet.status).toBe(200);
    const finalBody = await finalGet.json();
    expect(finalBody.room.stateVersion).toBe(5);
    expect(finalBody.room.participantCount).toBe(5);
    const serializedRoom = JSON.stringify(finalBody.room);
    for (const pid of knownIds) {
      expect(serializedRoom).not.toContain(pid);
    }

    const directDb = new DatabaseSync(process.env.CINEMATCH_SQLITE_PATH!);
    try {
      const events = directDb
        .prepare("SELECT version, event_type FROM room_events WHERE room_id = ? ORDER BY version ASC;")
        .all(roomId) as Array<{ version: number; event_type: string }>;
      expect(events.map((e) => e.version)).toEqual([1, 2, 3, 4, 5]);
      expect(events[0].event_type).toBe("ROOM_CREATED");
      expect(Math.max(...events.map((e) => e.version))).toBe(finalBody.room.stateVersion);
    } finally {
      directDb.close();
    }
  });
});
