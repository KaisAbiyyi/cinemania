import { z } from "zod";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { readBoundedJson } from "@/lib/server/auth/requestBody";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { requireRoomActor } from "@/lib/server/auth/roomAuth";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";

const HostCheckSchema = z.object({
  roomId: z.string().uuid("Valid roomId UUID is required."),
});

/**
 * POST /api/guest/host-check
 * Server-authoritative host privilege check backed by HttpOnly capability + DB role.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);

    const body = await readBoundedJson(request);

    const parsed = HostCheckSchema.safeParse(body);
    if (!parsed.success) {
      return privateJsonResponse(
        { error: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid request." },
        400
      );
    }

    const store = getRoomAuthorityStore();
    const actor = await requireRoomActor(request, parsed.data.roomId, store, {
      requireHost: true,
    });

    return privateJsonResponse(
      {
        authorized: true,
        roomId: actor.room.id,
        participantId: actor.participant.participant_id,
        role: actor.role,
      },
      200
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
