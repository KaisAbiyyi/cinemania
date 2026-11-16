import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { startRoomRealtime } from "@/lib/realtime/roomRealtime";
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

it("subscribes privately before retrieving the authoritative snapshot", async () => {
  const steps: string[] = [];
  const channel = {
    on: vi.fn(function() { return channel; }),
    subscribe: vi.fn((cb: (status: string) => void) => { steps.push("subscribe"); cb("SUBSCRIBED"); return channel; }),
  };
  const client = { realtime: { setAuth: async () => { steps.push("auth"); } }, channel: vi.fn((_topic, config) => { expect(config).toEqual({ config: { private: true } }); return channel; }), removeChannel: async () => {} };
  vi.mocked(createClient).mockReturnValue(client as never);
  const get = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("realtime-token")) return new Response(JSON.stringify({ token: "signed" }), { status: 200 });
    steps.push("snapshot"); return new Response(JSON.stringify({ room: { stateVersion: 1 } }), { status: 200 });
  });
  const snapshots: number[] = [];
  const close = await startRoomRealtime({ roomId: "a", supabaseUrl: "https://test.supabase.co", publishableKey: "key", fetcher: get as typeof fetch, onSnapshot: (snapshot) => snapshots.push(snapshot.room.stateVersion) });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(steps).toEqual(["auth", "subscribe", "snapshot"]);
  expect(snapshots).toEqual([1]);
  expect(createClient).toHaveBeenCalledTimes(1);
  await close();
});
