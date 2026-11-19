import {
  DEFAULT_RECONNECT_GRACE_SECONDS,
  type Room,
  type RoomEventType,
  type RoomParticipant,
  type RoomStatus,
  type RoundStatus,
} from "@/db/schema";
import {
  parseOptionalDeckFilterFromBody,
  type CanonicalRoomDeckFilter,
} from "@/lib/schemas/roomDeck";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";
import {
  assertValidTransition,
  calculateGraceExpiryTimestamp,
  InvalidPresencePayloadError,
  isGraceExpired,
  isRoomRecordExpired,
  selectDeterministicHostSuccessor,
} from "./stateMachine";
import { normalizeOperationId } from "./votingEngine";

export interface ParsedPresencePayload {
  connected: boolean;
}

export interface ParsedRetryRoundPayload {
  deckFilter?: CanonicalRoomDeckFilter;
  startRound: boolean;
  operationId: string | null;
}

export interface RoomFinishState {
  status: RoomStatus;
  code:
    | "LOBBY_READY"
    | "ROUND_CANCELLED"
    | "ROUND_ACTIVE"
    | "MATCH_FOUND"
    | "DECK_EXHAUSTED"
    | "ROOM_EXPIRED";
  reason: string | null;
  recoverable: boolean;
  retryAvailable: boolean;
  retryEndpoint: string | null;
  matchedMovieId: number | null;
  message: string;
}

export interface GraceTimeoutEventPlan {
  version: number;
  eventType: RoomEventType;
  payload: Record<string, unknown>;
}

export interface GraceTimeoutMutationPlan {
  changed: boolean;
  staleConnectedParticipantIds: string[];
  staleDisconnectTimestamps: Record<string, string>;
  timedOutParticipantIds: string[];
  timedOutEligibleVoterIds: string[];
  previousHostParticipantId: string | null;
  nextHost: RoomParticipant | null;
  cancelRound: boolean;
  cancelledRoundId: string | null;
  nextRoomStatus: RoomStatus;
  nextStateVersion: number;
  events: GraceTimeoutEventPlan[];
}

export function parsePresencePayload(body: Record<string, unknown>): ParsedPresencePayload {
  const allowedKeys = new Set(["connected"]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      throw new InvalidPresencePayloadError(`Unexpected presence field '${key}'.`);
    }
  }
  if (typeof body.connected !== "boolean") {
    throw new InvalidPresencePayloadError("Presence payload must include boolean 'connected'.");
  }
  return { connected: body.connected };
}

export function parseRetryRoundPayload(
  body: Record<string, unknown>,
  headerOperationId?: string | null
): ParsedRetryRoundPayload {
  const allowedKeys = new Set([
    "deckFilter",
    "filters",
    "startRound",
    "start",
    "mode",
    "operationId",
  ]);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      throw new CapabilityAuthError(
        400,
        "INVALID_REQUEST",
        `Unexpected field '${key}' in retry round payload.`
      );
    }
  }

  let startRound = false;
  if (body.startRound !== undefined) {
    if (typeof body.startRound !== "boolean") {
      throw new CapabilityAuthError(400, "INVALID_REQUEST", "startRound must be a boolean.");
    }
    startRound = body.startRound;
  } else if (body.start !== undefined) {
    if (typeof body.start !== "boolean") {
      throw new CapabilityAuthError(400, "INVALID_REQUEST", "start must be a boolean.");
    }
    startRound = body.start;
  } else if (body.mode !== undefined) {
    if (body.mode !== "lobby" && body.mode !== "start") {
      throw new CapabilityAuthError(
        400,
        "INVALID_REQUEST",
        "mode must be either 'lobby' or 'start'."
      );
    }
    startRound = body.mode === "start";
  }

  const normalizedHeaderOpId = normalizeOperationId(headerOperationId, "operationId header");
  const normalizedBodyOpId = normalizeOperationId(body.operationId, "operationId");
  if (
    normalizedHeaderOpId !== null &&
    normalizedBodyOpId !== null &&
    normalizedHeaderOpId !== normalizedBodyOpId
  ) {
    throw new CapabilityAuthError(
      400,
      "INVALID_REQUEST",
      "operationId in request header and body must match."
    );
  }

  const deckFilter = parseOptionalDeckFilterFromBody(body);
  return {
    ...(deckFilter ? { deckFilter } : {}),
    startRound,
    operationId: normalizedBodyOpId ?? normalizedHeaderOpId ?? null,
  };
}

