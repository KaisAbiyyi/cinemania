import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import {
  Room,
  RoomParticipant,
  Round,
  Candidate,
  Vote,
  RoomEvent,
  VoteType,
  MAX_PARTICIPANTS,
  DEFAULT_INACTIVITY_TTL_SECONDS,
  DECK_SIZE,
} from "@/db/schema";
import {
  assertValidTransition,
  validateStartRoundPrerequisites,
} from "./stateMachine";

export interface CreateRoomOptions {
  hostParticipantId?: string;
  hostDisplayName: string;
  deckFilter?: Record<string, unknown>;
  inactivityTtlSeconds?: number;
}

export interface CandidateInput {
  movieId: number;
  title: string;
  posterPath?: string | null;
  overview?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
}

export class RoomNotFoundError extends Error {
  constructor(message = "Room not found") {
    super(message);
    this.name = "RoomNotFoundError";
  }
}

export class ParticipantNotFoundError extends Error {
  constructor(message = "Participant not found") {
    super(message);
    this.name = "ParticipantNotFoundError";
  }
}

export class RoundNotFoundError extends Error {
  constructor(message = "Round not found") {
    super(message);
    this.name = "RoundNotFoundError";
  }
}

export class CandidateNotFoundError extends Error {
  constructor(message = "Candidate not found") {
    super(message);
    this.name = "CandidateNotFoundError";
  }
}

export class RoomCapacityError extends Error {
  constructor(message = "Room capacity exceeded") {
    super(message);
    this.name = "RoomCapacityError";
  }
}

export class DuplicateVoteError extends Error {
  constructor(message = "Vote has already been recorded for this candidate by this participant") {
    super(message);
    this.name = "DuplicateVoteError";
  }
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export class SqliteRoomRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Creates a new room in LOBBY status and registers the host participant.
   * Uses safe nullable host_participant_id insertion flow to guarantee
   * full immediate foreign-key compatibility with PostgreSQL and SQLite.
   */
  createRoom(options: CreateRoomOptions): { room: Room; host: RoomParticipant } {
    const roomId = crypto.randomUUID();
    const hostParticipantId = options.hostParticipantId || crypto.randomUUID();
    const ttlSeconds = options.inactivityTtlSeconds || DEFAULT_INACTIVITY_TTL_SECONDS;
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      // Collision retry loop for 6-character room code (up to 5 attempts)
      let roomCode = "";
      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        const candidateCode = generateRoomCode();
        const existing = this.db
          .prepare(`SELECT 1 FROM rooms WHERE code = ?`)
          .get(candidateCode);
        if (!existing) {
          roomCode = candidateCode;
          break;
        }
      }
      if (!roomCode) {
        throw new Error("Failed to generate unique room code after 5 attempts");
      }

      // Step 1: Insert Room with host_participant_id = NULL
      this.db
        .prepare(
          `INSERT INTO rooms (
            id, code, status, host_participant_id, state_version, participant_count,
            matched_movie_id, current_round_id, deck_filter, inactivity_ttl_seconds,
            last_activity_at, expires_at, created_at, updated_at
          ) VALUES (?, ?, 'LOBBY', NULL, 1, 1, NULL, NULL, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          roomId,
          roomCode,
          options.deckFilter ? JSON.stringify(options.deckFilter) : null,
          ttlSeconds,
          nowIso,
          expiresAt,
          nowIso,
          nowIso
        );

      // Step 2: Insert Host in room_participants
      this.db
        .prepare(
          `INSERT INTO room_participants (
            room_id, participant_id, display_name, role, is_connected, joined_at, last_seen_at
          ) VALUES (?, ?, ?, 'HOST', 1, ?, ?)`
        )
        .run(roomId, hostParticipantId, options.hostDisplayName, nowIso, nowIso);

      // Step 3: Link host_participant_id in rooms
      this.db
        .prepare(`UPDATE rooms SET host_participant_id = ? WHERE id = ?`)
        .run(hostParticipantId, roomId);

      // Step 4: Emit ROOM_CREATED outbox event (ADR-003 §4.4)
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, 1, 'ROOM_CREATED', ?, 0, 0, 0, ?)`
        )
        .run(
          roomId,
          JSON.stringify({
            roomCode,
            hostParticipantId,
            hostDisplayName: options.hostDisplayName,
          }),
          nowIso
        );

