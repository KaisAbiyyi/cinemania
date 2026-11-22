/** Outbox payloads are intentionally excluded: hints never include private votes. */
export type RoomHint = { roomId: string; version: number };
export class PermanentPublicationError extends Error {}
export class PublicationAuthorizationError extends Error {}
/**
 * The publisher already knows the provider is unavailable and made no request. The event stays
 * pending with its existing retry schedule: no database failure is recorded, so queued request
 * paths release their pooled connection immediately instead of each waiting out the provider timeout.
 */
export class PublicationDeferredError extends Error {}
export interface PendingEvent { id: string; version: number }
export interface LockedOutbox {
  readyHead(): Promise<PendingEvent | undefined>;
  markDispatched(id: string): Promise<void>;
  recordFailure(id: string, permanent: boolean, authorization: boolean): Promise<void>;
}
export interface OutboxStore {
  /** Holds an exclusive per-room lock until work settles. */
  withRoomLock<T>(roomId: string, work: (outbox: LockedOutbox) => Promise<T>): Promise<T>;
}

/** Publish in durable head order. An ambiguous acknowledgement can replay the head. */
export async function dispatchPendingEvents(
  roomId: string,
  store: OutboxStore,
  publish: (hint: RoomHint) => Promise<void>,
): Promise<boolean> {
  let last = -1;
  for (let sent = 0; sent < 3; sent++) {
    // Commit this acknowledgement before sending a later version. If this transaction
    // rolls back, only the current head can have been sent without a durable mark.
    const result = await store.withRoomLock(roomId, async (outbox) => {
      const event = await outbox.readyHead();
      if (!event) return "idle";
      if (!Number.isSafeInteger(event.version) || event.version <= last) {
        throw new Error("Outbox events are not strictly ordered");
      }
      last = event.version;
      try {
        await publish({ roomId, version: event.version });
      } catch (error) {
        if (error instanceof PublicationDeferredError) return "pending";
        const permanent = error instanceof PermanentPublicationError;
        await outbox.recordFailure(event.id, permanent, error instanceof PublicationAuthorizationError);
        if (permanent) console.error("[CINEMATCH_REALTIME_REJECTED] Check provider payload limits and quarantined events.");
        return "pending";
      }
      await outbox.markDispatched(event.id);
      return "sent";
    });
    if (result !== "sent") return result === "idle";
  }
  return true;
}
