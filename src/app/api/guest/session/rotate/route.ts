import { z } from "zod";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import {
  buildGuestCookieAttributes,
  CapabilityAuthError,
  DEFAULT_CAPABILITY_TTL_SECONDS,
  getCapabilitySecret,
  mintGuestCapabilityToken,
} from "@/lib/server/auth/guestCapability";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { requireRoomActor } from "@/lib/server/auth/roomAuth";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";

const RotateBodySchema = z.object({
  roomId: z.string().uuid("Valid roomId UUID is required."),
});

/**
 * POST /api/guest/session/rotate
 * Atomically compares and increments the caller's capability generation in persistent storage.
 * Concurrent/stale rotations fail closed with 409 CAPABILITY_ROTATION_CONFLICT and emit NO Set-Cookie.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);
    getCapabilitySecret();
    const store = getRoomAuthorityStore();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return privateJsonResponse(
        { error: "INVALID_JSON", message: "Request body must be valid JSON." },
        400
      );
    }

    const parsed = RotateBodySchema.safeParse(body);
    if (!parsed.success) {
      return privateJsonResponse(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        400
      );
    }

    const actor = await requireRoomActor(request, parsed.data.roomId, store);
    const expiresAtIso = new Date(
      Date.now() + DEFAULT_CAPABILITY_TTL_SECONDS * 1000
    ).toISOString();

    const nextGeneration = await store.rotateGeneration(
      actor.room.id,
      actor.participant.participant_id,
      actor.claims.gen,
      expiresAtIso
    );

    if (nextGeneration === null) {
      throw new CapabilityAuthError(
        409,
        "CAPABILITY_ROTATION_CONFLICT",
        "Capability token generation is stale; a concurrent rotation already succeeded."
      );
    }

    const { token } = mintGuestCapabilityToken({
      roomId: actor.room.id,
      participantId: actor.participant.participant_id,
      role: actor.role,
      generation: nextGeneration,
    });

    return privateJsonResponse(
      {
        rotated: true,
        roomId: actor.room.id,
        participantId: actor.participant.participant_id,
        role: actor.role,
        generation: nextGeneration,
      },
      200,
      buildGuestCookieAttributes(request, actor.room.id, token)
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
