import { RoomStatus, DEFAULT_INACTIVITY_TTL_SECONDS, MIN_PARTICIPANTS, MAX_PARTICIPANTS, DECK_SIZE } from "@/db/schema";

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

/**
 * Authoritative Transition Table:
 * Maps each current state to its strictly permitted target states.
 */
const VALID_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  LOBBY: ["ACTIVE", "EXPIRED"],
  ACTIVE: ["MATCHED", "EXHAUSTED", "EXPIRED"],
  MATCHED: ["EXPIRED"],
  EXHAUSTED: ["EXPIRED"],
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
  if (candidateCount !== DECK_SIZE) {
    throw new Error(
      `Cannot start round: movie deck must contain exactly ${DECK_SIZE} titles (provided: ${candidateCount}).`
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
