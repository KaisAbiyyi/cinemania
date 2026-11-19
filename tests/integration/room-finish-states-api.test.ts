// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createRoomPost } from "@/app/api/rooms/route";
import { POST as joinRoomPost } from "@/app/api/rooms/join/route";
import { GET as getRoomSnapshotGet } from "@/app/api/rooms/[roomId]/route";
import { PATCH as updateFiltersPatch } from "@/app/api/rooms/[roomId]/filters/route";
import { POST as startRoomPost } from "@/app/api/rooms/[roomId]/start/route";
import { POST as retryRoomPost } from "@/app/api/rooms/[roomId]/retry/route";
import { POST as presenceRoomPost } from "@/app/api/rooms/[roomId]/presence/route";
import { POST as leaveRoomPost } from "@/app/api/rooms/[roomId]/leave/route";
import { POST as submitVotePost } from "@/app/api/rooms/[roomId]/votes/route";
import { DEFAULT_INACTIVITY_TTL_SECONDS } from "@/db/schema";
import { getGuestCookieName, mintGuestCapabilityToken } from "@/lib/server/auth/guestCapability";
import { RoomExpiryWorker, SystemClock } from "@/lib/server/room/expiryWorker";
import {
  getRoomAuthorityStore,
  resetRoomAuthorityStoreForTests,
} from "@/lib/server/room/roomStore";
import tmdbApi from "@/services/tmdbApi";

const TEST_SECRET = "test-capability-signing-secret-cine-020-64-characters-long-12345678";

function createSameOriginRequest(
  method: "POST" | "PATCH" | "GET",
  url: string,
  options: {
    body?: unknown;
    cookieHeader?: string;
    origin?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (method !== "GET") {
    headers.origin = options.origin ?? "http://localhost:3000";
    headers["content-type"] = "application/json";
  }
  if (options.cookieHeader) {
    headers.cookie = options.cookieHeader;
  }
  return new NextRequest(url, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

function extractCookieHeader(response: Response, roomId: string): string {
  const cookieName = getGuestCookieName(roomId);
  const setCookieHeader = response.headers.get("set-cookie") ?? "";
  const match = setCookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match) {
    throw new Error(`Missing Set-Cookie for ${cookieName}`);
  }
  return `${cookieName}=${match[1]}`;
}

function makeTmdbMovies(count: number, baseId = 800000): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, idx) => ({
    id: baseId + idx,
    title: `Finish API Movie ${baseId + idx}`,
    poster_path: `/api-poster-${baseId + idx}.jpg`,
    release_date: "2024-08-01",
    vote_average: 7.8,
    overview: `Overview for ${baseId + idx}`,
    adult: false,
  }));
}

async function setupRoomAndMembers(
  memberCount = 3,
  deckBaseId = 800000,
  stepMsBetweenJoins = 0
) {
  let currentBase = deckBaseId;
  const mockTmdb = vi.spyOn(tmdbApi, "get").mockImplementation((async (
    _url: string,
    config?: { params?: Record<string, unknown> }
  ) => {
    const genres = (config?.params as Record<string, unknown> | undefined)?.with_genres;
    const baseOffset = genres === "28" ? currentBase + 500 : genres === "35" ? currentBase + 1000 : currentBase;
    return {
      data: {
        page: 1,
        results: makeTmdbMovies(20, baseOffset),
        total_pages: 1,
        total_results: 20,
      },
    };
  }) as never);

  const createRes = await createRoomPost(
    createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
      body: { displayName: "Host Alice" },
    })
  );
  expect(createRes.status).toBe(201);
  const created = await createRes.json();
  const roomId: string = created.room.roomId;
  const code: string = created.room.code;
  const cookies: string[] = [extractCookieHeader(createRes, roomId)];
  const participantIds: string[] = [created.viewer.participantId];

  for (let i = 1; i < memberCount; i += 1) {
    if (stepMsBetweenJoins > 0) {
      await vi.advanceTimersByTimeAsync(stepMsBetweenJoins);
    }
    const joinRes = await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
        body: { code, displayName: `Guest ${i}` },
      })
    );
    expect(joinRes.status).toBe(200);
    const joined = await joinRes.json();
    cookies.push(extractCookieHeader(joinRes, roomId));
    participantIds.push(joined.viewer.participantId);
  }

  return {
    roomId,
    code,
    cookies,
    participantIds,
    setDeckBase: (nextBase: number) => {
      currentBase = nextBase;
    },
    mockTmdb,
  };
}

