import type { NextRequest } from "next/server";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import { requireRoomActor, mintSupabaseRealtimeJwt } from "@/lib/server/auth/roomAuth";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";

/** Returns a short-lived room-bound listen capability, never a server key. */
export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  try {
    assertSameOriginCsrf(request);
    const { roomId } = await context.params;
    const actor = await requireRoomActor(request, roomId, getRoomAuthorityStore());
    const token = mintSupabaseRealtimeJwt(actor, { ttlSeconds: 60 });
    return privateJsonResponse({ token }, 200);
  } catch (error) {
    return handleGuestApiError(error);
  }
}
