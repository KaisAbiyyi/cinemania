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

describe("CINE-019 externally accepted snapshots", () => {
  it("accepts an authoritative response once, never backwards, and ignores the later duplicate hint", async () => {
    const seen: number[] = [];
    let loads = 0;
    const client = createRoomReconciler({
      loadSnapshot: async () => { loads++; return { stateVersion: 3 }; },
      onSnapshot: (snapshot) => seen.push(snapshot.stateVersion),
    });
    expect(client.currentVersion()).toBe(-1);
    expect(client.accept({ stateVersion: 3 })).toBe(true);
    expect(client.accept({ stateVersion: 3 })).toBe(false);
    expect(client.accept({ stateVersion: 2 })).toBe(false);
    expect(client.accept({ stateVersion: -1 })).toBe(false);
    expect(client.accept({ stateVersion: 1.5 })).toBe(false);
    await client.notify(3);
    expect(loads).toBe(0);
    expect(seen).toEqual([3]);
    expect(client.currentVersion()).toBe(3);
  });

  it("does not let a slower fetched snapshot overwrite a newer accepted one", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const seen: number[] = [];
    const client = createRoomReconciler({
      loadSnapshot: async () => { await gate; return { stateVersion: 4 }; },
      onSnapshot: (snapshot) => seen.push(snapshot.stateVersion),
    });
    const pending = client.connected();
    client.accept({ stateVersion: 6 });
    release();
    await pending;
    expect(seen).toEqual([6]);
  });
});