async function exhaustActiveRound(
  roomId: string,
  cookies: string[],
  roundId: string,
  deck: Array<{ candidateId: string; movieId: number }>
) {
  let lastBody: Record<string, unknown> | null = null;
  for (let idx = 0; idx < deck.length; idx += 1) {
    const card = deck[idx];
    for (let m = 0; m < cookies.length; m += 1) {
      const voteChoice = m === cookies.length - 1 ? "SKIP" : "LIKE";
      const res = await submitVotePost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
          cookieHeader: cookies[m],
          body: {
            roundId,
            candidateId: card.candidateId,
            movieId: card.movieId,
            vote: voteChoice,
            operationId: `exhaust-${roundId}-${idx}-m${m}`,
          },
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(res.status).toBe(200);
      lastBody = await res.json();
    }
  }
  return lastBody as {
    isExhausted: boolean;
    room: {
      status: string;
      canRetry: boolean;
      stateVersion: number;
      currentRoundId: string;
      deck: Array<{ candidateId: string; movieId: number }>;
      finishState: Record<string, unknown>;
    };
  };
}

describe("CINE-020 Finish States API Integration (Exhausted Retry, 90s Grace, Concurrent Host Races, 24h TTL & Cleanup)", () => {
  let tempDir: string;
  let sqlitePath: string;
  let prevSecret: string | undefined;
  let prevSqlitePath: string | undefined;
  let prevDatabaseUrl: string | undefined;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetRoomAuthorityStoreForTests();
    prevSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
    prevSqlitePath = process.env.CINEMATCH_SQLITE_PATH;
    prevDatabaseUrl = process.env.DATABASE_URL;

    delete process.env.DATABASE_URL;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine020-api-"));
    sqlitePath = path.join(tempDir, "rooms.sqlite");
    process.env.CINEMATCH_CAPABILITY_SECRET = TEST_SECRET;
    process.env.CINEMATCH_SQLITE_PATH = sqlitePath;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetRoomAuthorityStoreForTests();
    if (prevSecret === undefined) delete process.env.CINEMATCH_CAPABILITY_SECRET;
    else process.env.CINEMATCH_CAPABILITY_SECRET = prevSecret;

    if (prevSqlitePath === undefined) delete process.env.CINEMATCH_SQLITE_PATH;
    else process.env.CINEMATCH_SQLITE_PATH = prevSqlitePath;

    if (prevDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDatabaseUrl;

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("completes EXHAUSTED finish -> idempotent POST /retry (LOBBY + filters -> Round 2 ACTIVE, and direct startRound=true -> MATCHED), enforcing CSRF and HOST_ONLY_ACTION", async () => {
    const { roomId, cookies } = await setupRoomAndMembers(3, 810000);

    // CSRF rejection on retry and presence
    const badOriginRetry = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        origin: "https://evil.example",
        body: { startRound: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(badOriginRetry.status).toBe(403);

    const badOriginPresence = await presenceRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/presence`, {
        cookieHeader: cookies[0],
        origin: "https://evil.example",
        body: { connected: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(badOriginPresence.status).toBe(403);

    // Start Round 1
    const start1Res = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: cookies[0],
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(start1Res.status).toBe(200);
    const started1 = await start1Res.json();

    // Reject retry while ACTIVE (409 ROOM_NOT_EXHAUSTED)
    const retryWhileActive = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: { startRound: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(retryWhileActive.status).toBe(409);
    expect((await retryWhileActive.json()).error).toBe("ROOM_NOT_EXHAUSTED");

    // Exhaust all 20 candidates
    const exhausted = await exhaustActiveRound(
      roomId,
      cookies,
      started1.room.currentRoundId,
      started1.room.deck
    );
    expect(exhausted.isExhausted).toBe(true);
    expect(exhausted.room.status).toBe("EXHAUSTED");
    expect(exhausted.room.canRetry).toBe(true);
    expect(exhausted.room.finishState.code).toBe("DECK_EXHAUSTED");

    // Secret vote disclosure guarantee even in EXHAUSTED snapshot
    const guestSnapRes = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: cookies[1],
      }),
      { params: Promise.resolve({ roomId }) }
    );
    const guestSnap = await guestSnapRes.json();
    expect(guestSnap.room.status).toBe("EXHAUSTED");
    expect(JSON.stringify(guestSnap.room)).not.toContain('"LIKE"');
    expect(JSON.stringify(guestSnap.room)).not.toContain('"SKIP"');

    // Non-host guest cannot retry (403 HOST_ONLY_ACTION)
    const guestRetry = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[1],
        body: { startRound: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(guestRetry.status).toBe(403);
    expect((await guestRetry.json()).error).toBe("HOST_ONLY_ACTION");

    // Path A: Return to LOBBY -> update filters -> start Round 2
    const retryOpId = `retry-lobby-${started1.room.currentRoundId}`;
    const retryToLobbyRes = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: { startRound: false, operationId: retryOpId },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(retryToLobbyRes.status).toBe(200);
    const retriedLobby = await retryToLobbyRes.json();
    expect(retriedLobby.room.status).toBe("LOBBY");
    expect(retriedLobby.idempotentReplay).toBe(false);

    // Idempotent replay on same operationId
    const replayLobbyRes = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: { startRound: false, operationId: retryOpId },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(replayLobbyRes.status).toBe(200);
    const replayedLobby = await replayLobbyRes.json();
    expect(replayedLobby.idempotentReplay).toBe(true);
    expect(replayedLobby.room.stateVersion).toBe(retriedLobby.room.stateVersion);

    // Update filters & start Round 2
    const filterRes = await updateFiltersPatch(
      createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
        cookieHeader: cookies[0],
        body: { with_genres: "28", sort_by: "vote_average.desc" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(filterRes.status).toBe(200);

    const start2Res = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: cookies[0],
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(start2Res.status).toBe(200);
    const started2 = await start2Res.json();
    expect(started2.room.status).toBe("ACTIVE");
    expect(started2.room.currentRoundId).not.toBe(started1.room.currentRoundId);
    expect(started2.room.deck[0].movieId).toBeGreaterThanOrEqual(810500);

    const start2 = started2;
    expect(start2.room.frozenQuorum).toBe(3);

    // Replaying Round 1's `startRound: false` operationId AFTER Round 2 started must NOT crash 409 FROZEN_ROSTER_MISSING
    const replayAfterR2Start = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: { startRound: false, operationId: retryOpId },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(replayAfterR2Start.status).toBe(200);
    const replayR2Body = await replayAfterR2Start.json();
    expect(replayR2Body.idempotentReplay).toBe(true);
    expect(replayR2Body.room.status).toBe("ACTIVE");
    expect(replayR2Body.room.frozenQuorum).toBe(3);

    // Reusing the same operationId with different parameters must reject 409 OPERATION_CONFLICT
    const conflictRetry = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: { startRound: true, operationId: retryOpId, deckFilter: { with_genres: "28" } },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(conflictRetry.status).toBe(409);
    expect((await conflictRetry.json()).error).toBe("OPERATION_ID_CONFLICT");

    // Exhaust Round 2 and test Path B: direct startRound=true with comedy filter
    const exhausted2 = await exhaustActiveRound(
      roomId,
      cookies,
      started2.room.currentRoundId,
      started2.room.deck
    );
    expect(exhausted2.room.status).toBe("EXHAUSTED");

    const directRes = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: {
          startRound: true,
          deckFilter: { with_genres: "35", sort_by: "popularity.desc" },
          operationId: "direct-r3",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(directRes.status).toBe(200);
    const directR3 = await directRes.json();
    expect(directR3.room.status).toBe("ACTIVE");
    expect(directR3.room.deck[0].movieId).toBeGreaterThanOrEqual(811000);

    // Unanimous match in Round 3 succeeds
    const r3Card0 = directR3.room.deck[0];
    let finalVoteJson: Record<string, unknown> | null = null;
    for (const cookie of cookies) {
      const vRes = await submitVotePost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
          cookieHeader: cookie,
          body: {
            roundId: directR3.room.currentRoundId,
            candidateId: r3Card0.candidateId,
            movieId: r3Card0.movieId,
            vote: "LIKE",
          },
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(vRes.status).toBe(200);
      finalVoteJson = await vRes.json();
    }
    expect((finalVoteJson?.room as { status: string }).status).toBe("MATCHED");
    expect((finalVoteJson?.room as { matchedMovieId: number }).matchedMovieId).toBe(r3Card0.movieId);

    // Matched room rejects retry
    const retryMatched = await retryRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
        cookieHeader: cookies[0],
        body: { startRound: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(retryMatched.status).toBe(409);
    expect((await retryMatched.json()).error).toBe("ROOM_NOT_EXHAUSTED");
  });

  it("serializes concurrent host retry/start/filter races cleanly without split state", async () => {
    const { roomId, cookies } = await setupRoomAndMembers(2, 820000);
    const start1 = await (
      await startRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
          cookieHeader: cookies[0],
          body: {},
        }),
        { params: Promise.resolve({ roomId }) }
      )
    ).json();

    await exhaustActiveRound(roomId, cookies, start1.room.currentRoundId, start1.room.deck);

    // Competing concurrent retry requests with different operationIds/modes
    const [retryA, retryB] = await Promise.all([
      retryRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
          cookieHeader: cookies[0],
          body: { startRound: true, operationId: "race-direct", deckFilter: { with_genres: "28" } },
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      retryRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
          cookieHeader: cookies[0],
          body: { startRound: false, operationId: "race-lobby", deckFilter: { with_genres: "35" } },
        }),
        { params: Promise.resolve({ roomId }) }
      ),
    ]);

    const statuses = [retryA.status, retryB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);

    const bodyA = await retryA.json();
    const bodyB = await retryB.json();
    const loser = retryA.status === 409 ? bodyA : bodyB;
    expect(loser.error).toBe("ROOM_NOT_EXHAUSTED");

    // Exhausted-to-lobby followed by concurrent start vs filter update race
    if ((retryA.status === 200 ? bodyA : bodyB).room.status === "LOBBY") {
      const [sRes, fRes] = await Promise.all([
        startRoomPost(
          createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
            cookieHeader: cookies[0],
            body: {},
          }),
          { params: Promise.resolve({ roomId }) }
        ),
        updateFiltersPatch(
          createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
            cookieHeader: cookies[0],
            body: { sort_by: "vote_average.desc" },
          }),
          { params: Promise.resolve({ roomId }) }
        ),
      ]);
      // Either filter lands first (and start hits DECK_FILTER_CONFLICT) or start locks room first (filter hits FILTER_LOCKED)
      expect([200, 409]).toContain(sRes.status);
      expect([200, 409]).toContain(fRes.status);
      expect(sRes.status === 200 || fRes.status === 200).toBe(true);
    }
  });

  it("enforces fake-clock 90s reconnect grace, deterministic host handoff, round cancel & late-vote rejection via API handlers", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-17T06:00:00.000Z") });
    const { roomId, cookies } = await setupRoomAndMembers(3, 830000, 1000);

    // Start Round 1 with 3 voters
    const start1Res = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: cookies[0],
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    const start1 = await start1Res.json();
    const round1Id: string = start1.room.currentRoundId;
    const card0 = start1.room.deck[0];

    // Host casts LIKE on card 0, then disconnects
    const hostVoteRes = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[0],
        body: { roundId: round1Id, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(hostVoteRes.status).toBe(200);

    const discRes = await presenceRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/presence`, {
        cookieHeader: cookies[0],
        body: { connected: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(discRes.status).toBe(200);

    // At +89s (< 90s): snapshot still ACTIVE, host still HOST with graceExpiresAt
    await vi.advanceTimersByTimeAsync(89_000);
    const snap89Res = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: cookies[1],
      }),
      { params: Promise.resolve({ roomId }) }
    );
    const snap89 = await snap89Res.json();
    expect(snap89.room.status).toBe("ACTIVE");
    expect(snap89.room.participants[0].role).toBe("HOST");
    expect(snap89.room.participants[0].graceExpiresAt).toBeDefined();

    // Timely reconnect at 89s restores host connectivity seamlessly without duplicate rows or cancel
    const recon89Res = await presenceRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/presence`, {
        cookieHeader: cookies[0],
        body: { connected: true },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    const recon89 = await recon89Res.json();
    expect(recon89.room.status).toBe("ACTIVE");
    expect(recon89.viewer.role).toBe("HOST");
    expect(recon89.room.participants).toHaveLength(3);

    // Host disconnects AGAIN and exceeds 90s grace
    await presenceRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/presence`, {
        cookieHeader: cookies[0],
        body: { connected: false },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    await vi.advanceTimersByTimeAsync(90_000);

    // Guest 1 inspects snapshot -> server lazily sweeps timeout: promotes Guest 1 to HOST & cancels Round 1 -> LOBBY
    const snap90Res = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: cookies[1],
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(snap90Res.status).toBe(200);
    const snap90 = await snap90Res.json();
    expect(snap90.room.status).toBe("LOBBY");
    expect(snap90.room.currentRoundId).toBeNull();
    expect(snap90.room.finishState.code).toBe("ROUND_CANCELLED");
    expect(snap90.viewer.role).toBe("HOST");

    // Old host tries stale host action -> rejected 403 HOST_ONLY_ACTION (zero split-brain)
    const oldHostStart = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: cookies[0],
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(oldHostStart.status).toBe(403);
    expect((await oldHostStart.json()).error).toBe("HOST_ONLY_ACTION");

    // Stale vote targeting cancelled Round 1 returns 409 ROUND_CANCELLED
    const lateVoteRes = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[2],
        body: { roundId: round1Id, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(lateVoteRes.status).toBe(409);
    expect((await lateVoteRes.json()).error).toBe("ROUND_CANCELLED");

    // Old host leaves lobby after voting in Round 1 -> succeeds without trigger violation & rotates capability
    const oldHostLeave = await leaveRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/leave`, {
        cookieHeader: cookies[0],
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(oldHostLeave.status).toBe(200);
    const oldHostAfterLeave = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: cookies[0],
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(oldHostAfterLeave.status).toBe(401);

    // New Host (Guest 1) + Guest 2 start Round 2 with frozen quorum = 2
    const start2Res = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: cookies[1],
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(start2Res.status).toBe(200);
    const start2 = await start2Res.json();
    expect(start2.room.frozenQuorum).toBe(2);
  });

  it("rejects expired capability sessions (401) and 24h expired rooms (410) across all endpoints, and idempotently purges DB rows", async () => {
    // Start 25h in the past relative to real wall clock so SQLite CURRENT_TIMESTAMP permits deletion after +24h advance
    const pastIso = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    vi.useFakeTimers({ now: new Date(pastIso) });
    const { roomId, code, cookies, participantIds } = await setupRoomAndMembers(2, 840000);

    // 1. Expired capability session (> 7200s) fails closed 401 CAPABILITY_EXPIRED while 24h room is still valid
    await vi.advanceTimersByTimeAsync(7201 * 1000);
    const expiredSessionGet = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: cookies[0],
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(expiredSessionGet.status).toBe(401);
    expect((await expiredSessionGet.json()).error).toBe("CAPABILITY_EXPIRED");

    // 2. Mint fresh 24h capabilities just before advancing across 24h boundary to verify 410 ROOM_EXPIRED
    const freshHostToken = mintGuestCapabilityToken({
      roomId,
      participantId: participantIds[0],
      role: "HOST",
      generation: 1,
      ttlSeconds: DEFAULT_INACTIVITY_TTL_SECONDS,
      secret: TEST_SECRET,
    });
    const freshHostCookie = `${getGuestCookieName(roomId)}=${freshHostToken.token}`;

    // Advance remaining seconds up to 86399s total: room still alive (200)
    await vi.advanceTimersByTimeAsync((86399 - 7201) * 1000);
    const aliveAt86399 = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: freshHostCookie,
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(aliveAt86399.status).toBe(200);

    // Advance +1s -> 86400s exact TTL boundary
    await vi.advanceTimersByTimeAsync(1000);
    const store = getRoomAuthorityStore();
    const worker = new RoomExpiryWorker(DEFAULT_INACTIVITY_TTL_SECONDS, new SystemClock());
    const expiredRun = await worker.processExpiredRooms(store);
    expect(expiredRun.expiredRoomIds).toContain(roomId);

    // Every room endpoint rejects with 410 ROOM_EXPIRED (unrejoinable)
    const checks = await Promise.all([
      getRoomSnapshotGet(
        createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, { cookieHeader: freshHostCookie }),
        { params: Promise.resolve({ roomId }) }
      ),
      joinRoomPost(
        createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
          body: { code, displayName: "Late Comer" },
        })
      ),
      presenceRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/presence`, {
          cookieHeader: freshHostCookie,
          body: { connected: true },
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      retryRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/retry`, {
          cookieHeader: freshHostCookie,
          body: { startRound: false },
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      updateFiltersPatch(
        createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
          cookieHeader: freshHostCookie,
          body: { sort_by: "popularity.desc" },
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      startRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
          cookieHeader: freshHostCookie,
          body: {},
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      submitVotePost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
          cookieHeader: freshHostCookie,
          body: { candidateId: crypto.randomUUID(), movieId: 1, vote: "LIKE" },
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      leaveRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/leave`, {
          cookieHeader: freshHostCookie,
          body: {},
        }),
        { params: Promise.resolve({ roomId }) }
      ),
    ]);

    for (const res of checks) {
      expect(res.status).toBe(410);
      expect((await res.json()).error).toBe("ROOM_EXPIRED");
    }

    // Idempotent cleanup removes EXPIRED room cleanly and second sweep purges 0
    const cleanup1 = await worker.cleanupExpiredRooms(store);
    expect(cleanup1.purgedRoomIds).toContain(roomId);
    const cleanup2 = await worker.cleanupExpiredRooms(store);
    expect(cleanup2.purgedCount).toBe(0);
  });
});
