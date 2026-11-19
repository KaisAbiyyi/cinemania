import crypto from "node:crypto";
import { readBoundedJson } from "@/lib/server/auth/requestBody";
import {
  Candidate,
  DECK_SIZE,
  DEFAULT_RECONNECT_GRACE_SECONDS,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  ParticipantRole,
  Room,
  RoomParticipant,
  RoomStatus,
  RoundParticipant,
  RoundStatus,
  Vote,
  VoteType,
} from "@/db/schema";
import { ValidationError } from "@/lib/api/errorResponse";
import {
  normalizeRoomDeckFilter,
  parseOptionalDeckFilterFromBody,
  resolveEffectiveRoomDeckFilter,
  type CanonicalRoomDeckFilter,
  type SafeDeckCandidate,
} from "@/lib/schemas/roomDeck";
import {
  CapabilityAuthError,
  type CookieAttributes,
  buildClearedGuestCookieAttributes,
  buildGuestCookieAttributes,
  extractCookieValue,
  getCapabilitySecret,
  getGuestCookieName,
  isValidUuid,
  mintGuestCapabilityToken,
  verifyGuestCapabilityToken,
} from "@/lib/server/auth/guestCapability";
import { requireRoomActor, resolveGuestTokenFromRequest } from "@/lib/server/auth/roomAuth";
import { notifyAfterCommit } from "@/lib/server/realtime/notifyAfterCommit";
import {
  buildRoomFinishState,
  parsePresencePayload,
  parseRetryRoundPayload,
  type RoomFinishState,
} from "./finishPolicy";
import { buildRoomInvitePath, normalizeRoomCodeInput } from "./roomCode";
import {
  fetchAndBuildDeterministicDeck,
  toSafeDeckCandidate,
  type TmdbDiscoverMovieFetcher,
} from "./roomDeck";
import {
  RoomCapacityError,
  RoomExpiredError,
  RoomNotExhaustedError,
  RoomNotFoundError,
  computeCanonicalLobbyFilterJson,
  type LeaveLobbyResult,
  type RetryRoundResult,
  type StartLobbyRoundResult,
  type UpdatePresenceResult,
} from "./roomRepository";
import {
  getRoomAuthorityStore,
  type AtomicRoomSessionResult,
  type RecordVoteSessionResult,
  type RoomAuthorityStore,
  type RoomMutationHooks,
} from "./roomStore";
import {
  calculateGraceExpiryTimestamp,
  isGraceExpired,
  isRoomRecordExpired,
} from "./stateMachine";
import {
  evaluateDeckProgression,
  extractOperationIdFromHeaders,
  FrozenRosterMissingError,
  parseVoteSubmissionPayload,
} from "./votingEngine";

export interface SafeRoomParticipant {
  displayName: string;
  role: ParticipantRole;
  isConnected: boolean;
  joinedAt: string;
  isSelf: boolean;
  isEligibleVoter?: boolean;
  graceExpiresAt?: string;
}

export interface RoomSessionMutationOptions {
  hooks?: RoomMutationHooks;
  nowMs?: number;
}

export interface SafeRoomSnapshot {
  roomId: string;
  code: string;
  invitePath: string;
  status: RoomStatus;
  stateVersion: number;
  participantCount: number;
  connectedParticipantCount: number;
  maxParticipants: number;
  minParticipantsToStart: number;
  reconnectGraceSeconds: number;
  canStart: boolean;
  canRetry: boolean;
  currentRoundId: string | null;
  latestRoundStatus: RoundStatus | null;
  frozenQuorum: number | null;
  deckFilter: CanonicalRoomDeckFilter;
  deckSize: number;
  expectedDeckSize: number;
  isDeckShortage: boolean;
  deck: SafeDeckCandidate[];
  matchedMovieId: number | null;
  matchedCandidate: SafeDeckCandidate | null;
  currentCandidateIndex: number | null;
  currentCandidate: SafeDeckCandidate | null;
  finishState: RoomFinishState;
  expiresAt: string;
  createdAt: string;
  participants: SafeRoomParticipant[];
}

export interface RoomDeckReadResult {
  room: {
    roomId: string;
    code: string;
    status: RoomStatus;
    stateVersion: number;
    currentRoundId: string | null;
    frozenQuorum: number | null;
    deckFilter: CanonicalRoomDeckFilter;
    deckSize: number;
    expectedDeckSize: number;
    isDeckShortage: boolean;
  };
  viewer: RoomSnapshotResult["viewer"];
  deck: SafeDeckCandidate[];
}

export interface RoomSessionViewer {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  isEligibleVoter: boolean;
  canStart?: boolean;
  canRetry?: boolean;
  userVotes?: Record<string, VoteType>;
  nextCandidateIndex?: number | null;
}

export interface RoomRetryResult {
  retried: true;
  idempotentReplay: boolean;
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
}

export interface RoomPresenceResult {
  updated: true;
  changed: boolean;
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
}

export interface RoomVoteSubmissionResult {
  vote: {
    id: string;
    roomId: string;
    roundId: string;
    participantId: string;
    candidateId: string;
    movieId: number;
    vote: VoteType;
    operationId: string | null;
    createdAt: string;
  };
  isMatched: boolean;
  isExhausted: boolean;
  idempotentReplay: boolean;
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
}

export interface RoomSnapshotResult {
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
  cookie?: CookieAttributes;
}

