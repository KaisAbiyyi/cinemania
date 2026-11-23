// @vitest-environment node
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { Client } from "pg";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const requireLocal = createRequire(import.meta.url);
const { PROJECT } = requireLocal("../hosted-supabase/environment.cjs");
const { main } = requireLocal("../../scripts/cine026/run-hosted-staging.cjs");

const cleanState = {
  rooms: 0, participants: 0, votes: 0, events: 0, pending: 0, poison: 0, retries: 0,
  oldest_pending_ms: 0, advisory_locks: 0, advisory_waiters: 0, idle_transactions: 0,
  other_role_sessions: 0, other_role_nonidle_sessions: 0,
};

const sensitive = "postgres://fixture-user:fixture-password@fixture-host/private";
const fault = (code: string) => Object.assign(new Error(sensitive), { code });

function client(query: (sql: string) => unknown) {
  return Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => {}),
    query: vi.fn(async (sql: string) => query(sql)),
    end: vi.fn(async () => {}),
  });
}

function fixture() {
  let supervisorReads = 0;
  const workload = Promise.withResolvers<number>();
  const monitorTick = Promise.withResolvers<void>();
  const child = {
    done: workload.promise,
    stop: vi.fn(async () => {
      workload.resolve(1);
      monitorTick.resolve();
    }),
  };
  const options = {
    unlock: () => ({ rows: [{ released: true }] }),
    sample: async () => ({ rows: [cleanState] }),
    shutdown: () => ({ rows: [cleanState] }),
    audit: () => ({ rows: [cleanState] }),
  };
  const supervisor = client(sql => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
    if (sql.includes("pg_advisory_unlock")) return options.unlock();
    if (!sql.includes("pg_stat_activity")) return { rows: [{ n: 0 }] };
    supervisorReads++;
    if (supervisorReads === 1) return { rows: [cleanState] };
    if (supervisorReads === 2) return options.sample();
    return options.shutdown();
  });
  const audit = client(sql => sql.includes("pg_stat_activity") ? options.audit() : { rows: [] });
  const makeClient = vi.fn()
    .mockReturnValueOnce(supervisor)
    .mockReturnValueOnce(audit);
  const report = vi.fn();
  const checkPorts = vi.fn(async () => {});
  const run = () => main({
    args: ["--worker-qualification"],
    loadStaging: () => ({ pgConfig: {}, appEnv: {}, stackEnv: {}, url: "https://fixture.invalid" }),
    makeClient,
    startChild: () => child,
    checkPorts,
    wait: (ms: number) => ms === 3000 ? monitorTick.promise : Promise.resolve(),
    report,
  });
  return { options, run, supervisor, audit, workload, report, makeClient, child, checkPorts };
}

