import type { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { submitRoomVoteWithSession } from "@/lib/server/room/roomSnapshot";

/**
 * POST /api/rooms/[roomId]/votes
 * Authenticates the frozen room participant via HttpOnly capability cookie + CSRF origin check,
 * validates candidate membership & operationId idempotency, records an immutable LIKE/SKIP vote,
 * and evaluates server-authoritative unanimous consensus or deck exhaustion.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> }
) {
  try {
    assertSameOriginCsrf(request);
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const result = await submitRoomVoteWithSession(request, roomId, store);

    return privateJsonResponse(result, 200);
  } catch (err) {
    return handleGuestApiError(err);
  }
}
