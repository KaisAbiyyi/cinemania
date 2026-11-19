import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { enforceRoomRateLimit } from "@/lib/server/auth/roomRateLimit";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { joinRoomWithSession, parseJsonBodySafe } from "@/lib/server/room/roomSnapshot";
import { notifyAfterCommit } from "@/lib/server/realtime/notifyAfterCommit";

/**
 * POST /api/rooms/join
 * Normalizes a 6-character room code or invite link and atomically joins a guest
 * into the target LOBBY room (max 5 participants), or idempotently reconnects an existing member.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginCsrf(request);
    await enforceRoomRateLimit(request, "join");
    const store = getRoomAuthorityStore();
    const body = await parseJsonBodySafe(request);
    const result = await joinRoomWithSession(request, body, store);
    await notifyAfterCommit(store, result.room.roomId);

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
