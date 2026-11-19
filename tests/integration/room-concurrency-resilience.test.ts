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
import { POST as startRoomPost } from "@/app/api/rooms/[roomId]/start/route";
import { POST as submitVotePost } from "@/app/api/rooms/[roomId]/votes/route";
import { POST as leaveRoomPost } from "@/app/api/rooms/[roomId]/leave/route";
import { POST as realtimeTokenPost } from "@/app/api/rooms/[roomId]/realtime-token/route";
import { getGuestCookieName } from "@/lib/server/auth/guestCapability";
import { resetRoomAuthorityStoreForTests } from "@/lib/server/room/roomStore";
import tmdbApi from "@/services/tmdbApi";

const TEST_SECRET = "test-capability-signing-secret-cine-019-64-characters-long-abcdef01";

function createSameOriginRequest(
  method: "POST" | "GET",
  url: string,
  options: { body?: unknown; cookieHeader?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (method !== "GET") {
    headers.origin = "http://localhost:3000";
    headers["content-type"] = "application/json";
  }
  if (options.cookieHeader) headers.cookie = options.cookieHeader;
  return new NextRequest(url, {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

function extractCookieHeader(response: Response, roomId: string): string {
  const cookieName = getGuestCookieName(roomId);
  const match = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match) throw new Error(`Missing Set-Cookie for ${cookieName}`);
  return `${cookieName}=${match[1]}`;
}

function makeTmdbMovies(count: number, baseId = 700000): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, idx) => ({
    id: baseId + idx,
    title: `Resilience Film ${idx + 1}`,
    poster_path: `/res-film-${baseId + idx}.jpg`,
    release_date: "2024-06-15",
    vote_average: 7.9,
    overview: `Overview for ${baseId + idx}`,
    adult: false,
  }));
}

async function setupStartedRoom(participantCount: number, deckCount = 20) {
  vi.spyOn(tmdbApi, "get").mockResolvedValue({
    data: { page: 1, results: makeTmdbMovies(deckCount), total_pages: 1, total_results: deckCount },
  } as never);
  const createRes = await createRoomPost(
    createSameOriginRequest("POST", "http://localhost:3000/api/rooms", { body: { displayName: "Host" } })
  );
  expect(createRes.status).toBe(201);
  const created = await createRes.json();
  const roomId: string = created.room.roomId;
  const code: string = created.room.code;
  const cookies: string[] = [extractCookieHeader(createRes, roomId)];
  const participantIds: string[] = [created.viewer.participantId];
  for (let i = 1; i < participantCount; i += 1) {
    const joinRes = await joinRoomPost(
      createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", { body: { code, displayName: `Guest ${i}` } })
    );
    expect(joinRes.status).toBe(200);
    const joined = await joinRes.json();
    cookies.push(extractCookieHeader(joinRes, roomId));
    participantIds.push(joined.viewer.participantId);
  }
  const startRes = await startRoomPost(
    createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, { cookieHeader: cookies[0], body: {} }),
    { params: Promise.resolve({ roomId }) }
  );
  expect(startRes.status).toBe(200);
  const started = await startRes.json();
  return {
    roomId,
    code,
    roundId: started.room.currentRoundId as string,
    deck: started.room.deck as Array<{ candidateId: string; movieId: number; position: number }>,
    cookies,
    participantIds,
  };
}

const ctx = (roomId: string) => ({ params: Promise.resolve({ roomId }) });