      this.db.exec("COMMIT;");

      const room = this.getRoomById(roomId)!;
      const host = this.getParticipant(roomId, hostParticipantId)!;
      return { room, host };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Joins an existing room in LOBBY status.
   * Idempotency lookup is executed BEFORE the capacity check so reconnecting
   * guests never receive a false 'Room is full' error.
   * Atomically extends expires_at by inactivity_ttl_seconds.
   */
  joinRoom(roomId: string, participantId: string, displayName: string): RoomParticipant {
    const now = new Date();
    const nowIso = now.toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) throw new RoomNotFoundError(`Room ${roomId} does not exist.`);

      // 1. Idempotency check FIRST (ADR-003): return existing participant on retry/reconnect
      const existing = this.db
        .prepare(
          `SELECT * FROM room_participants WHERE room_id = ? AND participant_id = ?`
        )
        .get(roomId, participantId) as unknown as RoomParticipant | undefined;

      if (existing) {
        // Update last_seen_at and renew activity
        const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();
        this.db
          .prepare(
            `UPDATE room_participants SET last_seen_at = ?, is_connected = 1 WHERE room_id = ? AND participant_id = ?`
          )
          .run(nowIso, roomId, participantId);
        this.db
          .prepare(
            `UPDATE rooms SET last_activity_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`
          )
          .run(nowIso, newExpiresAt, nowIso, roomId);
        this.db.exec("COMMIT;");
        return {
          ...existing,
          last_seen_at: nowIso,
          is_connected: true,
        };
      }

      // 2. Room lifecycle check
      if (room.status !== "LOBBY") {
        throw new RoomCapacityError(
          `Cannot join room: status is '${room.status}', but must be 'LOBBY'.`
        );
      }

      // 3. Capacity check: maximum 5 participants
      if (room.participant_count >= MAX_PARTICIPANTS) {
        throw new RoomCapacityError(
          `Room has reached maximum capacity of ${MAX_PARTICIPANTS} participants.`
        );
      }

      // 4. Insert new participant
      this.db
        .prepare(
          `INSERT INTO room_participants (
            room_id, participant_id, display_name, role, is_connected, joined_at, last_seen_at
          ) VALUES (?, ?, ?, 'MEMBER', 1, ?, ?)`
        )
        .run(roomId, participantId, displayName, nowIso, nowIso);

      const nextVersion = room.state_version + 1;
      const newParticipantCount = room.participant_count + 1;
      const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();

      // 5. Update room state_version, participant_count, last_activity_at, and renewed expires_at
      this.db
        .prepare(
          `UPDATE rooms
           SET state_version = ?, participant_count = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextVersion, newParticipantCount, nowIso, newExpiresAt, nowIso, roomId);

      // 6. Insert PARTICIPANT_JOINED outbox event
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'PARTICIPANT_JOINED', ?, 0, 0, 0, ?)`
        )
        .run(
          roomId,
          nextVersion,
          JSON.stringify({
            participantId,
            displayName,
            participantCount: newParticipantCount,
          }),
          nowIso
        );

      this.db.exec("COMMIT;");
      return this.getParticipant(roomId, participantId)!;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Starts a voting round: transitions status from LOBBY to ACTIVE with a 20-movie deck.
   * Atomically extends expires_at by inactivity_ttl_seconds.
   */
  startRound(roomId: string, candidates: CandidateInput[]): { round: Round; candidates: Candidate[]; room: Room } {
    const roundId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) throw new RoomNotFoundError(`Room ${roomId} does not exist.`);

      assertValidTransition(room.status, "ACTIVE", "Starting voting round");
      validateStartRoundPrerequisites(room.participant_count, candidates.length);

