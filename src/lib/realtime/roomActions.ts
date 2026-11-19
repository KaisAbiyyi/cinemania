import type { RoomSnapshot } from "./roomRealtime";

export type VoteChoice = "LIKE" | "SKIP";

export interface RoomActionSuccess<T = Record<string, unknown>> {
  ok: true;
  /** True when the server recognised the request as a replay of an already-recorded action. */
  replayed: boolean;
  data: T;
}

export interface RoomActionFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  /** The client view was out of date; an authoritative snapshot read has already been requested. */
  stale: boolean;
  /** Network or transient server failure after all retries; the same action may be tried again. */
  transient: boolean;
}

export type RoomActionResult<T = Record<string, unknown>> = RoomActionSuccess<T> | RoomActionFailure;

export interface RoomActionsOptions {
  roomId: string;
  fetcher?: typeof fetch;
  /** Offers an authoritative snapshot taken from a mutation response (version gated). */
  accept: (snapshot: RoomSnapshot) => boolean;
  /** Forces an authoritative snapshot read. Called when the server reports the client was stale. */
  resync: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Total attempts including the first. Retries reuse the same operation id. */
  maxAttempts?: number;
  retryBaseMs?: number;
  /** Per-request abort timeout; 0 disables it. */
  requestTimeoutMs?: number;
}

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const STALE_CODES = new Set(["ROUND_NOT_FOUND", "CANDIDATE_NOT_FOUND"]);

/** A stable, bounded operation id: the same intent always maps to the same id (server limit is 128). */
export function voteOperationId(candidateId: string, roundId?: string | null): string {
  return `vote:${roundId ?? "-"}:${candidateId}`;
}

/**
 * Client side of the mutation contract. It makes double clicks, retries, reloads and stale tabs
 * converge on one authoritative outcome:
 * - identical in-flight actions share one request (single flight);
 * - a vote always carries a stable operation id, so retries after a lost response are replays;
 * - a successful mutation response is offered to the snapshot gate instead of waiting for a hint;
 * - a 409 or missing round/candidate means a stale view, so an authoritative snapshot is requested.
 */