beforeEach(() => {
  vi.stubEnv("CINE018_STAGING_PROJECT", PROJECT);
  vi.stubEnv("CINE018_STAGING_ENV_FILE", "synthetic-do-not-open");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("keeps the initiating monitoring socket error when the pending query also fails", async () => {
  const f = fixture();
  f.options.sample = () => {
    f.supervisor.emit("error", fault("ECONNRESET"));
    throw fault("SECONDARY_PRIVATE_CODE");
  };

  const result = await f.run();

  expect(result).toMatchObject({
    exitCode: 1, cleanupVerified: true, leaseRelease: "verified_absent",
    firstFailure: { code: "ECONNRESET", phase: "monitor", at: expect.stringMatching(/^\d{4}-.*Z$/) },
  });
  expect(f.child.stop).toHaveBeenCalledTimes(1);
  expect(f.supervisor.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_unlock"))).toBe(false);
  expect(f.audit.query.mock.calls.map(([sql]) => sql === "BEGIN READ ONLY" || sql === "COMMIT" ? sql : "read state"))
    .toEqual(["BEGIN READ ONLY", "read state", "COMMIT"]);
  expect(f.supervisor.end.mock.invocationCallOrder[0]).toBeLessThan(f.audit.connect.mock.invocationCallOrder[0]!);
  expect(JSON.stringify(f.report.mock.calls)).not.toContain(sensitive);
  expect(JSON.stringify(f.report.mock.calls)).not.toContain("SECONDARY_PRIVATE_CODE");
  expect(JSON.stringify(f.report.mock.calls)).not.toContain("pg_stat_activity");
});

it("keeps a lease-release failure ahead of a secondary supervisor-close failure", async () => {
  const f = fixture();
  f.workload.resolve(0);
  f.options.unlock = () => {
    f.supervisor.emit("error", fault("EPIPE"));
    throw fault("UNKNOWN_PRIVATE_CODE");
  };
  f.supervisor.end.mockRejectedValueOnce(fault("ETIMEDOUT"));

  expect(await f.run()).toMatchObject({
    exitCode: 1, cleanupVerified: true, leaseRelease: "verified_absent",
    firstFailure: { code: "EPIPE", phase: "lease_release" },
  });
  expect(f.report).toHaveBeenCalledWith("CINE026_HOSTED_FAILURE", expect.objectContaining({
    code: "ETIMEDOUT", phase: "supervisor_close", primary: false,
  }));
});

it("fails closed when an unacknowledged lease is still visible on the read-only audit", async () => {
  const f = fixture();
  f.workload.resolve(0);
  f.options.unlock = () => ({ rows: [{ released: false }] });
  f.options.audit = () => ({ rows: [{ ...cleanState, advisory_locks: 1 }] });

  expect(await f.run()).toMatchObject({
    exitCode: 1, cleanupVerified: false, leaseRelease: "unconfirmed",
    firstFailure: { code: "LEASE_RELEASE_UNCONFIRMED", phase: "lease_release" },
  });
  expect(f.audit.end).toHaveBeenCalledTimes(1);
});

it("preserves a shutdown read reset when the fresh cleanup read also loses its connection", async () => {
  const f = fixture();
  f.workload.resolve(0);
  f.options.shutdown = () => { throw fault("ECONNRESET"); };
  f.options.audit = () => { throw fault("EPIPE"); };

  expect(await f.run()).toMatchObject({
    exitCode: 1, cleanupVerified: false, leaseRelease: "unconfirmed",
    firstFailure: { code: "ECONNRESET", phase: "shutdown_read" },
  });
  expect(f.report).toHaveBeenCalledWith("CINE026_HOSTED_FAILURE", expect.objectContaining({
    code: "EPIPE", phase: "cleanup_audit", primary: false,
  }));
  expect(f.audit.end).toHaveBeenCalledTimes(1);
});

it("does not attest cleanup if owned ports remain open", async () => {
  const f = fixture();
  f.workload.resolve(0);
  f.checkPorts.mockResolvedValueOnce(undefined).mockRejectedValueOnce(fault("PRIVATE_PORT_RESULT"));

  expect(await f.run()).toMatchObject({
    exitCode: 1, cleanupVerified: false, leaseRelease: "released",
    firstFailure: { code: "PORTS_UNCONFIRMED", phase: "port_check" },
  });
  expect(f.makeClient).toHaveBeenCalledTimes(1);
});

it("requires a new read-only audit after explicit release even when the first snapshot is empty", async () => {
  const f = fixture();
  f.workload.resolve(0);

  expect(await f.run()).toMatchObject({ exitCode: 0, cleanupVerified: true, leaseRelease: "released" });
  const release = f.supervisor.query.mock.calls.findIndex(([sql]) => sql.includes("pg_advisory_unlock"));
  expect(f.supervisor.query.mock.invocationCallOrder[release]).toBeLessThan(f.audit.connect.mock.invocationCallOrder[0]!);
  expect(f.audit.query.mock.calls[0]).toEqual(["BEGIN READ ONLY"]);
});

it("bounds a monitoring query when the driver receives neither a response nor a socket error", async () => {
  vi.useFakeTimers();
  const f = fixture();
  const queued = Promise.withResolvers<Client>();
  f.options.sample = () => {
    // The installed driver queues this query without a server response. Use
    // the runner's client configuration rather than a timer in the mock.
    const silent = new Client(f.makeClient.mock.calls[0]![0]);
    const query = silent.query<typeof cleanState>("SELECT 1");
    queued.resolve(silent);
    return query;
  };
  const run = f.run();
  const driver = await queued.promise;
  try {
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await run).toMatchObject({
      exitCode: 1, cleanupVerified: true, leaseRelease: "verified_absent",
      firstFailure: { code: "PG_READ_TIMEOUT", phase: "monitor" },
    });
    expect(f.makeClient.mock.calls[1]![0]).toMatchObject({ query_timeout: 12_000 });
  } finally {
    await driver.end();
  }
});
