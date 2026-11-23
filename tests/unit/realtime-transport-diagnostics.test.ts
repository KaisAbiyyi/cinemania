// @vitest-environment node
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { dispatchPendingEvents } from "@/lib/server/realtime/dispatch";
import { classifyTransportFailure, trackRequestPhase } from "@/lib/server/realtime/diagnostics";
import { createSupabasePublisher } from "@/lib/server/realtime/supabasePublisher";

const requireLocal = createRequire(import.meta.url);
const { createTransportDiagnostics } = requireLocal("../../scripts/cine026/transport-diagnostics.cjs");

const ROOM = "d75a3c4c-c516-4b88-9803-0261932e62ac";
const SECRET = "synthetic-server-key";
const ORIGIN = "https://exampleproject.supabase.co";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function lines(spy: { mock: { calls: unknown[][] } }, tag: string) {
  return spy.mock.calls.map(call => call.join(" ")).filter(line => line.startsWith(`[CINEMATCH_REALTIME_${tag}] `))
    .map(line => JSON.parse(line.slice(line.indexOf("] ") + 2)) as Record<string, unknown>);
}

const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const fetchFailed = (cause: unknown) => Object.assign(new TypeError("fetch failed"), { cause });
const coded = (code: string) => Object.assign(new Error("private detail 10.0.0.1"), { code });

it.each([
  [timeout, "client_deadline", undefined],
  [Object.assign(new Error("x"), { name: "AbortError" }), "client_abort", undefined],
  [fetchFailed(coded("ENOTFOUND")), "dns_failure", "ENOTFOUND"],
  [fetchFailed(coded("UND_ERR_CONNECT_TIMEOUT")), "connect_timeout", "UND_ERR_CONNECT_TIMEOUT"],
  [fetchFailed(Object.assign(new AggregateError([coded("ECONNREFUSED")]), { code: undefined })), "connect_unreachable", "ECONNREFUSED"],
  [fetchFailed(coded("ECONNRESET")), "connection_reset", "ECONNRESET"],
  [fetchFailed(coded("UND_ERR_SOCKET")), "connection_closed", "UND_ERR_SOCKET"],
  [fetchFailed(coded("UND_ERR_HEADERS_TIMEOUT")), "response_timeout", "UND_ERR_HEADERS_TIMEOUT"],
  [fetchFailed(coded("CERT_HAS_EXPIRED")), "tls_failure", "CERT_HAS_EXPIRED"],
  [fetchFailed(new Error("unexpected redirect")), "unexpected_redirect", undefined],
  [fetchFailed(coded("not a safe code!")), "unknown_fetch_failure", undefined],
  ["not an error", "unknown_fetch_failure", undefined],
])("classifies a rejected fetch into a fixed category and allowlisted code", (error, category, code) => {
  const result = classifyTransportFailure(error);
  expect(result.category).toBe(category);
  expect(result.code).toBe(code);
  expect(JSON.stringify(result)).not.toMatch(/private detail|10\.0\.0\.1/);
});

it("emits nothing unless diagnostics are explicitly enabled", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const publish = createSupabasePublisher(ORIGIN, SECRET, async () => { throw timeout; });
  await expect(publish({ roomId: ROOM, version: 1 })).rejects.toThrow("Realtime provider request failed");
  expect(lines(warn, "ATTEMPT")).toEqual([]);
});

