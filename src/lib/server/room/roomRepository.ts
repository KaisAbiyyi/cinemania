import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import {
  Room,
  RoomParticipant,
  Round,
  RoundParticipant,
  Candidate,
  Vote,
  RoomEvent,
  VoteType,
  MIN_PARTICIPANTS,
  MAX_PARTICIPANTS,
  DEFAULT_INACTIVITY_TTL_SECONDS,
  DECK_SIZE,
} from "@/db/schema";
import { CapabilityAuthError } from "../auth/guestCapability";
import {
  canonicalSerializeDeckFilter,
  resolveEffectiveRoomDeckFilter,
  type CanonicalRoomDeckFilter,
} from "@/lib/schemas/roomDeck";
import {
  assertValidTransition,
  DeckEmptyError,
  isRoomRecordExpired,
  validateStartRoundDeckBounds,
  validateStartRoundPrerequisites,
} from "./stateMachine";
import {
  DEFAULT_CODE_GENERATION_MAX_RETRIES,
  RoomCodeGenerationError,
  generateRoomCode,
} from "./roomCode";
import {
  evaluateDeckProgression,
  ImmutableVoteError,
  normalizeOperationId,
  OperationConflictError,
  VoterNotEligibleError,
  type DeckProgressionResult,
} from "./votingEngine";

export {
  generateRoomCode,
  RoomCodeGenerationError,
  ImmutableVoteError,
  OperationConflictError,
  VoterNotEligibleError,
  type DeckProgressionResult,
};

export interface CreateRoomOptions {
  hostParticipantId?: string;
  hostDisplayName: string;
  deckFilter?: Record<string, unknown>;
  inactivityTtlSeconds?: number;
  codeGenerator?: () => string;
  maxCodeAttempts?: number;
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

export type RoomCapacityErrorCode =
  | "ROOM_FULL"
  | "ROOM_NOT_JOINABLE"
  | "ROOM_JOIN_CONFLICT"
  | "INSUFFICIENT_PARTICIPANTS"
  | "ROOM_ALREADY_ACTIVE"
  | "ROOM_ALREADY_MATCHED"
  | "ROOM_ALREADY_EXHAUSTED"
  | "ROOM_NOT_ACTIVE"
  | "LOBBY_LEAVE_CLOSED"
  | "FILTER_LOCKED"
  | "DECK_FILTER_CONFLICT";

export interface LeaveLobbyResult {
  room: Room;
  participants: RoomParticipant[];
  leftParticipantId: string;
  roomClosed: boolean;
  hostTransferredTo: RoomParticipant | null;
}

export interface StartLobbyRoundOptions {
  candidates: CandidateInput[];
  deckFilter?: CanonicalRoomDeckFilter;
  expectedLobbyFilterJson?: string | null;
  deckSeed?: string;
}

export interface StartLobbyRoundResult {
  room: Room;
  round: Round;
  participants: RoomParticipant[];
  frozenParticipants: RoundParticipant[];
  candidates: Candidate[];
}

export interface UpdateDeckFilterResult {
  room: Room;
  participants: RoomParticipant[];
}

export interface RecordVoteOptions {
  operationId?: string | null;
}

export interface RecordVoteResult {
  vote: Vote;
  room: Room;
  isMatched: boolean;
  isExhausted: boolean;
  idempotentReplay: boolean;
  progression: DeckProgressionResult;
}

export function normalizeSqliteVote(row: Record<string, unknown>): Vote {
  return {
    id: String(row.id),
    room_id: String(row.room_id),
    round_id: String(row.round_id),
    participant_id: String(row.participant_id),
    candidate_id: String(row.candidate_id),
    movie_id: Number(row.movie_id),
    vote: row.vote as Vote["vote"],
    operation_id:
      row.operation_id !== undefined && row.operation_id !== null
        ? String(row.operation_id)
        : null,
    created_at: String(row.created_at),
  };
}

export function normalizeSqliteRoom(row: Record<string, unknown>): Room {
  let deckFilter: Record<string, unknown> | null = null;
  if (typeof row.deck_filter === "string" && row.deck_filter.trim() !== "") {
    try {
      const parsed = JSON.parse(row.deck_filter);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        deckFilter = parsed as Record<string, unknown>;
      }
    } catch {
      deckFilter = null;
    }
  } else if (row.deck_filter && typeof row.deck_filter === "object" && !Array.isArray(row.deck_filter)) {
    deckFilter = row.deck_filter as Record<string, unknown>;
  }

  return {
    id: String(row.id),
    code: String(row.code),
    status: row.status as Room["status"],
    host_participant_id: row.host_participant_id ? String(row.host_participant_id) : null,
    state_version: Number(row.state_version),
    participant_count: Number(row.participant_count),
    matched_movie_id:
      row.matched_movie_id !== null && row.matched_movie_id !== undefined
        ? Number(row.matched_movie_id)
        : null,
    current_round_id: row.current_round_id ? String(row.current_round_id) : null,
    deck_filter: deckFilter,
    inactivity_ttl_seconds: Number(row.inactivity_ttl_seconds),
    last_activity_at: String(row.last_activity_at),
    expires_at: String(row.expires_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function normalizeSqliteCandidate(row: Record<string, unknown>): Candidate {
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
    vote_average:
      row.vote_average !== null && row.vote_average !== undefined
        ? Number(row.vote_average)
        : null,
  };
}

export function assertValidUniqueRoundCandidates(
  participantCount: number,
  candidates: CandidateInput[]
): void {
  validateStartRoundDeckBounds(participantCount, candidates.length);
  const seenIds = new Set<number>();
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.movieId) || candidate.movieId <= 0) {
      throw new Error(`Invalid candidate movieId: ${String(candidate.movieId)}`);
    }
    if (typeof candidate.title !== "string" || candidate.title.trim().length === 0) {
      throw new Error(`Invalid candidate title for movieId ${candidate.movieId}: title must be non-empty.`);
    }
    if (seenIds.has(candidate.movieId)) {
      throw new Error(`Duplicate candidate movieId detected in round deck: ${candidate.movieId}`);
    }
    seenIds.add(candidate.movieId);
  }
}

