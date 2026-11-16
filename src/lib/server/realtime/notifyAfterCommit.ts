export async function notifyAfterCommit(store: { dispatchRoomNotifications?: (roomId: string) => Promise<void> }, roomId: string): Promise<void> {
  if (!store.dispatchRoomNotifications) return;
  try {
    await store.dispatchRoomNotifications(roomId);
  } catch {
    // The committed outbox row remains pending; a later authenticated request retries it.
    console.warn("Room notification dispatch failed; retry remains pending.");
  }
}
