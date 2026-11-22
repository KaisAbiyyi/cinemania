import { PublicationAuthorizationError, PublicationDeferredError } from "./dispatch";

export async function notifyAfterCommit(store: { dispatchRoomNotifications?: (roomId: string) => Promise<void> }, roomId: string): Promise<void> {
  if (!store.dispatchRoomNotifications) return;
  try {
    await store.dispatchRoomNotifications(roomId);
  } catch (error) {
    // The committed row remains pending for the independent worker (or another fast-path attempt).
    // Sanitized category only (no message, SQL or room identifiers) so lock contention can be told
    // apart from provider transport failures in logs.
    console.warn("Room notification dispatch failed; retry remains pending.", JSON.stringify({ category: dispatchFailureCategory(error) }));
  }
}

export function dispatchFailureCategory(error: unknown): "outbox_lock_timeout" | "database" | "provider_transport" | "provider_status" | "deferred" | "authorization" | "other" {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "55P03") return "outbox_lock_timeout";
  if (code.length === 5) return "database";
  if (error instanceof PublicationDeferredError) return "deferred";
  if (error instanceof PublicationAuthorizationError) return "authorization";
  if (error instanceof Error && error.message === "Realtime provider request failed") return "provider_transport";
  if (error instanceof Error && /^Realtime broadcast failed \(\d{3}\)$/.test(error.message)) return "provider_status";
  return "other";
}
