import { createClient } from "@supabase/supabase-js";
import { createRoomReconciler } from "./roomReconciler";

export interface RoomSnapshot {
  room: { stateVersion: number; [key: string]: unknown };
  [key: string]: unknown;
}

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "degraded" | "closed";

export type RealtimeFailureCode =
  | "TOKEN_REQUEST_FAILED"
  | "TOKEN_INVALID"
  | "UNAUTHORIZED"
  | "SUBSCRIBE_FAILED"
  | "SNAPSHOT_FAILED"
  | "SNAPSHOT_INVALID"
  | "SNAPSHOT_BEHIND";

/** `permanent` failures (the actor lost access or the room is gone) are never retried. */
export class RoomRealtimeError extends Error {
  readonly code: RealtimeFailureCode;
  readonly status?: number;
  readonly permanent: boolean;

  constructor(code: RealtimeFailureCode, message: string, details: { status?: number; permanent?: boolean } = {}) {
    super(message);
    this.name = "RoomRealtimeError";
    this.code = code;
    this.status = details.status;
    this.permanent = details.permanent ?? false;
  }
}

const PERMANENT_HTTP_STATUS = new Set([401, 403, 404, 410]);

export type WakeReason = "visible" | "online" | "focus";

/** Seam for the clock, timers and browser wake-up events so recovery is deterministic in tests. */
export interface RealtimeEnvironment {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
  onWake(listener: (reason: WakeReason) => void): () => void;
}

export interface RealtimeTuning {
  /** Heartbeat granularity. Browsers throttle background timers, so deadlines use wall-clock time. */
  tickMs: number;
  /** A gap between heartbeats larger than this is treated as throttling or sleep: resync everything. */
  throttleGapMs: number;
  /** Snapshot polling that heals a dropped final broadcast. */
  pollMs: number;
  subscribeTimeoutMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  degradedAfterAttempts: number;
  /** Consecutive "hint ahead of snapshot" retries before leaving it to the poll. */
  behindRetryMax: number;
}

export const DEFAULT_REALTIME_TUNING: RealtimeTuning = {
  tickMs: 5000,
  throttleGapMs: 15000,
  pollMs: 15000,
  subscribeTimeoutMs: 10000,
  backoffBaseMs: 500,
  backoffMaxMs: 10000,
  degradedAfterAttempts: 3,
  behindRetryMax: 5,
};

export interface RoomRealtimeHandle {
  (): Promise<void>;
  /** Forces an authoritative snapshot read; resolves after delivery (or rejects on failure). */
  resync(): Promise<void>;
  /** Offers an already-authoritative snapshot (for example a mutation response). */
  accept(snapshot: RoomSnapshot): boolean;
  status(): RealtimeStatus;
}

function defaultEnvironment(): RealtimeEnvironment {
  return {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    random: () => Math.random(),
    onWake(listener) {
      const disposers: Array<() => void> = [];
      if (typeof document !== "undefined") {
        const onVisibility = () => { if (document.visibilityState === "visible") listener("visible"); };
        document.addEventListener("visibilitychange", onVisibility);
        disposers.push(() => document.removeEventListener("visibilitychange", onVisibility));
      }
      if (typeof window !== "undefined") {
        const onOnline = () => listener("online");
        const onFocus = () => listener("focus");
        const onPageShow = () => listener("visible");
        window.addEventListener("online", onOnline);
        window.addEventListener("focus", onFocus);
        window.addEventListener("pageshow", onPageShow);
        disposers.push(() => window.removeEventListener("online", onOnline));
        disposers.push(() => window.removeEventListener("focus", onFocus));
        disposers.push(() => window.removeEventListener("pageshow", onPageShow));
      }
      return () => disposers.forEach((dispose) => dispose());
    },
  };
}

/** Decodes only the `iat`/`exp` timing claims for scheduling. It is never trusted for authorization. */
function readTokenTiming(token: string, now: number): { expiresAt: number; renewAt: number } {
  const fallback = { expiresAt: now + 60000, renewAt: now + 30000 };
  try {
    const part = token.split(".")[1];
    if (!part) return fallback;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { exp?: unknown; iat?: unknown };
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) return fallback;
    const expiresAt = claims.exp * 1000;
    if (expiresAt <= now) return { expiresAt, renewAt: now };
    const lifetime = typeof claims.iat === "number" && claims.exp > claims.iat ? (claims.exp - claims.iat) * 1000 : expiresAt - now;
    // Renew at about half the lifetime (L-005): a hosted private channel closes when its JWT expires.
    return { expiresAt, renewAt: Math.min(expiresAt - 1000, now + Math.max(1000, lifetime / 2)) };
  } catch {
    return fallback;
  }
}

