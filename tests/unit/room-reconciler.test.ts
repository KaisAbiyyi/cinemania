import { describe, expect, it } from "vitest";
import { createRoomReconciler } from "@/lib/realtime/roomReconciler";

describe("room notification reconciliation", () => {
  it("loads authoritative snapshots and ignores duplicate and stale notifications", async () => {
    let loads = 0;
    const delivered: number[] = [];
    const client = createRoomReconciler({
      loadSnapshot: async () => ({ stateVersion: ++loads }),
      onSnapshot: (snapshot) => delivered.push(snapshot.stateVersion),
    });
    await client.connected();
    await client.notify(2);
    await client.notify(2);
    await client.notify(1);
    expect(delivered).toEqual([1, 2]);
  });

  it("fetches again when a newer event arrives during a snapshot read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const versions = [1, 2, 3];
    const delivered: number[] = [];
    const client = createRoomReconciler({
      loadSnapshot: async () => {
        const version = versions.shift()!;
        if (version === 2) await gate;
        return { stateVersion: version };
      },
      onSnapshot: (snapshot) => delivered.push(snapshot.stateVersion),
    });
    await client.connected();
    const pending = client.notify(2);
    const next = client.notify(3);
    release();
    await Promise.all([pending, next]);
    expect(delivered).toEqual([1, 2, 3]);
  });
});

  it("does not deliver a duplicate snapshot when reconnecting without a state change", async () => {
    const seen: number[] = [];
    const client = createRoomReconciler({
      loadSnapshot: async () => ({ stateVersion: 7 }),
      onSnapshot: (snapshot) => seen.push(snapshot.stateVersion),
    });
    await client.connected();
    await client.connected();
    expect(seen).toEqual([7]);
  });

it("re-reads after a reconnect that happens during an earlier snapshot request", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let loads = 0;
  const client = createRoomReconciler({
    loadSnapshot: async () => { loads++; if (loads === 1) await gate; return { stateVersion: loads }; },
    onSnapshot: () => {},
  });
  const first = client.connected();
  const reconnect = client.connected();
  release();
  await Promise.all([first, reconnect]);
  expect(loads).toBe(2);
});
