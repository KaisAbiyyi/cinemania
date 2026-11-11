import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import {
  Room,
  RoomParticipant,
  Round,
  RoomStatus,
  Candidate,
  Vote,
  VoteType,
  RoomEvent,
  DEFAULT_INACTIVITY_TTL_SECONDS,
  MAX_PARTICIPANTS,
  DECK_SIZE,
} from "@/db/schema";
import { assertValidTransition, validateStartRoundPrerequisites, RoomCapacityError } from "./stateMachine";

export interface CreateRoomOptions {
  hostGuestId: string;
  hostDisplayName: string;
  inactivityTtlSeconds?: number;
  deckFilter?: Record<string, unknown>;
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
  readonly status = 404;
  readonly code = "ROOM_NOT_FOUND";
  constructor(message = "Room not found") {
    super(message);
    this.name = "RoomNotFoundError";
  }
}

export class DuplicateVoteError extends Error {
  readonly status = 409;
  readonly code = "DUPLICATE_VOTE";
  constructor(message = "Vote has already been recorded for this candidate by this participant") {
    super(message);
    this.name = "DuplicateVoteError";
  }
}

/**
 * Generates an uppercase 6-character alphanumeric room code.
 */
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Omit ambiguous characters (0, O, 1, I)
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Authoritative Room Repository for relational transactional state management.
 * Built with SQLite WAL mode / PostgreSQL relational compatibility.
 */
