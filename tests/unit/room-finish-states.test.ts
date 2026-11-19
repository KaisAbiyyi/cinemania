import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INACTIVITY_TTL_SECONDS } from "@/db/schema";
import { createRoomActions, retryOperationId } from "@/lib/realtime/roomActions";
import { startRoomRealtime, type RealtimeEnvironment } from "@/lib/realtime/roomRealtime";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";
import { RoomExpiryWorker, type SyntheticClock } from "@/lib/server/room/expiryWorker";
import { PostgresRoomRepository } from "@/lib/server/room/postgresRoomRepository";
import {
  type CandidateInput,
  RoomCapacityError,
  RoomExpiredError,
  RoomNotExhaustedError,
  SqliteRoomRepository,
} from "@/lib/server/room/roomRepository";
import { buildSafeRoomSnapshot } from "@/lib/server/room/roomSnapshot";
import { applySqliteMigrations } from "@/lib/server/room/roomStore";
import { OperationConflictError } from "@/lib/server/room/votingEngine";

class MutableClock implements SyntheticClock {
  private currentMs: number;

  constructor(initialIso: string) {
    this.currentMs = new Date(initialIso).getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  advanceSeconds(seconds: number): void {
    this.currentMs += seconds * 1000;
  }

  advanceMs(ms: number): void {
    this.currentMs += ms;
  }
}

function makeCandidates(baseId: number, count = 20): CandidateInput[] {
  return Array.from({ length: count }, (_, idx) => ({
    movieId: baseId + idx,
    title: `Finish Movie ${baseId + idx}`,
    posterPath: `/poster-${baseId + idx}.jpg`,
    overview: `Overview for ${baseId + idx}`,
    releaseDate: "2024-03-10",
    voteAverage: 7.4,
  }));
}

function createMigratedRepo(clock: MutableClock, ttlSeconds = DEFAULT_INACTIVITY_TTL_SECONDS) {
  const db = new DatabaseSync(":memory:");
  applySqliteMigrations(db);
  const repo = new SqliteRoomRepository(db, {
    enforceMigrationAuthority: true,
    clock,
  });
  const created = repo.createRoom({
    hostDisplayName: "Alice",
    inactivityTtlSeconds: ttlSeconds,
  });
  return { db, repo, roomId: created.room.id, hostId: created.host.participant_id };
}

describe("CINE-020 Authoritative Finish States (Fake Clocks, Grace, Expiry & Cleanup)", () => {
  it("transitions ACTIVE -> EXHAUSTED on last candidate without unanimous approval, hides peer votes, and supports filtered retry (both via LOBBY and direct ACTIVE)", () => {
    const clock = new MutableClock("2026-11-18T10:00:00.000Z");
    const { db, repo, roomId, hostId } = createMigratedRepo(clock);
    const guestId = crypto.randomUUID();
    repo.joinRoom(roomId, guestId, "Bob");

    const candidates1 = makeCandidates(1000, 20);
    const started = repo.startLobbyRound(roomId, hostId, {
      candidates: candidates1,
      deckFilter: { include_adult: false, language: "en-US", sort_by: "popularity.desc", watch_region: "US" },
    });
    expect(started.round.round_number).toBe(1);

    // Non-EXHAUSTED room rejects retry
    expect(() =>
      repo.retryExhaustedRound(roomId, hostId, { startRound: false })
    ).toThrowError(RoomNotExhaustedError);

    // Exhaust all 20 candidates with non-unanimous votes
    for (let i = 0; i < started.candidates.length; i += 1) {
      const c = started.candidates[i];
      repo.recordVote(roomId, started.round.id, hostId, c.id, c.movie_id, "LIKE");
      const lastRes = repo.recordVote(
        roomId,
        started.round.id,
        guestId,
        c.id,
        c.movie_id,
        "SKIP"
      );
      if (i < started.candidates.length - 1) {
        expect(lastRes.isExhausted).toBe(false);
        expect(lastRes.room.status).toBe("ACTIVE");
      } else {
        expect(lastRes.isExhausted).toBe(true);
        expect(lastRes.room.status).toBe("EXHAUSTED");
      }
    }

    const exhaustedSnap = repo.getConsistentSnapshot(roomId)!;
    const safeExhausted = buildSafeRoomSnapshot(
      exhaustedSnap.room,
      exhaustedSnap.participants,
      guestId,
      clock.now(),
      exhaustedSnap.roundParticipants,
      exhaustedSnap.candidates,
      exhaustedSnap.votes,
      { latestRoundStatus: exhaustedSnap.latestRound?.status ?? null }
    );
    expect(safeExhausted.status).toBe("EXHAUSTED");
    expect(safeExhausted.canRetry).toBe(true);
    expect(safeExhausted.canStart).toBe(false);
    expect(safeExhausted.finishState).toMatchObject({
      status: "EXHAUSTED",
      code: "DECK_EXHAUSTED",
      reason: "NO_UNANIMOUS_MATCH",
      recoverable: true,
      retryAvailable: true,
      matchedMovieId: null,
    });
    expect(JSON.stringify(safeExhausted)).not.toContain('"LIKE"');
    expect(JSON.stringify(safeExhausted)).not.toContain('"SKIP"');

    // Guests cannot retry exhausted room
    expect(() =>
      repo.retryExhaustedRound(roomId, guestId, { startRound: false })
    ).toThrowError(CapabilityAuthError);

    // Path A: Host returns EXHAUSTED -> LOBBY, updates filters, and starts Round 2
    const retriedLobby = repo.retryExhaustedRound(roomId, hostId, {
      startRound: false,
      operationId: "retry-lobby-r1",
      deckFilter: { include_adult: false, language: "en-US", sort_by: "vote_average.desc", watch_region: "GB" },
    });
    expect(retriedLobby.room.status).toBe("LOBBY");
    expect(retriedLobby.room.current_round_id).toBeNull();
    expect(retriedLobby.idempotentReplay).toBe(false);

    // Replaying same operationId returns idempotent replay without error
    const replayedLobby = repo.retryExhaustedRound(roomId, hostId, {
      startRound: false,
      operationId: "retry-lobby-r1",
      deckFilter: { include_adult: false, language: "en-US", sort_by: "vote_average.desc", watch_region: "GB" },
    });
    expect(replayedLobby.idempotentReplay).toBe(true);
    expect(replayedLobby.room.state_version).toBe(retriedLobby.room.state_version);

    // Mismatched operationId params throw OperationConflictError
    expect(() =>
      repo.retryExhaustedRound(roomId, hostId, {
        startRound: true,
        operationId: "retry-lobby-r1",
        candidates: makeCandidates(2000, 5),
      })
    ).toThrowError(OperationConflictError);

    // Start Round 2 (with shortage deck of 4 movies) and exhaust again
    const started2 = repo.startLobbyRound(roomId, hostId, {
      candidates: makeCandidates(2000, 4),
      expectedRoundNumber: 2,
    });
    expect(started2.round.round_number).toBe(2);
    for (const c of started2.candidates) {
      repo.recordVote(roomId, started2.round.id, hostId, c.id, c.movie_id, "SKIP");
      repo.recordVote(roomId, started2.round.id, guestId, c.id, c.movie_id, "LIKE");
    }
    expect(repo.getRoomById(roomId)?.status).toBe("EXHAUSTED");

    // Path B: Direct EXHAUSTED -> ACTIVE with updated filters & operationId
    const directRetry = repo.retryExhaustedRound(roomId, hostId, {
      startRound: true,
      candidates: makeCandidates(3000, 20),
      deckFilter: { include_adult: false, language: "en-US", sort_by: "popularity.desc", with_genres: "28" },
      operationId: "retry-direct-r3",
    });
    expect(directRetry.room.status).toBe("ACTIVE");
    expect(directRetry.round?.round_number).toBe(3);
    expect(directRetry.candidates).toHaveLength(20);

    // Replaying direct retry returns identical round without duplicating round rows
    const directReplay = repo.retryExhaustedRound(roomId, hostId, {
      startRound: true,
      deckFilter: { include_adult: false, language: "en-US", sort_by: "popularity.desc", with_genres: "28" },
      operationId: "retry-direct-r3",
    });
    expect(directReplay.idempotentReplay).toBe(true);
    expect(directReplay.round?.id).toBe(directRetry.round?.id);

    // Unanimous match in Round 3 succeeds cleanly
    const c0 = directRetry.candidates[0];
    repo.recordVote(roomId, directRetry.round!.id, hostId, c0.id, c0.movie_id, "LIKE");
    const winRes = repo.recordVote(
      roomId,
      directRetry.round!.id,
      guestId,
      c0.id,
      c0.movie_id,
      "LIKE"
    );
    expect(winRes.isMatched).toBe(true);
    expect(winRes.room.status).toBe("MATCHED");

    // Matched room rejects retry & Round 1/2/3 votes remain immutable in DB
    expect(() => repo.retryExhaustedRound(roomId, hostId)).toThrowError(RoomNotExhaustedError);
    const totalRounds = db
      .prepare("SELECT count(*) AS cnt FROM rounds WHERE room_id = ?")
      .get(roomId) as { cnt: number };
    expect(totalRounds.cnt).toBe(3);
    db.close();
  });

  it("enforces 90-second reconnect grace on host loss and ACTIVE disconnect without split-brain or quorum mutation", () => {
    const clock = new MutableClock("2026-11-18T12:00:00.000Z");
    const { db, repo, roomId, hostId } = createMigratedRepo(clock);

    // Deterministic tie-breaker check: guestA joined at +1s, guestB joined at +2s
    clock.advanceSeconds(1);
    const guestA = crypto.randomUUID();
    repo.joinRoom(roomId, guestA, "Bob");
    clock.advanceSeconds(1);
    const guestB = crypto.randomUUID();
    repo.joinRoom(roomId, guestB, "Charlie");

    // 1. Reconnect BEFORE 90s in LOBBY keeps original host and creates NO duplicate participant
    repo.updateParticipantPresence(roomId, hostId, false);
    clock.advanceSeconds(89);
    const beforeBoundarySweep = repo.sweepRoomGraceTimeouts(roomId);
    expect(beforeBoundarySweep.changed).toBe(false);

    const hostReconnectBefore = repo.joinRoom(roomId, hostId, "Alice");
    expect(hostReconnectBefore.role).toBe("HOST");
    expect(repo.getParticipantsByRoom(roomId)).toHaveLength(3);
    expect(repo.getRoomById(roomId)?.host_participant_id).toBe(hostId);

    // 2. Host disconnects >= 90s during LOBBY -> deterministically promotes oldest connected guest (guestA)
    repo.updateParticipantPresence(roomId, hostId, false);
    clock.advanceSeconds(90);
    const lobbySweep = repo.sweepRoomGraceTimeouts(roomId);
    expect(lobbySweep.changed).toBe(true);
    expect(lobbySweep.hostTransferred).toBe(true);
    expect(lobbySweep.roundCancelled).toBe(false);
    expect(lobbySweep.nextHostParticipantId).toBe(guestA);

    // Old host is now MEMBER -> cannot start round (no split-brain)
    expect(repo.getParticipant(roomId, hostId)?.role).toBe("MEMBER");
    expect(() =>
      repo.startLobbyRound(roomId, hostId, { candidates: makeCandidates(4000, 20) })
    ).toThrowError(CapabilityAuthError);

    // Reconnecting old host remains MEMBER, while guestA is authoritative HOST
    repo.updateParticipantPresence(roomId, hostId, true);
    expect(repo.getRoomById(roomId)?.host_participant_id).toBe(guestA);

    // 3. Start Round 1 with all 3 frozen voters -> guestB disconnects and reconnects at 89s (round stays ACTIVE)
    const r1 = repo.startLobbyRound(roomId, guestA, { candidates: makeCandidates(4100, 20) });
    expect(r1.frozenParticipants).toHaveLength(3);
    repo.recordVote(roomId, r1.round.id, guestA, r1.candidates[0].id, r1.candidates[0].movie_id, "LIKE");
    repo.updateParticipantPresence(roomId, guestB, false);

    clock.advanceSeconds(89);
    expect(repo.sweepRoomGraceTimeouts(roomId).changed).toBe(false);
    const snapBefore = buildSafeRoomSnapshot(
      repo.getRoomById(roomId)!,
      repo.getParticipantsByRoom(roomId),
      guestA,
      clock.now(),
      r1.frozenParticipants,
      r1.candidates
    );
    expect(snapBefore.participants.find((p) => p.displayName === "Charlie")?.graceExpiresAt).toBeDefined();

    // Timely reconnect preserves round and frozen quorum
    const presReconnect = repo.updateParticipantPresence(roomId, guestB, true);
    expect(presReconnect.changed).toBe(true);
    expect(presReconnect.room.status).toBe("ACTIVE");
    expect(repo.getRoundParticipants(roomId, r1.round.id)).toHaveLength(3);

    // 4. guestA (current HOST) disconnects >= 90s during ACTIVE -> handoff to connected next host (hostId joined before guestB) AND cancel round back to LOBBY
    repo.updateParticipantPresence(roomId, guestA, false);
    clock.advanceSeconds(90);
    const activeSweep = repo.sweepRoomGraceTimeouts(roomId);
    expect(activeSweep.changed).toBe(true);
    expect(activeSweep.hostTransferred).toBe(true);
    expect(activeSweep.roundCancelled).toBe(true);
    expect(activeSweep.nextHostParticipantId).toBe(hostId);

    // Idempotent second sweep immediately after does nothing
    expect(repo.sweepRoomGraceTimeouts(roomId).changed).toBe(false);

    const roomAfterCancel = repo.getRoomById(roomId)!;
    expect(roomAfterCancel.status).toBe("LOBBY");
    expect(roomAfterCancel.current_round_id).toBeNull();
    expect(repo.getRoundById(r1.round.id)?.status).toBe("CANCELLED");

    // Frozen roster of Round 1 remains intact & stale vote for cancelled Round 1 is rejected with ROUND_CANCELLED
    expect(repo.getRoundParticipants(roomId, r1.round.id)).toHaveLength(3);
    try {
      repo.recordVote(roomId, r1.round.id, guestB, r1.candidates[0].id, r1.candidates[0].movie_id, "LIKE");
      expect.unreachable("Expected stale vote on cancelled round to fail");
    } catch (err) {
      expect(err).toBeInstanceOf(RoomCapacityError);
      expect((err as RoomCapacityError).code).toBe("ROUND_CANCELLED");
    }

    // Post-vote participant (guestA) leaving in LOBBY preserves immutable R1 vote without TRIGGER failure!
    repo.leaveLobby(roomId, guestA);
    const guestARow = repo.getParticipant(roomId, guestA);
    expect(guestARow?.is_connected).toBe(false);
    expect(repo.getVotesByRound(r1.round.id, roomId)).toHaveLength(1);

    // Round 2 freezes only remaining connected participants (hostId & guestB)
    const r2 = repo.startLobbyRound(roomId, hostId, { candidates: makeCandidates(4200, 20) });
    expect(r2.round.round_number).toBe(2);
    expect(r2.frozenParticipants.map((p) => p.participant_id).sort()).toEqual(
      [hostId, guestB].sort()
    );

    const safeLobbyCancelCheck = buildSafeRoomSnapshot(
      roomAfterCancel,
      repo.getParticipantsByRoom(roomId),
      hostId,
      clock.now(),
      [],
      [],
      [],
      { latestRoundStatus: "CANCELLED" }
    );
    expect(safeLobbyCancelCheck.finishState.code).toBe("ROUND_CANCELLED");
    db.close();
  });

  it("enforces exact 24h TTL across LOBBY/ACTIVE/MATCHED/EXHAUSTED, rejects expired actions, and runs idempotent retention-compliant cleanup", async () => {
    // Initialize clock 25h in the past so DB julianday('now') retention trigger allows purge after +24h advance
    const clock = new MutableClock(new Date(Date.now() - 25 * 3600 * 1000).toISOString());
    const db = new DatabaseSync(":memory:");
    applySqliteMigrations(db);
    const repo = new SqliteRoomRepository(db, { enforceMigrationAuthority: true, clock });
    const worker = new RoomExpiryWorker(DEFAULT_INACTIVITY_TTL_SECONDS, clock);

    // 1. Custom TTL room (1 hour = 3600s) in LOBBY
    const custom = repo.createRoom({ hostDisplayName: "ShortTTL", inactivityTtlSeconds: 3600 });

    // 2. Default 24h rooms in ACTIVE, MATCHED, and EXHAUSTED
    const active = repo.createRoom({ hostDisplayName: "ActiveHost" });
    const activeGuest = crypto.randomUUID();
    repo.joinRoom(active.room.id, activeGuest, "ActiveGuest");
    const activeStarted = repo.startLobbyRound(active.room.id, active.host.participant_id, {
      candidates: makeCandidates(5100, 5),
    });

    const matched = repo.createRoom({ hostDisplayName: "MatchHost" });
    const matchedGuest = crypto.randomUUID();
    repo.joinRoom(matched.room.id, matchedGuest, "MatchGuest");
    const matchedStarted = repo.startLobbyRound(matched.room.id, matched.host.participant_id, {
      candidates: makeCandidates(5200, 5),
    });
    repo.recordVote(
      matched.room.id,
      matchedStarted.round.id,
      matched.host.participant_id,
      matchedStarted.candidates[0].id,
      matchedStarted.candidates[0].movie_id,
      "LIKE"
    );
    repo.recordVote(
      matched.room.id,
      matchedStarted.round.id,
      matchedGuest,
      matchedStarted.candidates[0].id,
      matchedStarted.candidates[0].movie_id,
      "LIKE"
    );
    expect(repo.getRoomById(matched.room.id)?.status).toBe("MATCHED");

    const exhausted = repo.createRoom({ hostDisplayName: "ExHost" });
    const exGuest = crypto.randomUUID();
    repo.joinRoom(exhausted.room.id, exGuest, "ExGuest");
    const exStarted = repo.startLobbyRound(exhausted.room.id, exhausted.host.participant_id, {
      candidates: makeCandidates(5300, 2),
    });
    for (const c of exStarted.candidates) {
      repo.recordVote(exhausted.room.id, exStarted.round.id, exhausted.host.participant_id, c.id, c.movie_id, "LIKE");
      repo.recordVote(exhausted.room.id, exStarted.round.id, exGuest, c.id, c.movie_id, "SKIP");
    }
    expect(repo.getRoomById(exhausted.room.id)?.status).toBe("EXHAUSTED");

    // Advance 3599s: custom TTL room NOT expired yet
    clock.advanceSeconds(3599);
    expect((await worker.processExpiredRooms(repo)).processedCount).toBe(0);

    // Advance +1s (3600s): custom TTL room expires, 24h rooms remain alive
    clock.advanceSeconds(1);
    const customSweep = await worker.processExpiredRooms(repo);
    expect(customSweep.expiredRoomIds).toEqual([custom.room.id]);

    // Advance to 86399s from room start (already 3600s elapsed -> +82799s): 24h rooms still alive
    clock.advanceSeconds(82799);
    expect((await worker.processExpiredRooms(repo)).processedCount).toBe(0);

    // Advance +1s (86400s): ACTIVE, MATCHED, and EXHAUSTED all expire
    clock.advanceSeconds(1);
    const sweep24h = await worker.processExpiredRooms(repo);
    expect(sweep24h.expiredRoomIds.sort()).toEqual(
      [active.room.id, matched.room.id, exhausted.room.id].sort()
    );
    expect(repo.getRoundById(activeStarted.round.id)?.status).toBe("CANCELLED");

    // Expired room rejects joins, votes, retry, presence, and filters
    expect(() => repo.joinRoom(active.room.id, activeGuest, "ActiveGuest")).toThrowError(RoomExpiredError);
    expect(() => repo.joinRoom(custom.room.id, crypto.randomUUID(), "LateJoin")).toThrowError(RoomExpiredError);
    expect(() => repo.retryExhaustedRound(exhausted.room.id, exhausted.host.participant_id)).toThrowError(RoomExpiredError);
    expect(() => repo.updateParticipantPresence(matched.room.id, matchedGuest, false)).toThrowError(RoomExpiredError);
    expect(() =>
      repo.recordVote(
        active.room.id,
        activeStarted.round.id,
        activeGuest,
        activeStarted.candidates[0].id,
        activeStarted.candidates[0].movie_id,
        "LIKE"
      )
    ).toThrowError(RoomExpiredError);

    // Cleanup honors retention gate & is idempotent (with votes cascading safely once EXPIRED)
    const cleanup1 = await worker.cleanupExpiredRooms(repo);
    expect(cleanup1.purgedRoomIds.sort()).toEqual(
      [custom.room.id, active.room.id, matched.room.id, exhausted.room.id].sort()
    );
    expect((await worker.runLifecycleSweep(repo)).cleanup.purgedCount).toBe(0);

    db.close();
  });

  it("verifies PostgresRoomRepository SQL queries for grace sweep, retry, presence, ROUND_CANCELLED, and FOR UPDATE SKIP LOCKED purge", async () => {
    const baseIso = "2026-11-18T12:00:00.000Z";
    const graceExpiredIso = "2026-11-18T12:01:31.000Z";
    const clock = new MutableClock(graceExpiredIso);
    const roomId: string = crypto.randomUUID();
    const hostId: string = crypto.randomUUID();
    const guestId: string = crypto.randomUUID();
    const roundId: string = crypto.randomUUID();
    const queries: Array<{ text: string; params: unknown[] | undefined }> = [];

    let roomRow = {
      id: roomId,
      code: "PGC020",
      status: "ACTIVE",
      host_participant_id: hostId,
      state_version: 4,
      participant_count: 2,
      matched_movie_id: null as number | null,
      current_round_id: roundId as string | null,
      deck_filter: null,
      inactivity_ttl_seconds: 86400,
      last_activity_at: baseIso,
      expires_at: "2026-11-19T12:00:00.000Z",
      created_at: baseIso,
      updated_at: baseIso,
    };
    let hostRow = {
      room_id: roomId,
      participant_id: hostId,
      display_name: "PG Host",
      role: "HOST",
      is_connected: false,
      joined_at: baseIso,
      last_seen_at: baseIso,
    };
    let guestRow = {
      room_id: roomId,
      participant_id: guestId,
      display_name: "PG Guest",
      role: "MEMBER",
      is_connected: true,
      joined_at: "2026-11-18T12:00:01.000Z",
      last_seen_at: "2026-11-18T12:01:25.000Z",
    };

    const client = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        queries.push({ text, params });
        if (text.includes("information_schema.columns")) {
          return { rows: [{ table_name: "guest_capability_sessions" }, { table_name: "round_participants" }] };
        }
        if (text.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
          return { rows: [{ ...roomRow }] };
        }
        if (text.includes("SELECT * FROM room_participants WHERE room_id = $1 ORDER BY")) {
          return { rows: [{ ...hostRow }, { ...guestRow }] };
        }
        if (text.includes("SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2")) {
          const pid = String(params?.[1] ?? "");
          if (pid === hostId) return { rows: [{ ...hostRow }] };
          if (pid === guestId) return { rows: [{ ...guestRow }] };
          return { rows: [] };
        }
        if (text.includes("FROM round_participants")) {
          return {
            rows: [
              { participant_id: hostId },
              { participant_id: guestId },
            ],
          };
        }
        if (text.includes("UPDATE room_participants SET role = 'MEMBER'")) {
          hostRow = { ...hostRow, role: "MEMBER" };
          return { rows: [] };
        }
        if (text.includes("UPDATE room_participants SET role = 'HOST'")) {
          guestRow = { ...guestRow, role: "HOST" };
          return { rows: [] };
        }
        if (text.includes("UPDATE room_participants SET is_connected =")) {
          const connected = Boolean(params?.[0]);
          const pid = String(params?.[3] ?? "");
          if (pid === guestId) guestRow = { ...guestRow, is_connected: connected };
          return { rows: [] };
        }
        if (text.includes("UPDATE rooms") && text.includes("SET status = $1, host_participant_id = $2")) {
          roomRow = {
            ...roomRow,
            status: String(params?.[0]),
            host_participant_id: String(params?.[1]),
            current_round_id: (params?.[2] as string | null) ?? null,
            state_version: Number(params?.[3]),
          };
          return { rows: [] };
        }
        if (text.includes("UPDATE rooms") && text.includes("SET status = 'LOBBY'")) {
          roomRow = { ...roomRow, status: "LOBBY", current_round_id: null, state_version: Number(params?.[0]) };
          return { rows: [] };
        }
        if (text.includes("SELECT * FROM rooms WHERE id = $1;")) {
          return { rows: [{ ...roomRow }] };
        }
        if (text.includes("SELECT status FROM rounds WHERE id = $1 AND room_id = $2")) {
          return { rows: [{ status: "CANCELLED" }] };
        }
        if (text.includes("FROM room_events") && text.includes("ROUND_RETRY_LOBBY")) {
          return { rows: [] };
        }
        if (text.includes("DELETE FROM rooms") && text.includes("FOR UPDATE SKIP LOCKED")) {
          return { rows: [{ id: "room-purged-1" }] };
        }
        return { rows: [] };
      }),
    };
    const pgRepo = new PostgresRoomRepository(client as never, {
      enforceMigrationAuthority: true,
      clock,
    });

    // 1. Grace sweep: locks room FOR UPDATE, demotes timed-out host, promotes guest, cancels ACTIVE round -> LOBBY
    const sweep = await pgRepo.sweepRoomGraceTimeouts(roomId);
    expect(sweep).toMatchObject({
      roomId,
      changed: true,
      hostTransferred: true,
      roundCancelled: true,
      nextHostParticipantId: guestId,
    });
    expect(queries.some((q) => q.text.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE"))).toBe(true);
    expect(queries.some((q) => q.text.includes("UPDATE rounds SET status = 'CANCELLED'"))).toBe(true);
    expect(
      queries.some(
        (q) =>
          q.text.includes("INSERT INTO room_events") &&
          String(q.params?.[2] ?? q.text).includes("HOST_TRANSFERRED")
      )
    ).toBe(true);
    expect(
      queries.some(
        (q) =>
          q.text.includes("INSERT INTO room_events") &&
          String(q.params?.[2] ?? q.text).includes("ROUND_CANCELLED")
      )
    ).toBe(true);

    // 2. Late vote referencing cancelled round throws ROUND_CANCELLED
    await expect(
      pgRepo.recordVote(roomId, roundId, guestId, crypto.randomUUID(), 9001, "LIKE")
    ).rejects.toMatchObject({ code: "ROUND_CANCELLED" });

    // 3. Explicit presence disconnect emits PARTICIPANT_DISCONNECTED
    const pres = await pgRepo.updateParticipantPresence(roomId, guestId, false);
    expect(pres.changed).toBe(true);
    expect(pres.participant.is_connected).toBe(false);
    expect(
      queries.some(
        (q) =>
          q.text.includes("INSERT INTO room_events") &&
          (q.text.includes("PARTICIPANT_DISCONNECTED") ||
            String(q.params?.[2] ?? "").includes("PARTICIPANT_DISCONNECTED"))
      )
    ).toBe(true);

    // 4. Retry EXHAUSTED -> LOBBY executes transactional UPDATE and ROUND_RETRY_LOBBY event
    roomRow = { ...roomRow, status: "EXHAUSTED", current_round_id: roundId, state_version: 8 };
    const retried = await pgRepo.retryExhaustedRound(roomId, guestId, {
      startRound: false,
      operationId: "pg-retry-lobby-op",
    });
    expect(retried.room.status).toBe("LOBBY");
    expect(
      queries.some(
        (q) =>
          q.text.includes("INSERT INTO room_events") &&
          q.text.includes("ROUND_RETRY_LOBBY")
      )
    ).toBe(true);

    // 5. Purge expired rooms executes FOR UPDATE SKIP LOCKED + CURRENT_TIMESTAMP
    const purged = await pgRepo.purgeExpiredRooms(graceExpiredIso);
    expect(purged).toEqual(["room-purged-1"]);
    const deleteQuery = queries.find((q) => q.text.includes("DELETE FROM rooms"));
    expect(deleteQuery?.text).toContain("FOR UPDATE SKIP LOCKED");
    expect(deleteQuery?.text).toContain("CURRENT_TIMESTAMP");
  });

  it("verifies client actions retryRound/reportPresence and startRoomRealtime 410 permanent stop", async () => {
    const snapshotsAccepted: number[] = [];
    let resyncCalls = 0;
    const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];

    const actions = createRoomActions({
      roomId: "room-client-1",
      maxAttempts: 2,
      retryBaseMs: 1,
      sleep: async () => undefined,
      accept: (snap) => {
        snapshotsAccepted.push(snap.room.stateVersion);
        return true;
      },
      resync: async () => {
        resyncCalls += 1;
      },
      fetcher: (async (url: string, init?: RequestInit) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        requests.push({
          url: String(url),
          method: init?.method ?? "GET",
          headers,
          body: String(init?.body ?? ""),
        });
        if (String(url).endsWith("/retry")) {
          if (requests.length === 1) {
            return new Response(JSON.stringify({ error: "ROOM_NOT_EXHAUSTED", message: "wait" }), { status: 409 });
          }
          return new Response(
            JSON.stringify({
              idempotentReplay: true,
              room: { stateVersion: 14, status: "ACTIVE" },
              viewer: { role: "HOST" },
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            updated: true,
            changed: true,
            room: { stateVersion: 15, status: "ACTIVE" },
            viewer: { role: "HOST" },
          }),
          { status: 200 }
        );
      }) as typeof fetch,
    });

    // 409 ROOM_NOT_EXHAUSTED is classified as stale and triggers authoritative resync
    const failRetry = await actions.retryRound({ startRound: true, roundId: "r-1" });
    expect(failRetry.ok).toBe(false);
    if (!failRetry.ok) {
      expect(failRetry.stale).toBe(true);
      expect(failRetry.code).toBe("ROOM_NOT_EXHAUSTED");
    }
    expect(resyncCalls).toBe(1);

    // Retry success carries stable operationId and accepts snapshot
    const okRetry = await actions.retryRound({
      startRound: true,
      roundId: "r-1",
      deckFilter: { sort_by: "vote_average.desc" },
    });
    expect(okRetry.ok).toBe(true);
    if (okRetry.ok) {
      expect(okRetry.replayed).toBe(true);
    }
    expect(snapshotsAccepted).toContain(14);
    expect(requests[1].headers["idempotency-key"]).toBe(retryOperationId("r-1"));

    // reportPresence calls POST /presence and accepts snapshot
    const pres = await actions.reportPresence(false);
    expect(pres.ok).toBe(true);
    expect(snapshotsAccepted).toContain(15);

    // startRoomRealtime stops permanently on HTTP 410 ROOM_EXPIRED and supports opt-in presence beacon on shutdown
    const rtStatuses: string[] = [];
    let snapshot410Count = 0;
    const rtCalls: string[] = [];
    const env: RealtimeEnvironment = {
      now: () => 1000,
      setTimeout: () => 1,
      clearTimeout: () => undefined,
      random: () => 0.5,
      onWake: () => () => undefined,
    };

    const mockFetch410 = (async (url: string) => {
      rtCalls.push(String(url));
      if (String(url).endsWith("/realtime-token")) {
        return new Response(JSON.stringify({ error: "ROOM_EXPIRED" }), { status: 410 });
      }
      if (String(url).endsWith("/presence")) {
        return new Response(JSON.stringify({ updated: true, changed: false }), { status: 200 });
      }
      snapshot410Count += 1;
      return new Response(JSON.stringify({ error: "ROOM_EXPIRED" }), { status: 410 });
    }) as typeof fetch;

    await expect(
      startRoomRealtime({
        roomId: "room-exp-1",
        supabaseUrl: "http://127.0.0.1:54321",
        publishableKey: "anon-key",
        fetcher: mockFetch410,
        environment: env,
        sendPresenceOnDisconnect: true,
        onSnapshot: () => undefined,
        onStatus: (s) => rtStatuses.push(s),
      })
    ).rejects.toThrow();

    expect(snapshot410Count).toBe(0);
    expect(rtStatuses).toContain("closed");
    expect(rtCalls.some((u) => u.endsWith("/presence"))).toBe(true);
  });
});
