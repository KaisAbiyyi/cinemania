import {
  Room,
  RoomParticipant,
  RoomStatus,
  DEFAULT_INACTIVITY_TTL_SECONDS,
  DEFAULT_RECONNECT_GRACE_SECONDS,
  MIN_PARTICIPANTS,
  MAX_PARTICIPANTS,
  DECK_SIZE,
} from "../../../db/schema";

export class InvalidStateTransitionError extends Error {
  readonly status = 409;
  readonly code = "INVALID_STATE_TRANSITION";
  readonly fromStatus: RoomStatus;
  readonly toStatus: RoomStatus;

  constructor(from: RoomStatus, to: RoomStatus, reason?: string) {
    super(
      `Impossible room state transition from '${from}' to '${to}'${reason ? `: ${reason}` : "."}`
    );
    this.name = "InvalidStateTransitionError";
    this.fromStatus = from;
    this.toStatus = to;
    Object.setPrototypeOf(this, InvalidStateTransitionError.prototype);
  }
}

export class RoomCapacityError extends Error {
  readonly status = 400;
  readonly code = "ROOM_CAPACITY_VIOLATION";

  constructor(message: string) {
    super(message);
    this.name = "RoomCapacityError";
    Object.setPrototypeOf(this, RoomCapacityError.prototype);
  }
}

export class DeckEmptyError extends Error {
  readonly status = 422;
  readonly code = "DECK_EMPTY";

  constructor(
    message = "No movies matched the selected room filters. Adjust filters and try starting again."
  ) {
    super(message);
    this.name = "DeckEmptyError";
    Object.setPrototypeOf(this, DeckEmptyError.prototype);
  }
}

export class RoomNotExhaustedError extends Error {
  readonly status = 409;
  readonly code = "ROOM_NOT_EXHAUSTED";

  constructor(
    message = "Retry is only available after a round finishes without a match (EXHAUSTED)."
  ) {
    super(message);
    this.name = "RoomNotExhaustedError";
    Object.setPrototypeOf(this, RoomNotExhaustedError.prototype);
  }
}

export class InvalidPresencePayloadError extends Error {
  readonly status = 400;
  readonly code = "INVALID_PRESENCE_PAYLOAD";

  constructor(message = "Presence payload must include boolean 'connected'.") {
    super(message);
    this.name = "InvalidPresencePayloadError";
    Object.setPrototypeOf(this, InvalidPresencePayloadError.prototype);
  }
}

/**
 * Authoritative Transition Table:
 * Maps each current state to its strictly permitted target states.
 */
const VALID_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  LOBBY: ["ACTIVE", "EXPIRED"],
  ACTIVE: ["MATCHED", "EXHAUSTED", "LOBBY", "EXPIRED"],
  MATCHED: ["EXPIRED"],
  EXHAUSTED: ["LOBBY", "ACTIVE", "EXPIRED"],
  EXPIRED: [], // Terminal state: no outbound transitions permitted
};

/**
 * Returns true if the requested state transition is permissible under the CineMatch state machine.
 */
export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  if (from === to) return true; // Idempotent no-op transition
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Asserts that a state transition is valid, throwing an InvalidStateTransitionError if impossible.
 */
export function assertValidTransition(from: RoomStatus, to: RoomStatus, reason?: string): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to, reason);
  }
}

/**
 * Validates requirements to start an ACTIVE round from LOBBY:
 * - Participant count must be between 2 and 5 (MVP small groups)
 * - Deck candidate count must equal exactly 20 titles
 */
export function validateStartRoundPrerequisites(participantCount: number, candidateCount: number): void {
  validateStartLobbyRoundPrerequisites(participantCount);
  if (candidateCount !== DECK_SIZE) {
    throw new Error(
      `Cannot start round: movie deck must contain exactly ${DECK_SIZE} titles (provided: ${candidateCount}).`
    );
  }
}

/**
 * Validates runtime deck bounds (1..DECK_SIZE unique candidates) when starting an ACTIVE round.
 * Throws recoverable DeckEmptyError (422) when 0 matching titles exist.
 */
