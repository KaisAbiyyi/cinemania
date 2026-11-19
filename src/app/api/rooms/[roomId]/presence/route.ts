import { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { notifyAfterCommit } from "@/lib/server/realtime/notifyAfterCommit";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import {
  parseJsonBodySafe,
  updateParticipantPresenceWithSession,
} from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms/[roomId]/presence
 * Authenticated participant presence/disconnect reporting backed by server timestamps
 * for 90-second reconnect grace enforcement.
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
    const result = await updateParticipantPresenceWithSession(request, roomId, store, { body });
    if (result.changed) {
      await notifyAfterCommit(store, result.room.roomId);
    }

    return privateJsonResponse(
      {
        updated: result.updated,
        changed: result.changed,
        room: result.room,
        viewer: result.viewer,
      },
      200
    );
  } catch (err) {
    return handleGuestApiError(err);
  }
}
