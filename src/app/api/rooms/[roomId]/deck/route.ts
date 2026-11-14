import type { NextRequest } from "next/server";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { getAuthenticatedRoomDeck } from "@/lib/server/room/roomSnapshot";

/**
 * GET /api/rooms/[roomId]/deck
 * Returns the persisted deterministic ordered movie deck and active common filters
 * for the authenticated participant without calling upstream TMDB APIs.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const result = await getAuthenticatedRoomDeck(request, roomId, store);

    return privateJsonResponse(result, 200);
  } catch (err) {
    return handleGuestApiError(err);
  }
}