export function validateStartRoundDeckBounds(participantCount: number, candidateCount: number): void {
  validateStartLobbyRoundPrerequisites(participantCount);
  if (!Number.isInteger(candidateCount) || candidateCount < 1) {
    throw new DeckEmptyError();
  }
  if (candidateCount > DECK_SIZE) {
    throw new RoomCapacityError(
      `Cannot start round: movie deck cannot exceed ${DECK_SIZE} titles (provided: ${candidateCount}).`
    );
  }
}

/**
 * Validates lobby roster bounds (2..5 participants) before freezing voters and entering ACTIVE.
 */
export function validateStartLobbyRoundPrerequisites(participantCount: number): void {
  if (participantCount < MIN_PARTICIPANTS) {
    throw new RoomCapacityError(
      `Cannot start round: at least ${MIN_PARTICIPANTS} participants required (current: ${participantCount}).`
    );
  }
  if (participantCount > MAX_PARTICIPANTS) {
    throw new RoomCapacityError(
      `Cannot start round: maximum allowed participants is ${MAX_PARTICIPANTS} (current: ${participantCount}).`
    );
  }
}

/**
 * Calculates the exact expiration Date given last activity timestamp and configurable TTL in seconds.
 */
export function calculateExpiryTimestamp(
  lastActivityDate: Date,
  ttlSeconds: number = DEFAULT_INACTIVITY_TTL_SECONDS
): Date {
  return new Date(lastActivityDate.getTime() + ttlSeconds * 1000);
}

/**
 * Evaluates whether a room is expired based on last activity and configurable inactivity TTL.
 */
export function isRoomExpired(
  lastActivityDate: Date,
  ttlSeconds: number = DEFAULT_INACTIVITY_TTL_SECONDS,
  now: Date = new Date()
): boolean {
  const expiry = calculateExpiryTimestamp(lastActivityDate, ttlSeconds);
  return now.getTime() >= expiry.getTime();
}

/**
 * Evaluates whether a persisted room record is already terminal EXPIRED
 * or past its explicit expires_at deadline.
 */
export function isRoomRecordExpired(
  room: Pick<Room, "status" | "expires_at">,
  now: Date = new Date()
): boolean {
  if (room.status === "EXPIRED") {
    return true;
  }
  const expiresAtMs = new Date(room.expires_at).getTime();
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();
}

/**
 * Calculates the 90-second reconnect grace deadline from disconnect timestamp.
 */
export function calculateGraceExpiryTimestamp(
  disconnectedAt: Date,
  graceSeconds: number = DEFAULT_RECONNECT_GRACE_SECONDS
): Date {
  return new Date(disconnectedAt.getTime() + graceSeconds * 1000);
}

/**
 * Returns true once a disconnected participant has reached or passed the reconnect grace window.
 */
export function isGraceExpired(
  lastSeenAt: string | Date,
  graceSeconds: number = DEFAULT_RECONNECT_GRACE_SECONDS,
  now: Date = new Date()
): boolean {
  const lastSeenMs =
    lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  if (!Number.isFinite(lastSeenMs)) {
    return false;
  }
  return now.getTime() >= lastSeenMs + graceSeconds * 1000;
}

/**
 * Deterministically selects the next host participant ordered by joined_at ASC, participant_id ASC.
 * Prefers connected members first; when requireConnected is true (timeout handoff), returns null
 * if no connected member exists.
 */
export function selectDeterministicHostSuccessor(
  participants: readonly RoomParticipant[],
  excludeParticipantId: string | null,
  options: { requireConnected?: boolean } = {}
): RoomParticipant | null {
  const normalizedExclude = excludeParticipantId?.toLowerCase() ?? null;
  const candidates = participants
    .filter((p) => p.participant_id.toLowerCase() !== normalizedExclude)
    .sort((a, b) => {
      const timeDiff = new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime();
      if (Number.isFinite(timeDiff) && timeDiff !== 0) {
        return timeDiff;
      }
      return a.participant_id.localeCompare(b.participant_id);
    });

  const connectedCandidate = candidates.find((p) => Boolean(p.is_connected));
  if (connectedCandidate) {
    return connectedCandidate;
  }
  return options.requireConnected ? null : candidates[0] ?? null;
}
