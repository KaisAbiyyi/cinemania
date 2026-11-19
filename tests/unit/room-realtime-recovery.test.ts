// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { RoomRealtimeError, startRoomRealtime, type RealtimeEnvironment, type RealtimeStatus, type WakeReason } from "@/lib/realtime/roomRealtime";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const ROOM = "11111111-1111-4111-8111-111111111111";
const START = 1_800_000_000_000;

async function flush(times = 40) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

class FakeClock implements RealtimeEnvironment {
  current = START;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private wakeListeners = new Set<(reason: WakeReason) => void>();
  now = () => this.current;
  random = () => 0.5; // deterministic: jitter factor 0.75
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.seq; this.timers.set(id, { at: this.current + ms, fn }); return id; };
  clearTimeout = (handle: unknown) => { this.timers.delete(handle as number); };
  onWake = (listener: (reason: WakeReason) => void) => { this.wakeListeners.add(listener); return () => { this.wakeListeners.delete(listener); }; };
  get pendingTimers() { return this.timers.size; }
  get wakeSubscribers() { return this.wakeListeners.size; }
  wake(reason: WakeReason) { for (const listener of [...this.wakeListeners]) listener(reason); }
  /** Runs timers in order up to the target time, flushing promise work between them. */
  async advance(ms: number) {
    const target = this.current + ms;
    for (;;) {
      await flush();
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = Math.max(this.current, due[1].at);
      due[1].fn();
    }
    this.current = target;
    await flush();
  }
  /** Simulates a throttled or frozen tab: wall-clock time passes but no timer ran. Due timers then fire once. */
  async freeze(ms: number) {
    this.current += ms;
    const due = [...this.timers.entries()].filter(([, t]) => t.at <= this.current).sort((a, b) => a[1].at - b[1].at);
    for (const [id, t] of due) { this.timers.delete(id); t.fn(); await flush(); }
    await flush();
  }
}

class FakeChannel {
  handlers: Array<(message: { payload?: unknown }) => void> = [];
  statusCallback: ((state: string) => void) | null = null;
  removed = false;
  constructor(public topic: string, private auto: string[]) {}
  on(_type: string, _filter: unknown, callback: (message: { payload?: unknown }) => void) { this.handlers.push(callback); return this; }
  subscribe(callback: (state: string) => void) {
    this.statusCallback = callback;
    const next = this.auto.shift();
    if (next) queueMicrotask(() => callback(next));
    return this;
  }
  emit(state: string) { this.statusCallback?.(state); }
  hint(payload: unknown) { for (const handler of this.handlers) handler({ payload }); }
}

function jwt(issuedMs: number, ttlSeconds = 60) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(issuedMs / 1000);
  return `${encode({ alg: "HS256" })}.${encode({ iat, exp: iat + ttlSeconds })}.sig`;
}

interface FakeClient { realtime: { setAuth: (t: string) => Promise<void>; disconnect: ReturnType<typeof vi.fn> }; auth: { dispose: ReturnType<typeof vi.fn> } }

interface Rig {
  clock: FakeClock;
  clients: FakeClient[];
  channels: FakeChannel[];
  authTokens: string[];
  server: { tokenRetryAfter: number; tokenSkewMs: number; version: number; snapshotFailures: number; tokenStatus: number; tokenFailures: number; snapshotStatus: number; behindOnce: number };
  delivered: number[];
  errors: RoomRealtimeError[];
  statuses: RealtimeStatus[];
  fetcher: typeof fetch;
  tokenRequests: () => number;
  snapshotRequests: () => number;
  subscribeScript: string[][];
}