/**
 * Subscribe first; events only invalidate snapshots and are never applied as state.
 *
 * Recovery contract:
 * - CLOSED / CHANNEL_ERROR / TIMED_OUT after the first subscription renew the capability, replace the
 *   channel with a new one (a late setAuth does not revive a closed private channel) and force a
 *   snapshot read once SUBSCRIBED again, with jittered exponential backoff;
 * - the capability is renewed at about half its lifetime using wall-clock deadlines, and failed
 *   renewals retry with backoff and mark the connection degraded once the token has expired;
 * - tab visibility, focus, network-online and heartbeat gaps (background throttling) force a resync;
 * - snapshots are version-gated, so duplicate, reordered or replayed hints never apply twice.
 */
export async function startRoomRealtime(options: {
  roomId: string;
  supabaseUrl: string;
  publishableKey: string;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onError?: (error: Error) => void;
  onStatus?: (status: RealtimeStatus) => void;
  fetcher?: typeof fetch;
  environment?: RealtimeEnvironment;
  tuning?: Partial<RealtimeTuning>;
}): Promise<RoomRealtimeHandle> {
  const get = options.fetcher ?? fetch;
  const env = options.environment ?? defaultEnvironment();
  const tuning: RealtimeTuning = { ...DEFAULT_REALTIME_TUNING, ...options.tuning };
  // setAuth affects every channel on a client, so each room owns its client. Every (re)subscription gets a
  // brand-new client and socket: after an outage realtime-js replays buffered join/leave pushes for the same
  // topic, and a stale leave closes the newest channel, which showed up as a tight live/reconnecting flap.
  const makeClient = () => createClient(options.supabaseUrl, options.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  let client = makeClient();
  let currentToken = "";
  const base = "/api/rooms/" + encodeURIComponent(options.roomId);
  const topic = "room:" + options.roomId;

  let closed = false;
  let terminal = false;
  let status: RealtimeStatus = "connecting";
  let channel: ReturnType<typeof client.channel> | null = null;
  let channelGeneration = 0;
  let channelJoined = false;
  let suppressSync = true;
  let recovering = false;
  let tokenExpiresAt = 0;
  let tokenRenewAt = 0;
  let renewFailures = 0;
  let renewing: Promise<void> | null = null;
  let syncFailures = 0;
  let syncRetryTimer: unknown = null;
  let tickTimer: unknown = null;
  let lastTick = env.now();
  let lastSync = 0;
  let disposeWake: (() => void) | null = null;
  const sleepers = new Set<() => void>();

  const report = (error: unknown) => {
    try { options.onError?.(error instanceof Error ? error : new Error("Realtime failed")); } catch { /* consumer errors must not break recovery */ }
  };
  const setStatus = (next: RealtimeStatus) => {
    if (status === next || (terminal && next !== "closed")) return;
    status = next;
    try { options.onStatus?.(next); } catch { /* consumer errors must not break recovery */ }
  };
  const isPermanent = (error: unknown) => error instanceof RoomRealtimeError && error.permanent;
  const backoff = (attempt: number) => {
    const ceiling = Math.min(tuning.backoffMaxMs, tuning.backoffBaseMs * 2 ** Math.max(0, attempt - 1));
    return Math.round(ceiling * (0.5 + env.random() / 2));
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => {
    const wake = () => { env.clearTimeout(timer); sleepers.delete(wake); resolve(); };
    const timer = env.setTimeout(wake, ms);
    sleepers.add(wake);
  });
  const wakeSleepers = () => { for (const wake of [...sleepers]) wake(); };

  async function fetchToken(): Promise<string> {
    let response: Response;
    try {
      response = await get(base + "/realtime-token", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      throw new RoomRealtimeError("TOKEN_REQUEST_FAILED", "Realtime capability request failed");
    }
    if (PERMANENT_HTTP_STATUS.has(response.status)) {
      throw new RoomRealtimeError("UNAUTHORIZED", "Realtime capability was refused", { status: response.status, permanent: true });
    }
    if (!response.ok) throw new RoomRealtimeError("TOKEN_REQUEST_FAILED", "Realtime capability request failed", { status: response.status });
    let body: { token?: unknown };
    try { body = await response.json() as { token?: unknown }; } catch { body = {}; }
    if (typeof body.token !== "string" || body.token.length === 0) throw new RoomRealtimeError("TOKEN_INVALID", "Invalid realtime capability");
    return body.token;
  }

  /** Single flight: concurrent renewals (heartbeat, recovery, wake-up) share one request. */
  function renewToken(): Promise<void> {
    if (renewing) return renewing;
    renewing = (async () => {
      const token = await fetchToken();
      currentToken = token;
      await client.realtime.setAuth(token);
      const timing = readTokenTiming(token, env.now());
      tokenExpiresAt = timing.expiresAt;
      tokenRenewAt = timing.renewAt;
      renewFailures = 0;
      if (channelJoined && status === "degraded") setStatus("live");
    })().finally(() => { renewing = null; });
    return renewing;
  }

  const reconciler = createRoomReconciler<{ stateVersion: number; snapshot: RoomSnapshot }>({
    loadSnapshot: async () => {
      let response: Response;
      try {
        response = await get(base, { credentials: "same-origin", cache: "no-store" });
      } catch {
        throw new RoomRealtimeError("SNAPSHOT_FAILED", "Room snapshot request failed");
      }
      if (!response.ok) {
        throw new RoomRealtimeError("SNAPSHOT_FAILED", "Room snapshot request failed", { status: response.status, permanent: PERMANENT_HTTP_STATUS.has(response.status) });
      }
      let snapshot: RoomSnapshot;
      try { snapshot = await response.json() as RoomSnapshot; } catch { throw new RoomRealtimeError("SNAPSHOT_INVALID", "Room snapshot was not valid JSON"); }
      if (!snapshot || typeof snapshot.room !== "object" || snapshot.room === null) throw new RoomRealtimeError("SNAPSHOT_INVALID", "Room snapshot has no room");
      return { stateVersion: snapshot.room.stateVersion, snapshot };
    },
    onSnapshot: ({ snapshot }) => { if (!closed && !terminal) options.onSnapshot(snapshot); },
  });

  function terminate(error: unknown) {
    if (terminal || closed) return;
    terminal = true;
    report(error);
    stopBackground();
    setStatus("closed");
    void dropChannel();
  }

  function stopBackground() {
    if (tickTimer !== null) { env.clearTimeout(tickTimer); tickTimer = null; }
    if (syncRetryTimer !== null) { env.clearTimeout(syncRetryTimer); syncRetryTimer = null; }
    disposeWake?.();
    disposeWake = null;
    wakeSleepers();
  }

  /** Discards the channel AND its client/socket without waiting for a leave acknowledgement. */
  async function dropChannel() {
    channelGeneration++;
    channelJoined = false;
    const previous = channel;
    channel = null;
    if (!previous) return;
    const old = client;
    try { void Promise.resolve(old.removeChannel(previous)).catch(() => undefined); } catch { /* socket may already be gone */ }
    try { void Promise.resolve(old.realtime?.disconnect?.()).catch(() => undefined); } catch { /* best effort */ }
  }

  /** Forced authoritative snapshot read with retry. Never throws; failures are reported and retried. */
  async function syncNow(requireVersion?: number): Promise<void> {
    lastSync = env.now();
    try {
      await reconciler.connected();
      if (requireVersion !== undefined && reconciler.currentVersion() < requireVersion) {
        throw new RoomRealtimeError("SNAPSHOT_BEHIND", "Snapshot is older than the announced version");
      }
      syncFailures = 0;
    } catch (error) {
      if (closed || terminal) return;
      if (isPermanent(error)) { terminate(error); return; }
      syncFailures++;
      report(error);
      const behind = error instanceof RoomRealtimeError && error.code === "SNAPSHOT_BEHIND";
      if (behind && syncFailures > tuning.behindRetryMax) return;
      if (syncRetryTimer === null) {
        syncRetryTimer = env.setTimeout(() => { syncRetryTimer = null; void syncNow(requireVersion); }, backoff(syncFailures));
      }
    }
  }

  function onHint(payload: unknown) {
    const hint = payload as { roomId?: unknown; version?: unknown } | null;
    if (closed || terminal || hint?.roomId !== options.roomId) return;
    const version = hint.version;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return;
    if (version <= reconciler.currentVersion()) return; // duplicate, reordered or replayed hint
    void (async () => {
      try {
        await reconciler.notify(version);
        if (reconciler.currentVersion() < version) await syncNow(version);
      } catch (error) {
        if (closed || terminal) return;
        if (isPermanent(error)) { terminate(error); return; }
        report(error);
        void syncNow(version);
      }
    })();
  }

  /** Replaces the channel. Resolves once SUBSCRIBED; rejects on error, close or timeout. */
  async function openChannel(): Promise<void> {
    await dropChannel();
    if (channelGeneration > 1) {
      client = makeClient();
      if (currentToken) await client.realtime.setAuth(currentToken);
    }
    const generation = channelGeneration;
    const next = client.channel(topic, { config: { private: true } });
    next.on("broadcast", { event: "room_changed" }, (message: { payload?: unknown }) => {
      if (generation === channelGeneration) onHint(message.payload);
    });
    channel = next;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = env.setTimeout(() => settle(new RoomRealtimeError("SUBSCRIBE_FAILED", "Private realtime subscription timed out")), tuning.subscribeTimeoutMs);
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        env.clearTimeout(timer);
        if (error) reject(error); else resolve();
      };
      next.subscribe((state: string) => {
        if (closed || terminal || generation !== channelGeneration) return;
        if (state === "SUBSCRIBED") {
          channelJoined = true;
          setStatus("live");
          settle();
          // A later SUBSCRIBED after an internal rejoin also needs a resync: events may have been missed.
          if (!suppressSync) void syncNow();
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          channelJoined = false;
          if (!settled) settle(new RoomRealtimeError("SUBSCRIBE_FAILED", "Private realtime subscription failed"));
          else void recover();
        }
      });
    });
  }

  async function recover(): Promise<void> {
    if (recovering || closed || terminal) return;
    recovering = true;
    setStatus("reconnecting");
    let attempt = 0;
    try {
      while (!closed && !terminal) {
        try {
          await renewToken();
          await openChannel();
          return;
        } catch (error) {
          if (closed || terminal) return;
          if (isPermanent(error)) { terminate(error); return; }
          attempt++;
          report(error);
          setStatus(attempt >= tuning.degradedAfterAttempts ? "degraded" : "reconnecting");
          // A timed-out channel may still join late; never leave a zombie behind during backoff.
          await dropChannel();
          await sleep(backoff(attempt));
        }
      }
    } finally {
      recovering = false;
    }
  }

  async function tick(reason: "timer" | WakeReason) {
    if (closed || terminal) return;
    const now = env.now();
    const gap = now - lastTick;
    lastTick = now;
    const throttled = reason !== "timer" || gap > tuning.throttleGapMs;
    if (now >= tokenRenewAt && !renewing && !recovering) {
      void renewToken().catch((error) => {
        if (closed || terminal) return;
        if (isPermanent(error)) { terminate(error); return; }
        renewFailures++;
        tokenRenewAt = env.now() + backoff(renewFailures);
        report(error);
        if (env.now() >= tokenExpiresAt) setStatus("degraded");
      });
    }
    if (!channelJoined && !recovering) void recover();
    if (throttled) wakeSleepers();
    if (throttled || now - lastSync >= tuning.pollMs) void syncNow();
  }

  function scheduleTick() {
    if (closed || terminal) return;
    // Wake for the renewal deadline too, so a short-lived token is renewed at about half its lifetime.
    const delay = Math.max(1000, Math.min(tuning.tickMs, tokenRenewAt - env.now()));
    tickTimer = env.setTimeout(() => { tickTimer = null; void tick("timer").finally(scheduleTick); }, delay);
  }

  async function shutdown() {
    closed = true;
    stopBackground();
    await dropChannel();
    try { void Promise.resolve(client.realtime?.disconnect?.()).catch(() => undefined); } catch { /* best effort */ }
    setStatus("closed");
  }

  setStatus("connecting");
  try {
    await renewToken();
    await openChannel();
    suppressSync = false;
    lastSync = env.now();
    await reconciler.connected();
  } catch (error) {
    await shutdown();
    throw error;
  }
  lastTick = env.now();
  disposeWake = env.onWake((reason) => { void tick(reason); });
  scheduleTick();

  const handle: RoomRealtimeHandle = Object.assign(() => shutdown(), {
    resync: () => reconciler.connected(),
    accept: (snapshot: RoomSnapshot) => reconciler.accept({ stateVersion: snapshot.room.stateVersion, snapshot }),
    status: () => status,
  });
  return handle;
}
