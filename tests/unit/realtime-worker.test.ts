import { afterEach, expect, it, vi } from "vitest";
import { startOutboxWorker } from "@/lib/server/realtime/worker";

afterEach(() => vi.useRealTimers());

it("dispatches durable pending rooms without any HTTP request and advances a fair cursor", async () => {
  vi.useFakeTimers();
  const queries: Array<[string | undefined, number]> = [];
  const sent: string[] = [];
  const pages = [["a", "b"], ["c"], [], ["a"]];
  const worker = startOutboxWorker({
    scan: async (after, limit) => { queries.push([after, limit]); return pages.shift() ?? []; },
    dispatch: async room => { sent.push(room); }, intervalMs: 100, roomsPerSweep: 2,
  });
  await vi.advanceTimersByTimeAsync(300);
  await worker.stop();
  expect(queries).toEqual([[undefined, 2], ["b", 2], ["c", 2], [undefined, 2]]);
  expect(sent).toEqual(["a", "b", "c", "a"]);
});

it("does not overlap slow sweeps and stop drains in-flight work without scheduling another", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const sent: string[] = [];
  const worker = startOutboxWorker({ scan: async () => ["a", "b"],
    dispatch: async room => { sent.push(room); await blocked; }, intervalMs: 100,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toEqual(["a"]);
  const stopped = worker.stop();
  release(); await stopped;
  await vi.advanceTimersByTimeAsync(1000);
  expect(sent).toEqual(["a"]);
});

it("continues past a failing room and retries on a later autonomous sweep", async () => {
  vi.useFakeTimers();
  const sent: string[] = [], errors: unknown[] = [];
  const worker = startOutboxWorker({ scan: async () => ["a", "b"], dispatch: async room => {
    sent.push(room); if (room === "a") throw new Error("provider unavailable");
  }, onError: error => errors.push(error), intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  await worker.stop();
  expect(sent).toEqual(["a", "b", "a", "b"]);
  expect(errors).toHaveLength(2);
});

it("survives scan errors and resumes without external traffic", async () => {
  vi.useFakeTimers();
  let scans = 0;
  const sent: string[] = [];
  const worker = startOutboxWorker({ scan: async () => {
    if (++scans === 1) throw new Error("database temporarily unavailable"); return ["a"];
  }, dispatch: async room => { sent.push(room); }, intervalMs: 100 });
  await vi.advanceTimersByTimeAsync(100);
  await worker.stop();
  expect(sent).toEqual(["a"]);
});

it.each([0, 99, 60001, NaN, Infinity, 100.5])("rejects unsafe poll interval %s", intervalMs => {
  expect(() => startOutboxWorker({ scan: async () => [], dispatch: async () => {}, intervalMs })).toThrow();
});

it.each([0, 101, NaN, 1.5])("rejects unbounded room page %s", roomsPerSweep => {
  expect(() => startOutboxWorker({ scan: async () => [], dispatch: async () => {}, roomsPerSweep })).toThrow();
});
