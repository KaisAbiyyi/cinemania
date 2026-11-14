// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createRoomPost } from "@/app/api/rooms/route";
import { POST as joinRoomPost } from "@/app/api/rooms/join/route";
import { GET as getRoomSnapshotGet } from "@/app/api/rooms/[roomId]/route";
import { GET as getRoomDeckGet } from "@/app/api/rooms/[roomId]/deck/route";
import {
  PATCH as patchRoomFiltersPatch,
  PUT as putRoomFiltersPut,
} from "@/app/api/rooms/[roomId]/filters/route";
import { POST as startRoomPost } from "@/app/api/rooms/[roomId]/start/route";
import { getGuestCookieName } from "@/lib/server/auth/guestCapability";
import { SqliteRoomRepository } from "@/lib/server/room/roomRepository";
import { startRoomRoundWithSession } from "@/lib/server/room/roomSnapshot";
import {
  getRoomAuthorityStore,
  resetRoomAuthorityStoreForTests,
} from "@/lib/server/room/roomStore";
import tmdbApi, { TmdbApiError } from "@/services/tmdbApi";

const TEST_SECRET = "test-capability-signing-secret-cine-016-64-characters-long-abcdef01";

function createSameOriginRequest(
  method: "POST" | "PATCH" | "PUT" | "GET",
  url: string,
  options: {
    body?: unknown;
    cookieHeader?: string;
    origin?: string;
  } = {}
): NextRequest {
  const headers: Record<string, string> = {};
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

function makeTmdbMovies(count: number, baseId = 500000): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, idx) => ({
    id: baseId + idx,
    title: `Deterministic Film ${idx + 1}`,
    poster_path: `/film-${baseId + idx}.jpg`,
    release_date: "2024-06-15",
    vote_average: 7.8,
    overview: `Overview for ${baseId + idx}`,
    adult: false,
  }));
}

