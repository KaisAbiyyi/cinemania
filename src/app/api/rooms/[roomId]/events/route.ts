import type { NextRequest } from "next/server";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";
import { requireRoomActor } from "@/lib/server/auth/roomAuth";
import { handleGuestApiError, privateJsonResponse } from "@/lib/server/auth/guestResponse";
import { getRoomAuthorityStore } from "@/lib/server/room/roomStore";
import { notifyAfterCommit } from "@/lib/server/realtime/notifyAfterCommit";

/** Replay intentionally exposes version hints only, never event payloads. */
export async function GET(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await context.params;
    const store = getRoomAuthorityStore();
    const actor = await requireRoomActor(request, roomId, store);
    const raw = request.nextUrl.searchParams.get("since") ?? "0";
    if (!/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2147483647) {
      throw new CapabilityAuthError(400, "INVALID_EVENT_VERSION", "Invalid event version.");
    }
    const versions = await store.listRoomEventVersions(actor.room.id, Number(raw));
    await notifyAfterCommit(store, actor.room.id);
    return privateJsonResponse({ events: versions.map((version) => ({ version })), hasMore: versions.length === 100 });
  } catch (error) {
    return handleGuestApiError(error);
  }
}