function makeRig(subscribeScript: string[][] = []): Rig {
  const clock = new FakeClock();
  const channels: FakeChannel[] = [];
  const clients: FakeClient[] = [];
  const authTokens: string[] = [];
  const server = { version: 1, snapshotFailures: 0, tokenStatus: 200, tokenFailures: 0, snapshotStatus: 200, behindOnce: 0, tokenSkewMs: 0, tokenRetryAfter: 0 };
  let tokens = 0;
  let snapshots = 0;
  const script = [...subscribeScript];
  vi.mocked(createClient).mockImplementation((() => {
    const fake = {
      realtime: { setAuth: async (token: string) => { authTokens.push(token); }, disconnect: vi.fn() },
      auth: { dispose: vi.fn() },
      channel: (topic: string, config: unknown) => {
        expect(config).toEqual({ config: { private: true } });
        const ch = new FakeChannel(topic, script.shift() ?? ["SUBSCRIBED"]);
        channels.push(ch);
        return ch;
      },
      removeChannel: async (ch: FakeChannel) => { ch.removed = true; },
    };
    clients.push(fake);
    return fake;
  }) as never);
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/realtime-token")) {
      tokens++;
      if (server.tokenFailures > 0) { server.tokenFailures--; throw new TypeError("network down"); }
      if (server.tokenStatus !== 200) return new Response("{}", { status: server.tokenStatus, headers: server.tokenRetryAfter ? { "retry-after": String(server.tokenRetryAfter) } : {} });
      return new Response(JSON.stringify({ token: jwt(clock.now() + server.tokenSkewMs) }), { status: 200 });
    }
    snapshots++;
    if (server.snapshotFailures > 0) { server.snapshotFailures--; throw new TypeError("network down"); }
    if (server.snapshotStatus !== 200) return new Response("{}", { status: server.snapshotStatus });
    let version = server.version;
    if (server.behindOnce > 0) { server.behindOnce--; version = Math.max(1, version - 1); }
    return new Response(JSON.stringify({ room: { stateVersion: version }, viewer: {} }), { status: 200 });
  }) as typeof fetch;
  const rig: Rig = {
    clock, clients, channels, authTokens, server, fetcher,
    delivered: [], errors: [], statuses: [], subscribeScript: [],
    tokenRequests: () => tokens,
    snapshotRequests: () => snapshots,
  };
  return rig;
}

async function start(rig: Rig, extra: Partial<Parameters<typeof startRoomRealtime>[0]> = {}) {
  return startRoomRealtime({
    roomId: ROOM,
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "publishable",
    fetcher: rig.fetcher,
    environment: rig.clock,
    onSnapshot: (snapshot) => rig.delivered.push(snapshot.room.stateVersion),
    onError: (error) => rig.errors.push(error as RoomRealtimeError),
    onStatus: (status) => rig.statuses.push(status),
    ...extra,
  });
}

