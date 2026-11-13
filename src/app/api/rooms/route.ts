import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { createRoomWithSession, parseJsonBodySafe } from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms
 * Creates a new room in LOBBY state with a cryptographically random 6-character code,
 * assigns HOST capability cookie, and returns a secret-free room snapshot + invite path.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);
    const store = getRoomAuthorityStore();
    const body = await parseJsonBodySafe(request);
    const result = await createRoomWithSession(request, body, store);

    return privateJsonResponse(
      {
        room: result.room,
        viewer: result.viewer,
      },
      201,
      result.cookie
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
