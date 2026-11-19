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
  /** Server-requested pause (`Retry-After`), honoured by the retry schedules. */
  readonly retryAfterMs?: number;

  constructor(code: RealtimeFailureCode, message: string, details: { status?: number; permanent?: boolean; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "RoomRealtimeError";
    this.code = code;
    this.status = details.status;
    this.permanent = details.permanent ?? false;
    this.retryAfterMs = details.retryAfterMs;
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
  /** Minimum gap between wake-triggered resyncs (focus/visibility/online can fire in bursts). */
  wakeMinIntervalMs: number;
  /** Upper bound for a token or snapshot request including its body; a hung request must not wedge recovery. */
  fetchTimeoutMs: number;
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
  wakeMinIntervalMs: 1000,
  fetchTimeoutMs: 15000,
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

/** Smallest gap between two scheduled rotations, so no token can ever cause a rotation storm. */
const MIN_ROTATION_INTERVAL_MS = 5000;
const FALLBACK_LIFETIME_MS = 60000;
/** Longest server-requested pause the client will honour. */
const MAX_RETRY_AFTER_MS = 60000;

/**
 * Decodes only the token's LIFETIME (`exp - iat`) for scheduling. It is never trusted for authorization and
 * deliberately never compares `exp` with the client clock: a client whose clock is far ahead of the server
 * would otherwise see every fresh token as already expired and rotate in a tight loop.
 * Deadlines are measured from the local time the token was fetched.
 */
function readTokenLifetimeMs(token: string): number {
  try {
    const part = token.split(".")[1];
    if (!part) return FALLBACK_LIFETIME_MS;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { exp?: unknown; iat?: unknown };
    if (typeof claims.exp !== "number" || typeof claims.iat !== "number") return FALLBACK_LIFETIME_MS;
    const lifetime = (claims.exp - claims.iat) * 1000;
    return Number.isFinite(lifetime) && lifetime > 0 ? lifetime : FALLBACK_LIFETIME_MS;
  } catch {
    return FALLBACK_LIFETIME_MS;
  }
}

/**
 * Subscribe first; events only invalidate snapshots and are never applied as state.
 *
 * Recovery contract:
 * - CLOSED / CHANNEL_ERROR / TIMED_OUT after the first subscription fetch a new capability, replace the
 *   channel with one on a brand-new client/socket (a late setAuth does not revive a closed private
 *   channel) and force a snapshot read once SUBSCRIBED again, with jittered exponential backoff;
 * - the capability is rotated make-before-break at about half its lifetime using wall-clock deadlines
 *   (a token pushed to a joined channel makes the server close it early); failed rotations keep the old
 *   channel, retry with backoff and mark the connection degraded once the token has expired;
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
  // Every subscription (initial, rotation, recovery) owns a brand-new client and socket:
  // - after an outage realtime-js replays buffered join/leave pushes for the same topic on one socket and a
  //   stale leave closes the newest channel (observed as a tight live/reconnecting flap, CINE-019 scenario D);
  // - pushing a renewed token to a joined private channel (setAuth) made the local Realtime server close it
  //   EARLY (renewal at 30 s closed the channel at 50 s; at 20 s, at 30 s), so renewal is make-before-break.
  // The auth client is never used (the capability is set directly on the realtime socket). It would still
  // register a window visibilitychange listener per client, so it is not initialised and is disposed.
  // A unique storage key per client keeps auth-js from logging "Multiple GoTrueClient instances" on every rotation.
  let clientSeq = 0;
  const makeClient = () => createClient(options.supabaseUrl, options.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, storageKey: `cinematch-realtime-${options.roomId}-${++clientSeq}` },
  });
  interface Slot {
    client: ReturnType<typeof makeClient>;
    channel: ReturnType<ReturnType<typeof makeClient>["channel"]>;
    joined: boolean;
    dead: boolean;
    /** Local deadline of the capability this slot joined with (never derived from the server clock). */
    expiresAt: number;
    /** Local time that capability was fetched. */
    tokenFetchedAt: number;
    /** Rejects an in-flight join when the slot is disposed. */
    abort?: (error: Error) => void;
  }
  const slots = new Set<Slot>();
  const base = "/api/rooms/" + encodeURIComponent(options.roomId);
  const topic = "room:" + options.roomId;

  let closed = false;
  let terminal = false;
  let status: RealtimeStatus = "connecting";
  let active: Slot | null = null;
  let recovering = false;
  let rotating: Promise<void> | null = null;
  let fetching: Promise<void> | null = null;
  let currentToken = "";
  let tokenExpiresAt = 0;
  let tokenFetchedAt = 0;
  let tokenLifetimeMs = 0;
  let tokenRenewAt = 0;
  let renewFailures = 0;
  let syncFailures = 0;
  let behindFailures = 0;
  let lastWake = -Infinity;
  let lastRecoveryAt = -Infinity;
  let clockStepHandledFor = -1;
  let flaps = 0;
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

  /** Rotate at about half the token lifetime (L-005), never more often than MIN_ROTATION_INTERVAL_MS. */
  function scheduleRenewFromToken() {
    tokenRenewAt = tokenFetchedAt + Math.max(MIN_ROTATION_INTERVAL_MS, tokenLifetimeMs / 2);
  }

  /** Runs a request with a hard deadline (also aborting the underlying fetch where supported). */
  async function withTimeout<T>(run: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timer: unknown;
    const deadline = new Promise<never>((_, reject) => {
      timer = env.setTimeout(() => { controller?.abort(); reject(new Error("request timed out")); }, tuning.fetchTimeoutMs);
    });
    const work = run(controller?.signal);
    work.catch(() => undefined); // a late failure after the deadline must not become an unhandled rejection
    try { return await Promise.race([work, deadline]); } finally { env.clearTimeout(timer); }
  }

  async function fetchToken(): Promise<string> {
    let result: { status: number; ok: boolean; retryAfter: string | null; body: { token?: unknown } };
    try {
      result = await withTimeout(async (signal) => {
        const response = await get(base + "/realtime-token", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}", ...(signal ? { signal } : {}) });
        let body: { token?: unknown } = {};
        try { body = await response.json() as { token?: unknown }; } catch { body = {}; }
        return { status: response.status, ok: response.ok, retryAfter: response.headers?.get("retry-after") ?? null, body };
      });
    } catch {
      throw new RoomRealtimeError("TOKEN_REQUEST_FAILED", "Realtime capability request failed");
    }
    if (PERMANENT_HTTP_STATUS.has(result.status)) {
      throw new RoomRealtimeError("UNAUTHORIZED", "Realtime capability was refused", { status: result.status, permanent: true });
    }
    if (!result.ok) {
      const retryAfterMs = Math.min(MAX_RETRY_AFTER_MS, Number(result.retryAfter) * 1000 || 0) || undefined;
      throw new RoomRealtimeError("TOKEN_REQUEST_FAILED", "Realtime capability request failed", { status: result.status, retryAfterMs });
    }
    if (typeof result.body.token !== "string" || result.body.token.length === 0) throw new RoomRealtimeError("TOKEN_INVALID", "Invalid realtime capability");
    return result.body.token;
  }

  /** Single flight: concurrent requests (heartbeat, recovery, wake-up) share one token request. */
  function loadToken(options: { reuseIfFresh?: boolean; newerThan?: number } = {}): Promise<void> {
    // Recovery may try to join many times during an outage; a capability that is still in the first half of its
    // life is reused so the token endpoint (rate limited per guest, e.g. 12/min) is not hammered (CINE-021 limits).
    // `age >= 0`: a token "fetched in the future" (the wall clock stepped backwards) is never reused.
    const age = env.now() - tokenFetchedAt;
    if (options.reuseIfFresh && currentToken && age >= 0 && age < tokenLifetimeMs / 2 && (options.newerThan === undefined || tokenFetchedAt > options.newerThan)) return Promise.resolve();
    if (fetching) return fetching;
    fetching = (async () => {
      const token = await fetchToken();
      currentToken = token;
      const fetchedAt = env.now();
      const lifetime = readTokenLifetimeMs(token);
      tokenFetchedAt = fetchedAt;
      tokenLifetimeMs = lifetime;
      tokenExpiresAt = fetchedAt + lifetime;
      scheduleRenewFromToken();
    })().finally(() => { fetching = null; });
    return fetching;
  }

  const reconciler = createRoomReconciler<{ stateVersion: number; snapshot: RoomSnapshot }>({
    loadSnapshot: async () => {
      let result: { status: number; ok: boolean; snapshot: RoomSnapshot | null };
      try {
        result = await withTimeout(async (signal) => {
          const response = await get(base, { credentials: "same-origin", cache: "no-store", ...(signal ? { signal } : {}) });
          let snapshot: RoomSnapshot | null = null;
          if (response.ok) { try { snapshot = await response.json() as RoomSnapshot; } catch { snapshot = null; } }
          return { status: response.status, ok: response.ok, snapshot };
        });
      } catch {
        throw new RoomRealtimeError("SNAPSHOT_FAILED", "Room snapshot request failed");
      }
      if (!result.ok) {
        throw new RoomRealtimeError("SNAPSHOT_FAILED", "Room snapshot request failed", { status: result.status, permanent: PERMANENT_HTTP_STATUS.has(result.status) });
      }
      const snapshot = result.snapshot;
      if (!snapshot) throw new RoomRealtimeError("SNAPSHOT_INVALID", "Room snapshot was not valid JSON");
      if (typeof snapshot.room !== "object" || snapshot.room === null) throw new RoomRealtimeError("SNAPSHOT_INVALID", "Room snapshot has no room");
      return { stateVersion: snapshot.room.stateVersion, snapshot };
    },
    onSnapshot: ({ snapshot }) => { if (!closed && !terminal) options.onSnapshot(snapshot); },
  });

  /** Discards a slot's channel AND client/socket without waiting for a leave acknowledgement. */
  function disposeSlot(slot: Slot | null) {
    if (!slot || slot.dead) return;
    slot.dead = true;
    slot.joined = false;
    slots.delete(slot);
    slot.abort?.(new RoomRealtimeError("SUBSCRIBE_FAILED", "Private realtime subscription was cancelled"));
    try { void Promise.resolve(slot.client.removeChannel(slot.channel)).catch(() => undefined); } catch { /* socket may already be gone */ }
    try { void Promise.resolve(slot.client.realtime?.disconnect?.()).catch(() => undefined); } catch { /* best effort */ }
    try { void Promise.resolve(slot.client.auth?.dispose?.()).catch(() => undefined); } catch { /* best effort */ }
  }

  /** Disposes the active slot AND any join still in flight (rotation or recovery). */
  function disposeAllSlots() {
    for (const slot of [...slots]) disposeSlot(slot);
    active = null;
  }

  function stopBackground() {
    if (tickTimer !== null) { env.clearTimeout(tickTimer); tickTimer = null; }
    if (syncRetryTimer !== null) { env.clearTimeout(syncRetryTimer); syncRetryTimer = null; }
    disposeWake?.();
    disposeWake = null;
    wakeSleepers();
  }

  function terminate(error: unknown) {
    if (terminal || closed) return;
    terminal = true;
    report(error);
    stopBackground();
    setStatus("closed");
    disposeAllSlots();
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
      behindFailures = 0;
    } catch (error) {
      if (closed || terminal) return;
      if (isPermanent(error)) { terminate(error); return; }
      const behind = error instanceof RoomRealtimeError && error.code === "SNAPSHOT_BEHIND";
      // "Behind" retries have their own bounded budget; beyond it the poll takes over, silently.
      if (behind) {
        behindFailures++;
        if (behindFailures > tuning.behindRetryMax) return;
      } else {
        syncFailures++;
      }
      report(error);
      if (syncRetryTimer === null) {
        syncRetryTimer = env.setTimeout(() => { syncRetryTimer = null; void syncNow(requireVersion); }, backoff(behind ? behindFailures : syncFailures));
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

  /** Opens a new client + private channel with the current token. Resolves once SUBSCRIBED. */
  async function joinNewSlot(): Promise<Slot> {
    const expiresAt = tokenExpiresAt;
    const joinTokenFetchedAt = tokenFetchedAt;
    const client = makeClient();
    let channel: Slot["channel"];
    try {
      await client.realtime.setAuth(currentToken);
      if (closed || terminal) throw new RoomRealtimeError("SUBSCRIBE_FAILED", "Realtime client was closed");
      channel = client.channel(topic, { config: { private: true } });
    } catch (error) {
      try { void Promise.resolve(client.realtime?.disconnect?.()).catch(() => undefined); } catch { /* best effort */ }
      try { void Promise.resolve(client.auth?.dispose?.()).catch(() => undefined); } catch { /* best effort */ }
      throw error;
    }
    const slot: Slot = { client, channel, joined: false, dead: false, expiresAt, tokenFetchedAt: joinTokenFetchedAt };
    slots.add(slot);
    let joinedOnce = false;
    channel.on("broadcast", { event: "room_changed" }, (message: { payload?: unknown }) => {
      if (!slot.dead) onHint(message.payload);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = env.setTimeout(() => settle(new RoomRealtimeError("SUBSCRIBE_FAILED", "Private realtime subscription timed out")), tuning.subscribeTimeoutMs);
        const settle = (error?: Error) => {
          if (settled) return;
          settled = true;
          env.clearTimeout(timer);
          if (error) reject(error); else resolve();
        };
        slot.abort = settle;
        channel.subscribe((state: string) => {
          if (slot.dead || closed || terminal) return;
          if (state === "SUBSCRIBED") {
            slot.joined = true;
            const rejoined = joinedOnce;
            joinedOnce = true;
            settle();
            // An internal rejoin of the ACTIVE channel may have missed events: resync.
            if (rejoined && slot === active) { setStatus("live"); void syncNow(); }
          } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            slot.joined = false;
            if (!settled) settle(new RoomRealtimeError("SUBSCRIBE_FAILED", "Private realtime subscription failed"));
            else if (slot === active) void recover();
          }
        });
      });
    } catch (error) {
      disposeSlot(slot);
      throw error;
    }
    return slot;
  }

  async function recover(): Promise<void> {
    if (recovering || closed || terminal) return;
    recovering = true;
    setStatus("reconnecting");
    disposeSlot(active);
    active = null;
    let attempt = 0;
    // Flap guard: a server that accepts the join and drops it again right away must not be re-joined in a tight loop.
    const startedAt = env.now();
    flaps = startedAt >= lastRecoveryAt && startedAt - lastRecoveryAt < 5000 ? flaps + 1 : 0;
    try {
      if (flaps > 0) await sleep(backoff(flaps));
      while (!closed && !terminal) {
        try {
          await loadToken({ reuseIfFresh: true });
          const slot = await joinNewSlot();
          if (closed || terminal) { disposeSlot(slot); return; }
          active = slot;
          lastRecoveryAt = env.now();
          scheduleRenewFromToken();
          setStatus("live");
          void syncNow(); // events may have been missed while down
          return;
        } catch (error) {
          if (closed || terminal) return;
          if (isPermanent(error)) { terminate(error); return; }
          attempt++;
          report(error);
          setStatus(attempt >= tuning.degradedAfterAttempts ? "degraded" : "reconnecting");
          await sleep(Math.max(backoff(attempt), error instanceof RoomRealtimeError ? error.retryAfterMs ?? 0 : 0));
        }
      }
    } finally {
      recovering = false;
    }
  }

  /**
   * Make-before-break capability rotation: join a second channel with a fresh token, then retire the old one.
   * No gap, and the live channel never receives a token push.
   */
  function rotate(): Promise<void> {
    if (rotating) return rotating;
    rotating = (async () => {
      // A retry after a failed join reuses the token fetched for the failed attempt (token endpoint budget).
      await loadToken({ reuseIfFresh: true, newerThan: active?.tokenFetchedAt ?? Infinity });
      const slot = await joinNewSlot();
      if (closed || terminal || recovering || !active) { disposeSlot(slot); return; }
      const previous = active;
      active = slot;
      disposeSlot(previous);
      renewFailures = 0;
      scheduleRenewFromToken(); // a reused token keeps its own half-life; a failed-attempt backoff no longer applies
      if (status === "degraded") setStatus("live");
    })().finally(() => { rotating = null; });
    return rotating;
  }

  async function tick(reason: "timer" | WakeReason) {
    if (closed || terminal) return;
    const now = env.now();
    // The wall clock stepped backwards (NTP correction after sleep): deadlines measured in the "future" are
    // due now, and the poll must not pause until the clock catches up.
    // Once per token: if the fetch then fails, the normal backoff / Retry-After schedule must apply.
    if (now < tokenFetchedAt && clockStepHandledFor !== tokenFetchedAt) { tokenRenewAt = now; clockStepHandledFor = tokenFetchedAt; }
    if (now < lastSync) lastSync = -Infinity;
    if (reason !== "timer") {
      // focus / visibilitychange / pageshow / online can fire in bursts: coalesce wake-ups. A burst never
      // swallows the chance to cut a recovery backoff short, and a backwards clock step is never coalesced.
      if (now >= lastWake && now - lastWake < tuning.wakeMinIntervalMs) { wakeSleepers(); return; }
      lastWake = now;
    }
    const gap = now - lastTick;
    lastTick = now;
    const throttled = reason !== "timer" || gap > tuning.throttleGapMs;
    if (!active?.joined && !recovering) void recover();
    else if (now >= tokenRenewAt && !rotating && !recovering) {
      void rotate().catch((error) => {
        if (closed || terminal) return;
        if (isPermanent(error)) { terminate(error); return; }
        renewFailures++;
        tokenRenewAt = env.now() + Math.max(backoff(renewFailures), error instanceof RoomRealtimeError ? error.retryAfterMs ?? 0 : 0);
        report(error);
        // The ACTIVE channel dies at ITS token's deadline, not at the (newer) token that failed to join.
        if (env.now() >= (active?.expiresAt ?? tokenExpiresAt)) setStatus("degraded");
      });
    }
    if (throttled) wakeSleepers();
    if (throttled || now - lastSync >= tuning.pollMs) void syncNow();
  }

  function scheduleTick() {
    if (closed || terminal) return;
    // Wake for the rotation deadline too, so a short-lived token is replaced at about half its lifetime.
    const delay = Math.max(1000, Math.min(tuning.tickMs, tokenRenewAt - env.now()));
    tickTimer = env.setTimeout(() => { tickTimer = null; void tick("timer").finally(scheduleTick); }, delay);
  }

  async function shutdown() {
    closed = true;
    stopBackground();
    disposeAllSlots();
    setStatus("closed");
  }

  setStatus("connecting");
  try {
    await loadToken();
    active = await joinNewSlot();
    setStatus("live");
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
