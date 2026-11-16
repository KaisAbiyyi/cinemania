/** Outbox payloads are intentionally excluded: hints never include private votes. */
export type RoomHint = { roomId: string; version: number };
export class PermanentPublicationError extends Error {}
export interface PendingEvent { id: string; version: number }
export interface LockedOutbox {
  pending(): Promise<PendingEvent[]>;
  markDispatched(id: string): Promise<void>;
  recordFailure(id: string, permanent: boolean): Promise<void>;
}
export interface OutboxStore {
  /** Holds an exclusive per-room lock until work settles. */
  withRoomLock<T>(roomId: string, work: (outbox: LockedOutbox) => Promise<T>): Promise<T>;
}

/** Publish at least once, in version order. Consumers must deduplicate hints. */
export async function dispatchPendingEvents(
  roomId: string,
  store: OutboxStore,
  publish: (hint: RoomHint) => Promise<void>,
): Promise<boolean> {
  return store.withRoomLock(roomId, async (outbox) => {
    const events = await outbox.pending();
    let last = -1;
    for (const event of events) {
      if (!Number.isSafeInteger(event.version) || event.version <= last) {
        throw new Error("Outbox events are not strictly ordered");
      }
      last = event.version;
      try {
        await publish({ roomId, version: event.version });
      } catch (error) {
        const permanent = error instanceof PermanentPublicationError;
        await outbox.recordFailure(event.id, permanent);
        if (permanent) console.error("Permanent realtime event rejection; retry or quarantine pending.");
        return false;
      }
      await outbox.markDispatched(event.id);
    }
    return true;
  });
}
