import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  SqliteRoomRepository,
  ParticipantNotFoundError,
  CandidateNotFoundError,
  RoundNotFoundError,
  RoomCapacityError,
} from "@/lib/server/room/roomRepository";
import { DECK_SIZE, MAX_PARTICIPANTS } from "@/db/schema";

const UP_MIGRATION_SQL = fs.readFileSync(
  path.join(process.cwd(), "src", "db", "migrations", "sqlite", "001_create_room_schema.sql"),
  "utf-8"
);
const DOWN_MIGRATION_SQL = fs.readFileSync(
  path.join(process.cwd(), "src", "db", "migrations", "sqlite", "001_down_room_schema.sql"),
  "utf-8"
);
const PG_UP_MIGRATION_SQL = fs.readFileSync(
  path.join(process.cwd(), "src", "db", "migrations", "001_create_room_schema.sql"),
  "utf-8"
);

function getUniqueTempDbPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.db`);
}

describe("CINE-012: Relational Schema DDL & Referential Integrity", () => {
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = getUniqueTempDbPath("room_migration_test");
    const db = new DatabaseSync(testDbPath);
    db.exec("PRAGMA journal_mode = WAL;");
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

  it("enforces composite foreign keys, unique constraints and bounds", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    // 1. Create Room and Host
    const { room, host } = repo.createRoom({
      hostDisplayName: "Alice",
    });

    // 2. Joining with same participant_id returns existing participant idempotently
    const member1Id = crypto.randomUUID();
    const member1 = repo.joinRoom(room.id, member1Id, "Bob");
    const member1Again = repo.joinRoom(room.id, member1Id, "Bob Duplicate");
    expect(member1Again.participant_id).toBe(member1.participant_id);

    // Direct insert with duplicate (room_id, participant_id) throws UNIQUE constraint violation
    expect(() => {
      db.prepare(
        `INSERT INTO room_participants (room_id, participant_id, display_name, role)
         VALUES (?, ?, 'Bob Dupe', 'MEMBER')`
      ).run(room.id, member1Id);
    }).toThrow(/UNIQUE constraint failed: room_participants/);

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
    repo.recordVote(room.id, round.id, host.participant_id, firstCand.id, firstCand.movie_id, "LIKE");

    // Second direct insert of same vote throws UNIQUE constraint violation
    expect(() => {
      db.prepare(
        `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
         VALUES ('vote-dup', ?, ?, ?, ?, ?, 'LIKE')`
      ).run(room.id, round.id, host.participant_id, firstCand.id, firstCand.movie_id);
    }).toThrow(/UNIQUE constraint failed/);

    // 5. Monotonic outbox event version constraint: duplicate version throws
    expect(() => {
      db.prepare(
        `INSERT INTO room_events (room_id, version, event_type, payload)
         VALUES (?, 1, 'DUPLICATE_EVENT', '{}')`
      ).run(room.id);
    }).toThrow(/UNIQUE constraint failed: room_events\.room_id, room_events\.version/);

    db.close();
  });

  it("enforces cross-room and cross-round referential integrity negatives", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    // Room A
    const { room: roomA, host: hostA } = repo.createRoom({ hostDisplayName: "Alice" });
    const { room: roomB, host: hostB } = repo.createRoom({ hostDisplayName: "Bob" });

    const memberAId = crypto.randomUUID();
    repo.joinRoom(roomA.id, memberAId, "Charlie");

    const memberBId = crypto.randomUUID();
    repo.joinRoom(roomB.id, memberBId, "Dave");

    const deckA = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 100 + idx,
      title: `Deck A Movie ${idx}`,
    }));
    const { round: roundA, candidates: candidatesA } = repo.startRound(roomA.id, deckA);

    const deckB = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 200 + idx,
      title: `Deck B Movie ${idx}`,
    }));
    const { round: roundB, candidates: candidatesB } = repo.startRound(roomB.id, deckB);

    // Negative 1: Participant from Room B cannot vote in Room A
    expect(() => {
      repo.recordVote(
        roomA.id,
        roundA.id,
        hostB.participant_id,
        candidatesA[0].id,
        candidatesA[0].movie_id,
        "LIKE"
      );
    }).toThrowError(ParticipantNotFoundError);

    // Negative 2: Candidate from Round B cannot be voted in Round A
    expect(() => {
      repo.recordVote(
        roomA.id,
        roundA.id,
        hostA.participant_id,
        candidatesB[0].id,
        candidatesB[0].movie_id,
        "LIKE"
      );
    }).toThrowError(CandidateNotFoundError);

    // Negative 3: Wrong movie ID for candidate is rejected
    expect(() => {
      repo.recordVote(
        roomA.id,
        roundA.id,
        hostA.participant_id,
        candidatesA[0].id,
        999999, // wrong movie ID
        "LIKE"
      );
    }).toThrowError(CandidateNotFoundError);

    // Negative 4: Voting with Round B's ID in Room A is rejected
    expect(() => {
      repo.recordVote(
        roomA.id,
        roundB.id,
        hostA.participant_id,
        candidatesA[0].id,
        candidatesA[0].movie_id,
        "LIKE"
      );
    }).toThrowError(RoundNotFoundError);

    db.close();
  });

  it("permits reconnecting/rejoining guest even when room is at max capacity (5/5)", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    const { room, host } = repo.createRoom({ hostDisplayName: "Host" });

    const participantIds: string[] = [host.participant_id];
    for (let i = 2; i <= MAX_PARTICIPANTS; i++) {
      const pid = crypto.randomUUID();
      participantIds.push(pid);
      repo.joinRoom(room.id, pid, `Guest ${i}`);
    }

    // Room is now full (5/5). A 6th new participant must be rejected
    const newGuestId = crypto.randomUUID();
    expect(() => {
      repo.joinRoom(room.id, newGuestId, "Guest 6");
    }).toThrowError(RoomCapacityError);

    // But an existing participant (e.g. Guest 5) rejoining must succeed idempotently
    const existingGuestId = participantIds[4];
    const rejoined = repo.joinRoom(room.id, existingGuestId, "Guest 5 Reconnected");
    expect(rejoined.participant_id).toBe(existingGuestId);

    db.close();
  });

  it("atomically renews expires_at on every join, startRound, and vote", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    // 1. Create Room (TTL = 100 seconds)
    const { room, host } = repo.createRoom({
      hostDisplayName: "Alice",
      inactivityTtlSeconds: 100,
    });
    const initialExpiresAt = new Date(room.expires_at).getTime();

    // 2. Join Room: expires_at must be renewed
    const memberId = crypto.randomUUID();
    repo.joinRoom(room.id, memberId, "Bob");
    const roomAfterJoin = repo.getRoomById(room.id)!;
    expect(new Date(roomAfterJoin.expires_at).getTime()).toBeGreaterThanOrEqual(initialExpiresAt);

    // 3. Start Round: expires_at renewed
    const deck = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 300 + idx,
      title: `Movie ${idx}`,
    }));
    const { round, candidates } = repo.startRound(room.id, deck);
    const roomAfterRound = repo.getRoomById(room.id)!;
    expect(new Date(roomAfterRound.expires_at).getTime()).toBeGreaterThanOrEqual(
      new Date(roomAfterJoin.expires_at).getTime()
    );

    // 4. Record Vote: expires_at renewed
    repo.recordVote(room.id, round.id, host.participant_id, candidates[0].id, candidates[0].movie_id, "SKIP");
    const roomAfterVote = repo.getRoomById(room.id)!;
    expect(new Date(roomAfterVote.expires_at).getTime()).toBeGreaterThanOrEqual(
      new Date(roomAfterRound.expires_at).getTime()
    );

    db.close();
  });

  it("enforces SQL-level composite foreign key rejections when mixing rooms and rounds directly", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    const { room: roomA } = repo.createRoom({ hostDisplayName: "Room A Host" });
    const guestAId = crypto.randomUUID();
    repo.joinRoom(roomA.id, guestAId, "Room A Guest");

    const { room: roomB, host: hostB } = repo.createRoom({ hostDisplayName: "Room B Host" });
    const guestBId = crypto.randomUUID();
    repo.joinRoom(roomB.id, guestBId, "Room B Guest");

    const deck = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 3000 + idx,
      title: `Deck Movie ${idx}`,
    }));
    const { candidates: candidatesA } = repo.startRound(roomA.id, deck);

    // Negative 1: Inserting candidate into Room B with an unpopulated Round 2 belonging to Room A violates composite FK (room_id, round_id -> rounds)
    const round2AId = crypto.randomUUID();
    db.prepare(`INSERT INTO rounds (id, room_id, round_number, status) VALUES (?, ?, 2, 'ACTIVE')`).run(
      round2AId,
      roomA.id
    );

    expect(() => {
      db.prepare(
        `INSERT INTO candidates (id, room_id, round_id, movie_id, position, title)
         VALUES ('cand-illegal', ?, ?, 9999, 0, 'Cross room candidate')`
      ).run(roomB.id, round2AId);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Negative 2: Inserting vote into Room B with Candidate from Room A violates composite FK (room_id, round_id, candidate_id, movie_id -> candidates)
    expect(() => {
      db.prepare(
        `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
         VALUES ('vote-illegal', ?, ?, ?, ?, ?, 'LIKE')`
      ).run(roomB.id, round2AId, hostB.participant_id, candidatesA[0].id, candidatesA[0].movie_id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    db.close();
  });

  it("safely handles host participant removal by nulling host_participant_id without affecting room PK", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    const { room, host } = repo.createRoom({ hostDisplayName: "Host To Remove" });
    expect(repo.getRoomById(room.id)!.host_participant_id).toBe(host.participant_id);

    // Delete host participant
    db.prepare(`DELETE FROM room_participants WHERE room_id = ? AND participant_id = ?`).run(
      room.id,
      host.participant_id
    );

    // Room must still exist with unchanged PK and host_participant_id set to NULL
    const roomAfterHostDelete = repo.getRoomById(room.id);
    expect(roomAfterHostDelete).not.toBeNull();
    expect(roomAfterHostDelete!.id).toBe(room.id);
    expect(roomAfterHostDelete!.host_participant_id).toBeNull();

    db.close();
  });

  it("permits the same participant ID to join multiple distinct rooms (parity with PostgreSQL)", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    const guestId = crypto.randomUUID();
    const { room: room1 } = repo.createRoom({
      hostParticipantId: guestId,
      hostDisplayName: "Multi-Room Guest",
    });

    const { room: room2 } = repo.createRoom({
      hostDisplayName: "Other Host",
    });

    // Guest joins room2 as a member
    const participantInRoom2 = repo.joinRoom(room2.id, guestId, "Multi-Room Guest");
    expect(participantInRoom2.participant_id).toBe(guestId);

    // Verify database contains 2 rows for guestId across different room_ids
    const rows = db.prepare(`SELECT * FROM room_participants WHERE participant_id = ?`).all(guestId);
    expect(rows.length).toBe(2);

    // Verify host integrity in room1
    expect(repo.getRoomById(room1.id)!.host_participant_id).toBe(guestId);

    // Verify attempting to assign a participant from room2 as host of room1 (when not in room1) fails
    const otherGuestId = crypto.randomUUID();
    repo.joinRoom(room2.id, otherGuestId, "Stranger");
    expect(() => {
      db.prepare(`UPDATE rooms SET host_participant_id = ? WHERE id = ?`).run(otherGuestId, room1.id);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // Verify deleting participant from room1 nulls host in room1 but preserves membership in room2
    db.prepare(`DELETE FROM room_participants WHERE room_id = ? AND participant_id = ?`).run(room1.id, guestId);
    expect(repo.getRoomById(room1.id)!.host_participant_id).toBeNull();
    const rowsAfter = db.prepare(`SELECT * FROM room_participants WHERE participant_id = ?`).all(guestId);
    expect(rowsAfter.length).toBe(1);
    expect((rowsAfter[0] as { room_id: string }).room_id).toBe(room2.id);

    db.close();
  });

  it("fences against TOCTOU race in expiry worker when a fresh vote arrives after room scan", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    const { room, host } = repo.createRoom({
      hostDisplayName: "Alice",
      inactivityTtlSeconds: 10,
    });
    const guestId = crypto.randomUUID();
    repo.joinRoom(room.id, guestId, "Bob");

    const deck = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 4000 + idx,
      title: `Deck Movie ${idx}`,
    }));
    const { round, candidates } = repo.startRound(room.id, deck);

    // State version is now 3 (create=1, join=2, startRound=3)
    const activeRoom = repo.getRoomById(room.id)!;
    expect(activeRoom.state_version).toBe(3);

    // Simulate an expiry scanner capturing snapshot at state_version 3
    const capturedVersion = activeRoom.state_version;
    const simulatedExpiredAt = new Date(Date.now() + 15000).toISOString();

    // Before expireRoom executes, a participant casts a fresh vote!
    repo.recordVote(room.id, round.id, host.participant_id, candidates[0].id, candidates[0].movie_id, "SKIP");

    // Room is now at state_version 4 with fresh last_activity_at
    const updatedRoom = repo.getRoomById(room.id)!;
    expect(updatedRoom.state_version).toBe(4);

    // Stale expiry attempt using captured version 3 is executed
    const didExpire = repo.expireRoom(room.id, capturedVersion, simulatedExpiredAt);

    // Must be rejected (didExpire = false), preserving the active room and vote!
    expect(didExpire).toBe(false);
    const finalRoom = repo.getRoomById(room.id)!;
    expect(finalRoom.status).toBe("ACTIVE");
    expect(finalRoom.state_version).toBe(4);

    db.close();
  });

  it("executes rollback down migration cleanly on seeded database and permits re-migration", () => {
    const db = new DatabaseSync(testDbPath);
    const repo = new SqliteRoomRepository(db);

    // Seed database with a room, participant, round, candidate, vote, and outbox event
    const { room, host } = repo.createRoom({
      hostDisplayName: "Seeder",
    });
    const guestId = crypto.randomUUID();
    repo.joinRoom(room.id, guestId, "Seeder 2");
    const candidatesInput = Array.from({ length: DECK_SIZE }, (_, idx) => ({
      movieId: 2000 + idx,
      title: `Seeded Movie ${idx}`,
    }));
    const { round, candidates } = repo.startRound(room.id, candidatesInput);
    repo.recordVote(room.id, round.id, host.participant_id, candidates[0].id, 2000, "LIKE");

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

describe("CINE-012: Parallel Transition Contention & Deterministic Concurrency", () => {
  let concurrencyDbPath: string;

  beforeEach(() => {
    const id = crypto.randomBytes(4).toString("hex");
    concurrencyDbPath = path.join(os.tmpdir(), `concurrency_${id}.db`);

    // Coordinator establishes WAL mode ONCE on database initialization
    const db = new DatabaseSync(concurrencyDbPath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 10000;");
    db.exec(UP_MIGRATION_SQL);
    db.close();
  });

  afterEach(() => {
    if (fs.existsSync(concurrencyDbPath)) {
      try {
        fs.unlinkSync(concurrencyDbPath);
      } catch {}
    }
  });

  it("handles simultaneous final LIKE votes with exactly one MATCHED transition and one match event", async () => {
    const db = new DatabaseSync(concurrencyDbPath);
    db.exec("PRAGMA busy_timeout = 10000;");
    const repo = new SqliteRoomRepository(db);

    // Create room with 2 participants
    const { room, host } = repo.createRoom({
      hostDisplayName: "Alpha",
    });
    const memberId = crypto.randomUUID();
    const member = repo.joinRoom(room.id, memberId, "Beta");

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

    // Worker Script executed in parallel threads using message synchronization
    // Workers DO NOT call PRAGMA journal_mode = WAL (avoiding contention on pragma)
    const workerScript = `
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');

      const { dbPath, roomId, roundId, participantId, candidateId, movieId } = workerData;

      // 1. Signal readiness to coordinator
      parentPort.postMessage({ type: 'READY' });

      // 2. Wait for coordinator START signal
      parentPort.once('message', (msg) => {
        if (msg.command !== 'START') return;

        const db = new DatabaseSync(dbPath);
        db.exec("PRAGMA busy_timeout = 10000;");

        let matched = false;
        let error = null;

        try {
          db.exec("BEGIN IMMEDIATE;");
          const roomRow = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);

          const voteId = require('node:crypto').randomUUID();
          const nowIso = new Date().toISOString();

          // Insert vote
          db.prepare(
            "INSERT OR IGNORE INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at) VALUES (?, ?, ?, ?, ?, ?, 'LIKE', ?)"
          ).run(voteId, roomId, roundId, participantId, candidateId, movieId, nowIso);

          // Check LIKE votes count
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
              "INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at) VALUES (?, ?, 'MATCH_ANNOUNCED', ?, 0, 0, 0, ?)"
            ).run(roomId, nextVersion, JSON.stringify({ movieId, unanimousCount: roomRow.participant_count }), nowIso);
          } else {
            const nextVersion = roomRow.state_version + 1;
            db.prepare(
              "UPDATE rooms SET state_version = ?, last_activity_at = ?, updated_at = ? WHERE id = ?"
            ).run(nextVersion, nowIso, nowIso, roomId);

            db.prepare(
              "INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at) VALUES (?, ?, 'VOTE_RECORDED', ?, 0, 0, 0, ?)"
            ).run(roomId, nextVersion, JSON.stringify({ participantId }), nowIso);
          }

          db.exec("COMMIT;");
        } catch (err) {
          try { db.exec("ROLLBACK;"); } catch {}
          error = err.message;
        } finally {
          db.close();
        }

        parentPort.postMessage({ type: 'RESULT', participantId, matched, error });
      });
    `;

    interface WorkerHandle {
      worker: Worker;
      promise: Promise<{ participantId: string; matched: boolean; error: string | null }>;
      ready: Promise<void>;
    }

    const launchWorker = (data: Record<string, unknown>): WorkerHandle => {
      let readyResolve: () => void;
      const ready = new Promise<void>((r) => {
        readyResolve = r;
      });

      const worker = new Worker(workerScript, { eval: true, workerData: data });

      const promise = new Promise<{ participantId: string; matched: boolean; error: string | null }>(
        (resolve, reject) => {
          const timeout = setTimeout(() => {
            worker.terminate();
            reject(new Error("Worker timed out after 10000ms"));
          }, 10000);

          worker.on("message", (msg) => {
            if (msg.type === "READY") {
              readyResolve();
            } else if (msg.type === "RESULT") {
              clearTimeout(timeout);
              resolve({
                participantId: msg.participantId,
                matched: msg.matched,
                error: msg.error,
              });
            }
          });

          worker.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        }
      );

      return { worker, promise, ready };
    };

    const handleA = launchWorker({
      dbPath: concurrencyDbPath,
      roomId: room.id,
      roundId: round.id,
      participantId: host.participant_id,
      candidateId: targetCandidateId,
      movieId: targetMovieId,
    });

    const handleB = launchWorker({
      dbPath: concurrencyDbPath,
      roomId: room.id,
      roundId: round.id,
      participantId: member.participant_id,
      candidateId: targetCandidateId,
      movieId: targetMovieId,
    });

    // Wait until both workers are ready
    await Promise.all([handleA.ready, handleB.ready]);

    // Send START simultaneously to both workers
    handleA.worker.postMessage({ command: "START" });
    handleB.worker.postMessage({ command: "START" });

    const results = await Promise.all([handleA.promise, handleB.promise]);

    // Neither worker should encounter unhandled error
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

describe("CINE-012: PostgreSQL DDL Security & RLS Policy Assertions", () => {
  it("verifies fail-closed table permissions, RPC lockdown, and ADR-003 §4.2.1 least-privilege policies", () => {
    // 1. get_room_by_code revoked from anon and authenticated, granted exclusively to service_role
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /REVOKE ALL ON FUNCTION get_room_by_code\(VARCHAR\(6\)\) FROM PUBLIC, anon, authenticated;/
    );
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION get_room_by_code\(VARCHAR\(6\)\) TO service_role;/
    );
    expect(PG_UP_MIGRATION_SQL).not.toMatch(
      /GRANT EXECUTE ON FUNCTION get_room_by_code\(VARCHAR\(6\)\) TO.*anon/
    );

    // 2. is_current_user_room_participant revoked from PUBLIC and anon
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /REVOKE ALL ON FUNCTION is_current_user_room_participant\(UUID\) FROM PUBLIC;/
    );
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION is_current_user_room_participant\(UUID\) TO authenticated, service_role;/
    );
    expect(PG_UP_MIGRATION_SQL).not.toMatch(
      /GRANT EXECUTE ON FUNCTION is_current_user_room_participant\(UUID\) TO.*anon/
    );

    // 3. Fail-closed table permissions: PUBLIC, anon, and authenticated have all existing privileges revoked first
    // Prevents retention of preexisting/default ACL privileges (e.g. TRUNCATE, REFERENCES, INSERT) on Supabase projects
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /REVOKE ALL ON TABLE rooms, room_participants, rounds, candidates, votes, room_events FROM PUBLIC, anon, authenticated;/
    );
    expect(PG_UP_MIGRATION_SQL).not.toMatch(
      /GRANT (SELECT|ALL|INSERT|UPDATE|DELETE|TRUNCATE) ON TABLE.*TO.*anon/
    );

    // 4. Authenticated role granted exclusively minimal SELECT on public models, subject to RLS
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /GRANT SELECT ON TABLE rooms, room_participants, rounds, candidates TO authenticated;/
    );
    expect(PG_UP_MIGRATION_SQL).not.toMatch(
      /GRANT (ALL|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER) ON TABLE.*TO.*authenticated/
    );

    // 5. Service role granted full management access
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /GRANT ALL ON TABLE rooms, room_participants, rounds, candidates, votes, room_events TO service_role;/
    );

    // 6. Explicit Sequence Privileges (BIGSERIAL outbox sequence)
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /REVOKE ALL ON SEQUENCE room_events_id_seq FROM PUBLIC, anon, authenticated;/
    );
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /GRANT USAGE, SELECT ON SEQUENCE room_events_id_seq TO service_role;/
    );
    expect(PG_UP_MIGRATION_SQL).not.toMatch(
      /GRANT (USAGE|ALL|SELECT) ON SEQUENCE room_events_id_seq TO.*(anon|authenticated)/
    );

    // 6. RLS Policies explicitly scoped TO authenticated
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /CREATE POLICY rooms_participant_read_policy ON rooms\s+FOR SELECT TO authenticated/
    );
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /CREATE POLICY rounds_read_policy ON rounds\s+FOR SELECT TO authenticated/
    );
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /CREATE POLICY candidates_read_policy ON candidates\s+FOR SELECT TO authenticated/
    );

    // 7. room_participants self-read policy per ADR-003 §4.2.1
    expect(PG_UP_MIGRATION_SQL).toMatch(
      /CREATE POLICY participants_self_read_policy ON room_participants\s+FOR SELECT TO authenticated\s+USING \(participant_id = \(auth\.jwt\(\) ->> 'sub'\)::uuid\);/
    );
    expect(PG_UP_MIGRATION_SQL).not.toMatch(
      /CREATE POLICY participants_room_member_read_policy/
    );
  });
});
