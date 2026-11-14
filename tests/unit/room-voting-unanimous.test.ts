import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Candidate, RoomEvent, Vote, VoteType } from "@/db/schema";
import { PostgresRoomRepository } from "@/lib/server/room/postgresRoomRepository";
import {
  RoomCapacityError,
  SqliteRoomRepository,
} from "@/lib/server/room/roomRepository";
import { buildSafeRoomSnapshot } from "@/lib/server/room/roomSnapshot";
import { applySqliteMigrations } from "@/lib/server/room/roomStore";
import {
  CandidateOutOfOrderError,
  evaluateCandidateConsensus,
  evaluateDeckProgression,
  extractOperationIdFromHeaders,
  FrozenRosterMissingError,
  ImmutableVoteError,
  MissingMigrationSchemaError,
  OperationConflictError,
  parseVoteSubmissionPayload,
  VotePayloadError,
  VoterNotEligibleError,
} from "@/lib/server/room/votingEngine";

function createSeededPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeCandidates(roomId: string, roundId: string, count: number): Candidate[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
    room_id: roomId,
    round_id: roundId,
    movie_id: 70000 + idx,
    position: idx,
    title: `Candidate Movie ${idx + 1}`,
    poster_path: idx % 2 === 0 ? `/p_${idx}.jpg` : null,
    overview: `Overview ${idx + 1}`,
    release_date: "2024-01-01",
    vote_average: 7.5,
  }));
}

function createMigratedSqliteDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applySqliteMigrations(db);
  return db;
}

