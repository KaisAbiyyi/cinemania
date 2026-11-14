import { NextRequest } from "next/server";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { getAuthenticatedRoomSnapshot } from "@/lib/server/room/roomSnapshot";

/**
 * GET /api/rooms/[roomId]
 * Returns the authenticated member's safe room snapshot (fail-closed if unauthenticated or non-member).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const result = await getAuthenticatedRoomSnapshot(request, roomId, store);

    return privateJsonResponse(
      {
        room: result.room,
        viewer: result.viewer,
      },
      200
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
