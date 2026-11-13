// tests/live/scoped-lock-probe.ts
// Shared deterministic row-level lock contention probe for live PostgreSQL qualification.
// Verifies via pg_backend_pid(), pg_stat_activity, pg_blocking_pids(), and scoped pg_locks
// that Client 2 is explicitly blocked by Client 1 on the target room row until Client 1 commits.

import { Client, type ClientConfig } from 'pg';

const SAFE_SCHEMA_REGEX = /^cinematch_qual_[0-9]+_[a-f0-9]{8}$/;

export interface ScopedLockProbeResult {
  client1Pid: number;
  client2Pid: number;
  blockingPids: number[];
  waitEventType: string | null;
  waitEvent: string | null;
  waitingLockType: string;
  waitingLockMode: string;
  holdingLockMode: string;
  roomRelationLockMode: string;
  client2WaitDurationMs: number;
}

/**
 * Demonstrates deterministic PostgreSQL row-level lock blocking (`SELECT ... FOR UPDATE`)
 * between two independent connections and asserts kernel-level lock ownership via
 * `pg_backend_pid()`, `pg_blocking_pids()`, `pg_stat_activity`, and scoped `pg_locks`.
 */
export async function verifyScopedRowLockBlocking(params: {
  pgConfig: ClientConfig;
  observerClient: Client;
  schema: string;
  roomId: string;
  holdMs?: number;
  pollTimeoutMs?: number;
  onLog?: (message: string) => void;
}): Promise<ScopedLockProbeResult> {
  const {
    pgConfig,
    observerClient,
    schema,
    roomId,
    holdMs = 400,
    pollTimeoutMs = 3000,
    onLog,
  } = params;

  if (!SAFE_SCHEMA_REGEX.test(schema)) {
    throw new Error(`DETERMINISTIC LOCK FAILURE: Invalid schema identifier '${schema}'.`);
  }

  const client1 = new Client(pgConfig);
  const client2 = new Client(pgConfig);
  await Promise.all([client1.connect(), client2.connect()]);

  let client1Committed = false;
  let client2Committed = false;

  try {
    // Client 1 enters transaction, records backend PID, and acquires FOR UPDATE lock on target room.
    await client1.query('BEGIN;');
    const c1PidRes = await client1.query<{ pid: number | string }>('SELECT pg_backend_pid() AS pid;');
    const client1Pid = Number(c1PidRes.rows[0]?.pid);
    if (!Number.isInteger(client1Pid) || client1Pid <= 0) {
      throw new Error(`DETERMINISTIC LOCK FAILURE: Invalid Client 1 pg_backend_pid(): ${c1PidRes.rows[0]?.pid}`);
    }

    await client1.query(`SELECT id FROM "${schema}".rooms WHERE id = $1 FOR UPDATE;`, [roomId]);
    onLog?.(`      Client 1 (PID ${client1Pid}) acquired exclusive row lock on "${schema}".rooms (${roomId}).`);

    // Client 2 enters transaction and records its pinned backend PID before issuing FOR UPDATE.
    await client2.query('BEGIN;');
    const c2PidRes = await client2.query<{ pid: number | string }>('SELECT pg_backend_pid() AS pid;');
    const client2Pid = Number(c2PidRes.rows[0]?.pid);
    if (!Number.isInteger(client2Pid) || client2Pid <= 0) {
      throw new Error(`DETERMINISTIC LOCK FAILURE: Invalid Client 2 pg_backend_pid(): ${c2PidRes.rows[0]?.pid}`);
    }
    if (client1Pid === client2Pid) {
      throw new Error(
        `DETERMINISTIC LOCK FAILURE: Client 1 and Client 2 shared backend PID ${client1Pid}; distinct connections required.`
      );
    }

    let c2Resolved = false;
    let c2AcquireDurationMs = 0;

    const c2Promise = (async () => {
      const startT = performance.now();
      await client2.query(`SELECT id FROM "${schema}".rooms WHERE id = $1 FOR UPDATE;`, [roomId]);
      c2Resolved = true;
      c2AcquireDurationMs = performance.now() - startT;
      await client2.query('COMMIT;');
      client2Committed = true;
    })();

    const roomRegclass = `"${schema}".rooms`;
    const deadline = Date.now() + pollTimeoutMs;
    let matchedActivity: {
      blockingPids: number[];
      waitEventType: string | null;
      waitEvent: string | null;
    } | null = null;
    let matchedLock: {
      waitingLockType: string;
      waitingLockMode: string;
      holdingLockMode: string;
      roomRelationLockMode: string;
    } | null = null;

    while (Date.now() < deadline) {
      const activityRes = await observerClient.query<{
        pid: number | string;
        state: string | null;
        wait_event_type: string | null;
        wait_event: string | null;
        blocking_pids: Array<number | string> | null;
      }>(
        `
          SELECT
            sa.pid,
            sa.state,
            sa.wait_event_type,
            sa.wait_event,
            pg_blocking_pids(sa.pid) AS blocking_pids
          FROM pg_stat_activity sa
          WHERE sa.pid = $1;
        `,
        [client2Pid]
      );

      const lockRes = await observerClient.query<{
        waiting_pid: number | string;
        waiting_locktype: string;
        waiting_mode: string;
        waiting_granted: boolean;
        holding_pid: number | string;
        holding_locktype: string;
        holding_mode: string;
        holding_granted: boolean;
        room_relation_lock_mode: string;
      }>(
        `
          SELECT
            l2.pid AS waiting_pid,
            l2.locktype AS waiting_locktype,
            l2.mode AS waiting_mode,
            l2.granted AS waiting_granted,
            l1.pid AS holding_pid,
            l1.locktype AS holding_locktype,
            l1.mode AS holding_mode,
            l1.granted AS holding_granted,
            l1_rel.mode AS room_relation_lock_mode
          FROM pg_locks l2
          JOIN pg_locks l1
            ON l1.pid = $2
           AND l1.granted = true
           AND (
             (l2.locktype = 'transactionid' AND l1.locktype = 'transactionid' AND l2.transactionid = l1.transactionid)
             OR (l2.locktype = 'tuple' AND l1.locktype = 'tuple' AND l2.relation = l1.relation AND l2.page = l1.page AND l2.tuple = l1.tuple)
           )
          JOIN pg_locks l1_rel
            ON l1_rel.pid = $2
           AND l1_rel.granted = true
           AND l1_rel.locktype = 'relation'
           AND l1_rel.relation = $3::regclass
          WHERE l2.pid = $1
            AND l2.granted = false;
        `,
        [client2Pid, client1Pid, roomRegclass]
      );

      const activityRow = activityRes.rows[0];
      const blockingPids = Array.isArray(activityRow?.blocking_pids)
        ? activityRow.blocking_pids.map(Number).filter((n) => Number.isInteger(n))
        : [];

      const lockRow = lockRes.rows[0];

      if (
        activityRow &&
        activityRow.wait_event_type === 'Lock' &&
        blockingPids.includes(client1Pid) &&
        lockRow &&
        Number(lockRow.waiting_pid) === client2Pid &&
        lockRow.waiting_granted === false &&
        Number(lockRow.holding_pid) === client1Pid &&
        lockRow.holding_granted === true
      ) {
        matchedActivity = {
          blockingPids,
          waitEventType: activityRow.wait_event_type,
          waitEvent: activityRow.wait_event,
        };
        matchedLock = {
          waitingLockType: lockRow.waiting_locktype,
          waitingLockMode: lockRow.waiting_mode,
          holdingLockMode: lockRow.holding_mode,
          roomRelationLockMode: lockRow.room_relation_lock_mode,
        };
        onLog?.(
          `      Verified scoped PostgreSQL lock contention: Client 2 PID ${client2Pid} waiting on ${matchedLock.waitingLockType} (${matchedLock.waitingLockMode}, wait_event=${matchedActivity.waitEventType}:${matchedActivity.waitEvent}), pg_blocking_pids=[${blockingPids.join(', ')}] includes Client 1 PID ${client1Pid} holding ${matchedLock.roomRelationLockMode} on ${roomRegclass}.`
        );
        break;
      }

      if (c2Resolved) {
        break;
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    if (c2Resolved) {
      throw new Error(
        `DETERMINISTIC LOCK FAILURE: Client 2 (PID ${client2Pid}) resolved while Client 1 (PID ${client1Pid}) still held row lock!`
      );
    }

    if (!matchedActivity || !matchedLock) {
      throw new Error(
        `DETERMINISTIC LOCK FAILURE: Scoped pg_stat_activity / pg_locks / pg_blocking_pids(${client2Pid}) did not attest blocking by Client 1 PID ${client1Pid} on ${roomRegclass}.`
      );
    }

    // Hold row lock for forced duration and confirm Client 2 stays blocked right until COMMIT.
    await new Promise((r) => setTimeout(r, holdMs));
    if (c2Resolved) {
      throw new Error(
        `DETERMINISTIC LOCK FAILURE: Client 2 (PID ${client2Pid}) resolved prematurely before Client 1 (PID ${client1Pid}) COMMIT!`
      );
    }

    onLog?.(`      Client 1 (PID ${client1Pid}) committing transaction to release lock...`);
    await client1.query('COMMIT;');
    client1Committed = true;

    await c2Promise;
    onLog?.(
      `      Client 2 (PID ${client2Pid}) unblocked after Client 1 COMMIT and acquired lock (${c2AcquireDurationMs.toFixed(1)}ms, forced hold >= ${holdMs}ms).`
    );

    if (c2AcquireDurationMs < holdMs) {
      throw new Error(
        `DETERMINISTIC LOCK FAILURE: Client 2 waited only ${c2AcquireDurationMs.toFixed(1)}ms, expected >= ${holdMs}ms`
      );
    }

    return {
      client1Pid,
      client2Pid,
      blockingPids: matchedActivity.blockingPids,
      waitEventType: matchedActivity.waitEventType,
      waitEvent: matchedActivity.waitEvent,
      waitingLockType: matchedLock.waitingLockType,
      waitingLockMode: matchedLock.waitingLockMode,
      holdingLockMode: matchedLock.holdingLockMode,
      roomRelationLockMode: matchedLock.roomRelationLockMode,
      client2WaitDurationMs: c2AcquireDurationMs,
    };
  } finally {
    if (!client1Committed) {
      await client1.query('ROLLBACK;').catch(() => {});
    }
    if (!client2Committed) {
      await client2.query('ROLLBACK;').catch(() => {});
    }
    await Promise.all([client1.end().catch(() => {}), client2.end().catch(() => {})]);
  }
}
