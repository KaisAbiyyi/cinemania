// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createRoomPost } from "@/app/api/rooms/route";
import { POST as joinRoomPost } from "@/app/api/rooms/join/route";
import { GET as getRoomSnapshotGet } from "@/app/api/rooms/[roomId]/route";
import { POST as startRoomPost } from "@/app/api/rooms/[roomId]/start/route";
import { POST as submitVotePost } from "@/app/api/rooms/[roomId]/votes/route";
import { POST as submitVoteSingularPost } from "@/app/api/rooms/[roomId]/vote/route";
import { getGuestCookieName } from "@/lib/server/auth/guestCapability";
import { resetRoomAuthorityStoreForTests, getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import tmdbApi from "@/services/tmdbApi";

const TEST_SECRET = "test-capability-signing-secret-cine-017-64-characters-long-abcdef01";

function createSameOriginRequest(
  method: "POST" | "GET",
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

function makeTmdbMovies(count: number, baseId = 600000): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, idx) => ({
    id: baseId + idx,
    title: `Voting Film ${idx + 1}`,
    poster_path: `/vote-film-${baseId + idx}.jpg`,
    release_date: "2024-06-15",
    vote_average: 7.9,
    overview: `Overview for ${baseId + idx}`,
    adult: false,
  }));
}

async function setupStartedRoom(participantCount: number, deckCount = 20, baseId = 600000) {
  vi.spyOn(tmdbApi, "get").mockResolvedValue({
    data: {
      page: 1,
      results: makeTmdbMovies(deckCount, baseId),
      total_pages: 1,
      total_results: deckCount,
    },
  } as never);

  const createRes = await createRoomPost(
    createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
      body: { displayName: "Host" },
    })
  );
  expect(createRes.status).toBe(201);
  const created = await createRes.json();
  const roomId: string = created.room.roomId;
  const code: string = created.room.code;
  const cookies: string[] = [extractCookieHeader(createRes, roomId)];
  const participantIds: string[] = [created.viewer.participantId];

  for (let i = 1; i < participantCount; i += 1) {
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

  const startRes = await startRoomPost(
    createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, {
      cookieHeader: cookies[0],
      body: {},
    }),
    { params: Promise.resolve({ roomId }) }
  );
  expect(startRes.status).toBe(200);
  const started = await startRes.json();
  return {
    roomId,
    roundId: started.room.currentRoundId as string,
    deck: started.room.deck as Array<{ candidateId: string; movieId: number; position: number }>,
    cookies,
    participantIds,
  };
}