export interface LeaveRoomResult {
  left: true;
  roomClosed: boolean;
  roomId: string;
  status: RoomStatus;
  stateVersion: number;
  participantCount: number;
  hostTransferred: boolean;
  cookie: CookieAttributes;
}

const DISPLAY_NAME_MAX_LENGTH = 32;

/**
 * Safely parses an optional JSON request body; treats empty bodies as `{}`.
 */
export { readBoundedJson as parseJsonBodySafe } from "@/lib/server/auth/requestBody";

/**
 * Sanitizes and bounds a participant display name against HTML/XSS injection,
 * control/bidi characters, and excessive Unicode code-point length.
 */
export function normalizeDisplayName(rawName: unknown, defaultName: string): string {
  if (rawName === undefined) {
    return defaultName;
  }
  if (typeof rawName !== "string") {
    throw new CapabilityAuthError(400, "INVALID_DISPLAY_NAME", "Display name must be a string.");
  }

  const sanitized = rawName
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[a-z][^>]*>?/gi, " ")
    .replace(
      /[\u0000-\u001F\u007F-\u009F\u061C\u200B\u200C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g,
      ""
    )
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const codePointLength = Array.from(sanitized).length;
  if (codePointLength < 1 || codePointLength > DISPLAY_NAME_MAX_LENGTH || sanitized.length > 50) {
    throw new CapabilityAuthError(
      400,
      "INVALID_DISPLAY_NAME",
      `Display name must be between 1 and ${DISPLAY_NAME_MAX_LENGTH} characters.`
    );
  }
  return sanitized;
}

function resolveJoinLookup(
  body: Record<string, unknown>
): { type: "code"; value: string } | { type: "roomId"; value: string } {
  const rawCodeField = body.code ?? body.roomCode ?? body.inviteLink ?? body.link;
  if (rawCodeField !== undefined) {
    if (typeof rawCodeField !== "string") {
      throw new CapabilityAuthError(400, "INVALID_ROOM_CODE", "Room code or invite link must be a string.");
    }
    return { type: "code", value: normalizeRoomCodeInput(rawCodeField) };
  }

  if (body.roomId !== undefined) {
    if (typeof body.roomId !== "string" || !isValidUuid(body.roomId.trim())) {
      throw new CapabilityAuthError(400, "INVALID_ROOM_ID", "roomId must be a valid UUID.");
    }
    return { type: "roomId", value: body.roomId.trim() };
  }

  throw new CapabilityAuthError(400, "INVALID_ROOM_CODE", "A room code or invite link is required.");
}

function buildViewerVoteSummary(
  viewerParticipantId: string,
  currentCandidateIndex: number | null,
  currentCandidateId: string | null,
  isEligibleVoter: boolean,
  votes: Vote[]
): { userVotes: Record<string, VoteType>; nextCandidateIndex: number | null } {
  const normalizedViewerId = viewerParticipantId.toLowerCase();
  const userVotes: Record<string, VoteType> = {};
  for (const vote of votes) {
    if (vote.participant_id.toLowerCase() === normalizedViewerId) {
      userVotes[vote.candidate_id] = vote.vote;
    }
  }

  const nextCandidateIndex = isEligibleVoter && currentCandidateId !== null && !(currentCandidateId in userVotes)
    ? currentCandidateIndex
    : null;

  return { userVotes, nextCandidateIndex };
}

/**
 * Converts persisted room and participant records into a client-safe snapshot without secrets.
 */
