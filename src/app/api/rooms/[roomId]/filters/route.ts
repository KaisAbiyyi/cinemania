import type { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { parseJsonBodySafe, updateRoomFiltersWithSession } from "@/lib/server/room/roomSnapshot";

async function handleUpdateFilters(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    assertSameOriginCsrf(request);
    const body = await parseJsonBodySafe(request);
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const result = await updateRoomFiltersWithSession(request, roomId, body, store);

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

/**
 * PATCH /api/rooms/[roomId]/filters
 * Host-only endpoint to update and persist canonical movie deck filters while the room is in LOBBY.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  return handleUpdateFilters(request, context);
}

/**
 * PUT /api/rooms/[roomId]/filters
 * Alias supporting idempotent replacement semantics for LOBBY common movie deck filters.
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  return handleUpdateFilters(request, context);
}
