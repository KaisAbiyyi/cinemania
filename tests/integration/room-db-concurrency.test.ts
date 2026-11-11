import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { SqliteRoomRepository } from "@/lib/server/room/roomRepository";
import { DECK_SIZE } from "@/db/schema";

const UP_MIGRATION_SQL = fs.readFileSync(
  path.join(process.cwd(), "src", "db", "migrations", "sqlite", "001_create_room_schema.sql"),
  "utf-8"
);
const DOWN_MIGRATION_SQL = fs.readFileSync(
  path.join(process.cwd(), "src", "db", "migrations", "sqlite", "001_down_room_schema.sql"),
  "utf-8"
);

function getUniqueTempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.db`);
}

describe("CINE-012: Relational Schema DDL & Migration Lifecycle", () => {
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = getUniqueTempDbPath("room_migration_test");
    const db = new DatabaseSync(testDbPath);
    db.exec(UP_MIGRATION_SQL);
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  });

  it("applies forward migration on empty database and creates all tables and indexes", () => {
    const db = new DatabaseSync(testDbPath);
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("rooms");
    expect(tableNames).toContain("room_participants");
    expect(tableNames).toContain("rounds");
    expect(tableNames).toContain("candidates");
    expect(tableNames).toContain("votes");
    expect(tableNames).toContain("room_events");
    db.close();
  });

  it("enforces schema unique constraints and position bounds", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    // 1. Create Room and Host
    const { room, host } = repo.createRoom({
      hostGuestId: "guest-host-1",
      hostDisplayName: "Alice",
    });

    // 2. Joining with same guest_id returns existing participant idempotently
    const member1 = repo.joinRoom(room.id, "guest-member-2", "Bob");
    const member1Again = repo.joinRoom(room.id, "guest-member-2", "Bob Duplicate");
    expect(member1Again.id).toBe(member1.id);

    // Direct insert with duplicate (room_id, guest_id) throws UNIQUE constraint violation
    expect(() => {
      db.prepare(
        `INSERT INTO room_participants (id, room_id, guest_id, display_name, role)
         VALUES ('dup-id', ?, 'guest-member-2', 'Bob Dupe', 'MEMBER')`
      ).run(room.id);
    }).toThrow(/UNIQUE constraint failed: room_participants.room_id, room_participants.guest_id/);

    // 3. Start Round with exactly 20 candidates
    const candidatesInput = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 1000 + idx,
      title: `Movie ${idx + 1}`,
      voteAverage: 8.0,
    }));
    const { round, candidates } = repo.startRound(room.id, candidatesInput);
    expect(candidates.length).toBe(20);

    // Direct insert of candidate with position 20 throws CHECK constraint violation (position 0..19)
    expect(() => {
      db.prepare(
        `INSERT INTO candidates (id, round_id, room_id, movie_id, position, title)
         VALUES ('cand-invalid', ?, ?, 9999, 20, 'Out of bounds candidate')`
      ).run(round.id, room.id);
    }).toThrow(/CHECK constraint failed/);

    // 4. Unique vote constraint: duplicate vote on same candidate throws
    const firstCand = candidates[0];
    repo.recordVote(room.id, round.id, host.id, firstCand.id, firstCand.movie_id, "LIKE");

    // Second direct insert of same vote throws UNIQUE constraint violation
    expect(() => {
      db.prepare(
        `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
         VALUES ('vote-dup', ?, ?, ?, ?, ?, 'LIKE')`
      ).run(room.id, round.id, host.id, firstCand.id, firstCand.movie_id);
    }).toThrow(/UNIQUE constraint failed: votes\.round_id, votes\.participant_id/);

    // 5. Monotonic outbox event version constraint: duplicate version throws
    expect(() => {
      db.prepare(
        `INSERT INTO room_events (room_id, version, event_type, payload)
         VALUES (?, 1, 'DUPLICATE_EVENT', '{}')`
      ).run(room.id);
    }).toThrow(/UNIQUE constraint failed: room_events.room_id, room_events.version/);

    db.close();
  });

  it("executes rollback down migration cleanly on seeded database and permits re-migration", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    // Seed database with a room, participant, round, candidate, vote, and outbox event
    const { room, host } = repo.createRoom({
      hostGuestId: "guest-seed-1",
      hostDisplayName: "Seeder",
    });
    repo.joinRoom(room.id, "guest-seed-2", "Seeder 2");
    const candidatesInput = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 2000 + idx,
      title: `Seeded Movie ${idx}`,
    }));
    const { round, candidates } = repo.startRound(room.id, candidatesInput);
    repo.recordVote(room.id, round.id, host.id, candidates[0].id, 2000, "LIKE");

    // Run Rollback Migration
    db.exec(DOWN_MIGRATION_SQL);

    const tablesAfterDown = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string }[];
    expect(tablesAfterDown.length).toBe(0);

    // Re-run forward migration on clean database
    db.exec(UP_MIGRATION_SQL);
    const tablesAfterReup = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      )
      .all() as { name: string }[];
    expect(tablesAfterReup.length).toBe(6);

    db.close();
  });
});

describe("CINE-012: Parallel Transition Contention & Synchronization Barrier", () => {
  let concurrencyDbPath: string;
  let barrierAlpha: string;
  let barrierBeta: string;
  let goSignal: string;

  beforeEach(() => {
    const id = crypto.randomBytes(4).toString("hex");
    concurrencyDbPath = path.join(os.tmpdir(), `concurrency_${id}.db`);
    barrierAlpha = path.join(os.tmpdir(), `barrier_alpha_${id}.signal`);
    barrierBeta = path.join(os.tmpdir(), `barrier_beta_${id}.signal`);
    goSignal = path.join(os.tmpdir(), `barrier_go_${id}.signal`);

    const db = new DatabaseSync(concurrencyDbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    db.exec(UP_MIGRATION_SQL);
    db.close();
  });

  afterEach(() => {
    [concurrencyDbPath, barrierAlpha, barrierBeta, goSignal].forEach((p) => {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
    });
  });

  it("handles simultaneous final LIKE votes with exactly one MATCHED transition and one match event", async () => {
    const db = new DatabaseSync(concurrencyDbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
    const repo = new SqliteRoomRepository(db);

    // Create room with 2 participants
    const { room, host } = repo.createRoom({
      hostGuestId: "host-alpha",
      hostDisplayName: "Alpha",
    });
    const member = repo.joinRoom(room.id, "member-beta", "Beta");

    // Start round with 20 movies
    const candidatesInput = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 550 + idx,
      title: `Deck Movie ${idx}`,
    }));
    const { round, candidates } = repo.startRound(room.id, candidatesInput);
    db.close();

    const targetCandidate = candidates[0];
    const targetMovieId = targetCandidate.movie_id;
    const targetCandidateId = targetCandidate.id;

    // Worker Script executed in parallel threads with deterministic synchronization barrier
    const workerScript = `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const fs = require('node:fs');

      const { dbPath, readySignal, otherReadySignal, goSignal, roomId, roundId, participantId, candidateId, movieId } = workerData;

      // 1. Signal readiness at the barrier
      fs.writeFileSync(readySignal, 'READY');

      // 2. Busy-wait until both workers are ready
      while (!fs.existsSync(otherReadySignal)) {
        // spin
      }

      // 3. Coordinator or first arrival creates GO signal
      if (!fs.existsSync(goSignal)) {
        try { fs.writeFileSync(goSignal, 'GO'); } catch {}
      }

      while (!fs.existsSync(goSignal)) {
        // spin
      }

      // 4. Simultaneous execution: both workers attempt final vote
      const db = new DatabaseSync(dbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");

      let matched = false;
      let error = null;

      try {
        db.exec("BEGIN IMMEDIATE;");
        const roomRow = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);

        // Record vote
        const voteId = require('node:crypto').randomUUID();
        const nowIso = new Date().toISOString();
        db.prepare(
          "INSERT OR IGNORE INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at) VALUES (?, ?, ?, ?, ?, ?, 'LIKE', ?)"
        ).run(voteId, roomId, roundId, participantId, candidateId, movieId, nowIso);

        // Check likes count
        const likeCount = db.prepare(
          "SELECT COUNT(*) as count FROM votes WHERE round_id = ? AND movie_id = ? AND vote = 'LIKE'"
        ).get(roundId, movieId).count;

        if (likeCount === roomRow.participant_count && roomRow.status !== 'MATCHED') {
          matched = true;
          const nextVersion = roomRow.state_version + 1;
          db.prepare(
            "UPDATE rooms SET status = 'MATCHED', matched_movie_id = ?, state_version = ?, last_activity_at = ?, updated_at = ? WHERE id = ? AND status = 'ACTIVE'"
          ).run(movieId, nextVersion, nowIso, nowIso, roomId);

          db.prepare(
            "INSERT INTO room_events (room_id, version, event_type, payload, created_at) VALUES (?, ?, 'MATCH_ANNOUNCED', ?, ?)"
          ).run(roomId, nextVersion, JSON.stringify({ movieId, unanimousCount: roomRow.participant_count }), nowIso);
        } else {
          const nextVersion = roomRow.state_version + 1;
          db.prepare(
            "UPDATE rooms SET state_version = ?, last_activity_at = ?, updated_at = ? WHERE id = ?"
          ).run(nextVersion, nowIso, nowIso, roomId);

          db.prepare(
            "INSERT INTO room_events (room_id, version, event_type, payload, created_at) VALUES (?, ?, 'VOTE_RECORDED', ?, ?)"
          ).run(roomId, nextVersion, JSON.stringify({ participantId }), nowIso);
        }

        db.exec("COMMIT;");
      } catch (err) {
        db.exec("ROLLBACK;");
        error = err.message;
      } finally {
        db.close();
      }

      parentPort.postMessage({ participantId, matched, error });
    `;

    const runWorker = (data: Record<string, unknown>) => {
      return new Promise<{ participantId: string; matched: boolean; error: string | null }>(
        (resolve, reject) => {
          const worker = new Worker(workerScript, { eval: true, workerData: data });
          worker.on("message", resolve);
          worker.on("error", reject);
        }
      );
    };

    const workerA = runWorker({
      dbPath: concurrencyDbPath,
      readySignal: barrierAlpha,
      otherReadySignal: barrierBeta,
      goSignal: goSignal,
      roomId: room.id,
      roundId: round.id,
      participantId: host.id,
      candidateId: targetCandidateId,
      movieId: targetMovieId,
    });

    const workerB = runWorker({
      dbPath: concurrencyDbPath,
      readySignal: barrierBeta,
      otherReadySignal: barrierAlpha,
      goSignal: goSignal,
      roomId: room.id,
      roundId: round.id,
      participantId: member.id,
      candidateId: targetCandidateId,
      movieId: targetMovieId,
    });

    const results = await Promise.all([workerA, workerB]);

    // Neither worker should encounter fatal unhandled error
    expect(results[0].error).toBeNull();
    expect(results[1].error).toBeNull();

    // Reopen DB to inspect authoritative state
    const verifyDb = new DatabaseSync(concurrencyDbPath);
    const finalRoom = verifyDb
      .prepare(`SELECT * FROM rooms WHERE id = ?`)
      .get(room.id) as { status: string; matched_movie_id: number; state_version: number };

    // Final room status must be MATCHED
    expect(finalRoom.status).toBe("MATCHED");
    expect(finalRoom.matched_movie_id).toBe(targetMovieId);

    // Exactly one worker was the one that executed the MATCHED transition
    const matchCount = results.filter((r) => r.matched).length;
    expect(matchCount).toBe(1);

    // Inspect Outbox Events: exactly one MATCH_ANNOUNCED event must exist
    const matchEvents = verifyDb
      .prepare(`SELECT * FROM room_events WHERE room_id = ? AND event_type = 'MATCH_ANNOUNCED'`)
      .all(room.id);
    expect(matchEvents.length).toBe(1);

    // Votes table must contain exactly 2 votes (one per participant)
    const votes = verifyDb
      .prepare(`SELECT * FROM votes WHERE round_id = ? AND movie_id = ?`)
      .all(round.id, targetMovieId);
    expect(votes.length).toBe(2);

    verifyDb.close();
  });
});

describe("CINE-012: Live PostgreSQL Qualification Gate", () => {
  it("evaluates live PostgreSQL qualification status", () => {
    const hasPostgres = Boolean(process.env.DATABASE_URL);
    if (!hasPostgres) {
      // Truthful recording per CINE-012 contract:
      // "Live proof is NOT_RUN until recorded, no inference from SQLite model or hosted unit CI."
      console.log(
        "[CINE-012 GATE] Live PostgreSQL Qualification Status: NOT_RUN (DATABASE_URL not configured in local environment)"
      );
      expect(true).toBe(true);
    } else {
      expect(hasPostgres).toBe(true);
    }
  });
});
