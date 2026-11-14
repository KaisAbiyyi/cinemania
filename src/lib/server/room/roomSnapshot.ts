import crypto from "node:crypto";
import {
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  ParticipantRole,
  Room,
  RoomParticipant,
  RoomStatus,
} from "@/db/schema";
import {
  CapabilityAuthError,
  type CookieAttributes,
  buildGuestCookieAttributes,
  extractCookieValue,
  getCapabilitySecret,
  getGuestCookieName,
  isValidUuid,
  mintGuestCapabilityToken,
  verifyGuestCapabilityToken,
} from "@/lib/server/auth/guestCapability";
import { requireRoomActor } from "@/lib/server/auth/roomAuth";
import { buildRoomInvitePath, normalizeRoomCodeInput } from "./roomCode";
import { RoomExpiredError, RoomNotFoundError } from "./roomRepository";
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
  expiresAt: string;
  createdAt: string;
  participants: SafeRoomParticipant[];
}

export interface RoomSessionViewer {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
}

export interface RoomSnapshotResult {
  room: SafeRoomSnapshot;
  viewer: RoomSessionViewer;
  cookie?: CookieAttributes;
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
 * Normalizes a participant display name by trimming and collapsing whitespace.
 */
export function normalizeDisplayName(rawName: unknown, defaultName: string): string {
  if (rawName === undefined) {
    return defaultName;
  }
  if (typeof rawName !== "string") {
    throw new CapabilityAuthError(400, "INVALID_DISPLAY_NAME", "Display name must be a string.");
  }
  const normalized = rawName.trim().replace(/\s+/g, " ");
  if (normalized.length < 1 || normalized.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new CapabilityAuthError(
      400,
      "INVALID_DISPLAY_NAME",
      `Display name must be between 1 and ${DISPLAY_NAME_MAX_LENGTH} characters.`
    );
  }
  return normalized;
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
  now: Date = new Date()
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
    expiresAt: room.expires_at,
    createdAt: room.created_at,
    participants: participants.map((participant) => ({
      displayName: participant.display_name,
      role: participant.role,
      isConnected: Boolean(participant.is_connected),
      joinedAt: participant.joined_at,
      isSelf: participant.participant_id.toLowerCase() === normalizedViewerId,
    })),
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
  return {
    room: buildSafeRoomSnapshot(
      result.room,
      result.participants,
      result.participant.participant_id
    ),
    viewer: {
      participantId: result.participant.participant_id,
      displayName: result.participant.display_name,
      role,
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

  return {
    room: buildSafeRoomSnapshot(
      consistent.room,
      consistent.participants,
      viewerParticipant.participant_id
    ),
    viewer: {
      participantId: viewerParticipant.participant_id,
      displayName: viewerParticipant.display_name,
      role,
    },
  };
}
