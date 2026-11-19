import { describe, expect, it } from "vitest";
import { dispatchPendingEvents, PermanentPublicationError, PublicationDeferredError } from "@/lib/server/realtime/dispatch";

describe("outbox dispatch", () => {
  it("sends only room and version in order and marks after publication", async () => {
    const steps: string[] = [];
    const events = [{ id: "a", version: 1 }, { id: "b", version: 2 }];
    await dispatchPendingEvents("room-a", {
      withRoomLock: async (_room, work) => work({
        pending: async () => events,
        markDispatched: async (id) => { steps.push(`marked:${id}`); },
        recordFailure: async () => {},
      }),
    }, async (hint) => { steps.push(JSON.stringify(hint)); });
    expect(steps).toEqual(['{"roomId":"room-a","version":1}', "marked:a", '{"roomId":"room-a","version":2}', "marked:b"]);
  });
  it("does not send later versions after a publish failure", async () => {
    const steps: string[] = [];
    await dispatchPendingEvents("room-a", {
      withRoomLock: async (_room, work) => work({
        pending: async () => [{ id: "a", version: 1 }, { id: "b", version: 2 }],
        markDispatched: async (id) => { steps.push(`marked:${id}`); },
        recordFailure: async (id) => { steps.push(`failed:${id}`); },
      }),
    }, async (hint) => { steps.push(`send:${hint.version}`); throw new Error("offline"); });
    expect(steps).toEqual(["send:1", "failed:a"]);
  });
  it("distinguishes permanent event rejection from recoverable provider outages", async () => {
    const failures: boolean[] = [];
    const store = { withRoomLock: async <T>(_room: string, work: (outbox: import("@/lib/server/realtime/dispatch").LockedOutbox) => Promise<T>) => work({
      pending: async () => [{ id: "a", version: 1 }],
      markDispatched: async () => {},
      recordFailure: async (_id: string, permanent: boolean) => { failures.push(permanent); },
    }) };
    await dispatchPendingEvents("room-a", store, async () => { throw new Error("provider unavailable"); });
    await dispatchPendingEvents("room-a", store, async () => { throw new PermanentPublicationError(); });
    expect(failures).toEqual([false, true]);
  });
  it("keeps a deferred event pending without recording a failure or sending later versions", async () => {
    const steps: string[] = [];
    const sent = await dispatchPendingEvents("room-a", {
      withRoomLock: async (_room, work) => work({
        pending: async () => [{ id: "a", version: 1 }, { id: "b", version: 2 }],
        markDispatched: async (id) => { steps.push(`marked:${id}`); },
        recordFailure: async (id) => { steps.push(`failed:${id}`); },
      }),
    }, async (hint) => { steps.push(`send:${hint.version}`); throw new PublicationDeferredError(); });
    expect(sent).toBe(false);
    expect(steps).toEqual(["send:1"]);
  });
});
