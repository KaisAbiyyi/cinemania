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

  async function send(method: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<RoomActionResult> {
    let last: RoomActionFailure | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response | null = null;
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
        let parsed: Record<string, unknown> = {};
        try { parsed = await response.json() as Record<string, unknown>; } catch { parsed = {}; }
        if (response.ok) {
          const room = parsed.room as RoomSnapshot["room"] | undefined;
          if (room && typeof room === "object" && parsed.viewer) options.accept({ room, viewer: parsed.viewer });
          return { ok: true, replayed: parsed.idempotentReplay === true, data: parsed };
        }
        const code = typeof parsed.error === "string" ? parsed.error : "REQUEST_FAILED";
        const message = typeof parsed.message === "string" ? parsed.message : "Request failed";
        if (RETRYABLE_STATUS.has(response.status)) {
          last = { ok: false, status: response.status, code, message, stale: false, transient: true };
        } else {
          const stale = response.status === 409 || STALE_CODES.has(code);
          if (stale) await options.resync().catch(() => undefined);
          return { ok: false, status: response.status, code, message, stale, transient: false };
        }
      }
      if (attempt < maxAttempts) await sleep(Math.round(retryBaseMs * 2 ** (attempt - 1) * (0.5 + random() / 2)));
    }
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
      return singleFlight("vote:" + input.candidateId, input.vote, () => send("POST", "/votes", body, { "idempotency-key": operationId }));
    },
    /** Double clicks share one request; a retry after a lost response resolves as stale and resyncs. */
    startRound(body: Record<string, unknown> = {}): Promise<RoomActionResult> {
      return singleFlight("start", "start", () => send("POST", "/start", body));
    },
    /** Filter edits are serialized so the server applies them in the order the host made them. */
    updateFilters(filter: Record<string, unknown>): Promise<RoomActionResult> {
      const run = filterQueue.then(() => send("PATCH", "/filters", filter));
      filterQueue = run.catch(() => undefined);
      return run;
    },
    leave(): Promise<RoomActionResult> {
      return singleFlight("leave", "leave", () => send("POST", "/leave", {}));
    },
  };
}
