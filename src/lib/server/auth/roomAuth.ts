import crypto from "node:crypto";
import type { ParticipantRole, Room, RoomParticipant } from "@/db/schema";
import {
  CapabilityAuthError,
  extractCookieValue,
  getGuestCookieName,
  isValidUuid,
  MAX_CAPABILITY_TTL_SECONDS,
  verifyGuestCapabilityToken,
  type GuestCapabilityClaims,
} from "./guestCapability";
import { isRoomRecordExpired } from "@/lib/server/room/stateMachine";

export interface RoomActorAuthority {
  room: Room;
  participant: RoomParticipant;
  role: ParticipantRole;
  isHost: boolean;
  claims: GuestCapabilityClaims;
}

export interface RoomActorStore {
  getRoomById(roomId: string): Promise<Room | null>;
  getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null>;
  getMinGeneration(roomId: string, participantId: string): Promise<number>;
}

export interface RequireRoomActorOptions {
  requireHost?: boolean;
  nowMs?: number;
  secret?: string;
}

export function resolveGuestTokenFromRequest(request: Request, roomId: string): string {
  const cookieName = getGuestCookieName(roomId);
  const token = extractCookieValue(request.headers.get("cookie"), cookieName);
  if (!token) {
    throw new CapabilityAuthError(
      401,
      "CAPABILITY_MISSING",
      "Guest room capability cookie is required."
    );
  }
  return token;
}

/**
 * Validates the per-room HttpOnly guest capability cookie against:
 * 1. HMAC-SHA256 signature, numeric timestamp bounds, expiration, and room binding
 * 2. Persistent minimum generation (rejects rotated/revoked tokens)
 * 3. Authoritative DB room state and room_participants membership
 * 4. Authoritative DB host role check when requireHost is true (never trusts client claims/body)
 */
export async function requireRoomActor(
  request: Request,
  roomId: string,
  store: RoomActorStore,
  options: RequireRoomActorOptions = {}
): Promise<RoomActorAuthority> {
  if (!isValidUuid(roomId)) {
    throw new CapabilityAuthError(400, "INVALID_ROOM_ID", "Invalid room identifier.");
  }

  const normalizedRoomId = roomId.toLowerCase();
  const token = resolveGuestTokenFromRequest(request, normalizedRoomId);

  // Verify signature, lifetime, and room binding BEFORE querying database
  const preliminaryClaims = verifyGuestCapabilityToken(token, {
    expectedRoomId: normalizedRoomId,
    nowMs: options.nowMs,
    secret: options.secret,
  });

  const minGeneration = await store.getMinGeneration(normalizedRoomId, preliminaryClaims.pid);
  const claims = verifyGuestCapabilityToken(token, {
    expectedRoomId: normalizedRoomId,
    minGeneration,
    nowMs: options.nowMs,
    secret: options.secret,
  });

  const room = await store.getRoomById(normalizedRoomId);
  if (!room) {
    throw new CapabilityAuthError(404, "ROOM_NOT_FOUND", "Room does not exist.");
  }

  if (isRoomRecordExpired(room)) {
    throw new CapabilityAuthError(410, "ROOM_EXPIRED", "Room session has expired.");
  }

  const participant = await store.getParticipant(normalizedRoomId, claims.pid);
  if (!participant) {
    throw new CapabilityAuthError(
      403,
      "PARTICIPANT_NOT_IN_ROOM",
      "Guest is not a member of this room."
    );
  }

  const authoritativeIsHost =
    participant.role === "HOST" &&
    room.host_participant_id?.toLowerCase() === participant.participant_id.toLowerCase();
  const authoritativeRole: ParticipantRole = authoritativeIsHost ? "HOST" : "MEMBER";

  if (options.requireHost && !authoritativeIsHost) {
    throw new CapabilityAuthError(
      403,
      "HOST_ONLY_ACTION",
      "Only the room host can perform this action."
    );
  }

  return {
    room,
    participant,
    role: authoritativeRole,
    isHost: authoritativeIsHost,
    claims,
  };
}

/**
 * Mints a room-scoped HS256 Supabase Realtime JWT matching ADR-003 §4.2:
 * - RFC 7519 integer NumericDate seconds (`iat`, `exp`)
 * - Bounded lifetime (`exp - iat <= 86400`, default 3600s)
 * - Scoped `sub` (participant_id), `room_id`, `role: "authenticated"`
 */
export function mintSupabaseRealtimeJwt(
  actor: Pick<RoomActorAuthority, "room" | "participant">,
  options?: { secret?: string; ttlSeconds?: number; nowMs?: number }
): string {
  const jwtSecret = options?.secret ?? process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    throw new CapabilityAuthError(
      500,
      "REALTIME_SECRET_MISSING",
      "Supabase JWT signing secret is not configured."
    );
  }

  const ttlSeconds = Math.floor(options?.ttlSeconds ?? 3600);
  if (ttlSeconds < 1 || ttlSeconds > MAX_CAPABILITY_TTL_SECONDS) {
    throw new CapabilityAuthError(400, "INVALID_TTL", "Realtime JWT TTL is out of allowed bounds.");
  }

  const iat = Math.floor((options?.nowMs ?? Date.now()) / 1000);
  const exp = iat + ttlSeconds;

  const headerSegment = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
    "utf8"
  ).toString("base64url");
  const payloadSegment = Buffer.from(
    JSON.stringify({
      sub: actor.participant.participant_id,
      room_id: actor.room.id,
      role: "authenticated",
      aud: "authenticated",
      iss: "cinematch",
      iat,
      exp,
    }),
    "utf8"
  ).toString("base64url");

  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureSegment = crypto
    .createHmac("sha256", jwtSecret)
    .update(signingInput, "utf8")
    .digest("base64url");

  return `${signingInput}.${signatureSegment}`;
}