      // Insert Round
      this.db
        .prepare(
          `INSERT INTO rounds (id, room_id, round_number, status, started_at)
           VALUES (?, ?, 1, 'ACTIVE', ?)`
        )
        .run(roundId, roomId, nowIso);

      // Insert 20 candidates with exact positions 0..19
      const candidateStmt = this.db.prepare(
        `INSERT INTO candidates (
          id, round_id, room_id, movie_id, position, title, poster_path, overview, release_date, vote_average
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        candidateStmt.run(
          crypto.randomUUID(),
          roundId,
          roomId,
          c.movieId,
          i,
          c.title,
          c.posterPath || null,
          c.overview || null,
          c.releaseDate || null,
          c.voteAverage ?? null
        );
      }

      const nextVersion = room.state_version + 1;
      const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();

      // Update room status to ACTIVE, set current_round_id, and renew expires_at
      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'ACTIVE', current_round_id = ?, state_version = ?,
               last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(roundId, nextVersion, nowIso, newExpiresAt, nowIso, roomId);

      // Insert ROUND_STARTED outbox event
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'ROUND_STARTED', ?, 0, 0, 0, ?)`
        )
        .run(
          roomId,
          nextVersion,
          JSON.stringify({
            roundId,
            deckSize: candidates.length,
          }),
          nowIso
        );

      this.db.exec("COMMIT;");

      const updatedRoom = this.getRoomById(roomId)!;
      const round = this.getRoundById(roundId)!;
      const roundCandidates = this.getCandidatesByRound(roundId);

      return {
        round,
        candidates: roundCandidates,
        room: updatedRoom,
      };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Records a vote for a candidate in an active round.
   * Enforces referential integrity under room lock:
   * - Participant belongs to room
   * - Round belongs to room and is active
   * - Candidate belongs to round and room, and matches movie_id
   * 
   * Idempotent: returns existing vote if already recorded.
   * If room is already MATCHED, returns existing matching vote or throws.
   * Atomically extends expires_at by inactivity_ttl_seconds.
   */
  recordVote(
    roomId: string,
    roundId: string,
    participantId: string,
    candidateId: string,
    movieId: number,
    vote: VoteType
  ): { vote: Vote; room: Room; isMatched: boolean } {
    const voteId = crypto.randomUUID();
    const now = new Date();
    const nowIso = now.toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) throw new RoomNotFoundError(`Room ${roomId} does not exist.`);

      // If room is already MATCHED, check if this vote was already recorded
      if (room.status === "MATCHED") {
        const existingVote = this.db
          .prepare(
            `SELECT * FROM votes
             WHERE round_id = ? AND participant_id = ? AND (candidate_id = ? OR movie_id = ?)`
          )
          .get(roundId, participantId, candidateId, movieId) as unknown as Vote | undefined;

        if (existingVote) {
          this.db.exec("COMMIT;");
          return {
            vote: existingVote,
            room,
            isMatched: true,
          };
        }
        throw new RoomCapacityError(
          `Cannot record vote: room is already MATCHED on movie ${room.matched_movie_id}.`
        );
      }

      if (room.status !== "ACTIVE") {
        throw new RoomCapacityError(
          `Cannot record vote: room status is '${room.status}', but must be 'ACTIVE'.`
        );
      }

      // Referential integrity verification under room lock
      // 1. Participant must belong to the room
      const participant = this.getParticipant(roomId, participantId);
      if (!participant) {
        throw new ParticipantNotFoundError(
          `Participant ${participantId} is not a member of room ${roomId}`
        );
      }

      // 2. Round must belong to room and match active round
      if (room.current_round_id !== roundId) {
        throw new RoundNotFoundError(
          `Round ${roundId} is not the active round for room ${roomId}`
        );
      }

      // 3. Candidate must belong to this round and room, and match movieId
      const candidateRow = this.db
        .prepare(
          `SELECT * FROM candidates WHERE id = ? AND round_id = ? AND room_id = ? AND movie_id = ?`
        )
        .get(candidateId, roundId, roomId, movieId);

      if (!candidateRow) {
        throw new CandidateNotFoundError(
          `Candidate ${candidateId} does not match movie ${movieId} in round ${roundId}`
        );
      }