export function buildSafeRoomSnapshot(
  room: Room,
  participants: RoomParticipant[],
  viewerParticipantId: string,
  now: Date = new Date(),
  roundParticipants: RoundParticipant[] = [],
  candidates: Candidate[] = [],
  votes: Vote[] = [],
  options?: { latestRoundStatus?: RoundStatus | null }
): SafeRoomSnapshot {
  if (room.participant_count !== participants.length) {
    throw new CapabilityAuthError(
      500,
      "SNAPSHOT_INCOHERENT",
      `Incoherent room snapshot: participant_count (${room.participant_count}) does not match participant roster (${participants.length}).`
    );
  }

  const normalizedViewerId = viewerParticipantId.toLowerCase();
  const expired = isRoomRecordExpired(room, now);
  const status: RoomStatus = expired ? "EXPIRED" : room.status;
  const participantCount = room.participant_count;
  const connectedParticipantCount = participants.filter((p) => Boolean(p.is_connected)).length;
  const latestRoundStatus: RoundStatus | null = options?.latestRoundStatus ?? null;
  if (room.current_round_id !== null && roundParticipants.length < MIN_PARTICIPANTS) {
    throw new FrozenRosterMissingError(
      `Frozen voter roster for round ${room.current_round_id} has ${roundParticipants.length} participant(s); expected at least ${MIN_PARTICIPANTS}.`
    );
  }
  const hasFrozenRoster = Boolean(room.current_round_id && roundParticipants.length >= MIN_PARTICIPANTS);
  const frozenIds = new Set(roundParticipants.map((rp) => rp.participant_id.toLowerCase()));
  const deckFilter = resolveEffectiveRoomDeckFilter(room.deck_filter);
  const orderedCandidates = room.current_round_id
    ? [...candidates].sort((a, b) => a.position - b.position)
    : [];
  const deck: SafeDeckCandidate[] = orderedCandidates.map(toSafeDeckCandidate);

  let matchedMovieId: number | null = room.matched_movie_id ?? null;
  let matchedCandidate: SafeDeckCandidate | null =
    matchedMovieId !== null
      ? deck.find((candidate) => candidate.movieId === matchedMovieId) ?? null
      : null;
  let currentCandidateIndex: number | null =
    status === "ACTIVE" && deck.length > 0 ? 0 : null;
  let currentCandidate: SafeDeckCandidate | null =
    currentCandidateIndex !== null ? deck[currentCandidateIndex] ?? null : null;

  if (orderedCandidates.length > 0) {
    const eligibleVoterIds = new Set(roundParticipants.map((rp) => rp.participant_id));

    if (
      eligibleVoterIds.size >= MIN_PARTICIPANTS &&
      eligibleVoterIds.size <= MAX_PARTICIPANTS
    ) {
      const progression = evaluateDeckProgression(
        orderedCandidates,
        votes,
        eligibleVoterIds
      );
      if (matchedMovieId === null && progression.matchedMovieId !== null) {
        matchedMovieId = progression.matchedMovieId;
      }
      matchedCandidate =
        matchedMovieId !== null
          ? deck.find((candidate) => candidate.movieId === matchedMovieId) ?? null
          : null;
      if (status === "ACTIVE") {
        currentCandidateIndex = progression.currentCandidateIndex;
        currentCandidate =
          progression.currentCandidate !== null
            ? toSafeDeckCandidate(progression.currentCandidate)
            : null;
      } else {
        currentCandidateIndex = null;
        currentCandidate = null;
      }
    }
  }

  return {
    roomId: room.id,
    code: room.code,
    invitePath: buildRoomInvitePath(room.code),
    status,
    stateVersion: room.state_version,
    participantCount,
    connectedParticipantCount,
    maxParticipants: MAX_PARTICIPANTS,
    minParticipantsToStart: MIN_PARTICIPANTS,
    reconnectGraceSeconds: DEFAULT_RECONNECT_GRACE_SECONDS,
    canStart:
      status === "LOBBY" &&
      connectedParticipantCount >= MIN_PARTICIPANTS &&
      connectedParticipantCount <= MAX_PARTICIPANTS,
    canRetry:
      status === "EXHAUSTED" &&
      connectedParticipantCount >= MIN_PARTICIPANTS &&
      connectedParticipantCount <= MAX_PARTICIPANTS,
    currentRoundId: room.current_round_id,
    latestRoundStatus,
    frozenQuorum: hasFrozenRoster ? roundParticipants.length : null,
    deckFilter,
    deckSize: deck.length,
    expectedDeckSize: DECK_SIZE,
    isDeckShortage: Boolean(room.current_round_id && deck.length > 0 && deck.length < DECK_SIZE),
    deck,
    matchedMovieId,
    matchedCandidate,
    currentCandidateIndex,
    currentCandidate,
    finishState: buildRoomFinishState({
      roomStatus: status,
      roomId: room.id,
      connectedParticipantCount,
      matchedMovieId,
      latestRoundStatus,
    }),
    expiresAt: room.expires_at,
    createdAt: room.created_at,
    participants: participants.map((participant) => {
      const normalizedPid = participant.participant_id.toLowerCase();
      const isConnected = Boolean(participant.is_connected);
      const graceExpiresAt =
        !isConnected && (status === "LOBBY" || status === "ACTIVE")
          ? calculateGraceExpiryTimestamp(
              new Date(participant.last_seen_at),
              DEFAULT_RECONNECT_GRACE_SECONDS
            ).toISOString()
          : undefined;
      return {
        displayName: participant.display_name,
        role: participant.role,
        isConnected,
        joinedAt: participant.joined_at,
        isSelf: normalizedPid === normalizedViewerId,
        ...(hasFrozenRoster ? { isEligibleVoter: frozenIds.has(normalizedPid) } : {}),
        ...(graceExpiresAt ? { graceExpiresAt } : {}),
      };
    }),
  };
}

function resolveAuthoritativeRole(room: Room, participant: RoomParticipant): ParticipantRole {
  return participant.role === "HOST" &&
    room.host_participant_id?.toLowerCase() === participant.participant_id.toLowerCase()
    ? "HOST"
    : "MEMBER";
}

async function reconcileExpiredGraceIfNeeded(
  store: RoomAuthorityStore,
  roomId: string,
  evalNow: Date,
  roomStatus?: RoomStatus
): Promise<boolean> {
  if (roomStatus && roomStatus !== "LOBBY" && roomStatus !== "ACTIVE") {
    return false;
  }
  const participants = await store.getParticipantsByRoom(roomId);
  const hasExpiredDisconnected = participants.some(
    (p) =>
      !Boolean(p.is_connected) &&
      isGraceExpired(p.last_seen_at, DEFAULT_RECONNECT_GRACE_SECONDS, evalNow)
  );
  if (!hasExpiredDisconnected) {
    return false;
  }
  const outcome = await store.sweepRoomGraceTimeouts(roomId, {
    nowIso: evalNow.toISOString(),
    graceSeconds: DEFAULT_RECONNECT_GRACE_SECONDS,
  });
  if (outcome.changed) {
    await notifyAfterCommit(store, roomId);
  }
  return outcome.changed;
}

