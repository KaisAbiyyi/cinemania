export async function notifyAfterCommit(store: { dispatchRoomNotifications?: (roomId: string) => Promise<void> }, roomId: string): Promise<void> {
  if (!store.dispatchRoomNotifications) return;
  try {
    await store.dispatchRoomNotifications(roomId);
  } catch {
    // The committed row remains pending for the independent worker (or another fast-path attempt).
    console.warn("Room notification dispatch failed; retry remains pending.");
  }
}
