import crypto from "node:crypto";
import {
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  ParticipantRole,
  Room,
  RoomParticipant,
  RoomStatus,
  RoundParticipant,
} from "@/db/schema";
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
import { buildRoomInvitePath, normalizeRoomCodeInput } from "./roomCode";
import {
  RoomExpiredError,
  RoomNotFoundError,
  type LeaveLobbyResult,
  type StartLobbyRoundResult,
} from "./roomRepository";
import {
  getRoomAuthorityStore,
  type AtomicRoomSessionResult,
  type RoomAuthorityStore,
  type RoomMutationHooks,
} from "./roomStore";
import { isRoomRecordExpired } from "./stateMachine";

export interface SafeRoomParticipant {
  displayName: string;
  role: ParticipantRole;
  isConnected: boolean;
  joinedAt: string;
  isSelf: boolean;
  isEligibleVoter?: boolean;
}

export interface RoomSessionMutationOptions {
  hooks?: RoomMutationHooks;
}

export interface SafeRoomSnapshot {
  roomId: string;
  code: string;
  invitePath: string;
  status: RoomStatus;
  stateVersion: number;
  participantCount: number;
  maxParticipants: number;
  minParticipantsToStart: number;
  canStart: boolean;
  currentRoundId: string | null;
  frozenQuorum: number | null;
  expiresAt: string;
  createdAt: string;
  participants: SafeRoomParticipant[];
}

export interface RoomSessionViewer {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  isEligibleVoter: boolean;
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
export async function parseJsonBodySafe(request: Request): Promise<Record<string, unknown>> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new CapabilityAuthError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CapabilityAuthError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

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

/**
 * Converts persisted room and participant records into a client-safe snapshot without secrets.
 */
export function buildSafeRoomSnapshot(
  room: Room,
  participants: RoomParticipant[],
  viewerParticipantId: string,
  now: Date = new Date(),
  roundParticipants: RoundParticipant[] = []
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
  const hasFrozenRoster = Boolean(room.current_round_id && roundParticipants.length > 0);
  const frozenIds = new Set(roundParticipants.map((rp) => rp.participant_id.toLowerCase()));

  return {
    roomId: room.id,
    code: room.code,
    invitePath: buildRoomInvitePath(room.code),
    status,
    stateVersion: room.state_version,
    participantCount,
    maxParticipants: MAX_PARTICIPANTS,
    minParticipantsToStart: MIN_PARTICIPANTS,
    canStart:
      status === "LOBBY" &&
      participantCount >= MIN_PARTICIPANTS &&
      participantCount <= MAX_PARTICIPANTS,
    currentRoundId: room.current_round_id,
    frozenQuorum: hasFrozenRoster ? roundParticipants.length : null,
    expiresAt: room.expires_at,
    createdAt: room.created_at,
    participants: participants.map((participant) => {
      const normalizedPid = participant.participant_id.toLowerCase();
      return {
        displayName: participant.display_name,
        role: participant.role,
        isConnected: Boolean(participant.is_connected),
        joinedAt: participant.joined_at,
        isSelf: normalizedPid === normalizedViewerId,
        ...(hasFrozenRoster ? { isEligibleVoter: frozenIds.has(normalizedPid) } : {}),
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
  mintedToken: string
): RoomSnapshotResult {
  const role = resolveAuthoritativeRole(result.room, result.participant);
  const roundParticipants = result.roundParticipants ?? [];
  const safeRoom = buildSafeRoomSnapshot(
    result.room,
    result.participants,
    result.participant.participant_id,
    new Date(),
    roundParticipants
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

  const hostDisplayName = normalizeDisplayName(body.displayName, "Host");
  let mintedToken = "";

  const result = await store.createRoomWithSession({
    hostDisplayName,
    hooks: createPreCommitMintHooks(options?.hooks, (token) => {
      mintedToken = token;
    }),
  });

  return buildAtomicSnapshotResult(request, result, mintedToken);
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

  const target = resolveJoinLookup(body);
  const displayName = normalizeDisplayName(body.displayName, "Guest");

  const targetRoom =
    target.type === "code"
      ? await store.getRoomByCode(target.value)
      : await store.getRoomById(target.value);

  if (!targetRoom) {
    throw new RoomNotFoundError("Target room does not exist.");
  }

  if (isRoomRecordExpired(targetRoom)) {
    throw new RoomExpiredError(`Room '${targetRoom.code}' has expired.`);
  }

  const cookieName = getGuestCookieName(targetRoom.id);
  const existingToken = extractCookieValue(request.headers.get("cookie"), cookieName);

  let participantId: string;
  let requireExistingParticipant = false;
  let verifyLockedSession: ((context: { room: Room; minGeneration: number }) => void) | undefined;

  if (existingToken !== null) {
    const preliminary = verifyGuestCapabilityToken(existingToken, {
      expectedRoomId: targetRoom.id,
    });
    participantId = preliminary.pid;
    requireExistingParticipant = true;
    verifyLockedSession = ({ minGeneration }) => {
      verifyGuestCapabilityToken(existingToken, {
        expectedRoomId: targetRoom.id,
        minGeneration,
      });
    };
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

  return buildAtomicSnapshotResult(request, result, mintedToken);
}

/**
 * Returns the authenticated participant's view of the room snapshot from a single
 * consistent database snapshot transaction.
 */
export async function getAuthenticatedRoomSnapshot(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore()
): Promise<RoomSnapshotResult> {
  const actor = await requireRoomActor(request, roomId, store);
  const consistent = await store.getConsistentRoomSnapshot(actor.room.id);
  if (!consistent) {
    throw new RoomNotFoundError(`Room ${actor.room.id} does not exist.`);
  }
  if (isRoomRecordExpired(consistent.room)) {
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
    new Date(),
    consistent.roundParticipants
  );
  const isEligibleVoter = Boolean(
    safeRoom.frozenQuorum !== null &&
      consistent.roundParticipants.some(
        (rp) => rp.participant_id.toLowerCase() === viewerParticipant.participant_id.toLowerCase()
      )
  );

  return {
    room: safeRoom,
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
      isEligibleVoter,
    },
  };
}

/**
 * Host-only action to start the voting round from LOBBY (2..5 participants) and
 * freeze eligible voter IDs in round_participants. Ignores any client roster/quorum fields.
 */
export async function startRoomRoundWithSession(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore(),
  options?: { beforeCommit?: (started: StartLobbyRoundResult) => void | Promise<void> }
): Promise<RoomSnapshotResult> {
  getCapabilitySecret();
  const actor = await requireRoomActor(request, roomId, store, { requireHost: true });
  const token = resolveGuestTokenFromRequest(request, actor.room.id);

  const started = await store.startLobbyRoundWithSession({
    roomId: actor.room.id,
    actorParticipantId: actor.participant.participant_id,
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
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
    new Date(),
    started.frozenParticipants
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
  options?: { beforeCommit?: (left: LeaveLobbyResult) => void | Promise<void> }
): Promise<LeaveRoomResult> {
  const actor = await requireRoomActor(request, roomId, store);
  const token = resolveGuestTokenFromRequest(request, actor.room.id);

  const left = await store.leaveLobbyWithSession({
    roomId: actor.room.id,
    participantId: actor.participant.participant_id,
    verifyLockedSession: ({ minGeneration }) => {
      verifyGuestCapabilityToken(token, {
        expectedRoomId: actor.room.id,
        minGeneration,
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