describe("CINE-017 Pure Unanimous Matching Engine", () => {
  it("verifies exhaustive 2^N truth tables across 2, 3, 4, and 5 frozen voters (strict unanimity, no majority rule)", () => {
    for (const n of [2, 3, 4, 5]) {
      const voterIds = Array.from({ length: n }, (_, idx) => `voter-${idx + 1}`);
      const roster = new Set(voterIds);
      const totalStates = 1 << n;
      let matchedStates = 0;
      let resolvedWithoutMatchStates = 0;

      for (let mask = 0; mask < totalStates; mask += 1) {
        const votes: Array<Pick<Vote, "participant_id" | "vote">> = voterIds.map(
          (participant_id, idx) => ({
            participant_id,
            vote: (mask & (1 << idx)) !== 0 ? "LIKE" : "SKIP",
          })
        );

        const res = evaluateCandidateConsensus("cand-1", votes, roster);
        const allLike = mask === totalStates - 1;
        expect(res.eligibleVoterCount).toBe(n);
        expect(res.votesCastCount).toBe(n);
        expect(res.isPending).toBe(false);
        expect(res.isMatched).toBe(allLike);
        expect(res.isResolvedWithoutMatch).toBe(!allLike);

        if (res.isMatched) matchedStates += 1;
        if (res.isResolvedWithoutMatch) resolvedWithoutMatchStates += 1;
      }

      // Strictly 1 unanimous all-LIKE row; all other 2^N - 1 rows must NEVER match
      expect(matchedStates).toBe(1);
      expect(resolvedWithoutMatchStates).toBe(totalStates - 1);
    }
  });

  it("verifies exhaustive 3^N partial/complete vote states (NONE, LIKE, SKIP) across 2..5 voters", () => {
    for (const n of [2, 3, 4, 5]) {
      const voterIds = Array.from({ length: n }, (_, idx) => `voter-${idx + 1}`);
      const roster = new Set(voterIds);
      const totalStates = 3 ** n;

      let matchedCount = 0;
      let nonUnanimousCompleteCount = 0;
      let pendingCount = 0;

      for (let code = 0; code < totalStates; code += 1) {
        let cursor = code;
        const votes: Array<Pick<Vote, "participant_id" | "vote">> = [];
        let likes = 0;
        let skips = 0;

        for (let idx = 0; idx < n; idx += 1) {
          const trit = cursor % 3;
          cursor = Math.floor(cursor / 3);
          if (trit === 1) {
            votes.push({ participant_id: voterIds[idx]!, vote: "LIKE" });
            likes += 1;
          } else if (trit === 2) {
            votes.push({ participant_id: voterIds[idx]!, vote: "SKIP" });
            skips += 1;
          }
        }

        const res = evaluateCandidateConsensus("cand-partial", votes, roster);
        const complete = likes + skips === n;
        expect(res.isMatched).toBe(complete && likes === n && skips === 0);
        expect(res.isResolvedWithoutMatch).toBe(complete && skips > 0);
        expect(res.isPending).toBe(!complete);

        if (res.isMatched) matchedCount += 1;
        else if (res.isResolvedWithoutMatch) nonUnanimousCompleteCount += 1;
        else pendingCount += 1;
      }

      expect(matchedCount).toBe(1);
      expect(nonUnanimousCompleteCount).toBe(2 ** n - 1);
      expect(pendingCount).toBe(totalStates - 2 ** n);
    }
  });

  it("converges identically across 240 randomized permutations of arrival order and deck sizes (1..20)", () => {
    const rng = createSeededPrng(20261114);
    const roomId = "00000000-0000-4000-8000-0000000000aa";
    const roundId = "00000000-0000-4000-8000-0000000000bb";
    const deckSizes = [1, 2, 5, 10, 19, 20];

    for (let trial = 0; trial < 240; trial += 1) {
      const voterCount = 2 + (trial % 4); // 2..5
      const deckSize = deckSizes[trial % deckSizes.length]!;
      const candidates = makeCandidates(roomId, roundId, deckSize);
      const voterIds = Array.from({ length: voterCount }, (_, i) => `voter-${i + 1}`);
      const roster = new Set(voterIds);

      // Pick either an all-non-unanimous exhausted pattern or a matched card pattern
      const forceExhausted = trial % 3 === 0;
      const targetMatchIdx = forceExhausted ? -1 : Math.floor(rng() * deckSize);

      const plannedVotes: Array<{ candidate_id: string; participant_id: string; vote: VoteType }> = [];
      for (let cIdx = 0; cIdx < deckSize; cIdx += 1) {
        const candidateId = candidates[cIdx]!.id;
        if (cIdx === targetMatchIdx) {
          for (const pid of voterIds) {
            plannedVotes.push({ candidate_id: candidateId, participant_id: pid, vote: "LIKE" });
          }
        } else {
          // Ensure at least one SKIP (even if remaining voters choose LIKE, including last voter)
          const skipVoterIdx = Math.floor(rng() * voterCount);
          for (let vIdx = 0; vIdx < voterCount; vIdx += 1) {
            const vote: VoteType =
              vIdx === skipVoterIdx ? "SKIP" : rng() > 0.35 ? "LIKE" : "SKIP";
            plannedVotes.push({
              candidate_id: candidateId,
              participant_id: voterIds[vIdx]!,
              vote,
            });
          }
        }
      }

      // Shuffle vote arrival order with Fisher-Yates
      const shuffled = [...plannedVotes];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = tmp;
      }

      // Mid-stream check before the final vote: must NEVER declare EXHAUSTED prematurely
      const partial = evaluateDeckProgression(candidates, shuffled.slice(0, -1), roster);
      if (forceExhausted) {
        expect(partial.nextStatus).toBe("ACTIVE");
      }

      const full = evaluateDeckProgression(candidates, shuffled, roster);
      if (forceExhausted) {
        expect(full.nextStatus).toBe("EXHAUSTED");
        expect(full.matchedCandidate).toBeNull();
        expect(full.allResolvedWithoutMatch).toBe(true);
      } else {
        expect(full.nextStatus).toBe("MATCHED");
        expect(full.matchedCandidate?.id).toBe(candidates[targetMatchIdx]!.id);
        expect(full.matchedMovieId).toBe(candidates[targetMatchIdx]!.movie_id);
      }
    }
  });

  it("validates vote submission payloads and operationId headers strictly", () => {
    const validUuid = "11111111-1111-4111-8111-111111111111";
    const roundUuid = "22222222-2222-4222-8222-222222222222";

    const headers = new Headers({ "Idempotency-Key": "op-abc-123" });
    const headerOp = extractOperationIdFromHeaders(headers);
    expect(headerOp).toBe("op-abc-123");

    const parsed = parseVoteSubmissionPayload(
      { candidateId: validUuid, movieId: 550, vote: "LIKE", roundId: roundUuid },
      headerOp
    );
    expect(parsed).toEqual({
      candidateId: validUuid,
      movieId: 550,
      vote: "LIKE",
      roundId: roundUuid,
      operationId: "op-abc-123",
    });

    expect(() =>
      extractOperationIdFromHeaders(
        new Headers({ "Idempotency-Key": "op-1", "x-operation-id": "op-2" })
      )
    ).toThrow(VotePayloadError);

    expect(() =>
      parseVoteSubmissionPayload(
        { candidateId: validUuid, movieId: 550, vote: "SKIP", operationId: "op-body" },
        "op-header"
      )
    ).toThrow(VotePayloadError);

    expect(() =>
      parseVoteSubmissionPayload({ candidateId: "not-a-uuid", movieId: 550, vote: "LIKE" })
    ).toThrow(VotePayloadError);
    expect(() =>
      parseVoteSubmissionPayload({ candidateId: validUuid, movieId: -5, vote: "LIKE" })
    ).toThrow(VotePayloadError);
    expect(() =>
      parseVoteSubmissionPayload({ candidateId: validUuid, movieId: 550, vote: "MAYBE" })
    ).toThrow(VotePayloadError);
    expect(() =>
      parseVoteSubmissionPayload({
        candidateId: validUuid,
        movieId: 550,
        vote: "LIKE",
        operationId: "bad\nop",
      })
    ).toThrow(VotePayloadError);
  });

  it("refuses to match a later candidate while an earlier candidate in the deck is still pending consensus", () => {
    const roomId = "00000000-0000-4000-8000-0000000000c1";
    const roundId = "00000000-0000-4000-8000-0000000000c2";
    const candidates = makeCandidates(roomId, roundId, 3);
    const roster = new Set(["voter-1", "voter-2"]);

    // candidate[0] has only 1 of 2 votes (pending); candidate[1] has 2/2 LIKE (out-of-order)
    const progression = evaluateDeckProgression(
      candidates,
      [
        { candidate_id: candidates[0]!.id, participant_id: "voter-1", vote: "LIKE" },
        { candidate_id: candidates[1]!.id, participant_id: "voter-1", vote: "LIKE" },
        { candidate_id: candidates[1]!.id, participant_id: "voter-2", vote: "LIKE" },
      ],
      roster
    );

    expect(progression.nextStatus).toBe("ACTIVE");
    expect(progression.matchedCandidate).toBeNull();
    expect(progression.matchedMovieId).toBeNull();
    expect(progression.currentCandidateIndex).toBe(0);
    expect(progression.currentCandidate?.id).toBe(candidates[0]!.id);
  });
});