async function requireAuthorizedRoomActor(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore,
  options: { requireHost?: boolean; nowMs?: number } = {}
) {
  const evalNow = options.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const initialActor = await requireRoomActor(request, roomId, store, {
    nowMs: options.nowMs,
  });
  const swept = await reconcileExpiredGraceIfNeeded(
    store,
    initialActor.room.id,
    evalNow,
    initialActor.room.status
  );
  if (swept || options.requireHost) {
    return requireRoomActor(request, roomId, store, {
      requireHost: options.requireHost,
      nowMs: options.nowMs,
    });
  }
  return initialActor;
}

function createPreCommitMintHooks(
  hooks: RoomMutationHooks | undefined,
  onTokenMinted: (token: string) => void
): RoomMutationHooks {
  return {
    afterWriteBeforeSessionInit: hooks?.afterWriteBeforeSessionInit,
    beforeCommit: (txResult) => {
      const role = resolveAuthoritativeRole(txResult.room, txResult.participant);
      const { token } = mintGuestCapabilityToken({
        roomId: txResult.room.id,
        participantId: txResult.participant.participant_id,
        role,
        generation: txResult.sessionGeneration,
      });
      onTokenMinted(token);
      return hooks?.beforeCommit?.(txResult);
    },
  };
}

function buildAtomicSnapshotResult(
  request: Request,
  result: AtomicRoomSessionResult,
  mintedToken: string,
  evalNow: Date = new Date(),
  latestRoundStatus: RoundStatus | null = null
): RoomSnapshotResult {
  const role = resolveAuthoritativeRole(result.room, result.participant);
  const roundParticipants = result.roundParticipants ?? [];
  const candidates = result.candidates ?? [];
  const safeRoom = buildSafeRoomSnapshot(
    result.room,
    result.participants,
    result.participant.participant_id,
    evalNow,
    roundParticipants,
    candidates,
    [],
    { latestRoundStatus }
  );
  const isEligibleVoter = Boolean(
    safeRoom.frozenQuorum !== null &&
      roundParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === result.participant.participant_id.toLowerCase()
      )
  );
  return {
    room: safeRoom,
    viewer: {
      participantId: result.participant.participant_id,
      displayName: result.participant.display_name,
      role,
      isEligibleVoter,
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
    },
    cookie: buildGuestCookieAttributes(request, result.room.id, mintedToken),
  };
}

/**
 * Creates a new CineMatch room, assigns a unique normalized 6-character code,
 * persists guest capability generation = 1, and mints the HOST capability cookie
 * atomically before database COMMIT.
 */
export async function createRoomWithSession(
  request: Request,
  body: Record<string, unknown>,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: RoomSessionMutationOptions
): Promise<RoomSnapshotResult> {
  // Preflight signing secret before writing durable state (L-045)
  getCapabilitySecret();

  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const hostDisplayName = normalizeDisplayName(body.displayName, "Host");
  const deckFilter = parseOptionalDeckFilterFromBody(body);
  let mintedToken = "";

  const result = await store.createRoomWithSession({
    hostDisplayName,
    ...(deckFilter ? { deckFilter } : {}),
    hooks: createPreCommitMintHooks(options?.hooks, (token) => {
      mintedToken = token;
    }),
  });

  return buildAtomicSnapshotResult(request, result, mintedToken, evalNow);
}

/**
 * Joins an existing room via normalized join code or invite link (or rejoins with valid cookie).
 */
