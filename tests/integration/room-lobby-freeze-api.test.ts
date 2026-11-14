// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as createRoomPost } from "@/app/api/rooms/route";
import { POST as joinRoomPost } from "@/app/api/rooms/join/route";
import { GET as getRoomSnapshotGet } from "@/app/api/rooms/[roomId]/route";
import { POST as leaveRoomPost } from "@/app/api/rooms/[roomId]/leave/route";
import { POST as startRoomPost } from "@/app/api/rooms/[roomId]/start/route";
import { resetRoomAuthorityStoreForTests } from "@/lib/server/room/roomStore";

const TEST_SECRET = "test-capability-signing-secret-cine-015-64-characters-long-abcdef02";

function createSameOriginPost(
  url: string,
  body?: unknown,
  cookieHeader?: string
): NextRequest {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  };
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function extractSetCookiePair(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return "";
  return setCookie.split(";")[0] ?? "";
}

async function createRoomHelper(displayName = "Alice Host") {
  const res = await createRoomPost(
    createSameOriginPost("http://localhost:3000/api/rooms", { displayName })
  );
  expect(res.status).toBe(201);
  return {
    cookie: extractSetCookiePair(res),
    body: await res.json(),
  };
}

async function joinRoomHelper(code: string, displayName: string, cookie?: string) {
  const res = await joinRoomPost(
    createSameOriginPost("http://localhost:3000/api/rooms/join", { code, displayName }, cookie)
  );
  return {
    res,
    cookie: extractSetCookiePair(res),
    body: await res.json(),
  };
}

async function getSnapshotHelper(roomId: string, cookie: string) {
  const res = await getRoomSnapshotGet(
    new NextRequest(`http://localhost:3000/api/rooms/${roomId}`, {
      headers: { cookie },
    }),
    { params: Promise.resolve({ roomId }) }
  );
  return { res, body: await res.json() };
}

