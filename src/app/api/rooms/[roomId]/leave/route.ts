import { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { leaveRoomWithSession, parseJsonBodySafe } from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms/[roomId]/leave
 * Allows an authenticated participant to leave a LOBBY room cleanly before voting begins.
 * Clears the room-scoped HttpOnly cookie and deterministically transfers host if needed.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    assertSameOriginCsrf(request);
    await parseJsonBodySafe(request);
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const result = await leaveRoomWithSession(request, roomId, store);

    return privateJsonResponse(
      {
        left: result.left,
        roomClosed: result.roomClosed,
        roomId: result.roomId,
        status: result.status,
        stateVersion: result.stateVersion,
        participantCount: result.participantCount,
        hostTransferred: result.hostTransferred,
      },
      200,
      result.cookie
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