describe("CINE-017 Voting API Integration", () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine017-api-"));
    sqlitePath = path.join(tmpDir, "rooms.sqlite");
    process.env.CINEMATCH_CAPABILITY_SECRET = TEST_SECRET;
    process.env.CINEMATCH_SQLITE_PATH = sqlitePath;
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

  it.each([2, 3, 4, 5])(
    "enforces strict unanimous match for %d voters, advances on non-unanimity, and keeps vote choices confidential",
    async (voterCount) => {
      const { roomId, roundId, deck, cookies, participantIds } = await setupStartedRoom(voterCount, 20);
      const card0 = deck[0]!;
      const card1 = deck[1]!;

      // Card 0: All voters except last vote LIKE; last votes SKIP -> MUST advance deck (NO majority match)
      for (let i = 0; i < voterCount - 1; i += 1) {
        const res = await submitVotePost(
          createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
            cookieHeader: cookies[i],
            body: {
              roundId,
              candidateId: card0.candidateId,
              movieId: card0.movieId,
              vote: "LIKE",
              operationId: `c0-v${i}`,
            },
          }),
          { params: Promise.resolve({ roomId }) }
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.isMatched).toBe(false);
        expect(body.room.status).toBe("ACTIVE");
        expect(body.room.currentCandidateIndex).toBe(0);
      }

      const lastSkipRes = await submitVotePost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
          cookieHeader: cookies[voterCount - 1],
          body: {
            roundId,
            candidateId: card0.candidateId,
            movieId: card0.movieId,
            vote: "SKIP",
            operationId: `c0-v${voterCount - 1}`,
          },
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(lastSkipRes.status).toBe(200);
      const lastSkipBody = await lastSkipRes.json();
      expect(lastSkipBody.isMatched).toBe(false);
      expect(lastSkipBody.room.status).toBe("ACTIVE");
      expect(lastSkipBody.room.currentCandidateIndex).toBe(1);
      expect(lastSkipBody.room.currentCandidate.candidateId).toBe(card1.candidateId);

      // Card 1: Confidential check — host snapshot must NOT see guest's SKIP on card0, only host's own LIKE
      const hostSnapRes = await getRoomSnapshotGet(
        createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, {
          cookieHeader: cookies[0],
        }),
        { params: Promise.resolve({ roomId }) }
      );
      expect(hostSnapRes.status).toBe(200);
      const hostSnap = await hostSnapRes.json();
      expect(hostSnap.viewer.userVotes).toEqual({ [card0.candidateId]: "LIKE" });
      expect(hostSnap.viewer.nextCandidateIndex).toBe(1);
      expect(JSON.stringify(hostSnap)).not.toContain('"SKIP"');

      // Card 1: Concurrent LIKE votes across all frozen voters (using /vote alias for final voter)
      const card1Responses = await Promise.all(
        cookies.map((cookieHeader, i) => {
          const handler = i === voterCount - 1 ? submitVoteSingularPost : submitVotePost;
          return handler(
            createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
              cookieHeader,
              body: {
                roundId,
                candidateId: card1.candidateId,
                movieId: card1.movieId,
                vote: "LIKE",
                operationId: `c1-v${i}`,
              },
            }),
            { params: Promise.resolve({ roomId }) }
          );
        })
      );
      for (const res of card1Responses) {
        expect(res.status).toBe(200);
      }

      const finalBodies = await Promise.all(card1Responses.map((r) => r.json()));
      const winningResponses = finalBodies.filter((b) => b.isMatched === true);
      expect(winningResponses.length).toBe(1);
      expect(winningResponses[0]!.room.status).toBe("MATCHED");
      expect(winningResponses[0]!.room.matchedMovieId).toBe(card1.movieId);
      expect(winningResponses[0]!.room.matchedCandidate.candidateId).toBe(card1.candidateId);

      // Outbox confidentiality: VOTE_RECORDED events contain ONLY participantId; single MATCH_ANNOUNCED emitted
      const db = new DatabaseSync(sqlitePath);
      try {
        const events = db
          .prepare("SELECT event_type, payload FROM room_events WHERE room_id = ? ORDER BY version ASC;")
          .all(roomId) as Array<{ event_type: string; payload: string }>;
        const voteEvents = events.filter((e) => e.event_type === "VOTE_RECORDED");
        const matchEvents = events.filter((e) => e.event_type === "MATCH_ANNOUNCED");
        expect(matchEvents.length).toBe(1);
        expect(JSON.parse(matchEvents[0]!.payload)).toMatchObject({
          movieId: card1.movieId,
          candidateId: card1.candidateId,
          roundId,
          unanimousCount: voterCount,
        });
        for (const ve of voteEvents) {
          const parsedPayload = JSON.parse(ve.payload) as Record<string, unknown>;
          expect(Object.keys(parsedPayload)).toEqual(["participantId"]);
          expect(participantIds).toContain(parsedPayload.participantId);
        }
      } finally {
        db.close();
      }
    }
  );

  it("supports idempotent operationId headers/body across retries after MATCHED/EXHAUSTED and rejects immutability & conflicts", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(2, 1);
    const singleCard = deck[0]!;

    // 1. Host votes LIKE using Idempotency-Key header
    const res1 = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[0],
        headers: { "Idempotency-Key": "retry-header-op-1" },
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.idempotentReplay).toBe(false);

    // Replay same Idempotency-Key -> idempotent replay, identical stateVersion
    const replay1 = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[0],
        headers: { "Idempotency-Key": "retry-header-op-1" },
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(replay1.status).toBe(200);
    const replayBody1 = await replay1.json();
    expect(replayBody1.idempotentReplay).toBe(true);
    expect(replayBody1.room.stateVersion).toBe(body1.room.stateVersion);

    // Reusing same Idempotency-Key with SKIP -> 409 OPERATION_ID_CONFLICT
    const opConflict = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[0],
        headers: { "Idempotency-Key": "retry-header-op-1" },
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "SKIP",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(opConflict.status).toBe(409);
    expect((await opConflict.json()).error).toBe("OPERATION_ID_CONFLICT");

    // Flipping vote on same candidate with new operationId -> 409 VOTE_IMMUTABLE
    const flipRes = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[0],
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "SKIP",
          operationId: "new-op-flip",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(flipRes.status).toBe(409);
    expect((await flipRes.json()).error).toBe("VOTE_IMMUTABLE");

    // Conflicting Idempotency-Key and x-operation-id -> 400 INVALID_VOTE_PAYLOAD
    const headerConflict = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[1],
        headers: { "Idempotency-Key": "a", "x-operation-id": "b" },
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "SKIP",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(headerConflict.status).toBe(400);
    expect((await headerConflict.json()).error).toBe("INVALID_VOTE_PAYLOAD");

    // Guest votes SKIP using x-operation-id -> exhausts 1-card shortage deck!
    const guestSkip = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[1],
        headers: { "x-operation-id": "guest-shortage-op" },
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "SKIP",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(guestSkip.status).toBe(200);
    const guestSkipBody = await guestSkip.json();
    expect(guestSkipBody.isExhausted).toBe(true);
    expect(guestSkipBody.isMatched).toBe(false);
    expect(guestSkipBody.room.status).toBe("EXHAUSTED");

    // Retry-after-timeout on EXHAUSTED succeeds idempotently
    const retryAfterExhausted = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[1],
        headers: { "x-operation-id": "guest-shortage-op" },
        body: {
          roundId,
          candidateId: singleCard.candidateId,
          movieId: singleCard.movieId,
          vote: "SKIP",
        },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(retryAfterExhausted.status).toBe(200);
    const retryBody = await retryAfterExhausted.json();
    expect(retryBody.idempotentReplay).toBe(true);
    expect(retryBody.isExhausted).toBe(true);
    expect(retryBody.room.stateVersion).toBe(guestSkipBody.room.stateVersion);
  });

  it("rejects tampered candidates, LOBBY rooms, cross-origin CSRF, cross-room cookies, revoked sessions, and unfrozen voters", async () => {
    const roomA = await setupStartedRoom(2, 5, 600000);
    const roomB = await setupStartedRoom(2, 5, 700000);

    // 1. Cross-origin CSRF rejected
    const csrfFail = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        cookieHeader: roomA.cookies[0],
        origin: "https://evil.example",
        body: {
          candidateId: roomA.deck[0]!.candidateId,
          movieId: roomA.deck[0]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(csrfFail.status).toBe(403);

    // 2. Unauthenticated rejected (401)
    const unauthFail = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        body: {
          candidateId: roomA.deck[0]!.candidateId,
          movieId: roomA.deck[0]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(unauthFail.status).toBe(401);

    // 3. Cross-room cookie rejected
    const crossRoomFail = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        cookieHeader: roomB.cookies[0],
        body: {
          candidateId: roomA.deck[0]!.candidateId,
          movieId: roomA.deck[0]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(crossRoomFail.status).toBe(401);

    // 4. Tampered movieId for candidateId -> 404 CANDIDATE_NOT_FOUND
    const wrongMovie = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        cookieHeader: roomA.cookies[0],
        body: {
          candidateId: roomA.deck[0]!.candidateId,
          movieId: roomA.deck[1]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(wrongMovie.status).toBe(404);
    expect((await wrongMovie.json()).error).toBe("CANDIDATE_NOT_FOUND");

    // 5. Cross-round candidateId -> 404 CANDIDATE_NOT_FOUND
    const wrongCandidate = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        cookieHeader: roomA.cookies[0],
        body: {
          candidateId: roomB.deck[0]!.candidateId,
          movieId: roomB.deck[0]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(wrongCandidate.status).toBe(404);
    expect((await wrongCandidate.json()).error).toBe("CANDIDATE_NOT_FOUND");

    // 6. Wrong roundId -> 404 ROUND_NOT_FOUND
    const wrongRound = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        cookieHeader: roomA.cookies[0],
        body: {
          roundId: roomB.roundId,
          candidateId: roomA.deck[0]!.candidateId,
          movieId: roomA.deck[0]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(wrongRound.status).toBe(404);
    expect((await wrongRound.json()).error).toBe("ROUND_NOT_FOUND");

    // 7. Voting in LOBBY room -> 409 ROOM_NOT_ACTIVE
    const lobbyCreate = await createRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms", {
        body: { displayName: "LobbyHost" },
      })
    );
    const lobbyCreated = await lobbyCreate.json();
    const lobbyCookie = extractCookieHeader(lobbyCreate, lobbyCreated.room.roomId);
    const lobbyVote = await submitVotePost(
      createSameOriginRequest(
        "POST",
        `http://localhost:3000/api/rooms/${lobbyCreated.room.roomId}/votes`,
        {
          cookieHeader: lobbyCookie,
          body: {
            candidateId: crypto.randomUUID(),
            movieId: 550,
            vote: "LIKE",
          },
        }
      ),
      { params: Promise.resolve({ roomId: lobbyCreated.room.roomId }) }
    );
    expect(lobbyVote.status).toBe(409);
    expect((await lobbyVote.json()).error).toBe("ROOM_NOT_ACTIVE");

    // 8. Revoked session generation -> 401
    const store = getRoomAuthorityStore();
    await store.setMinGeneration(
      roomA.roomId,
      roomA.participantIds[1]!,
      5,
      new Date(Date.now() + 86400_000).toISOString()
    );
    const revokedVote = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomA.roomId}/votes`, {
        cookieHeader: roomA.cookies[1],
        body: {
          candidateId: roomA.deck[0]!.candidateId,
          movieId: roomA.deck[0]!.movieId,
          vote: "LIKE",
        },
      }),
      { params: Promise.resolve({ roomId: roomA.roomId }) }
    );
    expect(revokedVote.status).toBe(401);
  });

  it("handles late unfrozen intruder with 403 VOTER_NOT_ELIGIBLE and exhaustion when last vote on last card is LIKE", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(2, 1);
    const card = deck[0]!;

    // Host creates a room_participants row that wasn't in round_participants; wait - test via store direct SQL
    const db = new DatabaseSync(sqlitePath);
    try {
      const intruderId = crypto.randomUUID();
      db.prepare(
        "INSERT INTO room_participants (room_id, participant_id, display_name, role) VALUES (?, ?, 'Intruder', 'MEMBER');"
      ).run(roomId, intruderId);
      db.prepare("UPDATE rooms SET participant_count = 3 WHERE id = ?;").run(roomId);
    } finally {
      db.close();
    }

    // Voter 1 skips first
    const r1 = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[0],
        body: { roundId, candidateId: card.candidateId, movieId: card.movieId, vote: "SKIP" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(r1.status).toBe(200);
    expect((await r1.json()).room.status).toBe("ACTIVE");

    // Voter 2 votes LIKE last -> MUST exhaust despite final vote being LIKE and room.participant_count inflated to 3
    const r2 = await submitVotePost(
      createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, {
        cookieHeader: cookies[1],
        body: { roundId, candidateId: card.candidateId, movieId: card.movieId, vote: "LIKE" },
      }),
      { params: Promise.resolve({ roomId }) }
    );
    expect(r2.status).toBe(200);
    const b2 = await r2.json();
    expect(b2.isExhausted).toBe(true);
    expect(b2.isMatched).toBe(false);
    expect(b2.room.status).toBe("EXHAUSTED");
  });
});