beforeEach(() => { vi.mocked(createClient).mockReset(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("CINE-019 realtime recovery", () => {
  it("replaces a CLOSED channel with a renewed one, resyncs once, and ignores the dead channel", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    expect(rig.delivered).toEqual([1]);
    const first = rig.channels[0];
    rig.server.version = 4; // events were missed while down
    first.emit("CLOSED");
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(2);
    expect(first.removed).toBe(true);
    expect(rig.tokenRequests()).toBe(1); // the capability was still fresh, so it is reused (token budget); the channel is replaced regardless
    expect(rig.delivered).toEqual([1, 4]);
    expect(rig.statuses).toEqual(["live", "reconnecting", "live"]); // "connecting" is the initial state, not an event
    first.hint({ roomId: ROOM, version: 9 }); // stale channel: ignored
    rig.server.version = 9;
    first.emit("SUBSCRIBED"); // a late status from the replaced channel must not resync...
    first.emit("CLOSED"); // ...nor start another recovery
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1, 4]);
    expect(rig.channels).toHaveLength(2);
    expect(rig.tokenRequests()).toBe(1);
    await handle();
  });

  it("backs off through repeated CHANNEL_ERROR and TIMED_OUT, reports degraded, then recovers without duplicate state", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["TIMED_OUT"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(2);
    await rig.clock.advance(400); // first backoff ~375ms (base 500 * 0.75)
    expect(rig.channels).toHaveLength(3);
    await rig.clock.advance(800); // second backoff ~750ms
    expect(rig.channels).toHaveLength(4);
    expect(rig.statuses).toContain("degraded");
    await rig.clock.advance(1600); // third backoff ~1500ms
    expect(rig.channels).toHaveLength(5);
    expect(handle.status()).toBe("live");
    expect(rig.delivered).toEqual([1]); // same authoritative version is never delivered twice
    expect(rig.channels.slice(0, 4).every((c) => c.removed)).toBe(true);
    await handle();
  });

  it("keeps retrying throughout a 90 s outage and is live again as soon as the service returns", async () => {
    const failures = Array.from({ length: 12 }, () => ["CHANNEL_ERROR"]);
    const rig = makeRig([["SUBSCRIBED"], ...failures, ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(60000);
    // Backoff is capped (10 s), so a 90 s reconnect window always contains many attempts.
    expect(rig.channels.length).toBeGreaterThanOrEqual(10);
    expect(handle.status()).toBe("degraded");
    await rig.clock.advance(30000);
    expect(rig.channels).toHaveLength(14);
    expect(handle.status()).toBe("live");
    expect(rig.delivered).toEqual([1]);
    await handle();
  });

  it("gives every resubscription a fresh client and discards the old socket (no replayed join/leave cross-talk)", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    expect(rig.clients).toHaveLength(1);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(2000);
    expect(rig.channels).toHaveLength(3);
    expect(rig.clients).toHaveLength(3); // initial + one per recovery attempt
    expect(rig.clients[0].realtime.disconnect).toHaveBeenCalled();
    expect(rig.clients[1].realtime.disconnect).toHaveBeenCalled();
    expect(rig.clients[2].realtime.disconnect).not.toHaveBeenCalled();
    expect(rig.authTokens.length).toBeGreaterThanOrEqual(3); // the new client is authorised before it joins
    await handle();
    expect(rig.clients[2].realtime.disconnect).toHaveBeenCalled();
  });

  it("rotates the capability make-before-break at about half its lifetime, with no status change and no token push to the live channel", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    await rig.clock.advance(32000);
    expect(rig.channels).toHaveLength(2);
    expect(rig.clients).toHaveLength(2);
    expect(rig.channels[0].removed).toBe(true); // retired only after the replacement joined
    expect(rig.channels[1].removed).toBe(false);
    expect(rig.clients[0].realtime.disconnect).toHaveBeenCalled();
    expect(rig.statuses).toEqual(["live"]);
    expect(rig.authTokens).toHaveLength(2); // one setAuth per NEW client, never a push to a joined channel
    rig.server.version = 3;
    rig.channels[0].hint({ roomId: ROOM, version: 3 }); // retired channel: ignored
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1]);
    rig.channels[1].hint({ roomId: ROOM, version: 3 });
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1, 3]);
    await rig.clock.advance(30000);
    expect(rig.channels).toHaveLength(3); // keeps rotating
    expect(rig.statuses).toEqual(["live"]);
    await handle();
  });

  it("keeps the old channel when a rotation cannot join, and retries soon", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"]]);
    const handle = await start(rig);
    await rig.clock.advance(30500); // first rotation attempt at ~30 s fails
    expect(rig.channels).toHaveLength(2);
    expect(rig.channels[1].removed).toBe(true); // failed candidate discarded
    expect(rig.channels[0].removed).toBe(false); // old one still serving
    expect(handle.status()).toBe("live");
    expect(rig.errors.some((e) => e.code === "SUBSCRIBE_FAILED")).toBe(true);
    await rig.clock.advance(3000); // retry within seconds, not at the next half-life
    expect(rig.channels).toHaveLength(3);
    expect(rig.channels[0].removed).toBe(true);
    expect(rig.channels[2].removed).toBe(false);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("treats a subscription that never answers as a failure and retries", async () => {
    const rig = makeRig([["SUBSCRIBED"], [], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(2);
    await rig.clock.advance(10000); // subscribe timeout
    expect(rig.errors.some((e) => e.code === "SUBSCRIBE_FAILED")).toBe(true);
    await rig.clock.advance(1000);
    expect(rig.channels).toHaveLength(3);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("renews the capability at about half its lifetime", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    expect(rig.tokenRequests()).toBe(1);
    await rig.clock.advance(25000);
    expect(rig.tokenRequests()).toBe(1);
    await rig.clock.advance(7000);
    expect(rig.tokenRequests()).toBe(2);
    expect(rig.authTokens).toHaveLength(2);
    await rig.clock.advance(30000);
    expect(rig.tokenRequests()).toBe(3);
    await handle();
  });

  it("retries failed renewals with backoff, degrades after expiry, and returns to live after success", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.tokenFailures = 100;
    await rig.clock.advance(70000);
    expect(rig.errors.some((e) => e.code === "TOKEN_REQUEST_FAILED")).toBe(true);
    expect(rig.tokenRequests()).toBeGreaterThan(4); // retried repeatedly, not once per 30s
    expect(handle.status()).not.toBe("live"); // expired token cannot be reported as live
    rig.server.tokenFailures = 0;
    await rig.clock.advance(15000);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("stops permanently when renewal is refused instead of hammering the endpoint", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.tokenStatus = 403;
    await rig.clock.advance(35000);
    const requests = rig.tokenRequests();
    await rig.clock.advance(120000);
    expect(rig.tokenRequests()).toBe(requests);
    expect(handle.status()).toBe("closed");
    expect(rig.errors.at(-1)).toMatchObject({ code: "UNAUTHORIZED", permanent: true, status: 403 });
    expect(rig.clock.pendingTimers).toBe(0);
    await handle();
  });

  it("recovers after a throttled background tab missed the whole token lifetime", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.version = 6;
    rig.channels[0].emit("CLOSED"); // server closed the expired channel while the tab slept
    await rig.clock.freeze(0);
    await rig.clock.freeze(300000); // five minutes without a timer firing
    await rig.clock.advance(0);
    expect(rig.delivered.at(-1)).toBe(6);
    expect(handle.status()).toBe("live");
    expect(rig.tokenRequests()).toBeGreaterThanOrEqual(2);
    await handle();
  });

  it("forces a resync when the tab becomes visible or the network returns", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.version = 3;
    rig.clock.wake("visible");
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1, 3]);
    rig.server.version = 5;
    await rig.clock.advance(1000); // wake-ups closer than 1 s are coalesced
    rig.clock.wake("online");
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1, 3, 5]);
    await handle();
  });

  it("wakes a backing-off recovery immediately when the network returns", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(2);
    rig.clock.wake("online"); // no timer advance: the backoff sleep is cut short
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(3);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("coalesces bursts of wake-up events into one resync", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    await rig.clock.advance(1000);
    const before = rig.snapshotRequests();
    for (const reason of ["focus", "visible", "online", "visible", "focus"] as const) rig.clock.wake(reason);
    await rig.clock.advance(0);
    expect(rig.snapshotRequests() - before).toBe(1);
    await rig.clock.advance(1000);
    rig.clock.wake("focus");
    await rig.clock.advance(0);
    expect(rig.snapshotRequests() - before).toBe(2);
    await handle();
  });

  it("does not re-join in a tight loop when the server keeps accepting then dropping the channel", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    for (let cycle = 0; cycle < 12; cycle++) {
      rig.channels[rig.channels.length - 1].emit("CLOSED");
      await rig.clock.advance(100);
    }
    // 12 drops in ~1.2 s must not produce 12 immediate sockets: the flap guard backs off (0.5 s .. 10 s)
    expect(rig.channels.length).toBeLessThanOrEqual(5);
    await rig.clock.advance(60000);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("times out a hung token request so recovery is not wedged", async () => {
    const rig = makeRig();
    const real = rig.fetcher;
    let hung = false;
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => (hung && String(input).endsWith("/realtime-token") ? new Promise<Response>(() => {}) : real(input, init))) as typeof fetch;
    const handle = await start(rig, { fetcher: wrapped });
    rig.clock.current += 0;
    hung = true;
    await rig.clock.advance(31000); // the rotation's token request hangs
    rig.channels[0].emit("CLOSED"); // and the channel dies too (the token is past half-life, so recovery must fetch)
    await rig.clock.advance(20000); // longer than the 15 s request deadline
    expect(rig.errors.some((e) => e.code === "TOKEN_REQUEST_FAILED")).toBe(true);
    hung = false;
    await rig.clock.advance(30000);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("times out a hung snapshot request so resync and polling recover", async () => {
    const rig = makeRig();
    let hungSnapshots = false;
    const real = rig.fetcher;
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => (hungSnapshots && !String(input).endsWith("/realtime-token") ? new Promise<Response>(() => {}) : real(input, init))) as typeof fetch;
    const handle = await start(rig, { fetcher: wrapped });
    hungSnapshots = true;
    const stuck = handle.resync().catch((e) => e);
    await rig.clock.advance(16000);
    expect(await stuck).toMatchObject({ code: "SNAPSHOT_FAILED" });
    hungSnapshots = false;
    rig.server.version = 5;
    await rig.clock.advance(16000);
    expect(rig.delivered.at(-1)).toBe(5);
    await handle();
  });

  it("a rotation retry after a failed join reuses the token it already fetched (token endpoint budget)", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["CHANNEL_ERROR"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    await rig.clock.advance(45000);
    // initial + the one fetch for the rotation that is retried 3 times; never one fetch per retry
    expect(rig.tokenRequests()).toBeLessThanOrEqual(2);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("never lets the unused auth client initialise, and gives every client its own storage key", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(3000);
    const calls = vi.mocked(createClient).mock.calls as unknown as Array<[string, string, { auth?: { skipAutoInitialize?: boolean; storageKey?: string } }]>;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => c[2]?.auth?.skipAutoInitialize === true)).toBe(true);
    expect(new Set(calls.map((c) => c[2]?.auth?.storageKey)).size).toBe(calls.length);
    await handle();
  });

  it("does not swallow wake-ups after a backwards clock step, and treats the token deadline as due", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    await rig.clock.advance(1000);
    rig.server.version = 4;
    rig.clock.wake("visible");
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1, 4]);
    rig.clock.current -= 60_000; // NTP correction after sleep
    rig.server.version = 6;
    rig.clock.wake("online");
    await rig.clock.advance(0);
    expect(rig.delivered).toEqual([1, 4, 6]);
    // the token fetched "in the future" is rotated now instead of being trusted until the clock catches up
    await rig.clock.advance(1000);
    expect(rig.channels.length).toBeGreaterThanOrEqual(2);
    await handle();
  });

  it("never reuses a token that looks fetched in the future after a backwards clock step", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    await rig.clock.advance(1000);
    rig.clock.current -= 3_600_000; // wall clock corrected an hour backwards
    const before = rig.tokenRequests();
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(0);
    expect(rig.tokenRequests()).toBeGreaterThan(before); // fresh capability, not the (possibly expired) old one
    await handle();
  });

  it("applies the backwards-clock correction once per token: a failing token endpoint keeps its backoff", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    await rig.clock.advance(1000);
    rig.clock.current -= 3_600_000;
    rig.server.tokenStatus = 503;
    const before = rig.tokenRequests();
    for (let i = 0; i < 24; i++) { rig.clock.wake("visible"); await rig.clock.advance(5000); } // two minutes of ticks and wakes
    // with the old behaviour every tick restarted a rotation (about 24 requests); now backoff and the 10 s cap apply
    expect(rig.tokenRequests() - before).toBeLessThanOrEqual(14);
    await handle();
  });

  it("a token request that fails after its deadline never becomes an unhandled rejection", async () => {
    const rig = makeRig();
    const real = rig.fetcher;
    let rejectLate!: (e: Error) => void;
    let hung = false;
    const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (hung && String(input).endsWith("/realtime-token")) return new Promise<Response>((_, reject) => { rejectLate = reject; });
      return real(input, init);
    }) as typeof fetch;
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const handle = await start(rig, { fetcher: wrapped });
      hung = true;
      await rig.clock.advance(31000 + 16000); // rotation request exceeds the 15 s deadline
      hung = false;
      rejectLate(new Error("socket reset long after the deadline"));
      await rig.clock.advance(0);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      await handle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a coalesced wake still cuts a recovery backoff short", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(2); // first attempt failed, now backing off
    rig.clock.wake("online");
    rig.clock.wake("online"); // coalesced
    await rig.clock.advance(0);
    expect(rig.channels).toHaveLength(3);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it("keeps the token endpoint within a small budget during a long outage by reusing a fresh capability", async () => {
    const failures = Array.from({ length: 40 }, () => ["CHANNEL_ERROR"]);
    const rig = makeRig([["SUBSCRIBED"], ...failures]);
    const handle = await start(rig);
    expect(rig.tokenRequests()).toBe(1);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(28000); // many join attempts, all inside the first half of the token's life
    expect(rig.channels.length).toBeGreaterThanOrEqual(6);
    expect(rig.tokenRequests()).toBe(1);
    await rig.clock.advance(60000);
    // About one refresh per half-life, never one per attempt (per-guest limit is 12 requests/minute).
    expect(rig.tokenRequests()).toBeLessThanOrEqual(5);
    await handle();
  });

  it("fetches a new capability for recovery once the previous one is past half its life (stale token)", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.tokenFailures = 3; // rotation cannot refresh the token...
    await rig.clock.advance(29000);
    rig.channels[0].emit("CLOSED"); // ...but the channel dies at 29 s of a 60 s token (fresh enough)
    await rig.clock.advance(0);
    const afterFresh = rig.tokenRequests();
    await rig.clock.advance(6000); // now >30 s old: the next recovery attempt must fetch
    expect(rig.tokenRequests()).toBeGreaterThan(afterFresh);
    await rig.clock.advance(20000);
    await handle();
  });

  it("honours Retry-After from a rate-limited token endpoint for rotation and recovery", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.tokenStatus = 429;
    rig.server.tokenRetryAfter = 20;
    await rig.clock.advance(31000); // rotation attempt at ~30 s is refused
    const afterFirst = rig.tokenRequests();
    expect(afterFirst).toBe(2);
    await rig.clock.advance(15000); // still inside the requested pause
    expect(rig.tokenRequests()).toBe(afterFirst);
    rig.server.tokenStatus = 200;
    await rig.clock.advance(8000); // pause over
    expect(rig.tokenRequests()).toBeGreaterThan(afterFirst);
    expect(handle.status()).toBe("live");
    await handle();
  });

  it.each([-120000, 120000, 3_600_000])("never rotates in a loop when the client clock is skewed by %i ms", async (skew) => {
    const rig = makeRig();
    rig.server.tokenSkewMs = skew; // tokens look already expired (or far in the future) to the client clock
    const handle = await start(rig);
    const before = rig.tokenRequests();
    await rig.clock.advance(65000);
    expect(rig.tokenRequests() - before).toBeLessThanOrEqual(3); // about one rotation per 30 s, never per heartbeat
    expect(rig.channels.length).toBeLessThanOrEqual(4);
    expect(rig.statuses).toEqual(["live"]);
    await handle();
  });

  it("disposes the auth client of every discarded client (no leaked window listeners)", async () => {
    const rig = makeRig([["SUBSCRIBED"], ["CHANNEL_ERROR"], ["SUBSCRIBED"]]);
    const handle = await start(rig);
    rig.channels[0].emit("CLOSED");
    await rig.clock.advance(3000);
    await rig.clock.advance(32000); // plus one rotation
    await handle();
    expect(rig.clients.length).toBeGreaterThanOrEqual(4);
    for (const client of rig.clients) {
      expect(client.auth.dispose).toHaveBeenCalledTimes(1);
      expect(client.realtime.disconnect).toHaveBeenCalled();
    }
  });

  it("close() during an in-flight rotation disposes the half-open client immediately", async () => {
    const rig = makeRig([["SUBSCRIBED"], []]); // the rotation channel never answers
    const handle = await start(rig);
    await rig.clock.advance(31000);
    expect(rig.channels).toHaveLength(2);
    expect(rig.channels[1].removed).toBe(false);
    await handle();
    expect(rig.channels.every((c) => c.removed)).toBe(true);
    expect(rig.clients.every((c) => c.realtime.disconnect.mock.calls.length > 0)).toBe(true);
    expect(rig.clock.pendingTimers).toBe(0);
    await rig.clock.advance(20000);
    expect(rig.channels).toHaveLength(2);
    expect(rig.errors.filter((e) => e.code === "SUBSCRIBE_FAILED").length).toBeLessThanOrEqual(1);
  });

  it("reports degraded when the ACTIVE channel's own token expires and every rotation fails to join", async () => {
    const rig = makeRig([["SUBSCRIBED"], ...Array.from({ length: 30 }, () => ["CHANNEL_ERROR"])]);
    const handle = await start(rig);
    await rig.clock.advance(70000); // tokens keep being fetched, but no replacement ever joins
    expect(handle.status()).toBe("degraded");
    await handle();
  });

  it("applies duplicate, reordered and replayed hints at most once and never backwards", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    const channel = rig.channels[0];
    for (const version of [3, 2, 3, 5, 4, 5, 1]) {
      rig.server.version = Math.max(rig.server.version, version);
      channel.hint({ roomId: ROOM, version });
      await rig.clock.advance(0);
    }
    expect(rig.delivered).toEqual([1, 3, 5]);
    expect(rig.delivered).toEqual([...rig.delivered].sort((a, b) => a - b));
    await handle();
  });

  it("ignores hints for another room and malformed hints", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.version = 7;
    const before = rig.snapshotRequests();
    for (const payload of [{ roomId: "other", version: 7 }, { roomId: ROOM, version: "7" }, { roomId: ROOM, version: 1.5 }, { roomId: ROOM, version: -1 }, null, undefined]) {
      rig.channels[0].hint(payload);
    }
    await rig.clock.advance(0);
    expect(rig.snapshotRequests()).toBe(before);
    expect(rig.delivered).toEqual([1]);
    await handle();
  });

  it("retries a failed snapshot quickly instead of waiting for the next poll", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.version = 2;
    rig.server.snapshotFailures = 2;
    rig.channels[0].hint({ roomId: ROOM, version: 2 });
    await rig.clock.advance(3000);
    expect(rig.delivered).toEqual([1, 2]);
    expect(rig.errors.filter((e) => e.code === "SNAPSHOT_FAILED").length).toBeGreaterThanOrEqual(1);
    await handle();
  });

  it("retries when the snapshot is briefly behind the announced version until it catches up", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.version = 9;
    rig.server.behindOnce = 2;
    rig.channels[0].hint({ roomId: ROOM, version: 9 });
    await rig.clock.advance(5000);
    expect(rig.delivered).toEqual([1, 8, 9]);
    await handle();
  });

  it("does not retry a hint from the future forever", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    const before = rig.snapshotRequests();
    rig.channels[0].hint({ roomId: ROOM, version: 5000 });
    await rig.clock.advance(14000); // below the 15s poll
    const hintDriven = rig.snapshotRequests() - before;
    expect(hintDriven).toBeLessThanOrEqual(8);
    await handle();
  });

  it("closes the client when the room disappears", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.snapshotStatus = 404;
    rig.clock.wake("visible");
    await rig.clock.advance(0);
    expect(handle.status()).toBe("closed");
    expect(rig.errors.at(-1)).toMatchObject({ code: "SNAPSHOT_FAILED", permanent: true, status: 404 });
    await handle();
  });

  it("heals a dropped final broadcast by polling the snapshot", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    rig.server.version = 2; // no hint is ever delivered
    await rig.clock.advance(16000);
    expect(rig.delivered).toEqual([1, 2]);
    await handle();
  });

  it("accepts a mutation response snapshot once and ignores the later duplicate hint", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    expect(handle.accept({ room: { stateVersion: 2 }, viewer: {} })).toBe(true);
    expect(handle.accept({ room: { stateVersion: 2 }, viewer: {} })).toBe(false);
    rig.server.version = 2;
    const before = rig.snapshotRequests();
    rig.channels[0].hint({ roomId: ROOM, version: 2 });
    await rig.clock.advance(0);
    expect(rig.snapshotRequests()).toBe(before);
    expect(rig.delivered).toEqual([1, 2]);
    await handle();
  });

  it("cleans every timer, listener and channel on close, and a failed start leaks nothing", async () => {
    const rig = makeRig();
    const handle = await start(rig);
    expect(rig.clock.wakeSubscribers).toBe(1);
    await handle();
    expect(rig.channels.every((c) => c.removed)).toBe(true);
    expect(rig.clock.pendingTimers).toBe(0);
    expect(rig.clock.wakeSubscribers).toBe(0);
    expect(handle.status()).toBe("closed");

    const failing = makeRig([["CHANNEL_ERROR"]]);
    await expect(start(failing)).rejects.toMatchObject({ code: "SUBSCRIBE_FAILED" });
    expect(failing.channels.every((c) => c.removed)).toBe(true);
    expect(failing.clock.pendingTimers).toBe(0);
    expect(failing.clock.wakeSubscribers).toBe(0);
  });

  it("rejects the initial start when the capability is refused", async () => {
    const rig = makeRig();
    rig.server.tokenStatus = 401;
    await expect(start(rig)).rejects.toMatchObject({ code: "UNAUTHORIZED", permanent: true });
    expect(rig.channels).toHaveLength(0);
  });
});
