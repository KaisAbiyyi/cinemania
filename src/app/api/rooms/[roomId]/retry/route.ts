import { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { notifyAfterCommit } from "@/lib/server/realtime/notifyAfterCommit";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { parseJsonBodySafe, retryRoomRoundWithSession } from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms/[roomId]/retry
 * Host-only action to recover an EXHAUSTED round back to LOBBY (`startRound: false`)
 * or directly into a fresh filtered round (`startRound: true`) with optional operationId idempotency.
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
    const result = await retryRoomRoundWithSession(request, roomId, store, { body });
    await notifyAfterCommit(store, result.room.roomId);

    return privateJsonResponse(
      {
        retried: result.retried,
        idempotentReplay: result.idempotentReplay,
        room: result.room,
        viewer: result.viewer,
      },
      200
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