/**
 * Computes a deterministic, race-free grace timeout plan for a room in LOBBY or ACTIVE state.
 * - Marks silent participants disconnected if optional `heartbeatStaleSeconds` elapsed.
 * - Transfers host deterministically when the current host's 90s grace expired and a connected
 *   successor exists (preserving joined_at ASC, participant_id ASC order).
 * - Cancels an incomplete ACTIVE round back to LOBBY when any frozen eligible voter's 90s
 *   reconnect grace has expired, without shrinking the frozen quorum.
 */
export function evaluateGraceTimeoutPlan(params: {
  room: Room;
  participants: readonly RoomParticipant[];
  eligibleVoterIds: ReadonlySet<string> | null;
  now: Date;
  graceSeconds?: number;
  heartbeatStaleSeconds?: number;
}): GraceTimeoutMutationPlan {
  const { room, participants, eligibleVoterIds, now } = params;
  const graceSeconds = params.graceSeconds ?? DEFAULT_RECONNECT_GRACE_SECONDS;
  const heartbeatStaleSeconds = params.heartbeatStaleSeconds;

  const noChange = (): GraceTimeoutMutationPlan => ({
    changed: false,
    staleConnectedParticipantIds: [],
    staleDisconnectTimestamps: {},
    timedOutParticipantIds: [],
    timedOutEligibleVoterIds: [],
    previousHostParticipantId: room.host_participant_id,
    nextHost: null,
    cancelRound: false,
    cancelledRoundId: null,
    nextRoomStatus: room.status,
    nextStateVersion: room.state_version,
    events: [],
  });

  if (isRoomRecordExpired(room, now)) {
    return noChange();
  }
  if (room.status !== "LOBBY" && room.status !== "ACTIVE") {
    return noChange();
  }

  const nowMs = now.getTime();
  const staleConnectedParticipantIds: string[] = [];
  const staleDisconnectTimestamps: Record<string, string> = {};
  const effectiveParticipants: RoomParticipant[] = participants.map((participant) => {
    const isConnected = Boolean(participant.is_connected);
    if (
      isConnected &&
      heartbeatStaleSeconds !== undefined &&
      heartbeatStaleSeconds > 0
    ) {
      const lastSeenMs = new Date(participant.last_seen_at).getTime();
      if (Number.isFinite(lastSeenMs) && nowMs >= lastSeenMs + heartbeatStaleSeconds * 1000) {
        const disconnectedAtIso = new Date(
          Math.min(nowMs, lastSeenMs + heartbeatStaleSeconds * 1000)
        ).toISOString();
        staleConnectedParticipantIds.push(participant.participant_id);
        staleDisconnectTimestamps[participant.participant_id] = disconnectedAtIso;
        return {
          ...participant,
          is_connected: false,
          last_seen_at: disconnectedAtIso,
        };
      }
    }
    return {
      ...participant,
      is_connected: isConnected,
    };
  });

  const timedOutParticipants = effectiveParticipants.filter(
    (p) => !p.is_connected && isGraceExpired(p.last_seen_at, graceSeconds, now)
  );
  const timedOutParticipantIds = timedOutParticipants.map((p) => p.participant_id);
  const timedOutSet = new Set(timedOutParticipantIds.map((id) => id.toLowerCase()));

  let nextVersion = room.state_version;
  const events: GraceTimeoutEventPlan[] = [];

  for (const staleId of staleConnectedParticipantIds) {
    const disconnectedAtIso = staleDisconnectTimestamps[staleId]!;
    nextVersion += 1;
    events.push({
      version: nextVersion,
      eventType: "PARTICIPANT_DISCONNECTED",
      payload: {
        participantId: staleId,
        reason: "HEARTBEAT_TIMEOUT",
        graceSeconds,
        graceExpiresAt: calculateGraceExpiryTimestamp(
          new Date(disconnectedAtIso),
          graceSeconds
        ).toISOString(),
      },
    });
  }

  const normalizedHostId = room.host_participant_id?.toLowerCase() ?? null;
  const hostTimedOut = normalizedHostId === null || timedOutSet.has(normalizedHostId);
  let nextHost: RoomParticipant | null = null;
  if (hostTimedOut) {
    nextHost = selectDeterministicHostSuccessor(
      effectiveParticipants,
      room.host_participant_id,
      { requireConnected: true }
    );
  }

  if (nextHost) {
    nextVersion += 1;
    events.push({
      version: nextVersion,
      eventType: "HOST_TRANSFERRED",
      payload: {
        reason: "HOST_DISCONNECT_TIMEOUT",
        newHostDisplayName: nextHost.display_name,
        participantCount: effectiveParticipants.length,
        graceSeconds,
      },
    });
  }

  const timedOutEligibleVoterIds =
    room.status === "ACTIVE" && room.current_round_id && eligibleVoterIds
      ? timedOutParticipantIds.filter((pid) => eligibleVoterIds.has(pid))
      : [];

  const cancelRound =
    room.status === "ACTIVE" &&
    room.current_round_id !== null &&
    timedOutEligibleVoterIds.length > 0;

  let nextRoomStatus: RoomStatus = room.status;
  if (cancelRound) {
    assertValidTransition(room.status, "LOBBY", "Eligible participant reconnect grace expired");
    nextRoomStatus = "LOBBY";
    nextVersion += 1;
    events.push({
      version: nextVersion,
      eventType: "ROUND_CANCELLED",
      payload: {
        roundId: room.current_round_id,
        reason: "ELIGIBLE_PARTICIPANT_TIMEOUT",
        timedOutCount: timedOutEligibleVoterIds.length,
        graceSeconds,
        hostTransferred: Boolean(nextHost),
      },
    });
  }

  const changed = events.length > 0;
  return {
    changed,
    staleConnectedParticipantIds,
    staleDisconnectTimestamps,
    timedOutParticipantIds,
    timedOutEligibleVoterIds,
    previousHostParticipantId: room.host_participant_id,
    nextHost,
    cancelRound,
    cancelledRoundId: cancelRound ? room.current_round_id : null,
    nextRoomStatus,
    nextStateVersion: nextVersion,
    events,
  };
}