export function computeCanonicalLobbyFilterJson(
  deckFilter: Record<string, unknown> | null | undefined
): string | null {
  if (!deckFilter) return null;
  return canonicalSerializeDeckFilter(resolveEffectiveRoomDeckFilter(deckFilter));
}

export class RoomCapacityError extends Error {
  public readonly code: RoomCapacityErrorCode;

  constructor(message = "Room capacity exceeded", code: RoomCapacityErrorCode = "ROOM_JOIN_CONFLICT") {
    super(message);
    this.name = "RoomCapacityError";
    this.code = code;
    Object.setPrototypeOf(this, RoomCapacityError.prototype);
  }
}

export class RoomExpiredError extends Error {
  public readonly status = 410;
  public readonly code = "ROOM_EXPIRED";

  constructor(message = "Room has expired") {
    super(message);
    this.name = "RoomExpiredError";
    Object.setPrototypeOf(this, RoomExpiredError.prototype);
  }
}

export class DuplicateVoteError extends Error {
  constructor(message = "Vote has already been recorded for this candidate by this participant") {
    super(message);
    this.name = "DuplicateVoteError";
  }
}

export class SqliteRoomRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  private runInImmediateTransaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // ignore rollback error when surfacing primary failure
      }
      throw err;
    }
  }

  private createRoomCore(options: CreateRoomOptions): { room: Room; host: RoomParticipant } {
    const roomId = crypto.randomUUID();
    const hostParticipantId = options.hostParticipantId || crypto.randomUUID();
    const ttlSeconds = options.inactivityTtlSeconds || DEFAULT_INACTIVITY_TTL_SECONDS;
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();

    const codeGenerator = options.codeGenerator ?? generateRoomCode;
    const maxAttempts = Math.max(1, options.maxCodeAttempts ?? DEFAULT_CODE_GENERATION_MAX_RETRIES);
    // Collision retry loop for 6-character room code
    let roomCode = "";
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      const candidateCode = codeGenerator();
      const existing = this.db
        .prepare(`SELECT 1 FROM rooms WHERE code = ?`)
        .get(candidateCode);
      if (!existing) {
        roomCode = candidateCode;
        break;
      }
    }
    if (!roomCode) {
      throw new RoomCodeGenerationError(
        `Failed to generate unique room code after ${maxAttempts} attempts`
      );
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

    const room = this.getRoomById(roomId)!;
    const host = this.getParticipant(roomId, hostParticipantId)!;
    return { room, host };
  }

  private joinRoomCore(
    roomId: string,
    participantId: string,
    displayName: string,
    beforeJoinLocked?: (room: Room) => void
  ): { room: Room; participant: RoomParticipant; rejoined: boolean } {
    const now = new Date();
    const nowIso = now.toISOString();

    const room = this.getRoomById(roomId);
    if (!room) throw new RoomNotFoundError(`Room ${roomId} does not exist.`);

    if (isRoomRecordExpired(room, now)) {
      throw new RoomExpiredError(`Room '${room.code}' has expired.`);
    }

    beforeJoinLocked?.(room);

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
      const updatedRoom = this.getRoomById(roomId)!;
      const updatedParticipant = this.getParticipant(roomId, participantId)!;
      return {
        room: updatedRoom,
        participant: updatedParticipant,
        rejoined: true,
      };
    }

    // 2. Room lifecycle check
    if (room.status !== "LOBBY") {
      throw new RoomCapacityError(
        `Cannot join room: status is '${room.status}', but must be 'LOBBY'.`,
        "ROOM_NOT_JOINABLE"
      );
    }

    // 3. Capacity check: maximum 5 participants
    if (room.participant_count >= MAX_PARTICIPANTS) {
      throw new RoomCapacityError(
        `Room has reached maximum capacity of ${MAX_PARTICIPANTS} participants.`,
        "ROOM_FULL"
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

    return {
      room: this.getRoomById(roomId)!,
      participant: this.getParticipant(roomId, participantId)!,
      rejoined: false,
    };
  }

  /**
   * Creates a new room in LOBBY status and registers the host participant.
   * Uses safe nullable host_participant_id insertion flow to guarantee
   * full immediate foreign-key compatibility with PostgreSQL and SQLite.
   */
  createRoom(options: CreateRoomOptions): { room: Room; host: RoomParticipant } {
    return this.runInImmediateTransaction(() => this.createRoomCore(options));
  }

  /**
   * Executes room creation plus caller-supplied transactional follow-up work
   * (such as capability generation initialization and coherent roster read)
   * inside one atomic BEGIN IMMEDIATE transaction.
   */
  createRoomInTransaction<T>(
    options: CreateRoomOptions,
    afterRoomCreated: (created: { room: Room; host: RoomParticipant }) => T
  ): T {
    return this.runInImmediateTransaction(() => {
      const created = this.createRoomCore(options);
      return afterRoomCreated(created);
    });
  }

  /**
   * Joins an existing room in LOBBY status.
   * Idempotency lookup is executed BEFORE the capacity check so reconnecting
   * guests never receive a false 'Room is full' error.
   * Atomically extends expires_at by inactivity_ttl_seconds.
   */
  joinRoom(roomId: string, participantId: string, displayName: string): RoomParticipant {
    return this.runInImmediateTransaction(
      () => this.joinRoomCore(roomId, participantId, displayName).participant
    );
  }

  /**
   * Executes join/reconnect plus locked capability verification, generation
   * initialization, and coherent snapshot read inside one BEGIN IMMEDIATE transaction.
   */
  joinRoomInTransaction<T>(
    roomId: string,
    participantId: string,
    displayName: string,
    callbacks: {
      beforeJoinLocked?: (room: Room) => void;
      afterJoin: (joined: { room: Room; participant: RoomParticipant; rejoined: boolean }) => T;
    }
  ): T {
    return this.runInImmediateTransaction(() => {
      const joined = this.joinRoomCore(roomId, participantId, displayName, callbacks.beforeJoinLocked);
      return callbacks.afterJoin(joined);
    });
  }

  private hasRoundParticipantsTable(): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'round_participants' LIMIT 1;`)
      .get();
    return Boolean(row);
  }

  private hasVotesOperationIdColumn(): boolean {
    const columns = this.db.prepare(`PRAGMA table_info(votes);`).all() as Array<{ name?: string }>;
    return columns.some((col) => col.name === "operation_id");
  }

  private getRoundParticipantsInternal(roomId: string, roundId: string): RoundParticipant[] {
    if (!this.hasRoundParticipantsTable()) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM round_participants
         WHERE room_id = ? AND round_id = ?
         ORDER BY joined_at ASC, participant_id ASC;`
      )
      .all(roomId, roundId);
    return rows as unknown as RoundParticipant[];
  }

  private resolveEligibleVoterIds(roomId: string, roundId: string): Set<string> {
    if (this.hasRoundParticipantsTable()) {
      const frozen = this.getRoundParticipantsInternal(roomId, roundId);
      if (frozen.length > 0) {
        return new Set(frozen.map((participant) => participant.participant_id));
      }
    }
    const activeMembers = this.getParticipantsByRoom(roomId);
    return new Set(activeMembers.map((participant) => participant.participant_id));
  }

  private leaveLobbyCore(
    roomId: string,
    participantId: string,
    beforeLeaveLocked?: (room: Room) => void
  ): LeaveLobbyResult {
    const now = new Date();
    const nowIso = now.toISOString();

    const room = this.getRoomById(roomId);
    if (!room) {
      throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
    }
    if (isRoomRecordExpired(room, now)) {
      throw new RoomExpiredError(`Room '${room.code}' has expired.`);
    }

    if (beforeLeaveLocked) {
      beforeLeaveLocked(room);
    }

    const participant = this.getParticipant(roomId, participantId);
    if (!participant) {
      throw new CapabilityAuthError(
        403,
        "PARTICIPANT_NOT_IN_ROOM",
        "Guest is not a member of this room."
      );
    }

    if (room.status !== "LOBBY") {
      throw new RoomCapacityError(
        `Cannot leave lobby roster: room status is '${room.status}', not 'LOBBY'. Frozen voter roster is locked.`,
        "LOBBY_LEAVE_CLOSED"
      );
    }

    const participants = this.getParticipantsByRoom(roomId);
    if (participants.length <= 1) {
      assertValidTransition(room.status, "EXPIRED", "Last participant left lobby");
      const nextVersion = room.state_version + 1;

      this.db
        .prepare(
          `UPDATE room_participants
           SET is_connected = 0, last_seen_at = ?
           WHERE room_id = ? AND participant_id = ?;`
        )
        .run(nowIso, roomId, participantId);

      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'EXPIRED', state_version = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?;`
        )
        .run(nextVersion, nowIso, nowIso, nowIso, roomId);

      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'ROOM_EXPIRED', ?, 0, 0, 0, ?);`
        )
        .run(
          roomId,
          nextVersion,
          JSON.stringify({ reason: "LAST_PARTICIPANT_LEFT", participantId }),
          nowIso
        );

      return {
        room: this.getRoomById(roomId)!,
        participants: this.getParticipantsByRoom(roomId),
        leftParticipantId: participantId,
        roomClosed: true,
        hostTransferredTo: null,
      };
    }

    const remaining = participants.filter(
      (p) => p.participant_id.toLowerCase() !== participantId.toLowerCase()
    );
    const wasHost =
      room.host_participant_id?.toLowerCase() === participantId.toLowerCase();
    const nextHost = wasHost ? remaining[0] ?? null : null;

    this.db
      .prepare(`DELETE FROM room_participants WHERE room_id = ? AND participant_id = ?;`)
      .run(roomId, participantId);

    if (nextHost) {
      this.db
        .prepare(
          `UPDATE room_participants SET role = 'HOST' WHERE room_id = ? AND participant_id = ?;`
        )
        .run(roomId, nextHost.participant_id);
    }

    const leaveVersion = room.state_version + 1;
    const finalVersion = nextHost ? room.state_version + 2 : leaveVersion;
    const newExpiresAt = new Date(
      now.getTime() + room.inactivity_ttl_seconds * 1000
    ).toISOString();
    const nextHostId = nextHost ? nextHost.participant_id : room.host_participant_id;

    this.db
      .prepare(
        `UPDATE rooms
         SET host_participant_id = ?, participant_count = ?, state_version = ?,
             last_activity_at = ?, expires_at = ?, updated_at = ?
         WHERE id = ?;`
      )
      .run(
        nextHostId,
        remaining.length,
        finalVersion,
        nowIso,
        newExpiresAt,
        nowIso,
        roomId
      );

    this.db
      .prepare(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES (?, ?, 'PARTICIPANT_LEFT', ?, 0, 0, 0, ?);`
      )
      .run(
        roomId,
        leaveVersion,
        JSON.stringify({
          displayName: participant.display_name,
          participantCount: remaining.length,
          hostTransferred: Boolean(nextHost),
        }),
        nowIso
      );

    if (nextHost) {
      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'HOST_TRANSFERRED', ?, 0, 0, 0, ?);`
        )
        .run(
          roomId,
          finalVersion,
          JSON.stringify({
            newHostDisplayName: nextHost.display_name,
            participantCount: remaining.length,
          }),
          nowIso
        );
    }

    return {
      room: this.getRoomById(roomId)!,
      participants: this.getParticipantsByRoom(roomId),
      leftParticipantId: participantId,
      roomClosed: false,
      hostTransferredTo: nextHost
        ? this.getParticipant(roomId, nextHost.participant_id)
        : null,
    };
  }

  leaveLobby(roomId: string, participantId: string): LeaveLobbyResult {
    return this.runInImmediateTransaction(() =>
      this.leaveLobbyCore(roomId, participantId)
    );
  }

  leaveLobbyInTransaction<T>(
    roomId: string,
    participantId: string,
    callbacks: {
      beforeLeaveLocked?: (room: Room) => void;
      afterLeave: (left: LeaveLobbyResult) => T;
    }
  ): T {
    return this.runInImmediateTransaction(() => {
      const left = this.leaveLobbyCore(roomId, participantId, callbacks.beforeLeaveLocked);
      return callbacks.afterLeave(left);
    });
  }

  private updateRoomDeckFilterCore(
    roomId: string,
    actorParticipantId: string,
    deckFilter: CanonicalRoomDeckFilter,
    beforeUpdateLocked?: (room: Room) => void
  ): UpdateDeckFilterResult {
    const now = new Date();
    const nowIso = now.toISOString();

    const room = this.getRoomById(roomId);
    if (!room) {
      throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
    }
    if (isRoomRecordExpired(room, now)) {
      throw new RoomExpiredError(`Room '${room.code}' has expired.`);
    }

    if (beforeUpdateLocked) {
      beforeUpdateLocked(room);
    }

    const actor = this.getParticipant(roomId, actorParticipantId);
    if (!actor) {
      throw new CapabilityAuthError(
        403,
        "PARTICIPANT_NOT_IN_ROOM",
        "Guest is not a member of this room."
      );
    }

    const authoritativeIsHost =
      actor.role === "HOST" &&
      room.host_participant_id?.toLowerCase() === actor.participant_id.toLowerCase();
    if (!authoritativeIsHost) {
      throw new CapabilityAuthError(
        403,
        "HOST_ONLY_ACTION",
        "Only the room host can update room filters."
      );
    }

    if (room.status !== "LOBBY") {
      throw new RoomCapacityError(
        `Cannot update filters: room status is '${room.status}', filters lock once round starts.`,
        "FILTER_LOCKED"
      );
    }

    const nextVersion = room.state_version + 1;
    const newExpiresAt = new Date(
      now.getTime() + room.inactivity_ttl_seconds * 1000
    ).toISOString();

    this.db
      .prepare(
        `UPDATE rooms
         SET deck_filter = ?, state_version = ?,
             last_activity_at = ?, expires_at = ?, updated_at = ?
         WHERE id = ?;`
      )
      .run(JSON.stringify(deckFilter), nextVersion, nowIso, newExpiresAt, nowIso, roomId);

    this.db
      .prepare(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES (?, ?, 'DECK_FILTER_UPDATED', ?, 0, 0, 0, ?);`
      )
      .run(roomId, nextVersion, JSON.stringify({ deckFilter }), nowIso);

    return {
      room: this.getRoomById(roomId)!,
      participants: this.getParticipantsByRoom(roomId),
    };
  }

  updateRoomDeckFilter(
    roomId: string,
    actorParticipantId: string,
    deckFilter: CanonicalRoomDeckFilter
  ): UpdateDeckFilterResult {
    return this.runInImmediateTransaction(() =>
      this.updateRoomDeckFilterCore(roomId, actorParticipantId, deckFilter)
    );
  }

  updateRoomDeckFilterInTransaction<T>(
    roomId: string,
    actorParticipantId: string,
    deckFilter: CanonicalRoomDeckFilter,
    callbacks: {
      beforeUpdateLocked?: (room: Room) => void;
      afterUpdate: (updated: UpdateDeckFilterResult) => T;
    }
  ): T {
    return this.runInImmediateTransaction(() => {
      const updated = this.updateRoomDeckFilterCore(
        roomId,
        actorParticipantId,
        deckFilter,
        callbacks.beforeUpdateLocked
      );
      return callbacks.afterUpdate(updated);
    });
  }

  private startLobbyRoundCore(
    roomId: string,
    actorParticipantId: string,
    beforeStartLocked?: (room: Room) => void,
    options?: StartLobbyRoundOptions
  ): StartLobbyRoundResult {
    const now = new Date();
    const nowIso = now.toISOString();

    const room = this.getRoomById(roomId);
    if (!room) {
      throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
    }
    if (isRoomRecordExpired(room, now)) {
      throw new RoomExpiredError(`Room '${room.code}' has expired.`);
    }

    if (beforeStartLocked) {
      beforeStartLocked(room);
    }

    const actor = this.getParticipant(roomId, actorParticipantId);
    if (!actor) {
      throw new CapabilityAuthError(
        403,
        "PARTICIPANT_NOT_IN_ROOM",
        "Guest is not a member of this room."
      );
    }

    const authoritativeIsHost =
      actor.role === "HOST" &&
      room.host_participant_id?.toLowerCase() === actor.participant_id.toLowerCase();
    if (!authoritativeIsHost) {
      throw new CapabilityAuthError(
        403,
        "HOST_ONLY_ACTION",
        "Only the room host can perform this action."
      );
    }

    if (room.status !== "LOBBY") {
      throw new RoomCapacityError(
        `Cannot start round: room status is '${room.status}', but must be 'LOBBY'.`,
        "ROOM_ALREADY_ACTIVE"
      );
    }

    const participants = this.getParticipantsByRoom(roomId);
    if (participants.length !== room.participant_count) {
      throw new CapabilityAuthError(
        500,
        "SNAPSHOT_INCOHERENT",
        `Incoherent room snapshot: participant_count (${room.participant_count}) does not match participant roster (${participants.length}).`
      );
    }

    if (participants.length < MIN_PARTICIPANTS) {
      throw new RoomCapacityError(
        `Cannot start round: at least ${MIN_PARTICIPANTS} participants required (current: ${participants.length}).`,
        "INSUFFICIENT_PARTICIPANTS"
      );
    }
    if (participants.length > MAX_PARTICIPANTS) {
      throw new RoomCapacityError(
        `Cannot start round: maximum allowed participants is ${MAX_PARTICIPANTS} (current: ${participants.length}).`,
        "ROOM_FULL"
      );
    }

    if (options?.expectedLobbyFilterJson !== undefined) {
      const currentLobbyFilterJson = computeCanonicalLobbyFilterJson(room.deck_filter);
      if (currentLobbyFilterJson !== options.expectedLobbyFilterJson) {
        throw new RoomCapacityError(
          "Room filters changed before starting round. Retry starting with the updated filters.",
          "DECK_FILTER_CONFLICT"
        );
      }
    }

    const candidatesInput = options?.candidates;
    if (!Array.isArray(candidatesInput)) {
      throw new DeckEmptyError(
        "Cannot start active round without validated deck candidates."
      );
    }
    assertValidUniqueRoundCandidates(participants.length, candidatesInput);

    const maxRoundRow = this.db
      .prepare(`SELECT COALESCE(MAX(round_number), 0) AS max_round FROM rounds WHERE room_id = ?;`)
      .get(roomId) as unknown as { max_round: number } | undefined;
    const roundNumber = Number(maxRoundRow?.max_round ?? 0) + 1;
    const roundId = crypto.randomUUID();

    this.db
      .prepare(
        `INSERT INTO rounds (id, room_id, round_number, status, started_at)
         VALUES (?, ?, ?, 'ACTIVE', ?);`
      )
      .run(roundId, roomId, roundNumber, nowIso);

    const insertFrozenStmt = this.db.prepare(
      `INSERT INTO round_participants (room_id, round_id, participant_id, frozen_role, joined_at, frozen_at)
       VALUES (?, ?, ?, ?, ?, ?);`
    );
    for (const member of participants) {
      insertFrozenStmt.run(
        roomId,
        roundId,
        member.participant_id,
        member.role,
        member.joined_at,
        nowIso
      );
    }

    const insertCandidateStmt = this.db.prepare(
      `INSERT INTO candidates (
        id, round_id, room_id, movie_id, position, title, poster_path, overview, release_date, vote_average
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    );
    for (let i = 0; i < candidatesInput.length; i += 1) {
      const c = candidatesInput[i];
      insertCandidateStmt.run(
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

    const freezeVersion = room.state_version + 1;
    const startVersion = room.state_version + 2;
    const newExpiresAt = new Date(
      now.getTime() + room.inactivity_ttl_seconds * 1000
    ).toISOString();

    if (options?.deckFilter) {
      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'ACTIVE', current_round_id = ?, state_version = ?,
               deck_filter = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?;`
        )
        .run(
          roundId,
          startVersion,
          JSON.stringify(options.deckFilter),
          nowIso,
          newExpiresAt,
          nowIso,
          roomId
        );
    } else {
      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'ACTIVE', current_round_id = ?, state_version = ?,
               last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?;`
        )
        .run(roundId, startVersion, nowIso, newExpiresAt, nowIso, roomId);
    }

    this.db
      .prepare(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES (?, ?, 'ROSTER_FROZEN', ?, 0, 0, 0, ?);`
      )
      .run(
        roomId,
        freezeVersion,
        JSON.stringify({
          roundId,
          roundNumber,
          frozenQuorum: participants.length,
          frozenParticipantIds: participants.map((p) => p.participant_id),
        }),
        nowIso
      );

    this.db
      .prepare(
        `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
         VALUES (?, ?, 'ROUND_STARTED', ?, 0, 0, 0, ?);`
      )
      .run(
        roomId,
        startVersion,
        JSON.stringify({
          roundId,
          roundNumber,
          frozenQuorum: participants.length,
          deckSize: candidatesInput.length,
          expectedDeckSize: DECK_SIZE,
          isShortage: candidatesInput.length < DECK_SIZE,
          ...(options?.deckFilter ? { deckFilter: options.deckFilter } : {}),
          ...(options?.deckSeed ? { deckSeed: options.deckSeed } : {}),
        }),
        nowIso
      );

    return {
      room: this.getRoomById(roomId)!,
      round: this.getRoundById(roundId)!,
      participants: this.getParticipantsByRoom(roomId),
      frozenParticipants: this.getRoundParticipantsInternal(roomId, roundId),
      candidates: this.getCandidatesByRound(roundId, roomId),
    };
  }

  startLobbyRound(
    roomId: string,
    actorParticipantId: string,
    options: StartLobbyRoundOptions
  ): StartLobbyRoundResult {
    return this.runInImmediateTransaction(() =>
      this.startLobbyRoundCore(roomId, actorParticipantId, undefined, options)
    );
  }

  startLobbyRoundInTransaction<T>(
    roomId: string,
    actorParticipantId: string,
    callbacks: {
      options: StartLobbyRoundOptions;
      beforeStartLocked?: (room: Room) => void;
      afterStart: (started: StartLobbyRoundResult) => T;
    }
  ): T {
    return this.runInImmediateTransaction(() => {
      const started = this.startLobbyRoundCore(
        roomId,
        actorParticipantId,
        callbacks.beforeStartLocked,
        callbacks.options
      );
      return callbacks.afterStart(started);
    });
  }

  /**
   * Reads room, ordered participant roster, frozen round voters, and ordered deck candidates within a single SQLite read transaction.
   */
  getConsistentSnapshot(roomId: string): {
    room: Room;
    participants: RoomParticipant[];
    roundParticipants: RoundParticipant[];
    candidates: Candidate[];
    votes: Vote[];
  } | null {
    this.db.exec("BEGIN;");
    try {
      const room = this.getRoomById(roomId);
      if (!room) {
        this.db.exec("COMMIT;");
        return null;
      }
      const participants = this.getParticipantsByRoom(roomId);
      const roundParticipants = room.current_round_id
        ? this.getRoundParticipantsInternal(roomId, room.current_round_id)
        : [];
      const candidates = room.current_round_id
        ? this.getCandidatesByRound(room.current_round_id, roomId)
        : [];
      const votes = room.current_round_id
        ? this.getVotesByRound(room.current_round_id, roomId)
        : [];
      this.db.exec("COMMIT;");
      return { room, participants, roundParticipants, candidates, votes };
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        // ignore
      }
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
      const participants = this.getParticipantsByRoom(roomId);
      validateStartRoundPrerequisites(participants.length, candidates.length);

      // Insert Round
      this.db
        .prepare(
          `INSERT INTO rounds (id, room_id, round_number, status, started_at)
           VALUES (?, ?, 1, 'ACTIVE', ?)`
        )
        .run(roundId, roomId, nowIso);

      // Freeze voter roster in round_participants when migration 003+ is active
      if (this.hasRoundParticipantsTable()) {
        const freezeStmt = this.db.prepare(
          `INSERT OR IGNORE INTO round_participants (room_id, round_id, participant_id, frozen_role, joined_at, frozen_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const p of participants) {
          freezeStmt.run(roomId, roundId, p.participant_id, p.role, p.joined_at, nowIso);
        }
      }

      // Insert candidates with exact positions 0..N-1
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

  private recordVoteCore(
    roomId: string,
    roundId: string | null,
    participantId: string,
    candidateId: string,
    movieId: number,
    vote: VoteType,
    options?: RecordVoteOptions,
    beforeVoteLocked?: (room: Room) => void
  ): RecordVoteResult {
    const now = new Date();
    const nowIso = now.toISOString();
    const operationId = normalizeOperationId(options?.operationId, "operationId");

    const room = this.getRoomById(roomId);
    if (!room) {
      throw new RoomNotFoundError(`Room ${roomId} does not exist.`);
    }
    if (isRoomRecordExpired(room, now)) {
      throw new RoomExpiredError(`Room '${room.code}' has expired.`);
    }

    if (beforeVoteLocked) {
      beforeVoteLocked(room);
    }

    if (room.status === "EXPIRED") {
      throw new RoomExpiredError(`Room '${room.code}' has expired.`);
    }
    if (room.status === "LOBBY" || !room.current_round_id) {
      throw new RoomCapacityError(
        `Cannot record vote: room status is '${room.status}', round has not started.`,
        "ROOM_NOT_ACTIVE"
      );
    }
    if (roundId !== null && room.current_round_id !== roundId) {
      throw new RoundNotFoundError(
        `Round ${roundId} is not the active round for room ${roomId}`
      );
    }
    const targetRoundId = room.current_round_id;

    // Referential integrity verification under room lock
    const participant = this.getParticipant(roomId, participantId);
    if (!participant) {
      throw new ParticipantNotFoundError(
        `Participant ${participantId} is not a member of room ${roomId}`
      );
    }

    const eligibleVoterIds = this.resolveEligibleVoterIds(roomId, targetRoundId);
    if (!eligibleVoterIds.has(participantId)) {
      throw new VoterNotEligibleError(
        `Participant ${participantId} is not in the frozen voter roster for round ${targetRoundId}.`
      );
    }

    const supportsOperationId = this.hasVotesOperationIdColumn();
    if (operationId !== null && supportsOperationId) {
      const existingByOpRow = this.db
        .prepare(
          `SELECT * FROM votes
           WHERE round_id = ? AND participant_id = ? AND operation_id = ?
           LIMIT 1;`
        )
        .get(targetRoundId, participantId, operationId) as
        | Record<string, unknown>
        | undefined;

      if (existingByOpRow) {
        const existingByOp = normalizeSqliteVote(existingByOpRow);
        if (
          existingByOp.candidate_id !== candidateId ||
          existingByOp.movie_id !== movieId ||
          existingByOp.vote !== vote
        ) {
          throw new OperationConflictError(
            `operationId '${operationId}' was already used for different vote parameters.`
          );
        }

        const allCandidates = this.getCandidatesByRound(targetRoundId, roomId);
        const allVotes = this.getVotesByRound(targetRoundId, roomId);
        const progression = evaluateDeckProgression(
          allCandidates,
          allVotes,
          eligibleVoterIds
        );

        return {
          vote: existingByOp,
          room,
          isMatched:
            room.status === "MATCHED" &&
            existingByOp.movie_id === room.matched_movie_id,
          isExhausted: room.status === "EXHAUSTED",
          idempotentReplay: true,
          progression,
        };
      }
    }

    // Validate candidate belongs to this room + round + movieId
    const candidateRow = this.db
      .prepare(
        `SELECT * FROM candidates WHERE id = ? AND round_id = ? AND room_id = ? AND movie_id = ?`
      )
      .get(candidateId, targetRoundId, roomId, movieId);

    if (!candidateRow) {
      throw new CandidateNotFoundError(
        `Candidate ${candidateId} does not match movie ${movieId} in round ${targetRoundId}`
      );
    }

    // Check existing vote for this participant & candidate/movie in this round
    const existingVoteRow = this.db
      .prepare(
        `SELECT * FROM votes
         WHERE round_id = ? AND participant_id = ? AND (candidate_id = ? OR movie_id = ?)
         LIMIT 1;`
      )
      .get(targetRoundId, participantId, candidateId, movieId) as
      | Record<string, unknown>
      | undefined;

    if (existingVoteRow) {
      const existingVote = normalizeSqliteVote(existingVoteRow);
      if (existingVote.vote !== vote) {
        throw new ImmutableVoteError(
          `Participant ${participantId} has already voted ${existingVote.vote} on candidate ${candidateId}.`
        );
      }

      const allCandidates = this.getCandidatesByRound(targetRoundId, roomId);
      const allVotes = this.getVotesByRound(targetRoundId, roomId);
      const progression = evaluateDeckProgression(
        allCandidates,
        allVotes,
        eligibleVoterIds
      );

      return {
        vote: existingVote,
        room,
        isMatched:
          room.status === "MATCHED" &&
          existingVote.movie_id === room.matched_movie_id,
        isExhausted: room.status === "EXHAUSTED",
        idempotentReplay: true,
        progression,
      };
    }

    if (room.status === "MATCHED") {
      throw new RoomCapacityError(
        `Cannot record vote: room is already MATCHED on movie ${room.matched_movie_id}.`,
        "ROOM_ALREADY_MATCHED"
      );
    }
    if (room.status === "EXHAUSTED") {
      throw new RoomCapacityError(
        `Cannot record vote: round deck is already EXHAUSTED.`,
        "ROOM_ALREADY_EXHAUSTED"
      );
    }
    if (room.status !== "ACTIVE") {
      throw new RoomCapacityError(
        `Cannot record vote: room status is '${room.status}', but must be 'ACTIVE'.`,
        "ROOM_NOT_ACTIVE"
      );
    }

    const voteId = crypto.randomUUID();
    if (supportsOperationId) {
      this.db
        .prepare(
          `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, operation_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          voteId,
          roomId,
          targetRoundId,
          participantId,
          candidateId,
          movieId,
          vote,
          operationId,
          nowIso
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(voteId, roomId, targetRoundId, participantId, candidateId, movieId, vote, nowIso);
    }

    const allCandidates = this.getCandidatesByRound(targetRoundId, roomId);
    const allVotes = this.getVotesByRound(targetRoundId, roomId);
    const progression = evaluateDeckProgression(allCandidates, allVotes, eligibleVoterIds);

    const nextVersion = room.state_version + 1;
    const newExpiresAt = new Date(
      now.getTime() + room.inactivity_ttl_seconds * 1000
    ).toISOString();

    let isMatched = false;
    let isExhausted = false;

    if (progression.nextStatus === "MATCHED" && progression.matchedMovieId !== null) {
      assertValidTransition(room.status, "MATCHED", "Unanimous consensus achieved");
      isMatched = true;

      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'MATCHED', matched_movie_id = ?, state_version = ?,
               last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(progression.matchedMovieId, nextVersion, nowIso, newExpiresAt, nowIso, roomId);

      this.db
        .prepare(
          `UPDATE rounds SET status = 'COMPLETED', completed_at = ? WHERE id = ? AND status = 'ACTIVE'`
        )
        .run(nowIso, targetRoundId);

      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'MATCH_ANNOUNCED', ?, 0, 0, 0, ?)`
        )
        .run(
          roomId,
          nextVersion,
          JSON.stringify({
            movieId: progression.matchedMovieId,
            candidateId: progression.matchedCandidate?.id ?? candidateId,
            roundId: targetRoundId,
            unanimousCount: eligibleVoterIds.size,
          }),
          nowIso
        );
    } else if (progression.nextStatus === "EXHAUSTED") {
      assertValidTransition(room.status, "EXHAUSTED", "All candidates voted without match");
      isExhausted = true;

      this.db
        .prepare(
          `UPDATE rooms
           SET status = 'EXHAUSTED', state_version = ?, last_activity_at = ?, expires_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(nextVersion, nowIso, newExpiresAt, nowIso, roomId);

      this.db
        .prepare(
          `UPDATE rounds SET status = 'COMPLETED', completed_at = ? WHERE id = ? AND status = 'ACTIVE'`
        )
        .run(nowIso, targetRoundId);

      this.db
        .prepare(
          `INSERT INTO room_events (room_id, version, event_type, payload, dispatched, retry_count, poison, created_at)
           VALUES (?, ?, 'DECK_EXHAUSTED', ?, 0, 0, 0, ?)`
        )
        .run(
          roomId,
          nextVersion,
          JSON.stringify({
            roundId: targetRoundId,
            totalVotes: allVotes.length,
            deckSize: allCandidates.length,
          }),
          nowIso
        );
    } else {
      // Secret vote guarantee (CINE-017/CINE-020): broadcast outbox event reveals ONLY participantId
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

    const updatedRoom = this.getRoomById(roomId)!;
    const recordedVote: Vote = {
      id: voteId,
      room_id: roomId,
      round_id: targetRoundId,
      participant_id: participantId,
      candidate_id: candidateId,
      movie_id: movieId,
      vote,
      operation_id: operationId,
      created_at: nowIso,
    };

    return {
      vote: recordedVote,
      room: updatedRoom,
      isMatched,
      isExhausted,
      idempotentReplay: false,
      progression,
    };
  }

  /**
   * Records a vote for a candidate in an active round against frozen round_participants.
   * Supports operationId idempotency, strict vote immutability (409 VOTE_IMMUTABLE),
   * and deterministic unanimous match or deck exhaustion transitions.
   */
  recordVote(
    roomId: string,
    roundId: string,
    participantId: string,
    candidateId: string,
    movieId: number,
    vote: VoteType,
    options?: RecordVoteOptions
  ): RecordVoteResult {
    return this.runInImmediateTransaction(() =>
      this.recordVoteCore(
        roomId,
        roundId,
        participantId,
        candidateId,
        movieId,
        vote,
        options
      )
    );
  }

  recordVoteInTransaction<T>(
    roomId: string,
    roundId: string | null,
    participantId: string,
    candidateId: string,
    movieId: number,
    vote: VoteType,
    callbacks: {
      options?: RecordVoteOptions;
      beforeVoteLocked?: (room: Room) => void;
      afterVote: (result: RecordVoteResult) => T;
    }
  ): T {
    return this.runInImmediateTransaction(() => {
      const result = this.recordVoteCore(
        roomId,
        roundId,
        participantId,
        candidateId,
        movieId,
        vote,
        callbacks.options,
        callbacks.beforeVoteLocked
      );
      return callbacks.afterVote(result);
    });
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
    const rows = this.db
      .prepare(
        `SELECT * FROM rooms WHERE status NOT IN ('MATCHED', 'EXHAUSTED', 'EXPIRED')`
      )
      .all() as unknown as Array<Record<string, unknown>>;
    return rows.map(normalizeSqliteRoom);
  }

  getRoomById(id: string): Room | null {
    const row = this.db.prepare(`SELECT * FROM rooms WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? normalizeSqliteRoom(row) : null;
  }

  getParticipant(roomId: string, participantId: string): RoomParticipant | null {
    const row = this.db
      .prepare(`SELECT * FROM room_participants WHERE room_id = ? AND participant_id = ?`)
      .get(roomId, participantId);
    return (row as unknown as RoomParticipant) || null;
  }

  getParticipantsByRoom(roomId: string): RoomParticipant[] {
    const rows = this.db
      .prepare(`SELECT * FROM room_participants WHERE room_id = ? ORDER BY joined_at ASC, participant_id ASC`)
      .all(roomId);
    return rows as unknown as RoomParticipant[];
  }

  getRoundParticipants(roomId: string, roundId: string): RoundParticipant[] {
    return this.getRoundParticipantsInternal(roomId, roundId);
  }

  getRoundById(id: string): Round | null {
    const row = this.db.prepare(`SELECT * FROM rounds WHERE id = ?`).get(id);
    return (row as unknown as Round) || null;
  }

  getCandidatesByRound(roundId: string, roomId?: string): Candidate[] {
    const rows = (
      roomId
        ? this.db
            .prepare(`SELECT * FROM candidates WHERE room_id = ? AND round_id = ? ORDER BY position ASC`)
            .all(roomId, roundId)
        : this.db
            .prepare(`SELECT * FROM candidates WHERE round_id = ? ORDER BY position ASC`)
            .all(roundId)
    ) as unknown as Array<Record<string, unknown>>;
    return rows.map(normalizeSqliteCandidate);
  }

  getVotesByRound(roundId: string, roomId?: string): Vote[] {
    const rows = (
      roomId
        ? this.db
            .prepare(`SELECT * FROM votes WHERE room_id = ? AND round_id = ? ORDER BY created_at ASC`)
            .all(roomId, roundId)
        : this.db
            .prepare(`SELECT * FROM votes WHERE round_id = ? ORDER BY created_at ASC`)
            .all(roundId)
    ) as unknown as Array<Record<string, unknown>>;
    return rows.map(normalizeSqliteVote);
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

