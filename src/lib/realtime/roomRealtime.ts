import { createClient } from "@supabase/supabase-js";
import { createRoomReconciler } from "./roomReconciler";

export interface RoomSnapshot {
  room: { stateVersion: number; [key: string]: unknown };
  [key: string]: unknown;
}

/** Subscribe first; events only invalidate snapshots and are never applied as state. */
export async function startRoomRealtime(options: {
  roomId: string;
  supabaseUrl: string;
  publishableKey: string;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onError?: (error: Error) => void;
  fetcher?: typeof fetch;
}): Promise<() => Promise<void>> {
  const get = options.fetcher ?? fetch;
  // setAuth affects every channel on a client, so each room owns its client.
  const client = createClient(options.supabaseUrl, options.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const base = "/api/rooms/" + encodeURIComponent(options.roomId);
  let closed = false;
  async function renew(): Promise<void> {
    const response = await get(base + "/realtime-token", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error("Realtime capability request failed");
    const body = await response.json() as { token?: unknown };
    if (typeof body.token !== "string") throw new Error("Invalid realtime capability");
    await client.realtime.setAuth(body.token);
  }
  const reconciler = createRoomReconciler({
    loadSnapshot: async () => {
      const response = await get(base, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Room snapshot request failed");
      const snapshot = await response.json() as RoomSnapshot;
      return { stateVersion: snapshot.room.stateVersion, snapshot };
    },
    onSnapshot: ({ snapshot }) => { if (!closed) options.onSnapshot(snapshot); },
  });
  const report = (error: unknown) => options.onError?.(error instanceof Error ? error : new Error("Realtime failed"));
  await renew();
  const channel = client.channel("room:" + options.roomId, { config: { private: true } });
  channel.on("broadcast", { event: "room_changed" }, (message) => {
    const hint = message.payload as { roomId?: unknown; version?: unknown };
    if (!closed && hint?.roomId === options.roomId && typeof hint.version === "number") {
      void reconciler.notify(hint.version).catch(report);
    }
  });
  await new Promise<void>((resolve, reject) => {
    let initial = true;
    channel.subscribe((status) => {
      if (closed) return;
      if (status === "SUBSCRIBED") {
        void reconciler.connected().then(() => { if (initial) { initial = false; resolve(); } }).catch((error) => { if (initial) { initial = false; reject(error); } else report(error); });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        const error = new Error("Private realtime subscription failed");
        if (initial) { initial = false; reject(error); } else report(error);
      }
    });
  }).catch(async (error) => { closed = true; await client.removeChannel(channel); throw error; });
  // Polling is required to heal a dropped final broadcast with no later gap.
  const refresh = setInterval(() => { void reconciler.connected().catch(report); }, 15000);
  const renewToken = setInterval(() => { void renew().catch(report); }, 30000);
  return async () => {
    closed = true;
    clearInterval(refresh);
    clearInterval(renewToken);
    await client.removeChannel(channel);
  };
}
