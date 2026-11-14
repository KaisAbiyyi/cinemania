import { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { parseJsonBodySafe, startRoomRoundWithSession } from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms/[roomId]/start
 * Host-only round start transition from LOBBY (2..5 participants) to ACTIVE.
 * Freezes eligible voter IDs in round_participants; client body cannot alter roster or quorum.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    assertSameOriginCsrf(request);
    const body = await parseJsonBodySafe(request);
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const result = await startRoomRoundWithSession(request, roomId, store, { body });

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