export class SqliteRoomRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * Transactionally creates a new Room with an initial Host participant and outbox event.
   */
  createRoom(options: CreateRoomOptions): { room: Room; host: RoomParticipant } {
    const roomId = crypto.randomUUID();
    const hostId = crypto.randomUUID();
    const code = generateRoomCode();
    const ttl = options.inactivityTtlSeconds || DEFAULT_INACTIVITY_TTL_SECONDS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();
    const nowIso = now.toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      // 1. Insert room
      this.db
        .prepare(
          `INSERT INTO rooms (
            id, code, status, host_participant_id, state_version, participant_count,
            matched_movie_id, current_round_id, deck_filter, inactivity_ttl_seconds,
            last_activity_at, expires_at, created_at, updated_at
          ) VALUES (?, ?, 'LOBBY', ?, 1, 1, NULL, NULL, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          roomId,
          code,
          hostId,
          options.deckFilter ? JSON.stringify(options.deckFilter) : null,
          ttl,
          nowIso,
          expiresAt,
          nowIso,
          nowIso
        );

      // 2. Insert host participant
      this.db
        .prepare(
          `INSERT INTO room_participants (
            id, room_id, guest_id, display_name, role, is_connected, joined_at, last_seen_at
          ) VALUES (?, ?, ?, ?, 'HOST', 1, ?, ?)`
        )
        .run(hostId, roomId, options.hostGuestId, options.hostDisplayName, nowIso, nowIso);

      // 3. Insert outbox ROOM_CREATED event
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
           VALUES (?, 1, 'ROOM_CREATED', ?, ?)`
        )
        .run(
          roomId,
          JSON.stringify({
            roomId,
            code,
            hostId,
            displayName: options.hostDisplayName,
          }),
          nowIso
        );

      this.db.exec("COMMIT;");

      const room = this.getRoomById(roomId)!;
      const host = this.getParticipantById(hostId)!;
      return { room, host };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Transactionally adds a guest participant to a room in LOBBY status.
   */
  joinRoom(roomId: string, guestId: string, displayName: string): RoomParticipant {
    const participantId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) throw new RoomNotFoundError(`Room ${roomId} does not exist.`);

      if (room.status !== "LOBBY") {
        throw new RoomCapacityError(
          `Cannot join room: status is '${room.status}', but must be 'LOBBY'.`
        );
      }

      if (room.participant_count >= MAX_PARTICIPANTS) {
        throw new RoomCapacityError(
          `Room has reached maximum capacity of ${MAX_PARTICIPANTS} participants.`
        );
      }

      // Check for existing participant with same guest_id in this room (idempotency)
      const existing = this.db
        .prepare(
          `SELECT * FROM room_participants WHERE room_id = ? AND guest_id = ?`
        )
        .get(roomId, guestId) as unknown as RoomParticipant | undefined;

      if (existing) {
        this.db.exec("COMMIT;");
        return existing;
      }

      // Insert new participant
      this.db
        .prepare(
          `INSERT INTO room_participants (
            id, room_id, guest_id, display_name, role, is_connected, joined_at, last_seen_at
          ) VALUES (?, ?, ?, ?, 'MEMBER', 1, ?, ?)`
        )
        .run(participantId, roomId, guestId, displayName, nowIso, nowIso);

      const nextVersion = room.state_version + 1;
      const newParticipantCount = room.participant_count + 1;

      // Update room state_version, participant_count, and last_activity_at
      this.db
        .prepare(
          `UPDATE rooms
           SET state_version = ?, participant_count = ?, last_activity_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextVersion, newParticipantCount, nowIso, nowIso, roomId);

      // Insert PARTICIPANT_JOINED outbox event
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
           VALUES (?, ?, 'PARTICIPANT_JOINED', ?, ?)`
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
      return this.getParticipantById(participantId)!;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Starts a voting round: transitions status from LOBBY to ACTIVE with a 20-movie deck.
   */
  startRound(roomId: string, candidates: CandidateInput[]): { round: Round; candidates: Candidate[]; room: Room } {
    const roundId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

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

      // Insert 20 candidates
      const insertCandidateStmt = this.db.prepare(
        `INSERT INTO candidates (
          id, round_id, room_id, movie_id, position, title, poster_path, overview, release_date, vote_average
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const insertedCandidates: Candidate[] = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const candId = crypto.randomUUID();
        insertCandidateStmt.run(
          candId,
          roundId,
          roomId,
          c.movieId,
          i,
          c.title,
          c.posterPath || null,
          c.overview || null,
          c.releaseDate || null,
          c.voteAverage !== undefined ? c.voteAverage : null
        );
        insertedCandidates.push({
          id: candId,
          round_id: roundId,
          room_id: roomId,
          movie_id: c.movieId,
          position: i,
          title: c.title,
          poster_path: c.posterPath || null,
          overview: c.overview || null,
          release_date: c.releaseDate || null,
          vote_average: c.voteAverage !== undefined ? c.voteAverage : null,
        });
      }

      const nextVersion = room.state_version + 1;

      // Update room to ACTIVE
      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'ACTIVE', current_round_id = ?, state_version = ?, last_activity_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(roundId, nextVersion, nowIso, nowIso, roomId);

      // Outbox event ROUND_STARTED
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
           VALUES (?, ?, 'ROUND_STARTED', ?, ?)`
        )
        .run(
          roomId,
          nextVersion,
          JSON.stringify({
            roundId,
            candidateCount: candidates.length,
          }),
          nowIso
        );

      this.db.exec("COMMIT;");
      return {
        round: this.getRoundById(roundId)!,
        candidates: insertedCandidates,
        room: this.getRoomById(roomId)!,
      };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  /**
   * Transactionally records a vote and evaluates unanimous match consensus.
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
    const nowIso = new Date().toISOString();

    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) throw new RoomNotFoundError(`Room ${roomId} does not exist.`);

      if ((room.status as RoomStatus) !== "ACTIVE") {
        // If room is already MATCHED, return current match status idempotently
        if ((room.status as RoomStatus) === "MATCHED") {
          this.db.exec("COMMIT;");
          return {
            vote: {
              id: voteId,
              room_id: roomId,
              round_id: roundId,
              participant_id: participantId,
              candidate_id: candidateId,
              movie_id: movieId,
              vote,
              created_at: nowIso,
            },
            room,
            isMatched: true,
          };
        }
        throw new RoomCapacityError(
          `Cannot record vote: room status is '${room.status}', but must be 'ACTIVE'.`
        );
      }

      // Check for duplicate vote (enforcing uniqueness constraint)
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
          isMatched: room.status === "MATCHED",
        };
      }

      // Insert vote
      this.db
        .prepare(
          `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(voteId, roomId, roundId, participantId, candidateId, movieId, vote, nowIso);

      const nextVersion = room.state_version + 1;
      let isMatched = false;
      let matchedMovieId: number | null = null;

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
          newStatus = "MATCHED";
          matchedMovieId = movieId;

          this.db
            .prepare(
              `UPDATE rooms
               SET status = 'MATCHED', matched_movie_id = ?, state_version = ?, last_activity_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(matchedMovieId, nextVersion, nowIso, nowIso, roomId);

          // Emit MATCH_ANNOUNCED event in outbox
          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
               VALUES (?, ?, 'MATCH_ANNOUNCED', ?, ?)`
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
          // Secret vote guarantee: outbox broadcast event only reveals participantId
          this.db
            .prepare(
              `UPDATE rooms
               SET state_version = ?, last_activity_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nextVersion, nowIso, nowIso, roomId);

          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
               VALUES (?, ?, 'VOTE_RECORDED', ?, ?)`
            )
            .run(
              roomId,
              nextVersion,
              JSON.stringify({ participantId }),
              nowIso
            );
        }
      } else {
        // Vote is SKIP: check if deck is exhausted
        const totalVotesRow = this.db
          .prepare(`SELECT COUNT(*) as count FROM votes WHERE round_id = ?`)
          .get(roundId) as unknown as { count: number };

        const totalExpectedVotes = room.participant_count * DECK_SIZE;
        if (totalVotesRow.count >= totalExpectedVotes) {
          // All votes cast without match -> EXHAUSTED
          assertValidTransition(room.status, "EXHAUSTED", "Deck exhausted without consensus");

          this.db
            .prepare(
              `UPDATE rooms
               SET status = 'EXHAUSTED', state_version = ?, last_activity_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nextVersion, nowIso, nowIso, roomId);

          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
               VALUES (?, ?, 'DECK_EXHAUSTED', ?, ?)`
            )
            .run(
              roomId,
              nextVersion,
              JSON.stringify({ roundId, totalVotes: totalVotesRow.count }),
              nowIso
            );
        } else {
          this.db
            .prepare(
              `UPDATE rooms
               SET state_version = ?, last_activity_at = ?, updated_at = ?
               WHERE id = ?`
            )
            .run(nextVersion, nowIso, nowIso, roomId);

          this.db
            .prepare(
              `INSERT INTO room_events (room_id, version, event_type, payload, created_at)
               VALUES (?, ?, 'VOTE_RECORDED', ?, ?)`
            )
            .run(
              roomId,
              nextVersion,
              JSON.stringify({ participantId }),
              nowIso
            );
        }
      }

      this.db.exec("COMMIT;");
      return {
        vote: {
          id: voteId,
          room_id: roomId,
          round_id: roundId,
          participant_id: participantId,
          candidate_id: candidateId,
          movie_id: movieId,
          vote,
          created_at: nowIso,
        },
        room: this.getRoomById(roomId)!,
        isMatched,
      };
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  getRoomById(id: string): Room | null {
    const row = this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as unknown as Room | undefined;
    return row || null;
  }

  getParticipantById(id: string): RoomParticipant | null {
    const row = this.db.prepare(`SELECT * FROM room_participants WHERE id = ?`).get(id) as unknown as RoomParticipant | undefined;
    return row || null;
  }

  getRoundById(id: string): Round | null {
    const row = this.db.prepare(`SELECT * FROM rounds WHERE id = ?`).get(id) as unknown as Round | undefined;
    return row || null;
  }

  getCandidatesByRound(roundId: string): Candidate[] {
    return this.db
      .prepare(`SELECT * FROM candidates WHERE round_id = ? ORDER BY position ASC`)
      .all(roundId) as unknown as Candidate[];
  }

  getEventsByRoom(roomId: string): RoomEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM room_events WHERE room_id = ? ORDER BY version ASC`)
      .all(roomId) as unknown as RoomEvent[];
    return rows.map((r) => ({
      ...r,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    }));
  }
}
