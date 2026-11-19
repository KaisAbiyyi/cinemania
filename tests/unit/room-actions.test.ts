// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createRoomActions, voteOperationId } from "@/lib/realtime/roomActions";
import { createRoomReconciler } from "@/lib/realtime/roomReconciler";

const ROOM = "22222222-2222-4222-8222-222222222222";
const CANDIDATE = "33333333-3333-4333-8333-333333333333";
const ROUND = "44444444-4444-4444-8444-444444444444";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setup(handler: (url: string, init: RequestInit, call: number) => Promise<Response> | Response) {
  let calls = 0;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    requests.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {}, calls);
  }) as typeof fetch;
  const accepted: number[] = [];
  const resync = vi.fn(async () => {});
  const actions = createRoomActions({
    roomId: ROOM,
    fetcher,
    accept: (snapshot) => { accepted.push(snapshot.room.stateVersion); return true; },
    resync,
    sleep: async () => {},
    random: () => 0.5,
    requestTimeoutMs: 0,
  });
  return { actions, requests, accepted, resync };
}

const ok = (version: number, extra: Record<string, unknown> = {}) => json({ room: { stateVersion: version }, viewer: { participantId: "p" }, ...extra });

describe("CINE-019 room action layer", () => {
  it("shares one request between double clicks and refuses a different choice while in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { actions, requests } = setup(async () => { await gate; return ok(5, { idempotentReplay: false }); });
    const input = { candidateId: CANDIDATE, movieId: 7, vote: "LIKE" as const, roundId: ROUND };
    const first = actions.vote(input);
    const second = actions.vote(input);
    const flipped = await actions.vote({ ...input, vote: "SKIP" });
    expect(flipped).toMatchObject({ ok: false, code: "ACTION_IN_FLIGHT" });
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(requests).toHaveLength(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({ ok: true, replayed: false });
  });

  it("sends a stable operation id in header and body so retries and reloads are replays", async () => {
    const { actions, requests } = setup(async () => ok(2));
    await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "SKIP", roundId: ROUND });
    await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "SKIP", roundId: ROUND });
    const expected = voteOperationId(CANDIDATE, ROUND);
    expect(expected.length).toBeLessThanOrEqual(128);
    for (const { init } of requests) {
      expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(expected);
      expect(JSON.parse(String(init.body))).toMatchObject({ operationId: expected, candidateId: CANDIDATE, movieId: 7, vote: "SKIP", roundId: ROUND });
      expect(init.credentials).toBe("same-origin");
    }
  });

  it("retries a lost response with the same operation id and reports the server replay", async () => {
    const { actions, requests } = setup(async (_url, _init, call) => {
      if (call === 1) throw new TypeError("connection reset after the server committed");
      if (call === 2) return json({ error: "BAD_GATEWAY" }, 502);
      return ok(6, { idempotentReplay: true });
    });
    const result = await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" });
    expect(result).toMatchObject({ ok: true, replayed: true });
    expect(requests).toHaveLength(3);
    const ids = new Set(requests.map((r) => JSON.parse(String(r.init.body)).operationId));
    expect(ids.size).toBe(1);
  });

  it("gives up after the attempt bound and marks the failure transient", async () => {
    const { actions, requests } = setup(async () => { throw new TypeError("offline"); });
    const result = await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" });
    expect(result).toMatchObject({ ok: false, transient: true, code: "NETWORK_ERROR", stale: false });
    expect(requests).toHaveLength(4);
  });

  it("offers the response snapshot to the version gate before any hint arrives", async () => {
    const delivered: number[] = [];
    const reconciler = createRoomReconciler<{ stateVersion: number; snapshot: unknown }>({ loadSnapshot: async () => ({ stateVersion: 0, snapshot: null }), onSnapshot: (s) => delivered.push(s.stateVersion) });
    const actions = createRoomActions({
      roomId: ROOM,
      fetcher: (async () => ok(8)) as typeof fetch,
      accept: (snapshot) => reconciler.accept({ stateVersion: snapshot.room.stateVersion, snapshot }),
      resync: async () => {},
      requestTimeoutMs: 0,
    });
    await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" });
    await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" }); // replay of the same version
    await reconciler.notify(8); // the later hint is a duplicate
    expect(delivered).toEqual([8]);
  });

  it.each([
    [409, "CANDIDATE_OUT_OF_ORDER"],
    [409, "ROOM_ALREADY_MATCHED"],
    [409, "VOTE_IMMUTABLE"],
    [404, "ROUND_NOT_FOUND"],
    [404, "CANDIDATE_NOT_FOUND"],
  ])("treats %i %s as a stale view and requests an authoritative snapshot without retrying", async (status, code) => {
    const { actions, requests, resync } = setup(async () => json({ error: code, message: "x" }, status));
    const result = await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" });
    expect(result).toMatchObject({ ok: false, status, code, stale: true, transient: false });
    expect(requests).toHaveLength(1);
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it("does not resync or retry for authorization, validation and rate-limit answers", async () => {
    for (const status of [400, 401, 403, 429]) {
      const { actions, requests, resync } = setup(async () => json({ error: "X" }, status));
      const result = await actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" });
      expect(result).toMatchObject({ ok: false, status, stale: false, transient: false });
      expect(requests).toHaveLength(1);
      expect(resync).not.toHaveBeenCalled();
    }
  });

  it("collapses simultaneous host start clicks into one request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { actions, requests } = setup(async () => { await gate; return ok(3); });
    const a = actions.startRound();
    const b = actions.startRound();
    release();
    expect(await a).toBe(await b);
    expect(requests).toHaveLength(1);
  });

  it("never retries start or leave automatically: an ambiguous failure resyncs and is reported transient", async () => {
    for (const run of [(x: ReturnType<typeof setup>) => x.actions.startRound(), (x: ReturnType<typeof setup>) => x.actions.leave()]) {
      for (const failure of ["network", 503, "garbled"] as const) {
        const ctx = setup(async () => {
          if (failure === "network") throw new TypeError("response lost after the server committed");
          if (failure === "garbled") return new Response("<html>", { status: 200 });
          return json({ error: "UPSTREAM" }, 503);
        });
        const result = await run(ctx);
        expect(result).toMatchObject({ ok: false, transient: true, stale: false });
        expect(ctx.requests).toHaveLength(1); // a retry could repeat a committed start or hit a removed participant
        expect(ctx.resync).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("a deliberate second start against an ACTIVE room is stale (409) and resyncs", async () => {
    const ctx = setup(async () => json({ error: "ROOM_ALREADY_ACTIVE" }, 409));
    expect(await ctx.actions.startRound()).toMatchObject({ ok: false, stale: true, code: "ROOM_ALREADY_ACTIVE" });
    expect(ctx.resync).toHaveBeenCalledTimes(1);
  });

  it("does not hammer a server that asks for a long pause (Retry-After) and treats an unreadable 2xx as ambiguous", async () => {
    const paused = setup(async () => new Response(JSON.stringify({ error: "UPSTREAM_UNAVAILABLE" }), { status: 503, headers: { "retry-after": "30" } }));
    expect(await paused.actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" })).toMatchObject({ ok: false, transient: true });
    expect(paused.requests).toHaveLength(1);
    const garbled = setup(async (_u, _i, call) => (call < 3 ? new Response("not json", { status: 200 }) : ok(9)));
    expect(await garbled.actions.vote({ candidateId: CANDIDATE, movieId: 7, vote: "LIKE" })).toMatchObject({ ok: true });
    expect(garbled.requests).toHaveLength(3); // an idempotent vote is safely retried with the same operation id
  });

  it("does not accept a filter response as the authoritative snapshot; it resyncs instead", async () => {
    const ctx = setup(async () => ok(4));
    expect(await ctx.actions.updateFilters({ sort_by: "popularity.desc" })).toMatchObject({ ok: true });
    expect(ctx.accepted).toEqual([]);
    expect(ctx.resync).toHaveBeenCalledTimes(1);
  });

  it("serializes filter edits in the order the host made them", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const { actions } = setup(async (_url, init) => {
      const body = JSON.parse(String(init.body)) as { tag: string };
      order.push("start:" + body.tag);
      if (body.tag === "a") await firstGate;
      order.push("end:" + body.tag);
      return ok(order.length);
    });
    const a = actions.updateFilters({ tag: "a" });
    const b = actions.updateFilters({ tag: "b" });
    await Promise.resolve();
    expect(order).toEqual(["start:a"]);
    releaseFirst();
    await Promise.all([a, b]);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("keeps serving filter edits after one fails", async () => {
    const { actions } = setup(async (_u, _i, call) => (call === 1 ? json({ error: "INVALID_DECK_FILTER" }, 400) : ok(4)));
    expect(await actions.updateFilters({})).toMatchObject({ ok: false, status: 400 });
    expect(await actions.updateFilters({})).toMatchObject({ ok: true });
  });

  it("leave is single flight and does not touch the snapshot gate", async () => {
    const { actions, requests, accepted } = setup(async () => json({ left: true, roomId: ROOM }));
    const [a, b] = await Promise.all([actions.leave(), actions.leave()]);
    expect(a).toBe(b);
    expect(requests).toHaveLength(1);
    expect(accepted).toEqual([]);
  });
});