export function buildRoomFinishState(params: {
  roomStatus: RoomStatus;
  roomId: string;
  connectedParticipantCount: number;
  matchedMovieId: number | null;
  latestRoundStatus: RoundStatus | null;
}): RoomFinishState {
  const { roomStatus, roomId, connectedParticipantCount, matchedMovieId, latestRoundStatus } =
    params;

  switch (roomStatus) {
    case "EXPIRED":
      return {
        status: "EXPIRED",
        code: "ROOM_EXPIRED",
        reason: "INACTIVITY_TTL_OR_CLOSED",
        recoverable: false,
        retryAvailable: false,
        retryEndpoint: null,
        matchedMovieId: null,
        message: "Room expired due to inactivity and cannot be rejoined.",
      };
    case "MATCHED":
      return {
        status: "MATCHED",
        code: "MATCH_FOUND",
        reason: "UNANIMOUS_MATCH",
        recoverable: false,
        retryAvailable: false,
        retryEndpoint: null,
        matchedMovieId,
        message: "Unanimous match reached.",
      };
    case "EXHAUSTED":
      return {
        status: "EXHAUSTED",
        code: "DECK_EXHAUSTED",
        reason: "NO_UNANIMOUS_MATCH",
        recoverable: true,
        retryAvailable: true,
        retryEndpoint: `/api/rooms/${encodeURIComponent(roomId)}/retry`,
        matchedMovieId: null,
        message:
          "All candidate titles finished without a unanimous match. Host can retry with a fresh filtered round.",
      };
    case "ACTIVE":
      return {
        status: "ACTIVE",
        code: "ROUND_ACTIVE",
        reason: null,
        recoverable: true,
        retryAvailable: false,
        retryEndpoint: null,
        matchedMovieId: null,
        message: "Voting round is active.",
      };
    case "LOBBY":
    default:
      if (latestRoundStatus === "CANCELLED") {
        return {
          status: "LOBBY",
          code: "ROUND_CANCELLED",
          reason: "ELIGIBLE_PARTICIPANT_TIMEOUT",
          recoverable: true,
          retryAvailable: false,
          retryEndpoint: `/api/rooms/${encodeURIComponent(roomId)}/start`,
          matchedMovieId: null,
          message:
            "Previous round was cancelled after an eligible participant timed out past the 90s reconnect grace. Host can start a new round when ready.",
        };
      }
      return {
        status: "LOBBY",
        code: "LOBBY_READY",
        reason: null,
        recoverable: true,
        retryAvailable: false,
        retryEndpoint: `/api/rooms/${encodeURIComponent(roomId)}/start`,
        matchedMovieId: null,
        message:
          connectedParticipantCount >= 2
            ? "Room is in lobby and ready to start."
            : "Waiting for at least 2 connected participants.",
      };
  }
}
