import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { joinRoomWithSession, parseJsonBodySafe } from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms/join
 * Normalizes a 6-character room code or invite link and atomically joins a guest
 * into the target LOBBY room (max 5 participants), or idempotently reconnects an existing member.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);
    const store = getRoomAuthorityStore();
    const body = await parseJsonBodySafe(request);
    const result = await joinRoomWithSession(request, body, store);

    return privateJsonResponse(
      {
        room: result.room,
        viewer: result.viewer,
      },
      200,
      result.cookie
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