describe("CINE-015 Lobby Roster, Leave/Host Transfer, Start & Freeze API Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine015-api-"));
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

  it("enforces host-only start, 1 rejected, 2..5 accepted, active late-join denial, and ignores client roster/quorum tamper", async () => {
    for (const targetCount of [2, 3, 4, 5]) {
      const created = await createRoomHelper("Host Zero");
      const roomId: string = created.body.room.roomId;
      const code: string = created.body.room.code;

      // 1 participant cannot start
      const soloStart = await startRoomPost(
        createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, created.cookie),
        { params: Promise.resolve({ roomId }) }
      );
      expect(soloStart.status).toBe(409);
      expect(await soloStart.json()).toMatchObject({ error: "INSUFFICIENT_PARTICIPANTS" });

      const members: Array<{ cookie: string; pid: string }> = [];
      for (let i = 2; i <= targetCount; i++) {
        const joined = await joinRoomHelper(code, `Member ${i}`);
        expect(joined.res.status).toBe(200);
        members.push({ cookie: joined.cookie, pid: joined.body.viewer.participantId });
      }

      // 6th join fails cleanly if already 5
      if (targetCount === 5) {
        const sixthJoin = await joinRoomHelper(code, "Sixth Guest");
        expect(sixthJoin.res.status).toBe(409);
        expect(sixthJoin.body.error).toBe("ROOM_FULL");
      }

      // Non-host member cannot start
      const memberStart = await startRoomPost(
        createSameOriginPost(
          `http://localhost:3000/api/rooms/${roomId}/start`,
          {},
          members[0]!.cookie
        ),
        { params: Promise.resolve({ roomId }) }
      );
      expect(memberStart.status).toBe(403);
      expect(await memberStart.json()).toMatchObject({ error: "HOST_ONLY_ACTION" });

      // Cross-origin CSRF on start & leave rejected 403
      const csrfStart = await startRoomPost(
        new NextRequest(`http://localhost:3000/api/rooms/${roomId}/start`, {
          method: "POST",
          headers: { origin: "https://evil.example", cookie: created.cookie },
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(csrfStart.status).toBe(403);

      // Host starts while passing malicious client quorum/roster tamper payload -> completely ignored!
      const startRes = await startRoomPost(
        createSameOriginPost(
          `http://localhost:3000/api/rooms/${roomId}/start`,
          {
            quorum: 1,
            frozenQuorum: 1,
            participantIds: [created.body.viewer.participantId],
            eligibleVoterIds: [created.body.viewer.participantId],
            hostParticipantId: members[0]!.pid,
          },
          created.cookie
        ),
        { params: Promise.resolve({ roomId }) }
      );
      expect(startRes.status).toBe(200);
      const started = await startRes.json();
      expect(started.room.status).toBe("ACTIVE");
      expect(started.room.canStart).toBe(false);
      expect(started.room.currentRoundId).toBeTruthy();
      expect(started.room.frozenQuorum).toBe(targetCount);
      expect(started.room.participants).toHaveLength(targetCount);
      expect(started.viewer.isEligibleVoter).toBe(true);
      expect(
        started.room.participants.every((p: { isEligibleVoter: boolean }) => p.isEligibleVoter)
      ).toBe(true);

      // Late join while ACTIVE denied cleanly with zero frozen quorum mutation
      const lateJoin = await joinRoomHelper(code, "Latecomer");
      expect(lateJoin.res.status).toBe(409);
      expect(lateJoin.body.error).toBe("ROOM_NOT_JOINABLE");
      expect(lateJoin.res.headers.get("set-cookie")).toBeNull();

      // Re-starting already ACTIVE room fails 409 ROOM_ALREADY_ACTIVE
      const doubleStart = await startRoomPost(
        createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, created.cookie),
        { params: Promise.resolve({ roomId }) }
      );
      expect(doubleStart.status).toBe(409);
      expect(await doubleStart.json()).toMatchObject({ error: "ROOM_ALREADY_ACTIVE" });

      // Existing member can still idempotently reconnect via valid room cookie without altering frozenQuorum
      const reconnect = await joinRoomHelper(code, "Ignored Name", members[0]!.cookie);
      expect(reconnect.res.status).toBe(200);
      expect(reconnect.body.room.frozenQuorum).toBe(targetCount);
      expect(reconnect.body.viewer.isEligibleVoter).toBe(true);

      // Inspect persisted DB round_participants strictly matches targetCount
      const inspectDb = new DatabaseSync(process.env.CINEMATCH_SQLITE_PATH!);
      try {
        const frozenRows = inspectDb
          .prepare("SELECT participant_id FROM round_participants WHERE room_id = ?;")
          .all(roomId) as Array<{ participant_id: string }>;
        expect(frozenRows).toHaveLength(targetCount);
        const expectedSet = new Set([
          created.body.viewer.participantId,
          ...members.map((m) => m.pid),
        ]);
        expect(new Set(frozenRows.map((r) => r.participant_id))).toEqual(expectedSet);
      } finally {
        inspectDb.close();
      }
    }
  });

  it("supports lobby leave, drops room below start quorum if 2->1, transfers host deterministically, and closes room if lone participant leaves", async () => {
    const alice = await createRoomHelper("Alice Host");
    const roomId: string = alice.body.room.roomId;
    const code: string = alice.body.room.code;

    const bob = await joinRoomHelper(code, "Bob Member");
    const charlie = await joinRoomHelper(code, "Charlie Member");
    expect(charlie.body.room.participantCount).toBe(3);

    // Charlie leaves -> participantCount=2, Alice remains HOST
    const charlieLeave = await leaveRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/leave`, {}, charlie.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(charlieLeave.status).toBe(200);
    expect(charlieLeave.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await charlieLeave.json()).toMatchObject({
      left: true,
      roomClosed: false,
      participantCount: 2,
      hostTransferred: false,
    });

    // Charlie's old cookie is denied from snapshot and from rejoining via stale cookie
    const charlieAfter = await getSnapshotHelper(roomId, charlie.cookie);
    expect(charlieAfter.res.status).toBe(403);
    expect(charlieAfter.body.error).toBe("PARTICIPANT_NOT_IN_ROOM");

    // Host Alice leaves -> Bob promoted deterministically to HOST, count drops 2 -> 1
    const aliceLeave = await leaveRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/leave`, {}, alice.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(aliceLeave.status).toBe(200);
    expect(await aliceLeave.json()).toMatchObject({
      left: true,
      roomClosed: false,
      participantCount: 1,
      hostTransferred: true,
    });

    const bobSolo = await getSnapshotHelper(roomId, bob.cookie);
    expect(bobSolo.res.status).toBe(200);
    expect(bobSolo.body.viewer.role).toBe("HOST");
    expect(bobSolo.body.room.participantCount).toBe(1);
    expect(bobSolo.body.room.canStart).toBe(false);

    // Promoted Bob cannot start while 1 participant remains
    const bobStartSolo = await startRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, bob.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(bobStartSolo.status).toBe(409);

    // Alice joins fresh (no cookie) -> becomes MEMBER under promoted HOST Bob!
    const aliceRejoin = await joinRoomHelper(code, "Alice Returned");
    expect(aliceRejoin.res.status).toBe(200);
    expect(aliceRejoin.body.viewer.role).toBe("MEMBER");
    expect(aliceRejoin.body.room.canStart).toBe(true);

    // Alice (former host, now MEMBER) cannot start -> HOST_ONLY_ACTION
    const aliceStartDenied = await startRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, aliceRejoin.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(aliceStartDenied.status).toBe(403);
    expect(await aliceStartDenied.json()).toMatchObject({ error: "HOST_ONLY_ACTION" });

    // Promoted Bob CAN start -> freezes [Bob, Alice Returned] with frozenQuorum=2
    const bobStart = await startRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, bob.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(bobStart.status).toBe(200);
    const bobStarted = await bobStart.json();
    expect(bobStarted.room.frozenQuorum).toBe(2);

    // Leave during ACTIVE is rejected cleanly without altering frozenQuorum
    const activeLeave = await leaveRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/leave`, {}, aliceRejoin.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(activeLeave.status).toBe(409);
    expect(await activeLeave.json()).toMatchObject({ error: "LOBBY_LEAVE_CLOSED" });

    // Separate room: lone host leaving in LOBBY transitions room to EXPIRED and revokes session
    const soloRoom = await createRoomHelper("Solo Close");
    const soloRoomId: string = soloRoom.body.room.roomId;
    const soloLeave = await leaveRoomPost(
      createSameOriginPost(
        `http://localhost:3000/api/rooms/${soloRoomId}/leave`,
        {},
        soloRoom.cookie
      ),
      { params: Promise.resolve({ roomId: soloRoomId }) }
    );
    expect(soloLeave.status).toBe(200);
    expect(await soloLeave.json()).toMatchObject({
      left: true,
      roomClosed: true,
      status: "EXPIRED",
    });

    const staleAfterClose = await getSnapshotHelper(soloRoomId, soloRoom.cookie);
    expect([401, 410]).toContain(staleAfterClose.res.status);

    const strangerAfterClose = await joinRoomHelper(soloRoom.body.room.code, "Late");
    expect(strangerAfterClose.res.status).toBe(410);
  });

  it("converges identical rosters across two independent participant tabs with zero peer UUID leakage", async () => {
    const host = await createRoomHelper("Host <script>alert(1)</script> Alpha");
    expect(host.body.viewer.displayName).toBe("Host Alpha");
    const roomId: string = host.body.room.roomId;
    const code: string = host.body.room.code;

    const tabB = await joinRoomHelper(code, "  <b>Beta</b> 🎬  ");
    expect(tabB.res.status).toBe(200);
    expect(tabB.body.viewer.displayName).toBe("Beta 🎬");

    const tabC = await joinRoomHelper(code, "Gamma \u202E田中");
    expect(tabC.res.status).toBe(200);
    expect(tabC.body.viewer.displayName).toBe("Gamma 田中");

    // Bad XSS-only nicknames rejected 400
    for (const xssName of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "   \u200B  "]) {
      const bad = await joinRoomHelper(code, xssName);
      expect(bad.res.status).toBe(400);
      expect(bad.body.error).toBe("INVALID_DISPLAY_NAME");
    }

    const startRes = await startRoomPost(
      createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, host.cookie),
      { params: Promise.resolve({ roomId }) }
    );
    expect(startRes.status).toBe(200);

    const [viewHost, viewB, viewC] = await Promise.all([
      getSnapshotHelper(roomId, host.cookie),
      getSnapshotHelper(roomId, tabB.cookie),
      getSnapshotHelper(roomId, tabC.cookie),
    ]);

    const normalizeForConvergence = (room: Record<string, unknown>) => ({
      ...room,
      participants: (room.participants as Array<Record<string, unknown>>).map((p) => ({
        displayName: p.displayName,
        role: p.role,
        isConnected: p.isConnected,
        joinedAt: p.joinedAt,
        isEligibleVoter: p.isEligibleVoter,
      })),
    });

    expect(normalizeForConvergence(viewHost.body.room)).toEqual(
      normalizeForConvergence(viewB.body.room)
    );
    expect(normalizeForConvergence(viewB.body.room)).toEqual(
      normalizeForConvergence(viewC.body.room)
    );
    expect(viewHost.body.room.frozenQuorum).toBe(3);

    // Check isSelf differs accurately and ZERO participant UUIDs appear anywhere in room snapshot
    expect(viewHost.body.room.participants.map((p: { isSelf: boolean }) => p.isSelf)).toEqual([
      true,
      false,
      false,
    ]);
    expect(viewB.body.room.participants.map((p: { isSelf: boolean }) => p.isSelf)).toEqual([
      false,
      true,
      false,
    ]);
    const allPids = [
      host.body.viewer.participantId,
      tabB.body.viewer.participantId,
      tabC.body.viewer.participantId,
    ];
    for (const view of [viewHost.body.room, viewB.body.room, viewC.body.room]) {
      const serialized = JSON.stringify(view);
      for (const pid of allPids) {
        expect(serialized).not.toContain(pid);
      }
    }
  });

  it("serializes race conditions between host start and concurrent join/leave consistently across rounds", async () => {
    // Race A: host start vs concurrent join in 2-player LOBBY (8 rounds)
    for (let round = 0; round < 8; round++) {
      const host = await createRoomHelper(`RaceHost-${round}`);
      const guest2 = await joinRoomHelper(host.body.room.code, "Guest2");
      expect(guest2.res.status).toBe(200);

      const roomId: string = host.body.room.roomId;
      const [startRes, lateJoin] = await Promise.all([
        startRoomPost(
          createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, host.cookie),
          { params: Promise.resolve({ roomId }) }
        ),
        joinRoomHelper(host.body.room.code, "RaceJoiner"),
      ]);

      expect(startRes.status).toBe(200);
      const started = await startRes.json();
      const snapshot = await getSnapshotHelper(roomId, host.cookie);

      if (lateJoin.res.status === 200) {
        // Join committed before start: frozenQuorum MUST equal 3 and include RaceJoiner
        expect(started.room.frozenQuorum).toBe(3);
        expect(snapshot.body.room.frozenQuorum).toBe(3);
        expect(snapshot.body.room.participants).toHaveLength(3);
      } else {
        // Start committed before join: join rejected 409 ROOM_NOT_JOINABLE and frozenQuorum MUST be 2
        expect(lateJoin.res.status).toBe(409);
        expect(lateJoin.body.error).toBe("ROOM_NOT_JOINABLE");
        expect(started.room.frozenQuorum).toBe(2);
        expect(snapshot.body.room.frozenQuorum).toBe(2);
        expect(snapshot.body.room.participants).toHaveLength(2);
      }
    }

    // Race B: host start vs concurrent leave in 2-player & 3-player LOBBY (8 rounds each)
    for (let round = 0; round < 8; round++) {
      const host = await createRoomHelper(`RaceLeave2-${round}`);
      const guest2 = await joinRoomHelper(host.body.room.code, "Guest2");
      const roomId: string = host.body.room.roomId;

      const [startRes, leaveRes] = await Promise.all([
        startRoomPost(
          createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, host.cookie),
          { params: Promise.resolve({ roomId }) }
        ),
        leaveRoomPost(
          createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/leave`, {}, guest2.cookie),
          { params: Promise.resolve({ roomId }) }
        ),
      ]);

      const finalSnap = await getSnapshotHelper(roomId, host.cookie);
      if (leaveRes.status === 200) {
        // Leave committed before start: start MUST be rejected (count 1) and room remains LOBBY
        expect(startRes.status).toBe(409);
        expect(await startRes.json()).toMatchObject({ error: "INSUFFICIENT_PARTICIPANTS" });
        expect(finalSnap.body.room.status).toBe("LOBBY");
        expect(finalSnap.body.room.participantCount).toBe(1);
        expect(finalSnap.body.room.frozenQuorum).toBeNull();
      } else {
        // Start committed before leave: start froze 2 voters, leave MUST be rejected 409
        expect(leaveRes.status).toBe(409);
        expect(startRes.status).toBe(200);
        expect(finalSnap.body.room.status).toBe("ACTIVE");
        expect(finalSnap.body.room.frozenQuorum).toBe(2);
      }
    }

    for (let round = 0; round < 8; round++) {
      const host = await createRoomHelper(`RaceLeave3-${round}`);
      const guest2 = await joinRoomHelper(host.body.room.code, "Guest2");
      const guest3 = await joinRoomHelper(host.body.room.code, "Guest3");
      expect(guest2.res.status).toBe(200);
      expect(guest3.res.status).toBe(200);
      const roomId: string = host.body.room.roomId;

      const [startRes, leaveRes] = await Promise.all([
        startRoomPost(
          createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/start`, {}, host.cookie),
          { params: Promise.resolve({ roomId }) }
        ),
        leaveRoomPost(
          createSameOriginPost(`http://localhost:3000/api/rooms/${roomId}/leave`, {}, guest3.cookie),
          { params: Promise.resolve({ roomId }) }
        ),
      ]);

      expect(startRes.status).toBe(200);
      const started = await startRes.json();
      const finalSnap = await getSnapshotHelper(roomId, host.cookie);
      if (leaveRes.status === 200) {
        expect(started.room.frozenQuorum).toBe(2);
        expect(finalSnap.body.room.frozenQuorum).toBe(2);
        expect(finalSnap.body.room.participants).toHaveLength(2);
      } else {
        expect(leaveRes.status).toBe(409);
        expect(started.room.frozenQuorum).toBe(3);
        expect(finalSnap.body.room.frozenQuorum).toBe(3);
        expect(finalSnap.body.room.participants).toHaveLength(3);
      }
    }

    // Race C: concurrent duplicate host start clicks yield strictly 1 success + 1 409
    const dupHost = await createRoomHelper("DupHost");
    await joinRoomHelper(dupHost.body.room.code, "DupMember");
    const dupRoomId: string = dupHost.body.room.roomId;
    const [s1, s2] = await Promise.all([
      startRoomPost(
        createSameOriginPost(`http://localhost:3000/api/rooms/${dupRoomId}/start`, {}, dupHost.cookie),
        { params: Promise.resolve({ roomId: dupRoomId }) }
      ),
      startRoomPost(
        createSameOriginPost(`http://localhost:3000/api/rooms/${dupRoomId}/start`, {}, dupHost.cookie),
        { params: Promise.resolve({ roomId: dupRoomId }) }
      ),
    ]);
    const statuses = [s1.status, s2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    // Sanity check direct SQLite table count for rounds on dupRoomId === 1
    const inspectDb = new DatabaseSync(process.env.CINEMATCH_SQLITE_PATH!);
    try {
      const roundRows = inspectDb
        .prepare("SELECT id FROM rounds WHERE room_id = ?;")
        .all(dupRoomId);
      expect(roundRows).toHaveLength(1);
    } finally {
      inspectDb.close();
    }
  });
});
