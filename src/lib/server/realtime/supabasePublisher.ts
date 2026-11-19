import { PermanentPublicationError, type RoomHint } from "./dispatch";

/** Server-only factory: callers must keep the key outside client bundles. */
export function createSupabasePublisher(projectUrl: string, secret: string, send: typeof fetch = fetch) {
  const base = new URL(projectUrl);
  const hosted = base.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/.test(base.hostname) && !base.port;
  const local = process.env.CINEMATCH_ALLOW_LOCAL_REALTIME === "true" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/i.test(projectUrl) &&
    base.protocol === "http:" && (base.hostname === "localhost" || base.hostname === "127.0.0.1");
  if ((!hosted && !local) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !secret) {
    throw new Error("Invalid Supabase broadcast configuration");
  }
  return async (hint: RoomHint): Promise<void> => {
    const topic = encodeURIComponent(`room:${hint.roomId}`);
    const endpoint = new URL(`/realtime/v1/api/broadcast/${topic}/events/room_changed?private=true`, base);
    const response = await send(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: secret },
      body: JSON.stringify({ roomId: hint.roomId, version: hint.version }),
      signal: AbortSignal.timeout(1500),
    });
    if (response.status === 413) throw new PermanentPublicationError("Realtime event too large");
    if (!response.ok) throw new Error(`Realtime broadcast failed (${response.status})`);
  };
}