export async function joinRoomWithSession(
  request: Request,
  body: Record<string, unknown>,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: RoomSessionMutationOptions
): Promise<RoomSnapshotResult> {
  // Preflight signing secret before writing durable state (L-045)
  getCapabilitySecret();

  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const target = resolveJoinLookup(body);
  const displayName = normalizeDisplayName(body.displayName, "Guest");
  if (target.type === "roomId") {
    const roomId = target.value.toLowerCase();
    verifyGuestCapabilityToken(resolveGuestTokenFromRequest(request, roomId), { expectedRoomId: roomId });
    target.value = roomId;
  }

  const targetRoom =
    target.type === "code"
      ? await store.getRoomByCode(target.value)
      : await store.getRoomById(target.value);

  if (!targetRoom) {
    throw new RoomNotFoundError("Target room does not exist.");
  }

  if (isRoomRecordExpired(targetRoom, evalNow)) {
    throw new RoomExpiredError("Target room has expired.");
  }

  const cookieName = getGuestCookieName(targetRoom.id);
  const existingToken = extractCookieValue(request.headers.get("cookie"), cookieName);

  let participantId: string;
  let requireExistingParticipant = false;
  let verifyLockedSession: ((context: { room: Room; minGeneration: number }) => void) | undefined;

  if (existingToken !== null) {
    const preliminary = verifyGuestCapabilityToken(existingToken, {
      expectedRoomId: targetRoom.id,
      nowMs: options?.nowMs,
    });
    participantId = preliminary.pid;
    requireExistingParticipant = true;
    verifyLockedSession = ({ minGeneration }) => {
      verifyGuestCapabilityToken(existingToken, {
        expectedRoomId: targetRoom.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    };
    await reconcileExpiredGraceIfNeeded(store, targetRoom.id, evalNow, targetRoom.status);
  } else {
    participantId = crypto.randomUUID();
  }

  let mintedToken = "";
  const result = await store.joinRoomWithSession({
    roomId: targetRoom.id,
    participantId,
    displayName,
    requireExistingParticipant,
    verifyLockedSession,
    hooks: createPreCommitMintHooks(options?.hooks, (token) => {
      mintedToken = token;
    }),
  });

  const latestRound =
    result.rejoined && result.room.status === "LOBBY"
      ? await store.getLatestRound(result.room.id)
      : null;

  return buildAtomicSnapshotResult(
    request,
    result,
    mintedToken,
    evalNow,
    latestRound?.status ?? null
  );
}

/**
 * Returns the authenticated participant's view of the room snapshot from a single
 * consistent database snapshot transaction.
 */
export async function getAuthenticatedRoomSnapshot(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: { nowMs?: number }
): Promise<RoomSnapshotResult> {
  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    nowMs: options?.nowMs,
  });
  const consistent = await store.getConsistentRoomSnapshot(actor.room.id);
  if (!consistent) {
    throw new RoomNotFoundError(`Room ${actor.room.id} does not exist.`);
  }
  if (isRoomRecordExpired(consistent.room, evalNow)) {
    throw new RoomExpiredError(`Room '${consistent.room.code}' has expired.`);
  }

  const viewerParticipant = consistent.participants.find(
    (participant) =>
      participant.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
  );
  if (!viewerParticipant) {
    throw new CapabilityAuthError(
      403,
      "PARTICIPANT_NOT_IN_ROOM",
      "Capability does not match an active participant in this room."
    );
  }

  const role = resolveAuthoritativeRole(consistent.room, viewerParticipant);
  const safeRoom = buildSafeRoomSnapshot(
    consistent.room,
    consistent.participants,
    viewerParticipant.participant_id,
    evalNow,
    consistent.roundParticipants,
    consistent.candidates,
    consistent.votes,
    { latestRoundStatus: consistent.latestRound?.status ?? null }
  );
  const isEligibleVoter = Boolean(
    safeRoom.frozenQuorum !== null &&
      consistent.roundParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === viewerParticipant.participant_id.toLowerCase()
      )
  );
  const viewerVoteSummary = buildViewerVoteSummary(
    viewerParticipant.participant_id,
    safeRoom.currentCandidateIndex,
    safeRoom.currentCandidate?.candidateId ?? null,
    isEligibleVoter,
    consistent.votes
  );

  return {
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter,
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
      userVotes: viewerVoteSummary.userVotes,
      nextCandidateIndex: viewerVoteSummary.nextCandidateIndex,
    },
  };
}

/**
 * Returns the persisted deterministic ordered movie deck and common filters
 * for an authenticated room participant without calling upstream TMDB APIs.
 */
export async function getAuthenticatedRoomDeck(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore()
): Promise<RoomDeckReadResult> {
  const snapshot = await getAuthenticatedRoomSnapshot(request, roomId, store);
  return {
    room: {
      roomId: snapshot.room.roomId,
      code: snapshot.room.code,
      status: snapshot.room.status,
      stateVersion: snapshot.room.stateVersion,
      currentRoundId: snapshot.room.currentRoundId,
      frozenQuorum: snapshot.room.frozenQuorum,
      deckFilter: snapshot.room.deckFilter,
      deckSize: snapshot.room.deckSize,
      expectedDeckSize: snapshot.room.expectedDeckSize,
      isDeckShortage: snapshot.room.isDeckShortage,
    },
    viewer: snapshot.viewer,
    deck: snapshot.room.deck,
  };
}

function parseFilterUpdatePayload(body: Record<string, unknown>): CanonicalRoomDeckFilter {
  const hasDeckFilter = Object.prototype.hasOwnProperty.call(body, "deckFilter");
  const hasFilters = Object.prototype.hasOwnProperty.call(body, "filters");
  if (hasDeckFilter || hasFilters) {
    const allowedWrapperKeys = new Set(["deckFilter", "filters"]);
    for (const key of Object.keys(body)) {
      if (!allowedWrapperKeys.has(key)) {
        throw new ValidationError(`Unexpected field '${key}' alongside deck filter payload.`);
      }
    }
    return parseOptionalDeckFilterFromBody(body) ?? resolveEffectiveRoomDeckFilter(null);
  }
  return normalizeRoomDeckFilter(body);
}

/**
 * Host-only action to validate and persist common movie deck filters while room is in LOBBY.
 */
export async function updateRoomFiltersWithSession(
  request: Request,
  roomId: string,
  body: Record<string, unknown>,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: { beforeCommit?: () => void | Promise<void>; nowMs?: number }
): Promise<RoomSnapshotResult> {
  getCapabilitySecret();
  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    requireHost: true,
    nowMs: options?.nowMs,
  });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);
  const deckFilter = parseFilterUpdatePayload(body);

  const updated = await store.updateRoomDeckFilterWithSession({
    roomId: actor.room.id,
    actorParticipantId: actor.participant.participant_id,
    deckFilter,
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    },
    beforeCommit: options?.beforeCommit ? () => options.beforeCommit!() : undefined,
  });

  const viewerParticipant = updated.participants.find(
    (p) => p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
  );
  if (!viewerParticipant) {
    throw new CapabilityAuthError(
      403,
      "PARTICIPANT_NOT_IN_ROOM",
      "Host capability no longer matches an active participant."
    );
  }

  const latestRound = await store.getLatestRound(updated.room.id);
  const role = resolveAuthoritativeRole(updated.room, viewerParticipant);
  const safeRoom = buildSafeRoomSnapshot(
    updated.room,
    updated.participants,
    viewerParticipant.participant_id,
    evalNow,
    [],
    [],
    [],
    { latestRoundStatus: latestRound?.status ?? null }
  );

  return {
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter: false,
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
    },
  };
}