describe("CINE-016 Deterministic Room Movie Deck & Common Filters API Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine016-api-"));
    process.env.CINEMATCH_CAPABILITY_SECRET = TEST_SECRET;
    process.env.CINEMATCH_SQLITE_PATH = path.join(tmpDir, "rooms.sqlite");
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_PG_HOST;
    delete process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD;
    resetRoomAuthorityStoreForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRoomAuthorityStoreForTests();
    delete process.env.CINEMATCH_CAPABILITY_SECRET;
    delete process.env.CINEMATCH_SQLITE_PATH;
    delete process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD;
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it("validates filters at create/update, enforces host-only + CSRF + post-start FILTER_LOCKED, and yields 5-client identical ordered deck with zero per-swipe TMDB calls", async () => {
    // Reject adult content at room creation
    const badCreateRes = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: { displayName: "Host", deckFilter: { include_adult: true } },
      })
    );
    expect(badCreateRes.status).toBe(400);
    expect((await badCreateRes.json()).error).toBe("INVALID_DECK_FILTER");

    // Host creates room with valid initial movie filter
    const createRes = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: {
          displayName: "Host",
          deckFilter: { with_genres: "28", "vote_average.gte": 6.5 },
        },
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const roomCode: string = created.room.code;
    const hostCookie = extractCookieHeader(createRes, roomId);

    expect(created.room.deckFilter).toEqual({
      include_adult: false,
      language: "en-US",
      sort_by: "popularity.desc",
      "vote_average.gte": 6.5,
      with_genres: "28",
    });
    expect(created.room.deck).toEqual([]);
    expect(created.room.deckSize).toBe(0);

    // 4 guests join (total = 5 participants)
    const guestCookies: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const joinRes = await joinRoomPost(
        createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
          body: { code: roomCode, displayName: `Guest ${i}` },
        })
      );
      expect(joinRes.status).toBe(200);
      guestCookies.push(extractCookieHeader(joinRes, roomId));
    }

    // Non-host guest cannot edit room filters
    const guestFilterRes = await patchRoomFiltersPatch(
      createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
        cookieHeader: guestCookies[0],
        body: { with_genres: "35" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(guestFilterRes.status).toBe(403);
    expect((await guestFilterRes.json()).error).toBe("HOST_ONLY_ACTION");

    // Cross-origin CSRF blocked on filters route
    const csrfFilterRes = await patchRoomFiltersPatch(
      createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
        cookieHeader: hostCookie,
        origin: "https://attacker.example",
        body: { with_genres: "35" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(csrfFilterRes.status).toBe(403);
    expect((await csrfFilterRes.json()).error).toBe("CSRF_FORBIDDEN");

    // Host updates LOBBY filter via PATCH
    const updatedFilterRes = await patchRoomFiltersPatch(
      createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
        cookieHeader: hostCookie,
        body: {
          with_genres: "28,878",
          "vote_average.gte": 7,
          "primary_release_date.gte": "2015-01-01",
          sort_by: "vote_average.desc",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(updatedFilterRes.status).toBe(200);
    const updatedFilterBody = await updatedFilterRes.json();
    expect(updatedFilterBody.room.deckFilter.with_genres).toBe("28,878");
    expect(updatedFilterBody.room.deckFilter.include_adult).toBe(false);

    // Mock TMDB discover once for round start (25 movies -> capped to 20 deterministically)
    const tmdbSpy = vi.spyOn(tmdbApi, "get").mockResolvedValue({
      data: {
        page: 1,
        total_pages: 1,
        total_results: 25,
        results: makeTmdbMovies(25, 610000),
      },
    });

    const startRes = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(startRes.status).toBe(200);
    const startBody = await startRes.json();
    expect(startBody.room.status).toBe("ACTIVE");
    expect(startBody.room.frozenQuorum).toBe(5);
    expect(startBody.room.deckSize).toBe(20);
    expect(startBody.room.isDeckShortage).toBe(false);
    expect(startBody.room.deck).toHaveLength(20);

    // Verify upstream /discover/movie received forced include_adult=false + host filter
    expect(tmdbSpy).toHaveBeenCalledTimes(1);
    const callArgs = tmdbSpy.mock.calls[0]?.[1] as { params?: Record<string, unknown> };
    expect(callArgs.params?.include_adult).toBe(false);
    expect(callArgs.params?.with_genres).toBe("28,878");
    expect(callArgs.params?.sort_by).toBe("vote_average.desc");

    const callsAfterStart = tmdbSpy.mock.calls.length;

    // All 5 participants read snapshot & /deck + guest reconnects -> ZERO extra TMDB calls & identical order
    const allCookies = [hostCookie, ...guestCookies];
    const expectedMovieOrder = startBody.room.deck.map((d: { movieId: number }) => d.movieId);

    for (const cookie of allCookies) {
      const snapRes = await getRoomSnapshotGet(
        createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
          cookieHeader: cookie,
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(snapRes.status).toBe(200);
      expect(snapRes.headers.get("cache-control")).toContain("no-store");
      const snapJson = await snapRes.json();
      expect(snapJson.room.deck.map((d: { movieId: number }) => d.movieId)).toEqual(
        expectedMovieOrder
      );
      expect(snapJson.room.deck.map((d: { position: number }) => d.position)).toEqual(
        Array.from({ length: 20 }, (_, i) => i)
      );
      expect(snapJson.room.frozenQuorum).toBe(5);

      const deckRes = await getRoomDeckGet(
        createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}/deck`, {
          cookieHeader: cookie,
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(deckRes.status).toBe(200);
      expect(deckRes.headers.get("cache-control")).toContain("no-store");
      const deckJson = await deckRes.json();
      expect(deckJson.deck.map((d: { movieId: number }) => d.movieId)).toEqual(expectedMovieOrder);

      // No internal participant UUID leaks inside safe room participants
      for (const p of snapJson.room.participants) {
        expect(p).not.toHaveProperty("participantId");
        expect(p).not.toHaveProperty("id");
      }
    }

    // Idempotent reconnect POST /join during ACTIVE returns full identical deck cleanly
    const reconnectRes = await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
        cookieHeader: guestCookies[0],
        body: { code: roomCode, displayName: "Guest 1 Reconnected" },
      })
    );
    expect(reconnectRes.status).toBe(200);
    const reconnectJson = await reconnectRes.json();
    expect(reconnectJson.room.deck.map((d: { movieId: number }) => d.movieId)).toEqual(
      expectedMovieOrder
    );

    // Zero additional TMDB calls across 5 snapshot reads + 5 /deck reads + 1 reconnect
    expect(tmdbSpy).toHaveBeenCalledTimes(callsAfterStart);

    // Filter locked after room starts (PATCH & PUT return 409 FILTER_LOCKED)
    const lockedRes = await putRoomFiltersPut(
      createSameOriginRequest("PUT", `http://localhost:3000/api/rooms/${roomId}/filters`, {
        cookieHeader: hostCookie,
        body: { with_genres: "18" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(lockedRes.status).toBe(409);
    expect((await lockedRes.json()).error).toBe("FILTER_LOCKED");
  });

  it("handles 0-result 422 DECK_EMPTY cleanly without leaving LOBBY, and caps 100 provider results strictly at 20 on recovery", async () => {
    const createRes = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: { displayName: "Host", deckFilter: { with_genres: "99999" } },
      })
    );
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const hostCookie = extractCookieHeader(createRes, roomId);

    await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
        body: { code: created.room.code, displayName: "Guest 1" },
      })
    );

    // First attempt: 0 TMDB results
    const tmdbSpy = vi
      .spyOn(tmdbApi, "get")
      .mockResolvedValueOnce({ data: { page: 1, total_pages: 1, total_results: 0, results: [] } })
      .mockResolvedValueOnce({
        data: { page: 1, total_pages: 5, total_results: 100, results: makeTmdbMovies(100, 720000) },
      });

    const emptyStartRes = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(emptyStartRes.status).toBe(422);
    expect((await emptyStartRes.json()).error).toBe("DECK_EMPTY");

    // Room must remain cleanly in LOBBY with zero rounds/candidates created
    const snapStillLobby = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: hostCookie,
      }),
      { params: Promise.resolve({ roomId }) }
    );
    const stillLobbyBody = await snapStillLobby.json();
    expect(stillLobbyBody.room.status).toBe("LOBBY");
    expect(stillLobbyBody.room.currentRoundId).toBeNull();
    expect(stillLobbyBody.room.deckSize).toBe(0);

    // Host relaxes filters via PATCH -> retries start with 100 results -> strictly capped at 20
    const adjustRes = await patchRoomFiltersPatch(
      createSameOriginRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, {
        cookieHeader: hostCookie,
        body: { with_genres: "28" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(adjustRes.status).toBe(200);

    const recoveredStart = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(recoveredStart.status).toBe(200);
    const recoveredBody = await recoveredStart.json();
    expect(recoveredBody.room.status).toBe("ACTIVE");
    expect(recoveredBody.room.deckSize).toBe(20);
    expect(recoveredBody.room.isDeckShortage).toBe(false);
    expect(new Set(recoveredBody.room.deck.map((d: { movieId: number }) => d.movieId)).size).toBe(
      20
    );
    expect(tmdbSpy).toHaveBeenCalledTimes(2);
  });

  it("supports 1-result shortage deck with missing poster (posterUrl: null), strips adult titles, and exhausts cleanly on all-SKIP votes", async () => {
    const createRes = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: { displayName: "Host" },
      })
    );
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const hostCookie = extractCookieHeader(createRes, roomId);
    const hostParticipantId: string = created.viewer.participantId;

    const joinRes = await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
        body: { code: created.room.code, displayName: "Guest" },
      })
    );
    const guestJoined = await joinRes.json();
    const guestParticipantId: string = guestJoined.viewer.participantId;

    vi.spyOn(tmdbApi, "get").mockResolvedValueOnce({
      data: {
        page: 1,
        total_pages: 1,
        total_results: 2,
        results: [
          {
            id: 830001,
            title: "Posterless Rare Film",
            poster_path: null,
            release_date: null,
            vote_average: null,
            overview: null,
            adult: false,
          },
          {
            id: 830002,
            title: "Blocked Adult Decoy",
            poster_path: "/adult.jpg",
            release_date: "2024-01-01",
            vote_average: 8.0,
            overview: "Should never enter deck",
            adult: true,
          },
        ],
      },
    });

    const startRes = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(startRes.status).toBe(200);
    const started = await startRes.json();
    expect(started.room.status).toBe("ACTIVE");
    expect(started.room.deckSize).toBe(1);
    expect(started.room.expectedDeckSize).toBe(20);
    expect(started.room.isDeckShortage).toBe(true);
    expect(started.room.deck[0]).toMatchObject({
      position: 0,
      movieId: 830001,
      title: "Posterless Rare Film",
      posterPath: null,
      posterUrl: null,
    });

    // All-SKIP votes across both participants on the 1-card shortage deck must transition ACTIVE -> EXHAUSTED
    const db = new DatabaseSync(process.env.CINEMATCH_SQLITE_PATH!);
    try {
      const repo = new SqliteRoomRepository(db);
      const cand = started.room.deck[0];
      const roundId: string = started.room.currentRoundId;

      const vote1 = repo.recordVote(roomId, roundId, hostParticipantId, cand.candidateId, cand.movieId, "SKIP");
      expect(vote1.room.status).toBe("ACTIVE");

      const vote2 = repo.recordVote(roomId, roundId, guestParticipantId, cand.candidateId, cand.movieId, "SKIP");
      expect(vote2.room.status).toBe("EXHAUSTED");
    } finally {
      db.close();
    }
  });

  it("maps upstream 429 + 504 failures cleanly without leaking secrets or leaving LOBBY, and succeeds on retry", async () => {
    const createRes = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: { displayName: "Host" },
      })
    );
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const hostCookie = extractCookieHeader(createRes, roomId);

    await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
        body: { code: created.room.code, displayName: "Guest" },
      })
    );

    vi.spyOn(tmdbApi, "get")
      .mockRejectedValueOnce(new TmdbApiError(429, "TMDB_RATE_LIMIT", "Upstream 429", 5))
      .mockRejectedValueOnce(new TmdbApiError(504, "TMDB_TIMEOUT", "Upstream timed out"))
      .mockResolvedValueOnce({
        data: { page: 1, total_pages: 1, total_results: 20, results: makeTmdbMovies(20, 840000) },
      });

    const rateLimitRes = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(rateLimitRes.status).toBe(429);
    expect(rateLimitRes.headers.get("retry-after")).toBe("5");
    const rateLimitText = await rateLimitRes.text();
    expect(rateLimitText).toContain("RATE_LIMITED");
    expect(rateLimitText).not.toContain("mock-tmdb-offline-rat-token");

    const timeoutRes = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(timeoutRes.status).toBe(504);
    expect((await timeoutRes.json()).error).toBe("GATEWAY_TIMEOUT");

    const okRes = await startRoomPost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
        cookieHeader: hostCookie,
        body: {},
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).room.status).toBe("ACTIVE");
  });

  it("prevents concurrent start vs filter-update race via DECK_FILTER_CONFLICT, deduplicates double-start, and rolls back on pre-commit fault", async () => {
    const createRes = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: { displayName: "Host", deckFilter: { with_genres: "28" } },
      })
    );
    const created = await createRes.json();
    const roomId: string = created.room.roomId;
    const hostCookie = extractCookieHeader(createRes, roomId);

    await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", {
        body: { code: created.room.code, displayName: "Guest" },
      })
    );

    const store = getRoomAuthorityStore();

    // 1. Concurrent start vs PATCH /filters race: filter changes while TMDB fetch is in flight -> DECK_FILTER_CONFLICT (409)
    await expect(
      startRoomRoundWithSession(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
          cookieHeader: hostCookie,
          body: {},
        }),
        roomId,
        store,
        {
          discoverFetcher: async () => {
            // Simulate concurrent host filter update finishing before start enters DB lock
            const patchRes = await patchRoomFiltersPatch(
              createSameOriginRequest(
                "PATCH",
                `http://localhost:3000/api/rooms/${roomId}/filters`,
                {
                  cookieHeader: hostCookie,
                  body: { with_genres: "18" },
                }
              ),
              { params: Promise.resolve({ roomId }) }
            );
            expect(patchRes.status).toBe(200);
            return { page: 1, total_pages: 1, total_results: 20, results: makeTmdbMovies(20, 850000) };
          },
        }
      )
    ).rejects.toMatchObject({ code: "DECK_FILTER_CONFLICT" });

    // Verify room remained in LOBBY with the new genre filter (18) and zero orphaned rounds/candidates
    const snapAfterConflict = await getRoomSnapshotGet(
      createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
        cookieHeader: hostCookie,
      }),
      { params: Promise.resolve({ roomId }) }
    );
    const conflictSnap = await snapAfterConflict.json();
    expect(conflictSnap.room.status).toBe("LOBBY");
    expect(conflictSnap.room.deckFilter.with_genres).toBe("18");
    expect(conflictSnap.room.deckSize).toBe(0);

    // 2. Pre-commit hook failure rolls back transaction completely (0 rounds/candidates)
    await expect(
      startRoomRoundWithSession(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
          cookieHeader: hostCookie,
          body: {},
        }),
        roomId,
        store,
        {
          discoverFetcher: async () => ({
            page: 1,
            total_pages: 1,
            total_results: 20,
            results: makeTmdbMovies(20, 860000),
          }),
          beforeCommit: () => {
            throw new Error("Injected pre-commit disk failure");
          },
        }
      )
    ).rejects.toThrow("Injected pre-commit disk failure");

    const dbCheck = new DatabaseSync(process.env.CINEMATCH_SQLITE_PATH!);
    try {
      const roundCnt = (dbCheck.prepare("SELECT COUNT(*) as c FROM rounds WHERE room_id = ?").get(roomId) as { c: number }).c;
      const candCnt = (dbCheck.prepare("SELECT COUNT(*) as c FROM candidates WHERE room_id = ?").get(roomId) as { c: number }).c;
      expect(roundCnt).toBe(0);
      expect(candCnt).toBe(0);
    } finally {
      dbCheck.close();
    }

    // 3. Concurrent double-start -> exactly one 200 ACTIVE and one 409 ROOM_ALREADY_ACTIVE
    vi.spyOn(tmdbApi, "get").mockResolvedValue({
      data: { page: 1, total_pages: 1, total_results: 20, results: makeTmdbMovies(20, 870000) },
    });

    const [resA, resB] = await Promise.all([
      startRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
          cookieHeader: hostCookie,
          body: {},
        }),
        { params: Promise.resolve({ roomId }) }
      ),
      startRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
          cookieHeader: hostCookie,
          body: {},
        }),
        { params: Promise.resolve({ roomId }) }
      ),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
  });
});