it("records a sanitized transport failure without credentials, URLs, room identifiers or payloads", async () => {
  vi.stubEnv("CINEMATCH_REALTIME_DIAGNOSTICS", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const publish = createSupabasePublisher(ORIGIN, SECRET, async () => { throw fetchFailed(coded("ECONNRESET")); });
  await expect(publish({ roomId: ROOM, version: 8 })).rejects.toThrow("Realtime provider request failed");
  const [record] = lines(warn, "ATTEMPT");
  expect(record).toMatchObject({ kind: "transport", v: 8, category: "connection_reset", code: "ECONNRESET", phase: "unobserved" });
  expect(record.r).toMatch(/^[0-9a-f]{8}$/);
  expect(Number.isInteger(record.ms)).toBe(true);
  const everything = warn.mock.calls.flat().join("\n");
  expect(everything).not.toContain(ROOM);
  expect(everything).not.toContain(SECRET);
  expect(everything).not.toMatch(/supabase\.co|apikey|authorization|private detail|10\.0\.0\.1/i);
  // The legacy gate counter still sees exactly one transport failure.
  expect(warn.mock.calls.map(call => call.join(" ")).filter(line => line.startsWith("[CINEMATCH_REALTIME_ATTEMPT_FAILURE] transport"))).toHaveLength(1);
});

it("records successful and non-2xx responses so near-deadline latency is visible", async () => {
  vi.stubEnv("CINEMATCH_REALTIME_DIAGNOSTICS", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let status = 202;
  const publish = createSupabasePublisher(ORIGIN, SECRET, async () => new Response(null, { status }));
  await publish({ roomId: ROOM, version: 2 });
  status = 503;
  await expect(publish({ roomId: ROOM, version: 3 })).rejects.toThrow("Realtime broadcast failed (503)");
  expect(lines(warn, "ATTEMPT")).toMatchObject([{ kind: "http", status: 202, v: 2 }, { kind: "http", status: 503, v: 3 }]);
});

it("keeps the publisher request deadline at 1500 ms", async () => {
  const timer = vi.spyOn(AbortSignal, "timeout");
  const publish = createSupabasePublisher(ORIGIN, SECRET, async () => new Response(null, { status: 202 }));
  await publish({ roomId: ROOM, version: 1 });
  expect(timer).toHaveBeenCalledWith(1500);
});

it("an unfinished attempt reaches the outbox retry path without changing ordering or retry scheduling", async () => {
  vi.stubEnv("CINEMATCH_REALTIME_DIAGNOSTICS", "1");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const steps: string[] = [];
  const sends: number[] = [];
  const event = { id: "evt-8", version: 8, retryCount: 0 };
  const store = {
    withRoomLock: async <T>(_room: string, work: (outbox: import("@/lib/server/realtime/dispatch").LockedOutbox) => Promise<T>) => work({
      readyHead: async () => (event.retryCount < 99 ? event : undefined),
      markDispatched: async (id: string) => { steps.push(`marked:${id}`); event.retryCount = 100; },
      recordFailure: async (id: string) => { steps.push(`failed:${id}`); event.retryCount++; },
    }),
  };
  let calls = 0;
  const publish = async (hint: { roomId: string; version: number }) => {
    sends.push(hint.version);
    if (++calls === 1) throw new Error("Realtime provider request failed");
  };
  expect(await dispatchPendingEvents(ROOM, store, publish)).toBe(false);
  expect(await dispatchPendingEvents(ROOM, store, publish)).toBe(true);
  expect(sends).toEqual([8, 8]);
  expect(steps).toEqual(["failed:evt-8", "marked:evt-8"]);
  const outbox = lines(warn, "OUTBOX");
  expect(outbox).toMatchObject([
    { v: 8, attempt: 1, outcome: "retry_scheduled" },
    { v: 8, attempt: 2, outcome: "marked" },
  ]);
  expect(warn.mock.calls.flat().join("\n")).not.toContain(ROOM);
});

it("aggregates only allowlisted fields and joins a failed attempt to its outbox resolution", () => {
  let clock = 1_000;
  const aggregate = createTransportDiagnostics(() => clock);
  const token = "0a1b2c3d";
  aggregate.observe(`[CINEMATCH_REALTIME_ATTEMPT] ${JSON.stringify({ kind: "http", r: token, v: 7, ms: 220, status: 202, startedAt: "2026-11-24T00:00:00.000Z" })}`);
  aggregate.observe(`[CINEMATCH_REALTIME_ATTEMPT] ${JSON.stringify({
    kind: "transport", r: token, v: 8, ms: 1502, startedAt: "2026-11-24T00:00:01.000Z", phase: "request_written_awaiting_response",
    category: "client_deadline", message: "secret", url: "https://exampleproject.supabase.co/x",
  })}`);
  clock = 1_100;
  aggregate.observe(`[CINEMATCH_REALTIME_OUTBOX] ${JSON.stringify({ r: token, v: 8, attempt: 1, outcome: "retry_scheduled" })}`);
  clock = 2_000;
  for (let i = 0; i < 6; i++) aggregate.observe(`[CINEMATCH_REALTIME_OUTBOX] ${JSON.stringify({ r: token, v: 8, attempt: 2, outcome: "deferred" })}`);
  clock = 7_400;
  aggregate.observe(`[CINEMATCH_REALTIME_OUTBOX] ${JSON.stringify({ r: token, v: 8, attempt: 2, outcome: "marked" })}`);
  aggregate.observe("[CINEMATCH_REALTIME_ATTEMPT] {not json");
  aggregate.observe(`[CINEMATCH_REALTIME_ATTEMPT] ${JSON.stringify({ kind: "transport", r: "../etc", v: 1, ms: 1, phase: "unobserved", category: "dns_failure" })}`);
  const summary = aggregate.summary();
  expect(summary.http).toMatchObject({ count: 1, okCount: 1, maxMs: 220 });
  expect(summary.outcomes).toEqual({ marked: 1, retry_scheduled: 1, deferred: 6, permanent_rejection: 0 });
  expect(summary.failures).toEqual([{
    category: "client_deadline", code: null, phase: "request_written_awaiting_response", ms: 1502, version: 8,
    startedAt: "2026-11-24T00:00:01.000Z", httpResponseReceived: false,
    outbox: [
      { outcome: "retry_scheduled", attempt: 1, count: 1, observedAfterFailureMs: 100 },
      { outcome: "deferred", attempt: 2, count: 6, observedAfterFailureMs: 1000 },
      { outcome: "marked", attempt: 2, count: 1, observedAfterFailureMs: 6400 },
    ],
  }]);
  expect(JSON.stringify(summary)).not.toMatch(/secret|supabase\.co|0a1b2c3d/);
});

let server: Server | undefined;
afterEach(async () => { await new Promise(resolve => (server ? server.close(resolve) : resolve(undefined))); server = undefined; });

it("observes real undici request progress for a request that is written but never answered", async () => {
  vi.stubEnv("CINEMATCH_REALTIME_DIAGNOSTICS", "1");
  server = createServer(() => { /* accept the request, never respond */ });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const url = new URL(`http://127.0.0.1:${port}/realtime/v1/api/broadcast/room%3Asynthetic/events/room_changed?private=true`);
  const tracker = trackRequestPhase(url.pathname + url.search);
  const outcome = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(300) }).then(() => "response", error => error);
  expect(outcome.name).toBe("TimeoutError");
  expect(tracker.phase()).toBe("request_written_awaiting_response");
  tracker.done();
  expect(tracker.phase()).toBe("unobserved");
});

it("distinguishes a refused connection from an unanswered request", async () => {
  vi.stubEnv("CINEMATCH_REALTIME_DIAGNOSTICS", "1");
  const closed = createServer();
  await new Promise<void>(resolve => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address() as { port: number };
  await new Promise(resolve => closed.close(resolve));
  const url = new URL(`http://127.0.0.1:${port}/p?private=true`);
  const tracker = trackRequestPhase(url.pathname + url.search);
  const error = await fetch(url, { method: "POST", body: "{}", signal: AbortSignal.timeout(1000) }).then(() => undefined, caught => caught);
  expect(classifyTransportFailure(error)).toMatchObject({ category: "connect_unreachable", code: "ECONNREFUSED" });
  expect(tracker.phase()).toBe("connecting_or_queued");
  tracker.done();
});
