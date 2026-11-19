import "server-only";
import { PermanentPublicationError, PublicationAuthorizationError, type RoomHint } from "./dispatch";

const AUTHORIZATION_COOLDOWN_MS = 60_000;

/** Server-only factory: callers must keep the key outside client bundles. */
export function createSupabasePublisher(projectUrl: string, secret: string, send: typeof fetch = fetch) {
  let base: URL;
  try {
    base = new URL(projectUrl);
  } catch {
    throw new Error("Invalid Supabase broadcast configuration");
  }
  const hosted = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(projectUrl);
  const local = process.env.CINEMATCH_ALLOW_LOCAL_REALTIME === "true" &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?\/?$/i.test(projectUrl) &&
    base.protocol === "http:" && (base.hostname === "localhost" || base.hostname === "127.0.0.1");
  if ((!hosted && !local) || base.username || base.password || base.pathname !== "/" || base.search || base.hash || !secret) {
    throw new Error("Invalid Supabase broadcast configuration");
  }
  let authorizationCooldownUntil = 0;
  let nextOutageReport = 0;
  function reportOutage(status?: number) {
    if (Date.now() < nextOutageReport) return;
    nextOutageReport = Date.now() + AUTHORIZATION_COOLDOWN_MS;
    console.warn("[CINEMATCH_REALTIME_UNAVAILABLE] Check provider connectivity and pending outbox age.", status ?? "transport");
  }
  return async (hint: RoomHint): Promise<void> => {
    if (Date.now() < authorizationCooldownUntil) throw new PublicationAuthorizationError();
    const topic = encodeURIComponent(`room:${hint.roomId}`);
    const endpoint = new URL(`/realtime/v1/api/broadcast/${topic}/events/room_changed?private=true`, base);
    let response: Response;
    try {
      response = await send(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", apikey: secret },
        body: JSON.stringify({ roomId: hint.roomId, version: hint.version }),
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      reportOutage();
      throw new Error("Realtime provider request failed");
    }
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      if (Date.now() >= authorizationCooldownUntil) {
        authorizationCooldownUntil = Date.now() + AUTHORIZATION_COOLDOWN_MS;
        console.error("[CINEMATCH_REALTIME_AUTH] Check publisher key, project origin and broadcast permissions.", response.status);
      }
      throw new PublicationAuthorizationError();
    }
    if (response.status === 413) throw new PermanentPublicationError("Realtime event too large");
    if (!response.ok) {
      reportOutage(response.status);
      throw new Error(`Realtime broadcast failed (${response.status})`);
    }
  };
}
