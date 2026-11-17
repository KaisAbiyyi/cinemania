export interface OutboxWorkerOptions {
  scan(after: string | undefined, limit: number): Promise<string[]>;
  dispatch(roomId: string): Promise<unknown>;
  onError?: (error: unknown) => void;
  intervalMs?: number;
  roomsPerSweep?: number;
}

/** Independent process loop; never attach this timer to a serverless request. */
export function startOutboxWorker(options: OutboxWorkerOptions): { stop(): Promise<void> } {
  const intervalMs = options.intervalMs ?? 1000;
  const roomsPerSweep = options.roomsPerSweep ?? 20;
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) throw new Error("Invalid outbox poll interval");
  if (!Number.isInteger(roomsPerSweep) || roomsPerSweep < 1 || roomsPerSweep > 100) throw new Error("Invalid outbox page size");
  let stopped = false;
  let cursor: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;
  const report = (error: unknown) => {
    try { options.onError?.(error); } catch { /* Diagnostics cannot stop durable retries. */ }
  };
  async function sweep(): Promise<void> {
    try {
      const rooms = await options.scan(cursor, roomsPerSweep);
      if (!rooms.length) cursor = undefined;
      for (const roomId of rooms) {
        if (stopped) break;
        // Advance even on failure: a busy/poison room cannot starve later rooms.
        cursor = roomId;
        try { await options.dispatch(roomId); } catch (error) { report(error); }
      }
    } catch (error) { report(error); }
    if (!stopped) timer = setTimeout(run, intervalMs);
  }
  function run() { active = sweep(); }
  run();
  return { async stop() {
    stopped = true;
    clearTimeout(timer);
    await active;
  } };
}
