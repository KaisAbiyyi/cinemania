import crypto from "node:crypto";
import type { Client, Pool, PoolClient } from "pg";
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
} from "../../../db/schema";
import {
  assertValidTransition,
  isRoomRecordExpired,
  validateStartRoundPrerequisites,
} from "./stateMachine";
import {
  DEFAULT_CODE_GENERATION_MAX_RETRIES,
  RoomCodeGenerationError,
  generateRoomCode,
} from "./roomCode";
import {
  CreateRoomOptions,
  CandidateInput,
  RoomNotFoundError,
  ParticipantNotFoundError,
  RoundNotFoundError,
  CandidateNotFoundError,
  RoomCapacityError,
  RoomExpiredError,
} from "./roomRepository";

export function assertValidPgSchema(schema?: string): string | undefined {
  if (!schema) return undefined;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid PostgreSQL schema identifier: '${schema}'`);
  }
  return schema;
}

export interface PostgresRepositoryOptions {
  schema?: string;
}

type Queryable = Client | Pool | PoolClient;

function toIso(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === "string") return new Date(val).toISOString();
  return String(val);
}

function normalizeRoom(row: Record<string, unknown>): Room {
  return {
    id: String(row.id),
    code: String(row.code),
    status: row.status as Room["status"],
    host_participant_id: row.host_participant_id ? String(row.host_participant_id) : null,
    state_version: Number(row.state_version),
    participant_count: Number(row.participant_count),
    matched_movie_id: row.matched_movie_id !== null && row.matched_movie_id !== undefined ? Number(row.matched_movie_id) : null,
    current_round_id: row.current_round_id ? String(row.current_round_id) : null,
    deck_filter: typeof row.deck_filter === "string" ? JSON.parse(row.deck_filter) : (row.deck_filter as Record<string, unknown> || null),
    inactivity_ttl_seconds: Number(row.inactivity_ttl_seconds),
    last_activity_at: toIso(row.last_activity_at),
    expires_at: toIso(row.expires_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

function normalizeParticipant(row: Record<string, unknown>): RoomParticipant {
  return {
    room_id: String(row.room_id),
    participant_id: String(row.participant_id),
    display_name: String(row.display_name),
    role: row.role as RoomParticipant["role"],
    is_connected: Boolean(row.is_connected),
    joined_at: toIso(row.joined_at),
    last_seen_at: toIso(row.last_seen_at),
  };
}

function normalizeRound(row: Record<string, unknown>): Round {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    round_number: Number(row.round_number),
    status: row.status as Round["status"],
    started_at: toIso(row.started_at),
    completed_at: row.completed_at ? toIso(row.completed_at) : null,
  };
}

function normalizeCandidate(row: Record<string, unknown>): Candidate {
  return {
    id: String(row.id),
    round_id: String(row.round_id),
    room_id: String(row.room_id),
    movie_id: Number(row.movie_id),
    position: Number(row.position),
    title: String(row.title),
    poster_path: row.poster_path ? String(row.poster_path) : null,
    overview: row.overview ? String(row.overview) : null,
    release_date: row.release_date ? String(row.release_date) : null,
    vote_average: row.vote_average !== null && row.vote_average !== undefined ? Number(row.vote_average) : null,
  };
}

function normalizeVote(row: Record<string, unknown>): Vote {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    round_id: String(row.round_id),
    participant_id: String(row.participant_id),
    candidate_id: String(row.candidate_id),
    movie_id: Number(row.movie_id),
    vote: row.vote as Vote["vote"],
    created_at: toIso(row.created_at),
  };
}

function normalizeRoomEvent(row: Record<string, unknown>): RoomEvent {
  return {
    id: Number(row.id),
    room_id: String(row.room_id),
    version: Number(row.version),
    event_type: row.event_type as RoomEvent["event_type"],
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload as Record<string, unknown> || {}),
    dispatched: Boolean(row.dispatched),
    dispatched_at: row.dispatched_at ? toIso(row.dispatched_at) : null,
    retry_count: Number(row.retry_count || 0),
    poison: Boolean(row.poison),
    created_at: toIso(row.created_at),
  };
}

/**
 * Production-ready authoritative PostgreSQL Room Repository.
 * Executes server-authoritative state transitions, row-level locking (SELECT ... FOR UPDATE),
 * referential integrity validation, and transactional outbox event insertion.
 */
export class PostgresRoomRepository {
  private readonly db: Queryable;
  private readonly schema?: string;

  constructor(db: Queryable, options?: PostgresRepositoryOptions) {
    this.db = db;
    this.schema = assertValidPgSchema(options?.schema);
  }

  /**
   * Helper to execute a query using an active client, ensuring the schema search path is active.
   */
  private async executeQuery(client: Queryable, text: string, params: unknown[] = []) {
    return client.query(text, params);
  }

  /**
   * Executes a callback within a managed transaction block with search path applied.
   */
  private async withTransaction<T>(fn: (client: Client | PoolClient) => Promise<T>): Promise<T> {
    const isPool = "totalCount" in this.db && typeof (this.db as { connect?: unknown }).connect === "function";
    const client = isPool ? await (this.db as Pool).connect() : (this.db as Client | PoolClient);
    const shouldRelease = isPool && "release" in client;

    try {
      if (this.schema) {
        await client.query(`SET search_path TO "${this.schema}", pg_temp;`);
      }
      await client.query("BEGIN;");
      const result = await fn(client);
      await client.query("COMMIT;");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK;");
      } catch {
        // Rollback error ignored to propagate primary error
      }
      throw err;
    } finally {
      if (shouldRelease && "release" in client) {
        (client as PoolClient).release();
      }
    }
  }

  /**
   * Executes a callback with an active client.
   */
  private async withClient<T>(fn: (client: Client | PoolClient) => Promise<T>): Promise<T> {
    const isPool = "totalCount" in this.db && typeof (this.db as { connect?: unknown }).connect === "function";
    const client = isPool ? await (this.db as Pool).connect() : (this.db as Client | PoolClient);
    const shouldRelease = isPool && "release" in client;

    try {
      if (this.schema) {
        await client.query(`SET search_path TO "${this.schema}", pg_temp;`);
      }
      return await fn(client);
    } finally {
      if (shouldRelease && "release" in client) {
        (client as PoolClient).release();
      }
    }
  }

  /**
   * Creates a new room in LOBBY status and registers the host participant.
   */
  async createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }> {
    return this.withTransaction(async (client) => {
      const roomId = crypto.randomUUID();
      const hostParticipantId = options.hostParticipantId || crypto.randomUUID();
      const ttlSeconds = options.inactivityTtlSeconds || DEFAULT_INACTIVITY_TTL_SECONDS;
      const now = new Date();
      const nowIso = now.toISOString();
      const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

      const codeGenerator = options.codeGenerator ?? generateRoomCode;
      const maxAttempts = Math.max(1, options.maxCodeAttempts ?? DEFAULT_CODE_GENERATION_MAX_RETRIES);
      let roomCode = "";
      let attempts = 0;

      while (attempts < maxAttempts) {
        attempts++;
        const candidateCode = codeGenerator();
        const existing = await client.query("SELECT 1 FROM rooms WHERE code = $1 LIMIT 1;", [candidateCode]);
        if (existing.rows.length > 0) {
          continue;
        }

        // Step 1: Insert Room under savepoint so unique-code race retries do not abort the transaction
        await client.query("SAVEPOINT sp_create_room_code;");
        try {
          await client.query(
            `INSERT INTO rooms (
              id, code, status, host_participant_id, state_version, participant_count,
              matched_movie_id, current_round_id, deck_filter, inactivity_ttl_seconds,
              last_activity_at, expires_at, created_at, updated_at
            ) VALUES ($1, $2, 'LOBBY', NULL, 1, 1, NULL, NULL, $3, $4, $5, $6, $5, $5);`,
            [
              roomId,
              candidateCode,
              options.deckFilter ? JSON.stringify(options.deckFilter) : null,
              ttlSeconds,
              nowIso,
              expiresAt,
            ]
          );
          await client.query("RELEASE SAVEPOINT sp_create_room_code;");
          roomCode = candidateCode;
          break;
        } catch (insertErr: unknown) {
          await client.query("ROLLBACK TO SAVEPOINT sp_create_room_code;");
          const pgCode =
            typeof insertErr === "object" && insertErr !== null && "code" in insertErr
              ? String((insertErr as { code?: unknown }).code)
              : "";
          const pgConstraint =
            typeof insertErr === "object" && insertErr !== null && "constraint" in insertErr
              ? String((insertErr as { constraint?: unknown }).constraint)
              : "";
          if (pgCode === "23505" && (!pgConstraint || pgConstraint.includes("code"))) {
            continue;
          }
          throw insertErr;
        }
      }

      if (!roomCode) {
        throw new RoomCodeGenerationError(
          `Failed to generate unique room code after ${maxAttempts} attempts`
        );
      }

      // Step 2: Insert Host in room_participants
      await client.query(
        `INSERT INTO room_participants (
          room_id, participant_id, display_name, role, is_connected, joined_at, last_seen_at
        ) VALUES ($1, $2, $3, 'HOST', true, $4, $4);`,
        [roomId, hostParticipantId, options.hostDisplayName, nowIso]
      );

      // Step 3: Link host_participant_id in rooms
      await client.query(
        "UPDATE rooms SET host_participant_id = $1 WHERE id = $2;",
        [hostParticipantId, roomId]
      );

      // Step 4: Emit ROOM_CREATED outbox event
      await client.query(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES ($1, 1, 'ROOM_CREATED', $2, false, 0, false, $3);`,
        [
          roomId,
          JSON.stringify({
            roomCode,
            hostParticipantId,
            hostDisplayName: options.hostDisplayName,
          }),
          nowIso,
        ]
      );

      const roomRes = await client.query("SELECT * FROM rooms WHERE id = $1;", [roomId]);
      const hostRes = await client.query(
        "SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2;",
        [roomId, hostParticipantId]
      );

      return {
        room: normalizeRoom(roomRes.rows[0]),
        host: normalizeParticipant(hostRes.rows[0]),
      };
    });
  }

  /**
   * Joins an existing room in LOBBY status.
   * Enforces idempotency before capacity check.
   */
  async joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant> {
    return this.withTransaction(async (client) => {
      const now = new Date();
      const nowIso = now.toISOString();

      // Acquire exclusive lock on the room to serialize concurrent joins
      const roomRes = await client.query("SELECT * FROM rooms WHERE id = $1 FOR UPDATE;", [roomId]);
      if (roomRes.rows.length === 0) {
        throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
      }
      const room = normalizeRoom(roomRes.rows[0]);

      if (isRoomRecordExpired(room, now)) {
        throw new RoomExpiredError(`Room '${room.code}' has expired.`);
      }

      // 1. Idempotency check FIRST
      const existingRes = await client.query(
        "SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2;",
        [roomId, participantId]
      );
      if (existingRes.rows.length > 0) {
        const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();
        await client.query(
          "UPDATE room_participants SET last_seen_at = $1, is_connected = true WHERE room_id = $2 AND participant_id = $3;",
          [nowIso, roomId, participantId]
        );
        await client.query(
          "UPDATE rooms SET last_activity_at = $1, expires_at = $2, updated_at = $1 WHERE id = $3;",
          [nowIso, newExpiresAt, roomId]
        );
        return {
          ...normalizeParticipant(existingRes.rows[0]),
          last_seen_at: nowIso,
          is_connected: true,
        };
      }

      // 2. Room lifecycle check
      if (room.status !== "LOBBY") {
        throw new RoomCapacityError(
          `Cannot join room: status is '${room.status}', but must be 'LOBBY'.`,
          "ROOM_NOT_JOINABLE"
        );
      }

      // 3. Capacity check
      if (room.participant_count >= MAX_PARTICIPANTS) {
        throw new RoomCapacityError(
          `Room has reached maximum capacity of ${MAX_PARTICIPANTS} participants.`,
          "ROOM_FULL"
        );
      }

      // 4. Insert participant
      await client.query(
        `INSERT INTO room_participants (
          room_id, participant_id, display_name, role, is_connected, joined_at, last_seen_at
        ) VALUES ($1, $2, $3, 'MEMBER', true, $4, $4);`,
        [roomId, participantId, displayName, nowIso]
      );

      const nextVersion = room.state_version + 1;
      const newParticipantCount = room.participant_count + 1;
      const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();

      // 5. Update room state_version, participant_count, and extend expires_at
      await client.query(
        `UPDATE rooms
         SET state_version = $1, participant_count = $2, last_activity_at = $3, expires_at = $4, updated_at = $3
         WHERE id = $5;`,
        [nextVersion, newParticipantCount, nowIso, newExpiresAt, roomId]
      );

      // 6. Insert PARTICIPANT_JOINED outbox event
      await client.query(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES ($1, $2, 'PARTICIPANT_JOINED', $3, false, 0, false, $4);`,
        [
          roomId,
          nextVersion,
          JSON.stringify({ participantId, displayName, participantCount: newParticipantCount }),
          nowIso,
        ]
      );

      const partRes = await client.query(
        "SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2;",
        [roomId, participantId]
      );
      return normalizeParticipant(partRes.rows[0]);
    });
  }

  /**
   * Starts a voting round: transitions status from LOBBY to ACTIVE with a 20-movie deck.
   */
  async startRound(roomId: string, candidates: CandidateInput[]): Promise<{ round: Round; candidates: Candidate[]; room: Room }> {
    return this.withTransaction(async (client) => {
      const roundId = crypto.randomUUID();
      const now = new Date();
      const nowIso = now.toISOString();

      const roomRes = await client.query("SELECT * FROM rooms WHERE id = $1 FOR UPDATE;", [roomId]);
      if (roomRes.rows.length === 0) {
        throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
      }
      const room = roomRes.rows[0];

      assertValidTransition(room.status, "ACTIVE", "Starting voting round");
      validateStartRoundPrerequisites(room.participant_count, candidates.length);

      // Insert Round
      await client.query(
        "INSERT INTO rounds (id, room_id, round_number, status, started_at) VALUES ($1, $2, 1, 'ACTIVE', $3);",
        [roundId, roomId, nowIso]
      );

      // Insert 20 candidates
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        await client.query(
          `INSERT INTO candidates (
            id, round_id, room_id, movie_id, position, title, poster_path, overview, release_date, vote_average
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            crypto.randomUUID(),
            roundId,
            roomId,
            c.movieId,
            i,
            c.title,
            c.posterPath || null,
            c.overview || null,
            c.releaseDate || null,
            c.voteAverage ?? null,
          ]
        );
      }

      const nextVersion = room.state_version + 1;
      const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();

      await client.query(
        `UPDATE rooms
         SET status = 'ACTIVE', current_round_id = $1, state_version = $2,
             last_activity_at = $3, expires_at = $4, updated_at = $3
         WHERE id = $5;`,
        [roundId, nextVersion, nowIso, newExpiresAt, roomId]
      );

      await client.query(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES ($1, $2, 'ROUND_STARTED', $3, false, 0, false, $4);`,
        [
          roomId,
          nextVersion,
          JSON.stringify({ roundId, deckSize: candidates.length }),
          nowIso,
        ]
      );

      const updatedRoomRes = await client.query("SELECT * FROM rooms WHERE id = $1;", [roomId]);
      const roundRes = await client.query("SELECT * FROM rounds WHERE id = $1;", [roundId]);
      const candsRes = await client.query("SELECT * FROM candidates WHERE round_id = $1 ORDER BY position ASC;", [roundId]);

      return {
        room: normalizeRoom(updatedRoomRes.rows[0]),
        round: normalizeRound(roundRes.rows[0]),
        candidates: candsRes.rows.map(normalizeCandidate),
      };
    });
  }

  /**
   * Records a vote for a candidate in an active round.
   * Enforces referential integrity and strict serial consistency under exclusive room lock (SELECT ... FOR UPDATE).
   * Idempotent: returns existing vote if already recorded.
   * If room is already MATCHED, returns existing matching vote or throws RoomCapacityError.
   */
  async recordVote(
    roomId: string,
    roundId: string,
    participantId: string,
    candidateId: string,
    movieId: number,
    vote: VoteType
  ): Promise<{ vote: Vote; room: Room; isMatched: boolean }> {
    return this.withTransaction(async (client) => {
      const voteId = crypto.randomUUID();
      const now = new Date();
      const nowIso = now.toISOString();

      // Acquire exclusive row lock on the room
      const roomRes = await client.query("SELECT * FROM rooms WHERE id = $1 FOR UPDATE;", [roomId]);
      if (roomRes.rows.length === 0) {
        throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
      }
      const room = roomRes.rows[0];

      // If room is already MATCHED, check if this vote was already recorded
      if (room.status === "MATCHED") {
        const existingVoteRes = await client.query(
          "SELECT * FROM votes WHERE round_id = $1 AND participant_id = $2 AND (candidate_id = $3 OR movie_id = $4);",
          [roundId, participantId, candidateId, movieId]
        );
        if (existingVoteRes.rows.length > 0) {
          return {
            vote: normalizeVote(existingVoteRes.rows[0]),
            room: normalizeRoom(room),
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
      const partRes = await client.query(
        "SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2;",
        [roomId, participantId]
      );
      if (partRes.rows.length === 0) {
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
      const candidateRes = await client.query(
        "SELECT * FROM candidates WHERE id = $1 AND round_id = $2 AND room_id = $3 AND movie_id = $4;",
        [candidateId, roundId, roomId, movieId]
      );
      if (candidateRes.rows.length === 0) {
        throw new CandidateNotFoundError(
          `Candidate ${candidateId} does not match movie ${movieId} in round ${roundId}`
        );
      }

      // 4. Check for duplicate vote (idempotency)
      const existingVoteRes = await client.query(
        "SELECT * FROM votes WHERE round_id = $1 AND participant_id = $2 AND (candidate_id = $3 OR movie_id = $4);",
        [roundId, participantId, candidateId, movieId]
      );
      if (existingVoteRes.rows.length > 0) {
        return {
          vote: normalizeVote(existingVoteRes.rows[0]),
          room: normalizeRoom(room),
          isMatched: false,
        };
      }

      // 5. Insert vote
      const voteInsertRes = await client.query(
        `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *;`,
        [voteId, roomId, roundId, participantId, candidateId, movieId, vote, nowIso]
      );
      const recordedVote = voteInsertRes.rows[0];

      const nextVersion = room.state_version + 1;
      const newExpiresAt = new Date(now.getTime() + room.inactivity_ttl_seconds * 1000).toISOString();

      if (vote === "LIKE") {
        const likeCountRes = await client.query(
          "SELECT COUNT(*)::int as count FROM votes WHERE round_id = $1 AND movie_id = $2 AND vote = 'LIKE';",
          [roundId, movieId]
        );
        const likeCount = Number(likeCountRes.rows[0].count);

        if (likeCount === room.participant_count) {
          assertValidTransition(room.status, "MATCHED", "Unanimous consensus achieved");

          const updatedRoomRes = await client.query(
            `UPDATE rooms
             SET status = 'MATCHED', matched_movie_id = $1, state_version = $2,
                 last_activity_at = $3, expires_at = $4, updated_at = $3
             WHERE id = $5
             RETURNING *;`,
            [movieId, nextVersion, nowIso, newExpiresAt, roomId]
          );

          await client.query(
            `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
             VALUES ($1, $2, 'MATCH_ANNOUNCED', $3, false, 0, false, $4);`,
            [
              roomId,
              nextVersion,
              JSON.stringify({ movieId, unanimousCount: room.participant_count }),
              nowIso,
            ]
          );

          return {
            vote: normalizeVote(recordedVote),
            room: normalizeRoom(updatedRoomRes.rows[0]),
            isMatched: true,
          };
        } else {
          const updatedRoomRes = await client.query(
            `UPDATE rooms
             SET state_version = $1, last_activity_at = $2, expires_at = $3, updated_at = $2
             WHERE id = $4
             RETURNING *;`,
            [nextVersion, nowIso, newExpiresAt, roomId]
          );

          await client.query(
            `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
             VALUES ($1, $2, 'VOTE_RECORDED', $3, false, 0, false, $4);`,
            [roomId, nextVersion, JSON.stringify({ participantId }), nowIso]
          );

          return {
            vote: normalizeVote(recordedVote),
            room: normalizeRoom(updatedRoomRes.rows[0]),
            isMatched: false,
          };
        }
      } else {
        // SKIP vote: check if all candidates have been voted by all members
        const totalVotesRes = await client.query(
          "SELECT COUNT(*)::int as count FROM votes WHERE round_id = $1;",
          [roundId]
        );
        const totalVotes = Number(totalVotesRes.rows[0].count);
        const maxVotes = room.participant_count * 20;

        if (totalVotes >= maxVotes) {
          assertValidTransition(room.status, "EXHAUSTED", "All candidates voted without match");

          const updatedRoomRes = await client.query(
            `UPDATE rooms
             SET status = 'EXHAUSTED', state_version = $1, last_activity_at = $2, expires_at = $3, updated_at = $2
             WHERE id = $4
             RETURNING *;`,
            [nextVersion, nowIso, newExpiresAt, roomId]
          );

          await client.query(
            `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
             VALUES ($1, $2, 'DECK_EXHAUSTED', $3, false, 0, false, $4);`,
            [roomId, nextVersion, JSON.stringify({ roundId, totalVotes }), nowIso]
          );

          return {
            vote: normalizeVote(recordedVote),
            room: normalizeRoom(updatedRoomRes.rows[0]),
            isMatched: false,
          };
        } else {
          const updatedRoomRes = await client.query(
            `UPDATE rooms
             SET state_version = $1, last_activity_at = $2, expires_at = $3, updated_at = $2
             WHERE id = $4
             RETURNING *;`,
            [nextVersion, nowIso, newExpiresAt, roomId]
          );

          await client.query(
            `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
             VALUES ($1, $2, 'VOTE_RECORDED', $3, false, 0, false, $4);`,
            [roomId, nextVersion, JSON.stringify({ participantId }), nowIso]
          );

          return {
            vote: normalizeVote(recordedVote),
            room: normalizeRoom(updatedRoomRes.rows[0]),
            isMatched: false,
          };
        }
      }
    });
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    return this.withClient(async (client) => {
      const res = await client.query("SELECT * FROM rooms WHERE id = $1 LIMIT 1;", [roomId]);
      if (res.rows.length === 0) return null;
      return normalizeRoom(res.rows[0]);
    });
  }

  async getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null> {
    return this.withClient(async (client) => {
      const res = await client.query(
        "SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
        [roomId, participantId]
      );
      if (res.rows.length === 0) return null;
      return normalizeParticipant(res.rows[0]);
    });
  }

  async getParticipantsByRoom(roomId: string): Promise<RoomParticipant[]> {
    return this.withClient(async (client) => {
      const res = await client.query(
        "SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at ASC, participant_id ASC;",
        [roomId]
      );
      return res.rows.map((row) => normalizeParticipant(row));
    });
  }

  async getRoundById(roundId: string): Promise<Round | null> {
    return this.withClient(async (client) => {
      const res = await client.query("SELECT * FROM rounds WHERE id = $1 LIMIT 1;", [roundId]);
      if (res.rows.length === 0) return null;
      return normalizeRound(res.rows[0]);
    });
  }

  async getCandidatesByRound(roundId: string): Promise<Candidate[]> {
    return this.withClient(async (client) => {
      const res = await client.query(
        "SELECT * FROM candidates WHERE round_id = $1 ORDER BY position ASC;",
        [roundId]
      );
      return res.rows.map(normalizeCandidate);
    });
  }

  async getVotesByRound(roundId: string): Promise<Vote[]> {
    return this.withClient(async (client) => {
      const res = await client.query("SELECT * FROM votes WHERE round_id = $1 ORDER BY created_at ASC;", [roundId]);
      return res.rows.map(normalizeVote);
    });
  }

  async getRoomEvents(roomId: string): Promise<RoomEvent[]> {
    return this.withClient(async (client) => {
      const res = await client.query(
        "SELECT * FROM room_events WHERE room_id = $1 ORDER BY version ASC;",
        [roomId]
      );
      return res.rows.map(normalizeRoomEvent);
    });
  }
}