/**
 * Host-only action to generate the deterministic movie deck from TMDB, transition LOBBY -> ACTIVE,
 * freeze eligible voter IDs in round_participants, and persist candidates atomically.
 * Ignores any client roster/quorum fields.
 */
export async function startRoomRoundWithSession(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: {
    body?: Record<string, unknown>;
    beforeCommit?: (started: StartLobbyRoundResult) => void | Promise<void>;
    discoverFetcher?: TmdbDiscoverMovieFetcher;
    maxPages?: number;
    nowMs?: number;
  }
): Promise<RoomSnapshotResult> {
  getCapabilitySecret();
  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    requireHost: true,
    nowMs: options?.nowMs,
  });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);

  if (isRoomRecordExpired(actor.room, evalNow)) {
    throw new RoomExpiredError(`Room '${actor.room.code}' has expired.`);
  }
  if (actor.room.status !== "LOBBY") {
    const statusCode =
      actor.room.status === "MATCHED"
        ? "ROOM_ALREADY_MATCHED"
        : actor.room.status === "EXHAUSTED"
          ? "ROOM_ALREADY_EXHAUSTED"
          : "ROOM_ALREADY_ACTIVE";
    throw new RoomCapacityError(
      `Cannot start round: room status is '${actor.room.status}', but must be 'LOBBY'.`,
      statusCode
    );
  }

  const preflightParticipants = await store.getParticipantsByRoom(actor.room.id);
  const connectedCount = preflightParticipants.filter(
    (p) =>
      Boolean(p.is_connected) ||
      p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
  ).length;
  if (connectedCount < MIN_PARTICIPANTS) {
    throw new RoomCapacityError(
      `Cannot start round: at least ${MIN_PARTICIPANTS} participants required (current: ${connectedCount}).`,
      "INSUFFICIENT_PARTICIPANTS"
    );
  }
  if (connectedCount > MAX_PARTICIPANTS) {
    throw new RoomCapacityError(
      `Cannot start round: maximum allowed participants is ${MAX_PARTICIPANTS} (current: ${connectedCount}).`,
      "ROOM_FULL"
    );
  }

  const inlineFilter = parseOptionalDeckFilterFromBody(options?.body);
  const effectiveFilter = inlineFilter ?? resolveEffectiveRoomDeckFilter(actor.room.deck_filter);
  const expectedLobbyFilterJson =
    inlineFilter !== undefined ? undefined : computeCanonicalLobbyFilterJson(actor.room.deck_filter);

  const nextRoundNumber = await store.getNextRoundNumber(actor.room.id);

  // Fetch and deterministically order candidate deck outside DB transaction locks (L-053)
  const builtDeck = await fetchAndBuildDeterministicDeck({
    roomId: actor.room.id,
    roundNumber: nextRoundNumber,
    filter: effectiveFilter,
    maxPages: options?.maxPages,
    discoverFetcher: options?.discoverFetcher,
  });

  const started = await store.startLobbyRoundWithSession({
    roomId: actor.room.id,
    actorParticipantId: actor.participant.participant_id,
    options: {
      candidates: builtDeck.candidates,
      deckFilter: effectiveFilter,
      expectedLobbyFilterJson,
      expectedRoundNumber: nextRoundNumber,
      deckSeed: builtDeck.deckSeed,
    },
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    },
    beforeCommit: options?.beforeCommit,
  });

  const viewerParticipant = started.participants.find(
    (p) => p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
  );
  if (!viewerParticipant) {
    throw new CapabilityAuthError(
      403,
      "PARTICIPANT_NOT_IN_ROOM",
      "Host capability no longer matches an active participant."
    );
  }

  const role = resolveAuthoritativeRole(started.room, viewerParticipant);
  const safeRoom = buildSafeRoomSnapshot(
    started.room,
    started.participants,
    viewerParticipant.participant_id,
    evalNow,
    started.frozenParticipants,
    started.candidates,
    [],
    { latestRoundStatus: started.round.status }
  );

  return {
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter: started.frozenParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === viewerParticipant.participant_id.toLowerCase()
      ),
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
      userVotes: {},
      nextCandidateIndex: safeRoom.status === "ACTIVE" && safeRoom.deckSize > 0 ? 0 : null,
    },
  };
}

/**
 * Host-only action to recover an EXHAUSTED room back to LOBBY (`startRound: false`)
 * or directly into a fresh filtered round (`startRound: true`).
 */
