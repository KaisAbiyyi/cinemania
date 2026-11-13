import { z } from "zod";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import {
  buildGuestCookieAttributes,
  DEFAULT_CAPABILITY_TTL_SECONDS,
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
 * Rotates the caller's per-room HttpOnly capability while keeping participantId and role,
 * persisting min_generation so any prior cookie generation is immediately rejected.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);

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

    const store = getRoomAuthorityStore();
    const actor = await requireRoomActor(request, parsed.data.roomId, store);

    const nextGeneration = actor.claims.gen + 1;
    const expiresAtIso = new Date(
      Date.now() + DEFAULT_CAPABILITY_TTL_SECONDS * 1000
    ).toISOString();

    await store.setMinGeneration(
      actor.room.id,
      actor.participant.participant_id,
      nextGeneration,
      expiresAtIso
    );

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
