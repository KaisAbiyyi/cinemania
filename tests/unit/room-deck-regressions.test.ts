// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DECK_SIZE } from "@/db/schema";
import { resolveEffectiveRoomDeckFilter } from "@/lib/schemas/roomDeck";
import { PostgresRoomRepository } from "@/lib/server/room/postgresRoomRepository";
import { fetchAndBuildDeterministicDeck } from "@/lib/server/room/roomDeck";
import {
  type CandidateInput,
  RoomCapacityError,
  SqliteRoomRepository,
} from "@/lib/server/room/roomRepository";
import { applySqliteMigrations } from "@/lib/server/room/roomStore";
import {
  DeckEmptyError,
  RoomCapacityError as StateMachineRoomCapacityError,
} from "@/lib/server/room/stateMachine";

const tempDirs: string[] = [];
const openDbs: DatabaseSync[] = [];

function createMigratedSqliteRepo(): { repo: SqliteRoomRepository; db: DatabaseSync } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine016-reg-"));
  tempDirs.push(tmpDir);
  const dbPath = path.join(tmpDir, "rooms.sqlite");
  const db = new DatabaseSync(dbPath);
  openDbs.push(db);
  applySqliteMigrations(db);
  return { repo: new SqliteRoomRepository(db), db };
}

function makeRawTmdbMovie(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Movie ${id}`,
    poster_path: `/poster-${id}.jpg`,
    overview: `Overview for ${id}`,
    release_date: "2025-03-01",
    vote_average: 7.4,
    adult: false,
    ...overrides,
  };
}

function makeCandidateInput(movieId: number, overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    movieId,
    title: `Candidate ${movieId}`,
    posterPath: `/poster-${movieId}.jpg`,
    overview: `Overview for ${movieId}`,
    releaseDate: "2025-03-01",
    voteAverage: 7.4,
    ...overrides,
  };
}

function createPgMockPool(options?: {
  roomStatus?: string;
  participantCount?: number;
}) {
  const roomId = crypto.randomUUID();
  const hostId = crypto.randomUUID();
  const guestId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];

  const roomState: Record<string, unknown> = {
    id: roomId,
    code: "PG1602",
    status: options?.roomStatus ?? "LOBBY",
    host_participant_id: hostId,
    current_round_id: null,
    state_version: 2,
    participant_count: options?.participantCount ?? 2,
    matched_movie_id: null,
    deck_filter: null,
    inactivity_ttl_seconds: 86400,
    last_activity_at: nowIso,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    created_at: nowIso,
    updated_at: nowIso,
  };

  const participantsState = [
    {
      room_id: roomId,
      participant_id: hostId,
      display_name: "PG Host",
      role: "HOST",
      is_connected: true,
      joined_at: "2026-11-14T00:00:00.000Z",
      last_seen_at: nowIso,
    },
    {
      room_id: roomId,
      participant_id: guestId,
      display_name: "PG Guest",
      role: "MEMBER",
      is_connected: true,
      joined_at: "2026-11-14T00:00:01.000Z",
      last_seen_at: nowIso,
    },
  ];

  const roundsState: Array<Record<string, unknown>> = [];
  const frozenState: Array<Record<string, unknown>> = [];
  const candidatesState: Array<Record<string, unknown>> = [];
  const eventsState: Array<Record<string, unknown>> = [];

  const mockClient = {
    query: async (sql: string, params?: unknown[]) => {
      const normalizedSql = sql.trim();
      queries.push({ sql: normalizedSql, params });

      if (normalizedSql.startsWith("BEGIN") || normalizedSql === "COMMIT;" || normalizedSql === "ROLLBACK;") {
        if (normalizedSql === "ROLLBACK;") {
          roundsState.length = 0;
          frozenState.length = 0;
          candidatesState.length = 0;
          eventsState.length = 0;
          roomState.status = options?.roomStatus ?? "LOBBY";
          roomState.current_round_id = null;
        }
        return { rows: [] };
      }
      if (normalizedSql.includes("SET search_path")) {
        return { rows: [] };
      }
      if (normalizedSql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
        return { rows: [{ ...roomState }] };
      }
      if (normalizedSql.includes("SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2")) {
        const pid = params?.[1];
        return { rows: participantsState.filter((p) => p.participant_id === pid) };
      }
      if (normalizedSql.includes("SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at")) {
        return { rows: participantsState.map((p) => ({ ...p })) };
      }
      if (normalizedSql.includes("SELECT COALESCE(MAX(round_number), 0)")) {
        return { rows: [{ max_round: 0 }] };
      }
      if (normalizedSql.includes("INSERT INTO rounds")) {
        const roundRow = {
          id: params?.[0],
          room_id: params?.[1],
          round_number: params?.[2],
          status: "ACTIVE",
          started_at: params?.[3],
          completed_at: null,
        };
        roundsState.push(roundRow);
        roomState.current_round_id = params?.[0];
        return { rows: [] };
      }
      if (normalizedSql.includes("INSERT INTO round_participants")) {
        frozenState.push({
          room_id: params?.[0],
          round_id: params?.[1],
          participant_id: params?.[2],
          frozen_role: params?.[3],
          joined_at: params?.[4],
          frozen_at: params?.[5],
        });
        return { rows: [] };
      }
      if (normalizedSql.includes("INSERT INTO candidates")) {
        candidatesState.push({
          id: params?.[0],
          round_id: params?.[1],
          room_id: params?.[2],
          movie_id: params?.[3],
          position: params?.[4],
          title: params?.[5],
          poster_path: params?.[6],
          overview: params?.[7],
          release_date: params?.[8],
          vote_average: params?.[9],
        });
        return { rows: [] };
      }
      if (normalizedSql.includes("UPDATE rooms") && normalizedSql.includes("SET status = 'ACTIVE'")) {
        roomState.status = "ACTIVE";
        roomState.current_round_id = params?.[0];
        roomState.state_version = params?.[1];
        return { rows: [] };
      }
      if (normalizedSql.includes("INSERT INTO room_events")) {
        eventsState.push({
          room_id: params?.[0],
          version: params?.[1],
          event_type: normalizedSql.includes("ROSTER_FROZEN") ? "ROSTER_FROZEN" : "ROUND_STARTED",
          payload: params?.[2],
          created_at: params?.[3],
        });
        return { rows: [] };
      }
      if (normalizedSql === "SELECT * FROM rooms WHERE id = $1;") {
        return { rows: [{ ...roomState }] };
      }
      if (normalizedSql === "SELECT * FROM rounds WHERE id = $1;") {
        return { rows: roundsState.map((r) => ({ ...r })) };
      }
      if (normalizedSql.includes("SELECT * FROM round_participants WHERE room_id = $1 AND round_id = $2")) {
        return { rows: frozenState.map((r) => ({ ...r })) };
      }
      if (normalizedSql.includes("SELECT * FROM candidates WHERE room_id = $1 AND round_id = $2")) {
        return { rows: candidatesState.map((c) => ({ ...c })) };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };

  const mockPool = { totalCount: 1, connect: async () => mockClient };
  return {
    repo: new PostgresRoomRepository(mockPool as never, { schema: "cinematch_reg" }),
    roomId,
    hostId,
    queries,
    roomState,
    roundsState,
    frozenState,
    candidatesState,
    eventsState,
  };
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    try {
      db?.close();
    } catch {
      // ignore if already closed
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
});

describe("CINE-016 Review Regressions ([P2-1] Pagination & [P2-2] Repository Candidate Invariants)", () => {
  describe("[P2-1] Bounded Multi-Page Scanning Across Zero-Progress Intermediary Pages", () => {
    it("scans page 3 when page1=10 unique, page2=0 new (duplicates + invalid), page3=15 unique (total_pages=3)", async () => {
      const page1Items = Array.from({ length: 10 }, (_, idx) => makeRawTmdbMovie(1001 + idx));
      const page2DuplicateAndInvalidItems = [
        ...page1Items,
        { id: 0, title: "Invalid Zero ID", adult: false },
        { id: 9999, title: "   ", adult: false },
      ];
      const page3Items = Array.from({ length: 15 }, (_, idx) => makeRawTmdbMovie(2001 + idx));

      const pagesRequested: number[] = [];
      const fetcher = async (params: Record<string, unknown>) => {
        const page = Number(params.page ?? "1");
        pagesRequested.push(page);
        if (page === 1) {
          return { page: 1, total_pages: 3, total_results: 37, results: page1Items };
        }
        if (page === 2) {
          return { page: 2, total_pages: 3, total_results: 37, results: page2DuplicateAndInvalidItems };
        }
        return { page: 3, total_pages: 3, total_results: 37, results: page3Items };
      };

      const filter = resolveEffectiveRoomDeckFilter(undefined);
      const firstRun = await fetchAndBuildDeterministicDeck({
        roomId: "11111111-1111-4111-8111-111111111111",
        roundNumber: 1,
        filter,
        discoverFetcher: fetcher,
      });
      const secondRun = await fetchAndBuildDeterministicDeck({
        roomId: "11111111-1111-4111-8111-111111111111",
        roundNumber: 1,
        filter,
        discoverFetcher: fetcher,
      });

      expect(pagesRequested).toEqual([1, 2, 3, 1, 2, 3]);
      expect(firstRun.candidates).toHaveLength(DECK_SIZE);
      expect(firstRun.uniquePoolCount).toBe(25);
      expect(firstRun.pagesFetched).toBe(3);
      expect(firstRun.isShortage).toBe(false);
      expect(new Set(firstRun.candidates.map((c) => c.movieId)).size).toBe(DECK_SIZE);
      expect(firstRun.candidates).toEqual(secondRun.candidates);
    });

    it("scans page 3 when page 2 is an adult-only intermediary page (0 safe candidates)", async () => {
      const page1Items = Array.from({ length: 10 }, (_, idx) => makeRawTmdbMovie(3001 + idx));
      const page2AdultOnlyItems = Array.from({ length: 20 }, (_, idx) =>
        makeRawTmdbMovie(4001 + idx, { adult: true, title: `Adult Film ${idx}` })
      );
      const page3Items = Array.from({ length: 15 }, (_, idx) => makeRawTmdbMovie(5001 + idx));

      const fetcher = async (params: Record<string, unknown>) => {
        const page = Number(params.page ?? "1");
        if (page === 1) {
          return { page: 1, total_pages: 3, total_results: 45, results: page1Items };
        }
        if (page === 2) {
          return { page: 2, total_pages: 3, total_results: 45, results: page2AdultOnlyItems };
        }
        return { page: 3, total_pages: 3, total_results: 45, results: page3Items };
      };

      const filter = resolveEffectiveRoomDeckFilter(undefined);
      const deck = await fetchAndBuildDeterministicDeck({
        roomId: "22222222-2222-4222-8222-222222222222",
        roundNumber: 1,
        filter,
        discoverFetcher: fetcher,
      });

      expect(deck.candidates).toHaveLength(DECK_SIZE);
      expect(deck.pagesFetched).toBe(3);
      expect(deck.isShortage).toBe(false);
      expect(deck.candidates.every((c) => c.movieId < 4001 || c.movieId > 4020)).toBe(true);
      expect(deck.candidates.some((c) => c.movieId >= 5001)).toBe(true);
    });

    it("respects maxPages=5 upper bound even when total_pages=10 has sparse unique movies", async () => {
      const requestedPages: number[] = [];
      const fetcher = async (params: Record<string, unknown>) => {
        const page = Number(params.page ?? "1");
        requestedPages.push(page);
        if (page === 1) {
          return {
            page: 1,
            total_pages: 10,
            total_results: 100,
            results: [makeRawTmdbMovie(6001), makeRawTmdbMovie(6002)],
          };
        }
        if (page <= 4) {
          return {
            page,
            total_pages: 10,
            total_results: 100,
            results: [makeRawTmdbMovie(6001), makeRawTmdbMovie(6099, { adult: true })],
          };
        }
        return {
          page,
          total_pages: 10,
          total_results: 100,
          results: [makeRawTmdbMovie(6005), makeRawTmdbMovie(6006)],
        };
      };

      const deck = await fetchAndBuildDeterministicDeck({
        roomId: "33333333-3333-4333-8333-333333333333",
        roundNumber: 1,
        filter: resolveEffectiveRoomDeckFilter(undefined),
        discoverFetcher: fetcher,
      });

      expect(requestedPages).toEqual([1, 2, 3, 4, 5]);
      expect(deck.pagesFetched).toBe(5);
      expect(deck.candidates).toHaveLength(4);
      expect(deck.isShortage).toBe(true);
    });
  });

  describe("[P2-2] SQLite Repository Rejects Missing / Empty / Invalid Candidates Atomically", () => {
    it("rejects missing options and empty candidates=[], rolling back zero side effects and keeping room LOBBY", () => {
      const { repo, db } = createMigratedSqliteRepo();
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      const guestId = crypto.randomUUID();
      repo.joinRoom(room.id, guestId, "Guest");

      const assertCleanLobbyState = () => {
        const roomRow = db.prepare("SELECT status, current_round_id, state_version FROM rooms WHERE id = ?;").get(
          room.id
        ) as { status: string; current_round_id: string | null; state_version: number };
        expect(roomRow.status).toBe("LOBBY");
        expect(roomRow.current_round_id).toBeNull();
        expect(roomRow.state_version).toBe(2);

        const countRounds = (db.prepare("SELECT COUNT(*) AS cnt FROM rounds WHERE room_id = ?;").get(room.id) as {
          cnt: number;
        }).cnt;
        const countFrozen = (
          db.prepare("SELECT COUNT(*) AS cnt FROM round_participants WHERE room_id = ?;").get(room.id) as {
            cnt: number;
          }
        ).cnt;
        const countCands = (
          db.prepare("SELECT COUNT(*) AS cnt FROM candidates WHERE room_id = ?;").get(room.id) as { cnt: number }
        ).cnt;
        const countStartEvents = (
          db
            .prepare(
              "SELECT COUNT(*) AS cnt FROM room_events WHERE room_id = ? AND event_type IN ('ROSTER_FROZEN', 'ROUND_STARTED');"
            )
            .get(room.id) as { cnt: number }
        ).cnt;

        expect(countRounds).toBe(0);
        expect(countFrozen).toBe(0);
        expect(countCands).toBe(0);
        expect(countStartEvents).toBe(0);
      };

      // Missing options (cast from JS / untyped caller)
      expect(() => repo.startLobbyRound(room.id, host.participant_id, undefined as never)).toThrowError(
        DeckEmptyError
      );
      assertCleanLobbyState();

      // Empty candidates array
      expect(() => repo.startLobbyRound(room.id, host.participant_id, { candidates: [] })).toThrowError(
        DeckEmptyError
      );
      assertCleanLobbyState();

      // > 20 candidates rejected cleanly
      const twentyOne = Array.from({ length: 21 }, (_, idx) => makeCandidateInput(7001 + idx));
      expect(() => repo.startLobbyRound(room.id, host.participant_id, { candidates: twentyOne })).toThrowError(
        StateMachineRoomCapacityError
      );
      assertCleanLobbyState();

      // Duplicate candidate movieId rejected cleanly
      expect(() =>
        repo.startLobbyRound(room.id, host.participant_id, {
          candidates: [makeCandidateInput(7100), makeCandidateInput(7100)],
        })
      ).toThrow(/Duplicate candidate movieId/);
      assertCleanLobbyState();

      // Blank title rejected cleanly
      expect(() =>
        repo.startLobbyRound(room.id, host.participant_id, {
          candidates: [makeCandidateInput(7101, { title: "   " })],
        })
      ).toThrow(/title must be non-empty/);
      assertCleanLobbyState();

      // Now 1 valid candidate commits atomically
      const startedOne = repo.startLobbyRound(room.id, host.participant_id, {
        candidates: [makeCandidateInput(7200)],
      });
      expect(startedOne.room.status).toBe("ACTIVE");
      expect(startedOne.round.status).toBe("ACTIVE");
      expect(startedOne.frozenParticipants).toHaveLength(2);
      expect(startedOne.candidates).toHaveLength(1);
      expect(startedOne.candidates[0].movie_id).toBe(7200);
      expect(startedOne.candidates[0].position).toBe(0);

      // Re-starting throws RoomCapacityError without mutating existing round
      expect(() =>
        repo.startLobbyRound(room.id, host.participant_id, {
          candidates: [makeCandidateInput(7201)],
        })
      ).toThrowError(RoomCapacityError);
    });

    it("commits 20 valid candidates atomically and rolls back completely if transaction callback fails", () => {
      const { repo, db } = createMigratedSqliteRepo();
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      repo.joinRoom(room.id, crypto.randomUUID(), "Guest 2");

      const twenty = Array.from({ length: 20 }, (_, idx) => makeCandidateInput(8001 + idx));

      expect(() =>
        repo.startLobbyRoundInTransaction(room.id, host.participant_id, {
          options: { candidates: twenty },
          afterStart: () => {
            throw new Error("Simulated post-insert failure");
          },
        })
      ).toThrow("Simulated post-insert failure");

      const afterRollbackRoom = repo.getConsistentSnapshot(room.id);
      expect(afterRollbackRoom?.room.status).toBe("LOBBY");
      expect(afterRollbackRoom?.candidates).toHaveLength(0);
      expect(afterRollbackRoom?.roundParticipants).toHaveLength(0);
      expect(
        (db.prepare("SELECT COUNT(*) AS cnt FROM rounds WHERE room_id = ?;").get(room.id) as { cnt: number }).cnt
      ).toBe(0);

      const started = repo.startLobbyRound(room.id, host.participant_id, { candidates: twenty });
      expect(started.room.status).toBe("ACTIVE");
      expect(started.candidates).toHaveLength(20);
      expect(started.candidates.map((c) => c.position)).toEqual(Array.from({ length: 20 }, (_, idx) => idx));
    });
  });

  describe("[P2-2] PostgreSQL Repository Rejects Missing / Empty Candidates With Rollback & Commits 1..20 Atomically", () => {
    it("rejects missing options and empty candidates=[] with ROLLBACK and zero DB mutations in PostgresRoomRepository", async () => {
      const ctx = createPgMockPool();

      await expect(ctx.repo.startLobbyRound(ctx.roomId, ctx.hostId, undefined as never)).rejects.toThrowError(
        DeckEmptyError
      );
      expect(ctx.queries.some((q) => q.sql === "ROLLBACK;")).toBe(true);
      expect(ctx.queries.some((q) => q.sql === "COMMIT;")).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("INSERT INTO rounds"))).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("INSERT INTO round_participants"))).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("INSERT INTO candidates"))).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("UPDATE rooms"))).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("INSERT INTO room_events"))).toBe(false);
      expect(ctx.roomState.status).toBe("LOBBY");

      ctx.queries.length = 0;
      await expect(ctx.repo.startLobbyRound(ctx.roomId, ctx.hostId, { candidates: [] })).rejects.toThrowError(
        DeckEmptyError
      );
      expect(ctx.queries.some((q) => q.sql === "ROLLBACK;")).toBe(true);
      expect(ctx.queries.some((q) => q.sql === "COMMIT;")).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("INSERT INTO rounds"))).toBe(false);
      expect(ctx.queries.some((q) => q.sql.includes("INSERT INTO candidates"))).toBe(false);
      expect(ctx.roomState.status).toBe("LOBBY");

      // 1-candidate shortage commits atomically
      const startedOne = await ctx.repo.startLobbyRound(ctx.roomId, ctx.hostId, {
        candidates: [makeCandidateInput(9101)],
      });
      expect(startedOne.room.status).toBe("ACTIVE");
      expect(startedOne.candidates).toHaveLength(1);
      expect(startedOne.candidates[0].movie_id).toBe(9101);
      expect(ctx.queries.some((q) => q.sql === "COMMIT;")).toBe(true);
    });

    it("commits 20 valid candidates atomically in PostgresRoomRepository", async () => {
      const ctx = createPgMockPool();
      const twenty = Array.from({ length: 20 }, (_, idx) => makeCandidateInput(9201 + idx));

      const started = await ctx.repo.startLobbyRound(ctx.roomId, ctx.hostId, { candidates: twenty });
      expect(started.room.status).toBe("ACTIVE");
      expect(started.frozenParticipants).toHaveLength(2);
      expect(started.candidates).toHaveLength(20);
      expect(ctx.candidatesState).toHaveLength(20);
      expect(ctx.eventsState.some((e) => e.event_type === "ROSTER_FROZEN")).toBe(true);
      const roundStartedEvent = ctx.eventsState.find((e) => e.event_type === "ROUND_STARTED");
      expect(roundStartedEvent).toBeDefined();
      const payload = JSON.parse(String(roundStartedEvent?.payload));
      expect(payload.deckSize).toBe(20);
      expect(payload.expectedDeckSize).toBe(20);
      expect(payload.isShortage).toBe(false);
    });
  });
});