export async function retryRoomRoundWithSession(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: {
    body?: Record<string, unknown>;
    beforeCommit?: (retried: RetryRoundResult) => void | Promise<void>;
    discoverFetcher?: TmdbDiscoverMovieFetcher;
    maxPages?: number;
    nowMs?: number;
  }
): Promise<RoomRetryResult> {
  getCapabilitySecret();
  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    requireHost: true,
    nowMs: options?.nowMs,
  });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);

  if (isRoomRecordExpired(actor.room, evalNow)) {
    throw new RoomExpiredError(`Room '${actor.room.code}' has expired.`);
  }

  const headerOperationId = extractOperationIdFromHeaders(request.headers);
  const parsed = parseRetryRoundPayload(options?.body ?? {}, headerOperationId);

  if (actor.room.status !== "EXHAUSTED" && parsed.operationId === null) {
    throw new RoomNotExhaustedError(
      `Cannot retry room: room status is '${actor.room.status}', but must be 'EXHAUSTED'.`
    );
  }

  let builtDeck: Awaited<ReturnType<typeof fetchAndBuildDeterministicDeck>> | undefined;
  let nextRoundNumber: number | undefined;
  if (parsed.startRound && actor.room.status === "EXHAUSTED") {
    const preflightParticipants = await store.getParticipantsByRoom(actor.room.id);
    const connectedCount = preflightParticipants.filter(
      (p) =>
        Boolean(p.is_connected) ||
        p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
    ).length;
    if (connectedCount < MIN_PARTICIPANTS) {
      throw new RoomCapacityError(
        `Cannot start round: at least ${MIN_PARTICIPANTS} participants required (current: ${connectedCount}).`,
        "INSUFFICIENT_PARTICIPANTS"
      );
    }
    if (connectedCount > MAX_PARTICIPANTS) {
      throw new RoomCapacityError(
        `Cannot start round: maximum allowed participants is ${MAX_PARTICIPANTS} (current: ${connectedCount}).`,
        "ROOM_FULL"
      );
    }

    const effectiveFilter = parsed.deckFilter ?? resolveEffectiveRoomDeckFilter(actor.room.deck_filter);
    nextRoundNumber = await store.getNextRoundNumber(actor.room.id);
    builtDeck = await fetchAndBuildDeterministicDeck({
      roomId: actor.room.id,
      roundNumber: nextRoundNumber,
      filter: effectiveFilter,
      maxPages: options?.maxPages,
      discoverFetcher: options?.discoverFetcher,
    });
  }

  const retried = await store.retryExhaustedRoundWithSession({
    roomId: actor.room.id,
    actorParticipantId: actor.participant.participant_id,
    options: {
      deckFilter: parsed.deckFilter,
      startRound: parsed.startRound,
      ...(builtDeck ? { candidates: builtDeck.candidates, deckSeed: builtDeck.deckSeed } : {}),
      expectedRoundId: actor.room.current_round_id,
      ...(nextRoundNumber !== undefined ? { expectedRoundNumber: nextRoundNumber } : {}),
      operationId: parsed.operationId,
    },
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    },
    beforeCommit: options?.beforeCommit,
  });

  const initialViewerParticipant = retried.participants.find(
    (p) => p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
  );
  if (!initialViewerParticipant) {
    throw new CapabilityAuthError(
      403,
      "PARTICIPANT_NOT_IN_ROOM",
      "Host capability no longer matches an active participant."
    );
  }

  const consistent = await store.getConsistentRoomSnapshot(retried.room.id);
  const snapshotRoom = consistent?.room ?? retried.room;
  const snapshotParticipants = consistent?.participants ?? retried.participants;
  const viewerParticipant =
    snapshotParticipants.find(
      (p) => p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
    ) ?? initialViewerParticipant;
  const roundParticipants = consistent?.roundParticipants ?? retried.frozenParticipants;
  const candidates = consistent?.candidates ?? retried.candidates;
  const votes = consistent?.votes ?? [];
  const latestRoundStatus = consistent?.latestRound?.status ?? retried.round?.status ?? null;
  const role = resolveAuthoritativeRole(snapshotRoom, viewerParticipant);
  const safeRoom = buildSafeRoomSnapshot(
    snapshotRoom,
    snapshotParticipants,
    viewerParticipant.participant_id,
    evalNow,
    roundParticipants,
    candidates,
    votes,
    { latestRoundStatus }
  );
  const isEligibleVoter = Boolean(
    safeRoom.frozenQuorum !== null &&
      roundParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === viewerParticipant.participant_id.toLowerCase()
      )
  );
  const viewerVoteSummary = buildViewerVoteSummary(
    viewerParticipant.participant_id,
    safeRoom.currentCandidateIndex,
    safeRoom.currentCandidate?.candidateId ?? null,
    isEligibleVoter,
    votes
  );

  return {
    retried: true,
    idempotentReplay: retried.idempotentReplay,
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter,
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
      userVotes: viewerVoteSummary.userVotes,
      nextCandidateIndex: viewerVoteSummary.nextCandidateIndex,
    },
  };
}

/**
 * Updates the authenticated participant's server-authoritative presence / disconnect state
 * so the 90-second reconnect grace timer runs strictly from persisted timestamps.
 */