describe("CINE-017 SQLite Repository Immutability, Frozen Roster, Idempotency & Exhaustion", () => {
  it("uses frozen round_participants quorum even if room.participant_count mutates or late member row exists", () => {
    const db = createMigratedSqliteDb();
    try {
      const repo = new SqliteRoomRepository(db);
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      const guest1Id = crypto.randomUUID();
      const guest2Id = crypto.randomUUID();
      repo.joinRoom(room.id, guest1Id, "Guest 1");
      repo.joinRoom(room.id, guest2Id, "Guest 2");

      const candidatesInput = Array.from({ length: 5 }, (_, idx) => ({
        movieId: 5000 + idx,
        title: `Shortage Title ${idx + 1}`,
      }));

      const started = repo.startLobbyRound(room.id, host.participant_id, {
        candidates: candidatesInput,
      });
      expect(started.frozenParticipants.length).toBe(3);

      // Corrupt mutable room.participant_count to 2 and sneak an unfrozen member row in DB
      const outsiderInRoomId = crypto.randomUUID();
      db.prepare("UPDATE rooms SET participant_count = 2 WHERE id = ?;").run(room.id);
      db.prepare(
        `INSERT INTO room_participants (room_id, participant_id, display_name, role)
         VALUES (?, ?, 'Late Intruder', 'MEMBER');`
      ).run(room.id, outsiderInRoomId);

      const cand0 = started.candidates[0]!;

      // Non-frozen intruder MUST be rejected with VoterNotEligibleError
      expect(() =>
        repo.recordVote(room.id, started.round.id, outsiderInRoomId, cand0.id, cand0.movie_id, "LIKE")
      ).toThrow(VoterNotEligibleError);

      // 2 of 3 LIKEs must NOT trigger match even though mutable room.participant_count was lowered to 2!
      const v1 = repo.recordVote(
        room.id,
        started.round.id,
        host.participant_id,
        cand0.id,
        cand0.movie_id,
        "LIKE",
        { operationId: "op-h-1" }
      );
      expect(v1.isMatched).toBe(false);
      expect(v1.room.status).toBe("ACTIVE");

      const v2 = repo.recordVote(
        room.id,
        started.round.id,
        guest1Id,
        cand0.id,
        cand0.movie_id,
        "LIKE",
        { operationId: "op-g1-1" }
      );
      expect(v2.isMatched).toBe(false);
      expect(v2.room.status).toBe("ACTIVE");

      // 3rd frozen voter completes strict unanimity -> MATCHED!
      const v3 = repo.recordVote(
        room.id,
        started.round.id,
        guest2Id,
        cand0.id,
        cand0.movie_id,
        "LIKE",
        { operationId: "op-g2-1" }
      );
      expect(v3.isMatched).toBe(true);
      expect(v3.room.status).toBe("MATCHED");
      expect(v3.room.matched_movie_id).toBe(cand0.movie_id);

      const roundRow = repo.getRoundById(started.round.id)!;
      expect(roundRow.status).toBe("COMPLETED");
      expect(roundRow.completed_at).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it("enforces immutable votes (409 VOTE_IMMUTABLE + DB BEFORE UPDATE trigger) and operationId idempotency/conflict", () => {
    const db = createMigratedSqliteDb();
    try {
      // Calling applySqliteMigrations a second time must remain idempotent
      applySqliteMigrations(db);

      const repo = new SqliteRoomRepository(db);
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      const guestId = crypto.randomUUID();
      repo.joinRoom(room.id, guestId, "Guest");

      const { round, candidates } = repo.startRound(
        room.id,
        Array.from({ length: 20 }, (_, idx) => ({
          movieId: 81000 + idx,
          title: `Movie ${idx + 1}`,
        }))
      );

      const c0 = candidates[0]!;
      const c1 = candidates[1]!;

      // Record initial vote with operationId
      const first = repo.recordVote(
        room.id,
        round.id,
        host.participant_id,
        c0.id,
        c0.movie_id,
        "LIKE",
        { operationId: "op-host-c0" }
      );
      expect(first.idempotentReplay).toBe(false);
      expect(first.isMatched).toBe(false);
      const eventsAfterFirst: RoomEvent[] = repo.getEventsByRoom(room.id);
      const voteRecorded = eventsAfterFirst.find((e) => e.event_type === "VOTE_RECORDED")!;
      // Strict vote confidentiality: outbox payload only exposes participantId
      expect(JSON.parse(String(voteRecorded.payload))).toEqual({
        participantId: host.participant_id,
      });

      // Exact retry with same operationId -> idempotent replay, version & event count unchanged
      const retry = repo.recordVote(
        room.id,
        round.id,
        host.participant_id,
        c0.id,
        c0.movie_id,
        "LIKE",
        { operationId: "op-host-c0" }
      );
      expect(retry.idempotentReplay).toBe(true);
      expect(retry.vote.id).toBe(first.vote.id);
      expect(retry.room.state_version).toBe(first.room.state_version);
      expect(repo.getEventsByRoom(room.id).length).toBe(eventsAfterFirst.length);

      // Reusing same operationId with different vote or candidate -> OPERATION_ID_CONFLICT
      expect(() =>
        repo.recordVote(room.id, round.id, host.participant_id, c0.id, c0.movie_id, "SKIP", {
          operationId: "op-host-c0",
        })
      ).toThrow(OperationConflictError);
      expect(() =>
        repo.recordVote(room.id, round.id, host.participant_id, c1.id, c1.movie_id, "LIKE", {
          operationId: "op-host-c0",
        })
      ).toThrow(OperationConflictError);

      // Flipping vote on same candidate with new operationId -> ImmutableVoteError
      expect(() =>
        repo.recordVote(room.id, round.id, host.participant_id, c0.id, c0.movie_id, "SKIP", {
          operationId: "op-host-c0-flip",
        })
      ).toThrow(ImmutableVoteError);

      // Raw SQL UPDATE & DELETE on votes table MUST be aborted by DB immutability triggers
      expect(() => {
        db.prepare("UPDATE votes SET vote = 'SKIP' WHERE id = ?;").run(first.vote.id);
      }).toThrow(/VOTE_IMMUTABLE/);
      expect(() => {
        db.prepare("DELETE FROM votes WHERE id = ?;").run(first.vote.id);
      }).toThrow(/VOTE_IMMUTABLE/);

      // Blank operation_id MUST be aborted on insert by trg_votes_operation_id_nonempty
      expect(() => {
        db.prepare(
          `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, operation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'LIKE', '   ', ?);`
        ).run(
          crypto.randomUUID(),
          room.id,
          round.id,
          guestId,
          c1.id,
          c1.movie_id,
          new Date().toISOString()
        );
      }).toThrow(/INVALID_VOTE_PAYLOAD/);

      // Guest completes unanimous LIKE -> MATCHED; retry-after-timeout on MATCHED stays idempotent
      const matchRes = repo.recordVote(
        room.id,
        round.id,
        guestId,
        c0.id,
        c0.movie_id,
        "LIKE",
        { operationId: "op-guest-match" }
      );
      expect(matchRes.isMatched).toBe(true);
      expect(matchRes.room.status).toBe("MATCHED");

      const retryAfterMatch = repo.recordVote(
        room.id,
        round.id,
        guestId,
        c0.id,
        c0.movie_id,
        "LIKE",
        { operationId: "op-guest-match" }
      );
      expect(retryAfterMatch.idempotentReplay).toBe(true);
      expect(retryAfterMatch.isMatched).toBe(true);
      expect(retryAfterMatch.room.state_version).toBe(matchRes.room.state_version);

      // Flip on MATCHED still throws ImmutableVoteError; unvoted card on MATCHED throws ROOM_ALREADY_MATCHED
      expect(() =>
        repo.recordVote(room.id, round.id, guestId, c0.id, c0.movie_id, "SKIP", {
          operationId: "op-guest-flip-after-match",
        })
      ).toThrow(ImmutableVoteError);

      try {
        repo.recordVote(room.id, round.id, host.participant_id, c1.id, c1.movie_id, "LIKE", {
          operationId: "op-host-late-c1",
        });
        expect.unreachable("Expected ROOM_ALREADY_MATCHED error");
      } catch (err) {
        expect(err).toBeInstanceOf(RoomCapacityError);
        expect((err as RoomCapacityError).code).toBe("ROOM_ALREADY_MATCHED");
      }
    } finally {
      db.close();
    }
  });

  it("transitions to EXHAUSTED on 1-card and 20-card decks even when the final vote cast is LIKE after prior SKIP", () => {
    const db = createMigratedSqliteDb();
    try {
      const repo = new SqliteRoomRepository(db);
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      const guestId = crypto.randomUUID();
      repo.joinRoom(room.id, guestId, "Guest");

      const started = repo.startLobbyRound(room.id, host.participant_id, {
        candidates: [{ movieId: 999901, title: "Shortage Single" }],
      });
      const cand = started.candidates[0]!;

      // Host votes SKIP first
      const first = repo.recordVote(
        room.id,
        started.round.id,
        host.participant_id,
        cand.id,
        cand.movie_id,
        "SKIP",
        { operationId: "op-shortage-skip" }
      );
      expect(first.room.status).toBe("ACTIVE");
      expect(first.isExhausted).toBe(false);

      // Guest votes LIKE second (final vote is LIKE!) -> MUST still transition to EXHAUSTED!
      const second = repo.recordVote(
        room.id,
        started.round.id,
        guestId,
        cand.id,
        cand.movie_id,
        "LIKE",
        { operationId: "op-shortage-like" }
      );
      expect(second.isMatched).toBe(false);
      expect(second.isExhausted).toBe(true);
      expect(second.room.status).toBe("EXHAUSTED");

      // Idempotent retry-after-timeout on EXHAUSTED succeeds without changing state_version
      const retryExhausted = repo.recordVote(
        room.id,
        started.round.id,
        guestId,
        cand.id,
        cand.movie_id,
        "LIKE",
        { operationId: "op-shortage-like" }
      );
      expect(retryExhausted.idempotentReplay).toBe(true);
      expect(retryExhausted.isExhausted).toBe(true);
      expect(retryExhausted.room.state_version).toBe(second.room.state_version);
    } finally {
      db.close();
    }
  });

  it("supports clean SQLite 004_down rollback (including DROP COLUMN operation_id) and 004 forward re-application", () => {
    const db = createMigratedSqliteDb();
    try {
      const repo = new SqliteRoomRepository(db, { enforceMigrationAuthority: true });
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      const guestId = crypto.randomUUID();
      repo.joinRoom(room.id, guestId, "Guest");
      const started = repo.startLobbyRound(room.id, host.participant_id, {
        candidates: [
          { movieId: 501, title: "Rollback Movie 1" },
          { movieId: 502, title: "Rollback Movie 2" },
        ],
      });
      repo.recordVote(
        room.id,
        started.round.id,
        host.participant_id,
        started.candidates[0]!.id,
        started.candidates[0]!.movie_id,
        "SKIP",
        { operationId: "op-rollback-seed" }
      );

      const downSql = fs.readFileSync(
        path.join(process.cwd(), "src", "db", "migrations", "sqlite", "004_down_vote_operation_idempotency.sql"),
        "utf8"
      );
      const upSql = fs.readFileSync(
        path.join(process.cwd(), "src", "db", "migrations", "sqlite", "004_vote_operation_idempotency.sql"),
        "utf8"
      );

      db.exec(downSql);

      const colsAfterDown = db
        .prepare("PRAGMA table_info(votes);")
        .all() as Array<{ name: string }>;
      expect(colsAfterDown.some((c) => c.name === "operation_id")).toBe(false);

      const triggersAfterDown = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger'
             AND name IN ('trg_votes_immutable_update', 'trg_votes_immutable_delete', 'trg_votes_operation_id_nonempty');`
        )
        .all();
      expect(triggersAfterDown.length).toBe(0);

      const idxAfterDown = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_votes_round_participant_operation';"
        )
        .all();
      expect(idxAfterDown.length).toBe(0);

      // Re-apply forward 004 migration cleanly from SQL file alone
      db.exec(upSql);

      const colsAfterUp = db
        .prepare("PRAGMA table_info(votes);")
        .all() as Array<{ name: string }>;
      expect(colsAfterUp.some((c) => c.name === "operation_id")).toBe(true);

      const triggersAfterUp = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger'
             AND name IN ('trg_votes_immutable_update', 'trg_votes_immutable_delete', 'trg_votes_operation_id_nonempty');`
        )
        .all();
      expect(triggersAfterUp.length).toBe(3);

      const idxAfterUp = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_votes_round_participant_operation';"
        )
        .all();
      expect(idxAfterUp.length).toBe(1);
    } finally {
      db.close();
    }
  });

  it("blocks out-of-order candidate voting and fails closed when frozen roster or migration authority is missing in SQLite & PostgreSQL", async () => {
    // 1. SQLite out-of-order candidate voting & fail-closed empty round_participants
    const db = createMigratedSqliteDb();
    try {
      const repo = new SqliteRoomRepository(db, { enforceMigrationAuthority: true });
      const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
      const guestId = crypto.randomUUID();
      repo.joinRoom(room.id, guestId, "Guest");
      const started = repo.startLobbyRound(room.id, host.participant_id, {
        candidates: [
          { movieId: 601, title: "Seq 1" },
          { movieId: 602, title: "Seq 2" },
        ],
      });

      const c0 = started.candidates[0]!;
      const c1 = started.candidates[1]!;

      // Jumping to c1 before c0 has any votes -> CandidateOutOfOrderError
      expect(() =>
        repo.recordVote(room.id, started.round.id, host.participant_id, c1.id, c1.movie_id, "LIKE")
      ).toThrow(CandidateOutOfOrderError);

      // Host skips c0 -> still 1/2 pending on c0 -> c1 STILL rejected
      repo.recordVote(room.id, started.round.id, host.participant_id, c0.id, c0.movie_id, "SKIP");
      expect(() =>
        repo.recordVote(room.id, started.round.id, guestId, c1.id, c1.movie_id, "LIKE")
      ).toThrow(CandidateOutOfOrderError);

      // Guest completes c0 with LIKE -> c0 resolves without unanimity -> c1 becomes active & succeeds
      const c0Done = repo.recordVote(room.id, started.round.id, guestId, c0.id, c0.movie_id, "LIKE");
      expect(c0Done.room.status).toBe("ACTIVE");
      expect(c0Done.progression.currentCandidateIndex).toBe(1);

      const c1Vote = repo.recordVote(room.id, started.round.id, host.participant_id, c1.id, c1.movie_id, "LIKE");
      expect(c1Vote.room.status).toBe("ACTIVE");

      // buildSafeRoomSnapshot must NEVER fall back to mutable participants when roundParticipants is missing
      const participants = repo.getParticipantsByRoom(room.id);
      const activeRoom = repo.getRoomById(room.id)!;
      expect(() =>
        buildSafeRoomSnapshot(activeRoom, participants, host.participant_id, new Date(), [], started.candidates, [])
      ).toThrow(FrozenRosterMissingError);

      // Corrupting round_participants to empty MUST fail closed with FrozenRosterMissingError (never fallback to room_participants)
      db.prepare("DELETE FROM round_participants WHERE round_id = ?;").run(started.round.id);
      expect(() =>
        repo.recordVote(room.id, started.round.id, guestId, c1.id, c1.movie_id, "LIKE")
      ).toThrow(FrozenRosterMissingError);
    } finally {
      db.close();
    }

    // 2. Partial migration / missing migration authority must fail closed
    const partialDb = new DatabaseSync(":memory:");
    try {
      const baseDir = path.join(process.cwd(), "src", "db", "migrations", "sqlite");
      partialDb.exec("PRAGMA foreign_keys = ON;");
      partialDb.exec(fs.readFileSync(path.join(baseDir, "001_create_room_schema.sql"), "utf8"));
      partialDb.exec(fs.readFileSync(path.join(baseDir, "002_guest_capability_sessions.sql"), "utf8"));
      partialDb.exec(fs.readFileSync(path.join(baseDir, "003_round_roster_freeze.sql"), "utf8"));

      const partialRepo = new SqliteRoomRepository(partialDb);
      const { room, host } = partialRepo.createRoom({ hostDisplayName: "Partial Host" });
      const guestId = crypto.randomUUID();
      partialRepo.joinRoom(room.id, guestId, "Partial Guest");
      const started = partialRepo.startLobbyRound(room.id, host.participant_id, {
        candidates: [{ movieId: 701, title: "Partial Movie" }],
      });

      // Missing 004 (votes.operation_id) when 002+003 exist MUST fail closed
      expect(() =>
        partialRepo.recordVote(
          room.id,
          started.round.id,
          host.participant_id,
          started.candidates[0]!.id,
          started.candidates[0]!.movie_id,
          "LIKE"
        )
      ).toThrow(MissingMigrationSchemaError);
    } finally {
      partialDb.close();
    }

    // 3. 001-only DB with enforceMigrationAuthority OR explicit operationId MUST fail closed
    const legacyDb = new DatabaseSync(":memory:");
    try {
      const m001 = fs.readFileSync(
        path.join(process.cwd(), "src", "db", "migrations", "sqlite", "001_create_room_schema.sql"),
        "utf8"
      );
      legacyDb.exec("PRAGMA foreign_keys = ON;");
      legacyDb.exec(m001);

      const compatRepo = new SqliteRoomRepository(legacyDb);
      const { room, host } = compatRepo.createRoom({ hostDisplayName: "Compat Host" });
      compatRepo.joinRoom(room.id, crypto.randomUUID(), "Compat Guest");
      const { round, candidates } = compatRepo.startRound(
        room.id,
        Array.from({ length: 20 }, (_, idx) => ({
          movieId: 801 + idx,
          title: `Compat Movie ${idx + 1}`,
        }))
      );

      // Passing operationId on 001-only schema MUST NOT silently drop idempotency
      expect(() =>
        compatRepo.recordVote(
          room.id,
          round.id,
          host.participant_id,
          candidates[0]!.id,
          candidates[0]!.movie_id,
          "LIKE",
          { operationId: "must-fail-closed" }
        )
      ).toThrow(MissingMigrationSchemaError);

      // Authority mode on 001-only MUST fail closed even without operationId
      const authorityRepo = new SqliteRoomRepository(legacyDb, { enforceMigrationAuthority: true });
      expect(() =>
        authorityRepo.recordVote(
          room.id,
          round.id,
          host.participant_id,
          candidates[0]!.id,
          candidates[0]!.movie_id,
          "LIKE"
        )
      ).toThrow(MissingMigrationSchemaError);
    } finally {
      legacyDb.close();
    }

    // 4. PostgresRoomRepository regression checks (out-of-order candidate & fail-closed empty frozen roster)
    const pgRoomId = crypto.randomUUID();
    const pgRoundId = crypto.randomUUID();
    const pgHostId = crypto.randomUUID();
    const pgGuestId = crypto.randomUUID();
    const pgCand0Id = crypto.randomUUID();
    const pgCand1Id = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const makePgMockPool = (emptyFrozenRoster: boolean) => ({
      totalCount: 1,
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
            return {
              rows: [
                {
                  id: pgRoomId,
                  code: "PG1234",
                  status: "ACTIVE",
                  host_participant_id: pgHostId,
                  state_version: 3,
                  participant_count: 2,
                  matched_movie_id: null,
                  current_round_id: pgRoundId,
                  deck_filter: null,
                  inactivity_ttl_seconds: 86400,
                  last_activity_at: nowIso,
                  expires_at: new Date(Date.now() + 86400_000).toISOString(),
                  created_at: nowIso,
                  updated_at: nowIso,
                },
              ],
            };
          }
          if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2")) {
            return {
              rows: [
                {
                  room_id: pgRoomId,
                  participant_id: pgHostId,
                  display_name: "PG Host",
                  role: "HOST",
                  is_connected: true,
                  joined_at: nowIso,
                  last_seen_at: nowIso,
                },
              ],
            };
          }
          if (sql.includes("SELECT to_regclass('round_participants')")) {
            return { rows: [{ present: true }] };
          }
          if (sql.includes("information_schema.columns") && sql.includes("operation_id")) {
            return { rows: [{ present: true }] };
          }
          if (sql.includes("SELECT participant_id FROM round_participants")) {
            return {
              rows: emptyFrozenRoster
                ? []
                : [{ participant_id: pgHostId }, { participant_id: pgGuestId }],
            };
          }
          if (sql.includes("SELECT * FROM candidates WHERE id = $1")) {
            return {
              rows: [
                {
                  id: pgCand1Id,
                  room_id: pgRoomId,
                  round_id: pgRoundId,
                  movie_id: 992,
                  position: 1,
                  title: "PG Second Candidate",
                },
              ],
            };
          }
          if (sql.includes("SELECT * FROM candidates WHERE room_id = $1 AND round_id = $2 ORDER BY position ASC")) {
            return {
              rows: [
                {
                  id: pgCand0Id,
                  room_id: pgRoomId,
                  round_id: pgRoundId,
                  movie_id: 991,
                  position: 0,
                  title: "PG First Candidate",
                },
                {
                  id: pgCand1Id,
                  room_id: pgRoomId,
                  round_id: pgRoundId,
                  movie_id: 992,
                  position: 1,
                  title: "PG Second Candidate",
                },
              ],
            };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    });

    const pgOutOfOrderRepo = new PostgresRoomRepository(makePgMockPool(false) as never, {
      schema: "cinematch_unit",
      enforceMigrationAuthority: true,
    });
    await expect(
      pgOutOfOrderRepo.recordVote(pgRoomId, pgRoundId, pgHostId, pgCand1Id, 992, "LIKE")
    ).rejects.toThrow(CandidateOutOfOrderError);

    const pgEmptyRosterRepo = new PostgresRoomRepository(makePgMockPool(true) as never, {
      schema: "cinematch_unit",
      enforceMigrationAuthority: true,
    });
    await expect(
      pgEmptyRosterRepo.recordVote(pgRoomId, pgRoundId, pgHostId, pgCand1Id, 992, "LIKE")
    ).rejects.toThrow(FrozenRosterMissingError);
  });

  it("verifies PostgresRoomRepository executes FOR UPDATE locking, round_participants lookup, and SAVEPOINT vote insertion", async () => {
    const executedSql: string[] = [];
    const roomId = crypto.randomUUID();
    const roundId = crypto.randomUUID();
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const candId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const mockClient = {
      query: async (sql: string) => {
        executedSql.push(sql.replace(/\s+/g, " ").trim());
        if (sql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
          return {
            rows: [
              {
                id: roomId,
                code: "ABCDEF",
                status: "ACTIVE",
                host_participant_id: hostId,
                state_version: 3,
                participant_count: 2,
                matched_movie_id: null,
                current_round_id: roundId,
                deck_filter: null,
                inactivity_ttl_seconds: 86400,
                last_activity_at: nowIso,
                expires_at: new Date(Date.now() + 86400_000).toISOString(),
                created_at: nowIso,
                updated_at: nowIso,
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2")) {
          return {
            rows: [
              {
                room_id: roomId,
                participant_id: hostId,
                display_name: "Host",
                role: "HOST",
                is_connected: true,
                joined_at: nowIso,
                last_seen_at: nowIso,
              },
            ],
          };
        }
        if (sql.includes("SELECT to_regclass('round_participants')")) {
          return { rows: [{ present: true }] };
        }
        if (sql.includes("SELECT participant_id FROM round_participants")) {
          return { rows: [{ participant_id: hostId }, { participant_id: guestId }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("operation_id")) {
          return { rows: [{ present: true }] };
        }
        if (sql.includes("SELECT * FROM votes") && sql.includes("operation_id = $3")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT * FROM candidates WHERE id = $1")) {
          return {
            rows: [
              {
                id: candId,
                room_id: roomId,
                round_id: roundId,
                movie_id: 550,
                position: 0,
                title: "Fight Club",
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM votes") && sql.includes("candidate_id = $3 OR movie_id = $4")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO votes")) {
          return {
            rows: [
              {
                id: crypto.randomUUID(),
                room_id: roomId,
                round_id: roundId,
                participant_id: hostId,
                candidate_id: candId,
                movie_id: 550,
                vote: "LIKE",
                operation_id: "pg-op-1",
                created_at: nowIso,
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM candidates WHERE room_id = $1 AND round_id = $2 ORDER BY position ASC")) {
          return {
            rows: [
              {
                id: candId,
                room_id: roomId,
                round_id: roundId,
                movie_id: 550,
                position: 0,
                title: "Fight Club",
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM votes WHERE room_id = $1 AND round_id = $2 ORDER BY created_at ASC")) {
          return {
            rows: [
              {
                id: crypto.randomUUID(),
                room_id: roomId,
                round_id: roundId,
                participant_id: hostId,
                candidate_id: candId,
                movie_id: 550,
                vote: "LIKE",
                operation_id: "pg-op-1",
                created_at: nowIso,
              },
            ],
          };
        }
        if (sql.includes("UPDATE rooms") && sql.includes("RETURNING *")) {
          return {
            rows: [
              {
                id: roomId,
                code: "ABCDEF",
                status: "ACTIVE",
                host_participant_id: hostId,
                state_version: 4,
                participant_count: 2,
                matched_movie_id: null,
                current_round_id: roundId,
                deck_filter: null,
                inactivity_ttl_seconds: 86400,
                last_activity_at: nowIso,
                expires_at: new Date(Date.now() + 86400_000).toISOString(),
                created_at: nowIso,
                updated_at: nowIso,
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => {},
    };

    const mockPool = {
      totalCount: 1,
      connect: async () => mockClient,
    };

    const repo = new PostgresRoomRepository(mockPool as never, { schema: "cinematch_unit" });
    const res = await repo.recordVote(roomId, roundId, hostId, candId, 550, "LIKE", {
      operationId: "pg-op-1",
    });

    expect(res.isMatched).toBe(false);
    expect(res.room.state_version).toBe(4);
    expect(executedSql.some((q) => q.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE"))).toBe(
      true
    );
    expect(executedSql.some((q) => q.includes("FROM round_participants"))).toBe(true);
    expect(executedSql.some((q) => q.includes("SAVEPOINT sp_insert_vote"))).toBe(true);
    expect(executedSql.some((q) => q.includes("VOTE_RECORDED"))).toBe(true);
  });
});