function vote(roomId: string, cookieHeader: string, input: Record<string, unknown>, headers?: Record<string, string>) {
  return submitVotePost(
    createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/votes`, { cookieHeader, body: input, headers }),
    ctx(roomId)
  );
}

async function snapshot(roomId: string, cookieHeader: string) {
  const res = await getRoomSnapshotGet(
    createSameOriginRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, { cookieHeader }),
    ctx(roomId)
  );
  return { status: res.status, body: await res.json() };
}

function inspect<T>(sqlitePath: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(sqlitePath);
  try { return run(db); } finally { db.close(); }
}

const count = (db: DatabaseSync, sql: string, ...args: string[]) =>
  (db.prepare(sql).get(...args) as { c: number }).c;

describe("CINE-019 reconnect, duplicate request and stale-tab resilience (API + SQLite authority)", () => {
  let tmpDir: string;
  let sqlitePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine019-api-"));
    sqlitePath = path.join(tmpDir, "rooms.sqlite");
    process.env.CINEMATCH_CAPABILITY_SECRET = TEST_SECRET;
    process.env.CINEMATCH_SQLITE_PATH = sqlitePath;
    process.env.SUPABASE_JWT_SECRET = "unit-test-realtime-signing-secret";
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
    delete process.env.SUPABASE_JWT_SECRET;
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it("reloads never create a participant, a vote, a version bump or a quorum change (cookie rejoin in ACTIVE)", async () => {
    const { roomId, roundId, deck, cookies, participantIds, code } = await setupStartedRoom(3);
    const card0 = deck[0]!;
    expect((await vote(roomId, cookies[0]!, { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE", operationId: "r-0" })).status).toBe(200);
    const before = await snapshot(roomId, cookies[1]!);
    const counts = () => inspect(sqlitePath, (db) => ({
      participants: count(db, "SELECT COUNT(*) AS c FROM room_participants WHERE room_id = ?;", roomId),
      votes: count(db, "SELECT COUNT(*) AS c FROM votes WHERE room_id = ?;", roomId),
      frozen: count(db, "SELECT COUNT(*) AS c FROM round_participants WHERE room_id = ?;", roomId),
      events: count(db, "SELECT COUNT(*) AS c FROM room_events WHERE room_id = ?;", roomId),
      version: count(db, "SELECT state_version AS c FROM rooms WHERE id = ?;", roomId),
    }));
    const baseline = counts();
    expect(baseline).toMatchObject({ participants: 3, votes: 1, frozen: 3 });
    for (let reload = 0; reload < 5; reload++) {
      for (let i = 0; i < cookies.length; i++) {
        const res = await joinRoomPost(
          createSameOriginRequest("POST", "http://localhost:3000/api/rooms/join", { cookieHeader: cookies[i], body: { code, displayName: `Renamed ${reload}` } })
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.viewer.participantId).toBe(participantIds[i]);
        expect(body.room.frozenQuorum).toBe(3);
        expect(body.room.stateVersion).toBe(baseline.version);
      }
    }
    expect(counts()).toEqual(baseline);
    const after = await snapshot(roomId, cookies[1]!);
    expect(after.body.room.stateVersion).toBe(before.body.room.stateVersion);
    expect(after.body.viewer.userVotes).toEqual(before.body.viewer.userVotes);
  });

  it("collapses concurrent duplicate votes from duplicate tabs into exactly one recorded vote and one version bump", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(3);
    const card0 = deck[0]!;
    const versionBefore = (await snapshot(roomId, cookies[0]!)).body.room.stateVersion as number;
    const input = { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE" };
    const responses = await Promise.all([
      ...Array.from({ length: 4 }, () => vote(roomId, cookies[0]!, { ...input, operationId: "tab-dup" })),
      ...Array.from({ length: 4 }, (_, i) =>
        i % 2 === 0
          ? vote(roomId, cookies[0]!, { ...input, operationId: `tab-dup-${i}` })
          : vote(roomId, cookies[0]!, input, { "Idempotency-Key": `tab-dup-${i}` })
      ),
    ]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
    expect(bodies.filter((b) => b.idempotentReplay === false)).toHaveLength(1);
    expect(bodies.filter((b) => b.idempotentReplay === true)).toHaveLength(7);
    inspect(sqlitePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM votes WHERE room_id = ? AND participant_id = ?;", roomId, bodies[0].viewer.participantId)).toBe(1);
    });
    expect((await snapshot(roomId, cookies[0]!)).body.room.stateVersion).toBe(versionBefore + 1);
  });

  it("serializes opposite concurrent votes by one participant: one wins, the other is a 409, one row exists", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(2);
    for (let attempt = 0; attempt < 4; attempt++) {
      const card = deck[attempt]!;
      if (attempt > 0) {
        // Advance the deck unanimously so each attempt races on a fresh head card.
        const prev = deck[attempt - 1]!;
        for (let i = 1; i < cookies.length; i++) {
          // participant 0 already voted on prev during the race; the others complete it
          await vote(roomId, cookies[i]!, { roundId, candidateId: prev.candidateId, movieId: prev.movieId, vote: "SKIP", operationId: `adv-${attempt}-${i}` });
        }
      }
      const [like, skip] = await Promise.all([
        vote(roomId, cookies[0]!, { roundId, candidateId: card.candidateId, movieId: card.movieId, vote: "LIKE", operationId: `race-like-${attempt}` }),
        vote(roomId, cookies[0]!, { roundId, candidateId: card.candidateId, movieId: card.movieId, vote: "SKIP", operationId: `race-skip-${attempt}` }),
      ]);
      expect([like.status, skip.status].sort()).toEqual([200, 409]);
      const loser = like.status === 409 ? await like.json() : await skip.json();
      expect(loser.error).toBe("VOTE_IMMUTABLE");
      inspect(sqlitePath, (db) => {
        expect(count(db, "SELECT COUNT(*) AS c FROM votes WHERE room_id = ? AND candidate_id = ? AND participant_id = (SELECT participant_id FROM votes WHERE room_id = ? AND candidate_id = ? LIMIT 1);", roomId, card.candidateId, roomId, card.candidateId)).toBe(1);
      });
    }
  });

  it("produces a single authoritative MATCH under simultaneous final votes with duplicate retries", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(5);
    const card0 = deck[0]!;
    const calls: Array<Promise<Response>> = [];
    cookies.forEach((cookie, i) => {
      for (let copy = 0; copy < 3; copy++) {
        calls.push(vote(roomId, cookie, { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE", operationId: `final-${i}` }));
      }
    });
    const responses = await Promise.all(calls);
    expect(responses.every((r) => r.status === 200)).toBe(true);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    const matched = bodies.filter((b) => b.room.status === "MATCHED");
    expect(matched.length).toBeGreaterThan(0);
    for (const b of matched) {
      expect(b.room.matchedMovieId).toBe(card0.movieId);
      expect(b.room.matchedCandidate.candidateId).toBe(card0.candidateId);
    }
    inspect(sqlitePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM room_events WHERE room_id = ? AND event_type = 'MATCH_ANNOUNCED';", roomId)).toBe(1);
      expect(count(db, "SELECT COUNT(*) AS c FROM votes WHERE room_id = ?;", roomId)).toBe(5);
      expect(db.prepare("SELECT status, matched_movie_id FROM rooms WHERE id = ?;").get(roomId)).toMatchObject({ status: "MATCHED", matched_movie_id: card0.movieId });
      expect(count(db, "SELECT COUNT(*) AS c FROM rounds WHERE room_id = ? AND status = 'COMPLETED';", roomId)).toBe(1);
    });
    const views = await Promise.all(cookies.map((c) => snapshot(roomId, c)));
    expect(new Set(views.map((v) => v.body.room.stateVersion)).size).toBe(1);
    expect(new Set(views.map((v) => v.body.room.matchedMovieId))).toEqual(new Set([card0.movieId]));
  });

  it("answers a stale tab after the match with replays for old operations and 409 for new ones, never a second result", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(2);
    const card0 = deck[0]!;
    const card1 = deck[1]!;
    for (let i = 0; i < 2; i++) {
      expect((await vote(roomId, cookies[i]!, { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE", operationId: `m-${i}` })).status).toBe(200);
    }
    const replay = await vote(roomId, cookies[1]!, { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "LIKE", operationId: "m-1" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ idempotentReplay: true, isMatched: true });
    const stale = await vote(roomId, cookies[1]!, { roundId, candidateId: card1.candidateId, movieId: card1.movieId, vote: "LIKE", operationId: "stale-new" });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/ROOM_ALREADY_MATCHED|CANDIDATE_OUT_OF_ORDER/);
    const different = await vote(roomId, cookies[1]!, { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "SKIP", operationId: "m-1" });
    expect(different.status).toBe(409);
    expect((await different.json()).error).toBe("OPERATION_ID_CONFLICT");
    inspect(sqlitePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM votes WHERE room_id = ?;", roomId)).toBe(2);
    });
    const view = await snapshot(roomId, cookies[1]!);
    expect(view.body.room).toMatchObject({ status: "MATCHED", matchedMovieId: card0.movieId });
  });

  it("never shrinks the frozen quorum: leave in ACTIVE is rejected for guest and host, quorum is stable across reloads", async () => {
    const { roomId, cookies } = await setupStartedRoom(4);
    expect((await snapshot(roomId, cookies[0]!)).body.room.frozenQuorum).toBe(4);
    for (const idx of [3, 0]) {
      const res = await leaveRoomPost(
        createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/leave`, { cookieHeader: cookies[idx], body: {} }),
        ctx(roomId)
      );
      expect(res.status).toBe(409);
    }
    const views = await Promise.all(cookies.map((c) => snapshot(roomId, c)));
    for (const v of views) {
      expect(v.status).toBe(200);
      expect(v.body.room.frozenQuorum).toBe(4);
      expect(v.body.room.participants).toHaveLength(4);
      expect(v.body.viewer.isEligibleVoter).toBe(true);
    }
    inspect(sqlitePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM round_participants WHERE room_id = ?;", roomId)).toBe(4);
    });
  });

  it("scopes idempotency per room and actor: the same operationId never collides across participants or rooms", async () => {
    const first = await setupStartedRoom(2);
    const second = await setupStartedRoom(2);
    for (const room of [first, second]) {
      const card = room.deck[0]!;
      const responses = await Promise.all(
        room.cookies.map((cookie) => vote(room.roomId, cookie, { roundId: room.roundId, candidateId: card.candidateId, movieId: card.movieId, vote: "LIKE", operationId: "shared-op" }))
      );
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const bodies = await Promise.all(responses.map((r) => r.json()));
      expect(bodies.map((b) => b.idempotentReplay)).toEqual([false, false]);
    }
    inspect(sqlitePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM votes WHERE operation_id = 'shared-op';")).toBe(4);
    });
  });

  it("keeps the room authoritative when many tabs hit snapshots, votes and the realtime capability at once", async () => {
    const { roomId, roundId, deck, cookies } = await setupStartedRoom(3);
    const card0 = deck[0]!;
    const work: Array<Promise<{ status: number }>> = [];
    cookies.forEach((cookie, i) => {
      for (let n = 0; n < 4; n++) {
        work.push(snapshot(roomId, cookie));
        work.push(vote(roomId, cookie, { roundId, candidateId: card0.candidateId, movieId: card0.movieId, vote: "SKIP", operationId: `storm-${i}` }));
        work.push(realtimeTokenPost(createSameOriginRequest("POST", `http://localhost:3000/api/rooms/${roomId}/realtime-token`, { cookieHeader: cookie, body: {} }), ctx(roomId)));
      }
    });
    const results = await Promise.all(work);
    expect(results.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
    inspect(sqlitePath, (db) => {
      expect(count(db, "SELECT COUNT(*) AS c FROM votes WHERE room_id = ?;", roomId)).toBe(3);
      const version = count(db, "SELECT state_version AS c FROM rooms WHERE id = ?;", roomId);
      const events = db.prepare("SELECT version FROM room_events WHERE room_id = ? ORDER BY version ASC;").all(roomId) as Array<{ version: number }>;
      expect(events.at(-1)!.version).toBe(version);
      expect(new Set(events.map((e) => e.version)).size).toBe(events.length);
    });
  });
});