export async function updateParticipantPresenceWithSession(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: {
    body?: Record<string, unknown>;
    beforeCommit?: (updated: UpdatePresenceResult) => void | Promise<void>;
    nowMs?: number;
  }
): Promise<RoomPresenceResult> {
  getCapabilitySecret();
  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    nowMs: options?.nowMs,
  });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);
  const body = options?.body ?? (await readBoundedJson(request));
  const parsed = parsePresencePayload(body);

  const updated = await store.updateParticipantPresenceWithSession({
    roomId: actor.room.id,
    participantId: actor.participant.participant_id,
    connected: parsed.connected,
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    },
    beforeCommit: options?.beforeCommit,
  });

  const consistent = await store.getConsistentRoomSnapshot(updated.room.id);
  const snapshotRoom = consistent?.room ?? updated.room;
  const snapshotParticipants = consistent?.participants ?? updated.participants;
  const viewerParticipant =
    snapshotParticipants.find(
      (p) => p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
    ) ?? updated.participant;
  const roundParticipants = consistent?.roundParticipants ?? [];
  const candidates = consistent?.candidates ?? [];
  const votes = consistent?.votes ?? [];
  const role = resolveAuthoritativeRole(snapshotRoom, viewerParticipant);
  const safeRoom = buildSafeRoomSnapshot(
    snapshotRoom,
    snapshotParticipants,
    viewerParticipant.participant_id,
    evalNow,
    roundParticipants,
    candidates,
    votes,
    { latestRoundStatus: consistent?.latestRound?.status ?? null }
  );
  const isEligibleVoter = Boolean(
    safeRoom.frozenQuorum !== null &&
      roundParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === viewerParticipant.participant_id.toLowerCase()
      )
  );
  const viewerVoteSummary = buildViewerVoteSummary(
    viewerParticipant.participant_id,
    safeRoom.currentCandidateIndex,
    safeRoom.currentCandidate?.candidateId ?? null,
    isEligibleVoter,
    votes
  );

  return {
    updated: true,
    changed: updated.changed,
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter,
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
      userVotes: viewerVoteSummary.userVotes,
      nextCandidateIndex: viewerVoteSummary.nextCandidateIndex,
    },
  };
}

/**
 * Removes the authenticated participant from a LOBBY room, transfers host cleanly if
 * the host departed with remaining members, or closes the room when the lone member leaves.
 */
export async function leaveRoomWithSession(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: { beforeCommit?: (left: LeaveLobbyResult) => void | Promise<void>; nowMs?: number }
): Promise<LeaveRoomResult> {
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    nowMs: options?.nowMs,
  });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);

  const left = await store.leaveLobbyWithSession({
    roomId: actor.room.id,
    participantId: actor.participant.participant_id,
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    },
    beforeCommit: options?.beforeCommit,
  });

  return {
    left: true,
    roomClosed: left.roomClosed,
    roomId: left.room.id,
    status: left.room.status,
    stateVersion: left.room.state_version,
    participantCount: left.room.participant_count,
    hostTransferred: Boolean(left.hostTransferredTo),
    cookie: buildClearedGuestCookieAttributes(request, left.room.id),
  };
}

/**
 * Authenticates the actor, validates vote & optional operationId payload, executes
 * atomic unanimous consensus + immutability checks, and returns a confidential viewer snapshot.
 */
export async function submitRoomVoteWithSession(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: { beforeCommit?: (result: RecordVoteSessionResult) => void | Promise<void>; nowMs?: number }
): Promise<RoomVoteSubmissionResult> {
  getCapabilitySecret();
  const evalNow = options?.nowMs !== undefined ? new Date(options.nowMs) : new Date();
  const actor = await requireAuthorizedRoomActor(request, roomId, store, {
    nowMs: options?.nowMs,
  });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);
  const headerOperationId = extractOperationIdFromHeaders(request.headers);
  const body = await readBoundedJson(request);
  const payload = parseVoteSubmissionPayload(body, headerOperationId);

  const recorded = await store.recordVoteWithSession({
    roomId: actor.room.id,
    roundId: payload.roundId,
    participantId: actor.participant.participant_id,
    candidateId: payload.candidateId,
    movieId: payload.movieId,
    vote: payload.vote,
    operationId: payload.operationId,
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
        nowMs: options?.nowMs,
      });
    },
    beforeCommit: options?.beforeCommit,
  });

  const viewerParticipant = recorded.participants.find(
    (p) => p.participant_id.toLowerCase() === actor.participant.participant_id.toLowerCase()
  );
  if (!viewerParticipant) {
    throw new CapabilityAuthError(
      403,
      "PARTICIPANT_NOT_IN_ROOM",
      "Guest capability no longer matches an active participant."
    );
  }

  const latestRound = await store.getLatestRound(recorded.room.id);
  const role = resolveAuthoritativeRole(recorded.room, viewerParticipant);
  const safeRoom = buildSafeRoomSnapshot(
    recorded.room,
    recorded.participants,
    viewerParticipant.participant_id,
    evalNow,
    recorded.roundParticipants,
    recorded.candidates,
    recorded.votes,
    { latestRoundStatus: latestRound?.status ?? null }
  );
  const isEligibleVoter = Boolean(
    safeRoom.frozenQuorum !== null &&
      recorded.roundParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === viewerParticipant.participant_id.toLowerCase()
      )
  );
  const viewerVoteSummary = buildViewerVoteSummary(
    viewerParticipant.participant_id,
    safeRoom.currentCandidateIndex,
    safeRoom.currentCandidate?.candidateId ?? null,
    isEligibleVoter,
    recorded.votes
  );

  return {
    vote: {
      id: recorded.vote.id,
      roomId: recorded.vote.room_id,
      roundId: recorded.vote.round_id,
      participantId: recorded.vote.participant_id,
      candidateId: recorded.vote.candidate_id,
      movieId: recorded.vote.movie_id,
      vote: recorded.vote.vote,
      operationId: recorded.vote.operation_id ?? null,
      createdAt: recorded.vote.created_at,
    },
    isMatched: recorded.isMatched,
    isExhausted: recorded.isExhausted,
    idempotentReplay: recorded.idempotentReplay,
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter,
      canStart: role === "HOST" && safeRoom.canStart,
      canRetry: role === "HOST" && safeRoom.canRetry,
      userVotes: viewerVoteSummary.userVotes,
      nextCandidateIndex: viewerVoteSummary.nextCandidateIndex,
    },
  };
}
