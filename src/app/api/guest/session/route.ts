import crypto from "node:crypto";
import { z } from "zod";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import {
  buildGuestCookieAttributes,
  CapabilityAuthError,
  DEFAULT_CAPABILITY_TTL_SECONDS,
  extractCookieValue,
  getCapabilitySecret,
  getGuestCookieName,
  isValidUuid,
  mintGuestCapabilityToken,
  verifyGuestCapabilityToken,
} from "@/lib/server/auth/guestCapability";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { requireRoomActor } from "@/lib/server/auth/roomAuth";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";

const SessionPostSchema = z.object({
  roomId: z.string().uuid().optional(),
  roomCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{6}$/i, "Room code must be 6 alphanumeric characters.")
    .optional(),
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(32, "Display name must be 32 characters or fewer.")
    .default("Guest"),
});

function buildSessionPayload(params: {
  roomId: string;
  roomCode: string;
  roomStatus: string;
  participantCount: number;
  participantId: string;
  displayName: string;
  role: "HOST" | "MEMBER";
  generation: number;
  rejoined: boolean;
}) {
  const isHost = params.role === "HOST";
  return {
    roomId: params.roomId,
    roomCode: params.roomCode,
    roomStatus: params.roomStatus,
    participantCount: params.participantCount,
    participantId: params.participantId,
    displayName: params.displayName,
    role: params.role,
    generation: params.generation,
    rejoined: params.rejoined,
    capabilities: {
      isHost,
      canStartRound: isHost,
      canVote: true,
    },
  };
}

/**
 * GET /api/guest/session?roomId=<uuid>
 * Returns server-authoritative guest session and role for the requested room.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get("roomId") ?? "";
    if (!isValidUuid(roomId)) {
      throw new CapabilityAuthError(400, "INVALID_ROOM_ID", "Query parameter roomId must be a valid UUID.");
    }

    getCapabilitySecret();
    const store = getRoomAuthorityStore();
    const actor = await requireRoomActor(request, roomId, store);

    return privateJsonResponse(
      buildSessionPayload({
        roomId: actor.room.id,
        roomCode: actor.room.code,
        roomStatus: actor.room.status,
        participantCount: actor.room.participant_count,
        participantId: actor.participant.participant_id,
        displayName: actor.participant.display_name,
        role: actor.role,
        generation: actor.claims.gen,
        rejoined: true,
      }),
      200
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}

/**
 * POST /api/guest/session
 * - Empty body (including absent Content-Length) or JSON with optional displayName creates a HOST room.
 * - With roomId or roomCode + valid existing cookie: safely rejoins preserving server participantId & role.
 * - With roomId or roomCode + no cookie: joins as a new MEMBER with server-generated UUID.
 * User-supplied participantId or role fields in request body are never trusted.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);

    // Preflight capability signing configuration & durable store BEFORE any DB mutation
    // so missing secrets/store config never creates orphan room/participant records.
    getCapabilitySecret();
    const store = getRoomAuthorityStore();

    let rawBody: unknown = {};
    const rawText = await request.text();
    if (rawText.trim().length > 0) {
      try {
        rawBody = JSON.parse(rawText);
      } catch {
        return privateJsonResponse(
          { error: "INVALID_JSON", message: "Request body must be valid JSON." },
          400
        );
      }
    }

    // Explicitly parse only allowed fields so client-supplied participantId/role cannot influence identity or privilege.
    const parsed = SessionPostSchema.safeParse(rawBody);
    if (!parsed.success) {
      return privateJsonResponse(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        400
      );
    }

    const { roomId: requestedRoomId, roomCode: requestedRoomCode, displayName } = parsed.data;

    // Case 1: Create new room as anonymous HOST
    if (!requestedRoomId && !requestedRoomCode) {
      const hostParticipantId = crypto.randomUUID();
      const { room, host } = await store.createRoom({
        hostParticipantId,
        hostDisplayName: displayName,
      });

      const expiresAtIso = new Date(
        Date.now() + DEFAULT_CAPABILITY_TTL_SECONDS * 1000
      ).toISOString();
      await store.setMinGeneration(room.id, host.participant_id, 1, expiresAtIso);

      const { token } = mintGuestCapabilityToken({
        roomId: room.id,
        participantId: host.participant_id,
        role: "HOST",
        generation: 1,
      });

      return privateJsonResponse(
        buildSessionPayload({
          roomId: room.id,
          roomCode: room.code,
          roomStatus: room.status,
          participantCount: room.participant_count,
          participantId: host.participant_id,
          displayName: host.display_name,
          role: "HOST",
          generation: 1,
          rejoined: false,
        }),
        201,
        buildGuestCookieAttributes(request, room.id, token)
      );
    }

    // Case 2: Join or rejoin an existing room
    const targetRoom = requestedRoomId
      ? await store.getRoomById(requestedRoomId.toLowerCase())
      : await store.getRoomByCode(requestedRoomCode!);

    if (!targetRoom) {
      throw new CapabilityAuthError(404, "ROOM_NOT_FOUND", "Target room does not exist.");
    }

    if (targetRoom.status === "EXPIRED") {
      throw new CapabilityAuthError(410, "ROOM_EXPIRED", "Target room has expired.");
    }

    const cookieName = getGuestCookieName(targetRoom.id);
    const existingToken = extractCookieValue(request.headers.get("cookie"), cookieName);

    if (existingToken !== null) {
      // Caller presented a room cookie: verify strictly and fail closed if forged, expired, or rotated.
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
      const authoritativeRole =
        rejoined.role === "HOST" &&
        freshRoom.host_participant_id?.toLowerCase() === rejoined.participant_id.toLowerCase()
          ? "HOST"
          : "MEMBER";

      const { token } = mintGuestCapabilityToken({
        roomId: targetRoom.id,
        participantId: rejoined.participant_id,
        role: authoritativeRole,
        generation: minGen,
      });

      return privateJsonResponse(
        buildSessionPayload({
          roomId: freshRoom.id,
          roomCode: freshRoom.code,
          roomStatus: freshRoom.status,
          participantCount: freshRoom.participant_count,
          participantId: rejoined.participant_id,
          displayName: rejoined.display_name,
          role: authoritativeRole,
          generation: minGen,
          rejoined: true,
        }),
        200,
        buildGuestCookieAttributes(request, freshRoom.id, token)
      );
    }

    // New guest entering this room: always mint server-assigned participantId & MEMBER role
    const assignedParticipantId = crypto.randomUUID();
    const participant = await store.joinRoom(targetRoom.id, assignedParticipantId, displayName);
    const updatedRoom = (await store.getRoomById(targetRoom.id)) ?? targetRoom;
    const expiresAtIso = new Date(
      Date.now() + DEFAULT_CAPABILITY_TTL_SECONDS * 1000
    ).toISOString();
    await store.setMinGeneration(updatedRoom.id, participant.participant_id, 1, expiresAtIso);

    const { token } = mintGuestCapabilityToken({
      roomId: updatedRoom.id,
      participantId: participant.participant_id,
      role: "MEMBER",
      generation: 1,
    });

    return privateJsonResponse(
      buildSessionPayload({
        roomId: updatedRoom.id,
        roomCode: updatedRoom.code,
        roomStatus: updatedRoom.status,
        participantCount: updatedRoom.participant_count,
        participantId: participant.participant_id,
        displayName: participant.display_name,
        role: "MEMBER",
        generation: 1,
        rejoined: false,
      }),
      201,
      buildGuestCookieAttributes(request, updatedRoom.id, token)
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