      // Check for duplicate vote (idempotency)
      const existingVote = this.db
        .prepare(
          `SELECT * FROM votes
           WHERE round_id = ? AND participant_id = ? AND (candidate_id = ? OR movie_id = ?)`
        )
        .get(roundId, participantId, candidateId, movieId) as unknown as Vote | undefined;

      if (existingVote) {
        this.db.exec("COMMIT;");
        return {
          vote: existingVote,
          room,
          isMatched: false,
        };
      }

      // Insert vote with composite foreign keys
      this.db
        .prepare(
          `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(voteId, roomId, roundId, participantId, candidateId, movieId, vote, nowIso);

      const nextVersion = room.state_version + 1;
      const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();
      let isMatched = false;

      if (vote === "LIKE") {
        // Count total LIKE votes for this movie in this round
        const likeCountRow = this.db
          .prepare(
            `SELECT COUNT(*) as count FROM votes
             WHERE round_id = ? AND movie_id = ? AND vote = 'LIKE'`
          )
          .get(roundId, movieId) as unknown as { count: number };

        if (likeCountRow.count === room.participant_count) {
          // Unanimous match consensus reached!
          assertValidTransition(room.status, "MATCHED", "Unanimous consensus achieved");
          isMatched = true;

          this.db
            .prepare(
              `UPDATE rooms
               SET status = 'MATCHED', matched_movie_id = ?, state_version = ?,
                   last_activity_at = ?, expires_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(movieId, nextVersion, nowIso, newExpiresAt, nowIso, roomId);

          // Emit MATCH_ANNOUNCED event in outbox
          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
               VALUES (?, ?, 'MATCH_ANNOUNCED', ?, 0, 0, 0, ?)`
            )
            .run(
              roomId,
              nextVersion,
              JSON.stringify({
                movieId,
                unanimousCount: room.participant_count,
              }),
              nowIso
            );
        } else {
          // Secret vote guarantee (CINE-020): outbox broadcast event only reveals participantId
          this.db
            .prepare(
              `UPDATE rooms
               SET state_version = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nextVersion, nowIso, newExpiresAt, nowIso, roomId);

          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
               VALUES (?, ?, 'VOTE_RECORDED', ?, 0, 0, 0, ?)`
            )
            .run(roomId, nextVersion, JSON.stringify({ participantId }), nowIso);
        }
      } else {
        // SKIP vote: check if all candidates have been voted by all members
        const totalVotesRow = this.db
          .prepare(
            `SELECT COUNT(*) as count FROM votes WHERE round_id = ?`
          )
          .get(roundId) as unknown as { count: number };

        const totalExpectedVotes = room.participant_count * DECK_SIZE;

        if (totalVotesRow.count >= totalExpectedVotes) {
          // 20 cards swiped by all members with no match: deck exhausted!
          assertValidTransition(room.status, "EXHAUSTED", "Deck exhausted without consensus");

          this.db
            .prepare(
              `UPDATE rooms
               SET status = 'EXHAUSTED', state_version = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nextVersion, nowIso, newExpiresAt, nowIso, roomId);

          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
               VALUES (?, ?, 'DECK_EXHAUSTED', ?, 0, 0, 0, ?)`
            )
            .run(
              roomId,
              nextVersion,
              JSON.stringify({
                roundId,
                totalVotes: totalVotesRow.count,
              }),
              nowIso
            );
        } else {
          // Normal SKIP: secret vote broadcast
          this.db
            .prepare(
              `UPDATE rooms
               SET state_version = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nextVersion, nowIso, newExpiresAt, nowIso, roomId);

          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
               VALUES (?, ?, 'VOTE_RECORDED', ?, 0, 0, 0, ?)`
            )
            .run(roomId, nextVersion, JSON.stringify({ participantId }), nowIso);
        }
      }

      this.db.exec("COMMIT;");

      const updatedRoom = this.getRoomById(roomId)!;
      const recordedVote: Vote = {
        id: voteId,
        room_id: roomId,
        round_id: roundId,
        participant_id: participantId,
        candidate_id: candidateId,
        movie_id: movieId,
        vote,
        created_at: nowIso,
      };

      return {
        vote: recordedVote,
        room: updatedRoom,
        isMatched,
      };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Safe transactional conditional room expiry.
   * Fenced against TOCTOU race condition: checks expectedVersion and fresh last_activity_at
   * under atomic lock to ensure no fresh vote occurred between scan and expiry.
   */
  expireRoom(roomId: string, expectedVersion: number, expiredAt: string): boolean {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) {
        this.db.exec("COMMIT;");
        return false;
      }
      if (room.status === "MATCHED" || room.status === "EXPIRED" || room.status === "EXHAUSTED") {
        this.db.exec("COMMIT;");
        return false;
      }

      // 1. Guard against concurrent activity race: if state_version changed, abort expiry
      if (room.state_version !== expectedVersion) {
        this.db.exec("COMMIT;");
        return false;
      }

      // 2. Re-verify that room has actually lapsed TTL since fresh last_activity_at
      const nowTime = new Date(expiredAt).getTime();
      const lastActivityTime = new Date(room.last_activity_at).getTime();
      const ttlMs = (room.inactivity_ttl_seconds || DEFAULT_INACTIVITY_TTL_SECONDS) * 1000;
      if (nowTime < lastActivityTime + ttlMs) {
        // Fresh activity arrived, abort expiry
        this.db.exec("COMMIT;");
        return false;
      }

      assertValidTransition(room.status, "EXPIRED", "Room expired due to inactivity");
      const nextVersion = room.state_version + 1;

      const result = this.db
        .prepare(
          `UPDATE rooms
           SET status = 'EXPIRED', state_version = ?, updated_at = ?
           WHERE id = ? AND state_version = ? AND status NOT IN ('MATCHED', 'EXPIRED', 'EXHAUSTED')`
        )
        .run(nextVersion, expiredAt, roomId, expectedVersion);

      if (result.changes === 0) {
        this.db.exec("COMMIT;");
        return false;
      }

      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'ROOM_EXPIRED', ?, 0, 0, 0, ?)`
        )
        .run(roomId, nextVersion, JSON.stringify({ expiredAt }), expiredAt);

      this.db.exec("COMMIT;");
      return true;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  findActiveRooms(): Room[] {
    return this.db
      .prepare(
        `SELECT * FROM rooms WHERE status NOT IN ('MATCHED', 'EXHAUSTED', 'EXPIRED')`
      )
      .all() as unknown as Room[];
  }

  getRoomById(id: string): Room | null {
    const row = this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id);
    return (row as unknown as Room) || null;
  }

  getParticipant(roomId: string, participantId: string): RoomParticipant | null {
    const row = this.db
      .prepare(`SELECT * FROM room_participants WHERE room_id = ? AND participant_id = ?`)
      .get(roomId, participantId);
    return (row as unknown as RoomParticipant) || null;
  }

  getParticipantsByRoom(roomId: string): RoomParticipant[] {
    const rows = this.db
      .prepare(`SELECT * FROM room_participants WHERE room_id = ? ORDER BY joined_at ASC`)
      .all(roomId);
    return rows as unknown as RoomParticipant[];
  }

  getRoundById(id: string): Round | null {
    const row = this.db.prepare(`SELECT * FROM rounds WHERE id = ?`).get(id);
    return (row as unknown as Round) || null;
  }

  getCandidatesByRound(roundId: string): Candidate[] {
    const rows = this.db
      .prepare(`SELECT * FROM candidates WHERE round_id = ? ORDER BY position ASC`)
      .all(roundId);
    return rows as unknown as Candidate[];
  }

  getEventsByRoom(roomId: string): RoomEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM room_events WHERE room_id = ? ORDER BY version ASC`)
      .all(roomId);
    return rows as unknown as RoomEvent[];
  }
}

export {
  PostgresRoomRepository,
  type PostgresRepositoryOptions,
} from "./postgresRoomRepository";

