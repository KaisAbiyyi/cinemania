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
import { getRoomAuthorityStore, type RoomAuthorityStore } from "./roomStore";
import { isRoomRecordExpired } from "./stateMachine";

export interface SafeRoomParticipant {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  isConnected: boolean;
  joinedAt: string;
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
  now: Date = new Date()
): SafeRoomSnapshot {
  const expired = isRoomRecordExpired(room, now);
  const status: RoomStatus = expired ? "EXPIRED" : room.status;
  const participantCount = Math.max(room.participant_count, participants.length);

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
      participantId: participant.participant_id,
      displayName: participant.display_name,
      role: participant.role,
      isConnected: Boolean(participant.is_connected),
      joinedAt: participant.joined_at,
    })),
  };
}

function resolveAuthoritativeRole(room: Room, participant: RoomParticipant): ParticipantRole {
  return participant.role === "HOST" &&
    room.host_participant_id?.toLowerCase() === participant.participant_id.toLowerCase()
    ? "HOST"
    : "MEMBER";
}

/**
 * Creates a new CineMatch room, assigns a unique normalized 6-character code,
 * and mints the HOST capability cookie.
 */
export async function createRoomWithSession(
  request: Request,
  body: Record<string, unknown>,
  store: RoomAuthorityStore = getRoomAuthorityStore()
): Promise<RoomSnapshotResult> {
  // Preflight signing secret before writing durable state (L-045)
  getCapabilitySecret();

  const hostDisplayName = normalizeDisplayName(body.displayName, "Host");
  const { room, host } = await store.createRoom({
    hostDisplayName,
  });

  await store.setMinGeneration(room.id, host.participant_id, 1, room.expires_at);
  const { token } = mintGuestCapabilityToken({
    roomId: room.id,
    participantId: host.participant_id,
    role: "HOST",
    generation: 1,
  });

  const cookie = buildGuestCookieAttributes(request, room.id, token);
  const participants = await store.getParticipantsByRoom(room.id);

  return {
    room: buildSafeRoomSnapshot(room, participants.length > 0 ? participants : [host]),
    viewer: {
      participantId: host.participant_id,
      displayName: host.display_name,
      role: "HOST",
    },
    cookie,
  };
}

/**
 * Joins an existing room via normalized join code or invite link (or rejoins with valid cookie).
 */
export async function joinRoomWithSession(
  request: Request,
  body: Record<string, unknown>,
  store: RoomAuthorityStore = getRoomAuthorityStore()
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

  if (existingToken !== null) {
    const preliminary = verifyGuestCapabilityToken(existingToken, {
      expectedRoomId: targetRoom.id,
    });
    const minGen = await store.getMinGeneration(targetRoom.id, preliminary.pid);
    const claims = verifyGuestCapabilityToken(existingToken, {
      expectedRoomId: targetRoom.id,
      minGeneration: minGen,
    });

    const participant = await store.getParticipant(targetRoom.id, claims.pid);
    if (!participant) {
      throw new CapabilityAuthError(
        403,
        "PARTICIPANT_NOT_IN_ROOM",
        "Capability does not match an active participant in this room."
      );
    }

    const rejoined = await store.joinRoom(
      targetRoom.id,
      participant.participant_id,
      participant.display_name
    );
    const freshRoom = (await store.getRoomById(targetRoom.id)) ?? targetRoom;
    const participants = await store.getParticipantsByRoom(targetRoom.id);
    const role = resolveAuthoritativeRole(freshRoom, rejoined);

    const { token } = mintGuestCapabilityToken({
      roomId: targetRoom.id,
      participantId: rejoined.participant_id,
      role,
      generation: minGen,
    });

    return {
      room: buildSafeRoomSnapshot(freshRoom, participants),
      viewer: {
        participantId: rejoined.participant_id,
        displayName: rejoined.display_name,
        role,
      },
      cookie: buildGuestCookieAttributes(request, targetRoom.id, token),
    };
  }

  const participantId = crypto.randomUUID();
  const participant = await store.joinRoom(targetRoom.id, participantId, displayName);
  const freshRoom = (await store.getRoomById(targetRoom.id)) ?? targetRoom;
  await store.setMinGeneration(freshRoom.id, participant.participant_id, 1, freshRoom.expires_at);

  const { token } = mintGuestCapabilityToken({
    roomId: freshRoom.id,
    participantId: participant.participant_id,
    role: "MEMBER",
    generation: 1,
  });

  const participants = await store.getParticipantsByRoom(freshRoom.id);

  return {
    room: buildSafeRoomSnapshot(freshRoom, participants),
    viewer: {
      participantId: participant.participant_id,
      displayName: participant.display_name,
      role: "MEMBER",
    },
    cookie: buildGuestCookieAttributes(request, freshRoom.id, token),
  };
}

/**
 * Returns the authenticated participant's view of the room snapshot.
 */
export async function getAuthenticatedRoomSnapshot(
  request: Request,
  roomId: string,
  store: RoomAuthorityStore = getRoomAuthorityStore()
): Promise<RoomSnapshotResult> {
  const actor = await requireRoomActor(request, roomId, store);
  const participants = await store.getParticipantsByRoom(actor.room.id);
  const role = resolveAuthoritativeRole(actor.room, actor.participant);

  return {
    room: buildSafeRoomSnapshot(actor.room, participants),
    viewer: {
      participantId: actor.participant.participant_id,
      displayName: actor.participant.display_name,
      role,
    },
  };
}