export function createRoomActions(options: RoomActionsOptions) {
  const get = options.fetcher ?? fetch;
  const base = "/api/rooms/" + encodeURIComponent(options.roomId);
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const retryBaseMs = options.retryBaseMs ?? 300;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const requestTimeoutMs = options.requestTimeoutMs ?? 15000;
  const inFlight = new Map<string, { signature: string; promise: Promise<RoomActionResult> }>();
  let filterQueue: Promise<unknown> = Promise.resolve();

  /**
   * `idempotent` actions (a vote with its operation id, a filter replacement) are retried automatically with
   * the same payload. Others (start, leave) are NOT: after an ambiguous failure the outcome is unknown, so the
   * layer resyncs the authoritative view and returns `transient` for the caller/user to decide.
   * `acceptSnapshot` is false for responses whose viewer is not the full GET shape (filter edits).
   */
  async function send(
    method: string, path: string, body: unknown, headers: Record<string, string> = {},
    mode: { idempotent: boolean; acceptSnapshot: boolean; resyncOnSuccess?: boolean }
  ): Promise<RoomActionResult> {
    const attempts = mode.idempotent ? maxAttempts : 1;
    let last: RoomActionFailure | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let response: Response | null = null;
      let retryAfterMs = 0;
      try {
        response = await get(base + path, {
          method,
          credentials: "same-origin",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body ?? {}),
          ...(requestTimeoutMs > 0 && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? { signal: AbortSignal.timeout(requestTimeoutMs) } : {}),
        });
      } catch {
        last = { ok: false, status: 0, code: "NETWORK_ERROR", message: "Request failed before a response was received", stale: false, transient: true };
      }
      if (response) {
        let parsed: Record<string, unknown> | null = null;
        try { parsed = await response.json() as Record<string, unknown>; } catch { parsed = null; }
        if (response.ok) {
          if (parsed === null || typeof parsed !== "object") {
            // The server answered 2xx but the body is unreadable: the outcome is known only to the server.
            last = { ok: false, status: response.status, code: "INVALID_RESPONSE", message: "Response body was not readable", stale: false, transient: true };
          } else {
            const room = parsed.room as RoomSnapshot["room"] | undefined;
            if (mode.acceptSnapshot && room && typeof room === "object" && parsed.viewer) options.accept({ room, viewer: parsed.viewer });
            else if (mode.resyncOnSuccess) await options.resync().catch(() => undefined);
            return { ok: true, replayed: parsed.idempotentReplay === true, data: parsed };
          }
        } else {
          const body2 = parsed ?? {};
          const code = typeof body2.error === "string" ? body2.error : "REQUEST_FAILED";
          const message = typeof body2.message === "string" ? body2.message : "Request failed";
          if (RETRYABLE_STATUS.has(response.status)) {
            last = { ok: false, status: response.status, code, message, stale: false, transient: true };
            retryAfterMs = Number(response.headers.get("retry-after")) * 1000 || 0;
          } else {
            const stale = response.status === 409 || STALE_CODES.has(code);
            if (stale) await options.resync().catch(() => undefined);
            return { ok: false, status: response.status, code, message, stale, transient: false };
          }
        }
      }
      // A server asking for a long pause (for example upstream 503 + Retry-After) is not hammered.
      if (retryAfterMs > 5000) break;
      if (attempt < attempts) await sleep(Math.round(retryBaseMs * 2 ** (attempt - 1) * (0.5 + random() / 2)));
    }
    // Ambiguous failure of a call that may or may not have taken effect: converge on the authoritative view.
    if (!mode.idempotent) await options.resync().catch(() => undefined);
    return last as RoomActionFailure;
  }

  function singleFlight(key: string, signature: string, run: () => Promise<RoomActionResult>): Promise<RoomActionResult> {
    const existing = inFlight.get(key);
    if (existing) {
      if (existing.signature === signature) return existing.promise;
      return Promise.resolve({ ok: false, status: 409, code: "ACTION_IN_FLIGHT", message: "A different action for the same target is still in progress", stale: false, transient: false });
    }
    const promise = run().finally(() => { inFlight.delete(key); });
    inFlight.set(key, { signature, promise });
    return promise;
  }

  return {
    /** Votes are immutable: a second, different choice for a candidate in flight is refused locally. */
    vote(input: { candidateId: string; movieId: number; vote: VoteChoice; roundId?: string | null }): Promise<RoomActionResult> {
      const operationId = voteOperationId(input.candidateId, input.roundId);
      const body = { candidateId: input.candidateId, movieId: input.movieId, vote: input.vote, operationId, ...(input.roundId ? { roundId: input.roundId } : {}) };
      return singleFlight("vote:" + input.candidateId, input.vote, () => send("POST", "/votes", body, { "idempotency-key": operationId }, { idempotent: true, acceptSnapshot: true }));
    },
    /**
     * Double clicks share one request. Never retried automatically: if the response is lost the layer resyncs
     * and returns `transient`; the round may already be ACTIVE, which the snapshot then shows. A deliberate
     * second attempt that meets an ACTIVE room returns `stale` (409) and resyncs.
     */
    startRound(body: Record<string, unknown> = {}): Promise<RoomActionResult> {
      return singleFlight("start", "start", () => send("POST", "/start", body, {}, { idempotent: false, acceptSnapshot: true }));
    },
    /**
     * Filter edits are serialized so the server applies them in the order the host made them. Replacement
     * semantics make a retry safe. The response viewer is not the full snapshot shape, so success triggers a
     * resync instead of accepting it.
     */
    updateFilters(filter: Record<string, unknown>): Promise<RoomActionResult> {
      const run = filterQueue.then(() => send("PATCH", "/filters", filter, {}, { idempotent: true, acceptSnapshot: false, resyncOnSuccess: true }));
      filterQueue = run.catch(() => undefined);
      return run;
    },
    leave(): Promise<RoomActionResult> {
      return singleFlight("leave", "leave", () => send("POST", "/leave", {}, {}, { idempotent: false, acceptSnapshot: false }));
    },
  };
}
