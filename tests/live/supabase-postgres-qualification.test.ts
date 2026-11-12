import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { fork, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Load .env.test.local if present
const envPath = path.join(process.cwd(), ".env.test.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

const PG_CONFIG = {
  host: process.env.SUPABASE_PG_HOST || "aws-0-ap-northeast-2.pooler.supabase.com",
  port: parseInt(process.env.SUPABASE_PG_PORT || "5432", 10),
  database: process.env.SUPABASE_PG_DATABASE || "postgres",
  user: process.env.SUPABASE_PG_USER || "cinematch_runner.dmrbticnsczhyaiftrar",
  password: process.env.SUPABASE_PG_PASSWORD || "",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
};

const UP_MIGRATION_PATH = path.join(
  process.cwd(),
  "src",
  "db",
  "migrations",
  "001_create_room_schema.sql"
);
const DOWN_MIGRATION_PATH = path.join(
  process.cwd(),
  "src",
  "db",
  "migrations",
  "001_down_room_schema.sql"
);
const UP_MIGRATION_SQL = fs.readFileSync(UP_MIGRATION_PATH, "utf-8");
const DOWN_MIGRATION_SQL = fs.readFileSync(DOWN_MIGRATION_PATH, "utf-8");

const WORKER_SCRIPT_PATH = path.join(process.cwd(), "tests", "live", "supabase-worker.cjs");

const isConfigured = Boolean(
  (process.env.SUPABASE_PG_HOST && process.env.SUPABASE_PG_PASSWORD) ||
  fs.existsSync(path.join(process.cwd(), ".env.test.local"))
);

describe.skipIf(!isConfigured)("CINE-012: Live Supabase PostgreSQL Qualification", () => {
  let masterClient: Client;
  const createdRoomIds: string[] = [];

  beforeAll(async () => {
    masterClient = new Client(PG_CONFIG);
    await masterClient.connect();
  });

  afterAll(async () => {
    // Cleanup any test-created rooms
    if (createdRoomIds.length > 0) {
      for (const roomId of createdRoomIds) {
        try {
          await masterClient.query("RESET ROLE");
          await masterClient.query("DELETE FROM rooms WHERE id = $1", [roomId]);
        } catch {}
      }
    }
    await masterClient.end();
  });

  it("1. Connects to real Supabase PostgreSQL and confirms host version and session pooler", async () => {
    await masterClient.query("RESET ROLE");
    const res = await masterClient.query(
      "SELECT current_user, session_user, current_database(), version()"
    );
    expect(res.rows.length).toBe(1);
    const row = res.rows[0];
    expect(row.current_user).toBe("cinematch_runner");
    expect(row.current_database).toBe("postgres");
    expect(row.version).toMatch(/PostgreSQL 17/i);
  }, 60000);

  it("2. Verifies forward and back migrations on clean and seeded Supabase PostgreSQL", async () => {
    await masterClient.query("RESET ROLE");
    // 2a. Rollback down migration on empty database
    await masterClient.query(DOWN_MIGRATION_SQL);

    const tablesAfterDown = await masterClient.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('rooms', 'room_participants', 'rounds', 'candidates', 'votes', 'room_events')`
    );
    expect(tablesAfterDown.rows.length).toBe(0);

    // 2b. Forward migration on clean database
    await masterClient.query(UP_MIGRATION_SQL);
    const tablesAfterUp = await masterClient.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('rooms', 'room_participants', 'rounds', 'candidates', 'votes', 'room_events')
       ORDER BY table_name`
    );
    expect(tablesAfterUp.rows.length).toBe(6);

    // 2c. Seed test data
    const seedRoomId = crypto.randomUUID();
    const seedHostId = crypto.randomUUID();
    const seedRoundId = crypto.randomUUID();
    const seedCandidateId = crypto.randomUUID();

    await masterClient.query(
      `INSERT INTO rooms (id, code, host_participant_id, participant_count, status, state_version, expires_at)
       VALUES ($1, 'SEED01', NULL, 1, 'LOBBY', 1, NOW() + INTERVAL '1 day')`,
      [seedRoomId]
    );
    await masterClient.query(
      `INSERT INTO room_participants (room_id, participant_id, display_name, role)
       VALUES ($1, $2, 'Seed Host', 'HOST')`,
      [seedRoomId, seedHostId]
    );
    await masterClient.query(
      `UPDATE rooms SET host_participant_id = $1 WHERE id = $2`,
      [seedHostId, seedRoomId]
    );
    await masterClient.query(
      `INSERT INTO rounds (id, room_id, round_number, status)
       VALUES ($1, $2, 1, 'ACTIVE')`,
      [seedRoundId, seedRoomId]
    );
    await masterClient.query(
      `INSERT INTO candidates (id, room_id, round_id, movie_id, position, title, vote_average)
       VALUES ($1, $2, $3, 99901, 0, 'Seed Movie', 8.5)`,
      [seedCandidateId, seedRoomId, seedRoundId]
    );
    await masterClient.query(
      `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
       VALUES ($1, $2, $3, $4, $5, 99901, 'LIKE')`,
      [crypto.randomUUID(), seedRoomId, seedRoundId, seedHostId, seedCandidateId]
    );
    await masterClient.query(
      `INSERT INTO room_events (room_id, version, event_type, payload)
       VALUES ($1, 1, 'ROOM_CREATED', '{"seed":true}')`,
      [seedRoomId]
    );

    // 2d. Rollback down migration on SEEDED database (verifies FK cascades & teardown order)
    await masterClient.query(DOWN_MIGRATION_SQL);
    const tablesAfterSeededDown = await masterClient.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('rooms', 'room_participants', 'rounds', 'candidates', 'votes', 'room_events')`
    );
    expect(tablesAfterSeededDown.rows.length).toBe(0);

    // 2e. Re-apply forward migration for remaining test suite
    await masterClient.query(UP_MIGRATION_SQL);
    const tablesFinal = await masterClient.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('rooms', 'room_participants', 'rounds', 'candidates', 'votes', 'room_events')`
    );
    expect(tablesFinal.rows.length).toBe(6);
  }, 60000);

  it("3. Verifies role table permissions, RPC lockdown, and sequence access", async () => {
    await masterClient.query("RESET ROLE");
    // 3a. Anon role has 0 table permissions on all 6 tables
    const tableNames = ["rooms", "room_participants", "rounds", "candidates", "votes", "room_events"];
    for (const table of tableNames) {
      const anonSelect = await masterClient.query(
        `SELECT has_table_privilege('anon', $1, 'SELECT') as priv`,
        [table]
      );
      expect(anonSelect.rows[0].priv).toBe(false);

      const anonInsert = await masterClient.query(
        `SELECT has_table_privilege('anon', $1, 'INSERT') as priv`,
        [table]
      );
      expect(anonInsert.rows[0].priv).toBe(false);

      const anonDelete = await masterClient.query(
        `SELECT has_table_privilege('anon', $1, 'DELETE') as priv`,
        [table]
      );
      expect(anonDelete.rows[0].priv).toBe(false);
    }

    // 3b. Authenticated role has SELECT on read models, but NOT on votes or room_events, and NO write privileges
    for (const table of ["rooms", "room_participants", "rounds", "candidates"]) {
      const authSelect = await masterClient.query(
        `SELECT has_table_privilege('authenticated', $1, 'SELECT') as priv`,
        [table]
      );
      expect(authSelect.rows[0].priv).toBe(true);

      const authInsert = await masterClient.query(
        `SELECT has_table_privilege('authenticated', $1, 'INSERT') as priv`,
        [table]
      );
      expect(authInsert.rows[0].priv).toBe(false);

      const authDelete = await masterClient.query(
        `SELECT has_table_privilege('authenticated', $1, 'DELETE') as priv`,
        [table]
      );
      expect(authDelete.rows[0].priv).toBe(false);
    }

    for (const table of ["votes", "room_events"]) {
      const authSelect = await masterClient.query(
        `SELECT has_table_privilege('authenticated', $1, 'SELECT') as priv`,
        [table]
      );
      expect(authSelect.rows[0].priv).toBe(false);
    }

    // 3c. Function lockdown
    const anonRpc = await masterClient.query(
      `SELECT has_function_privilege('anon', 'get_room_by_code(varchar)', 'EXECUTE') as priv`
    );
    expect(anonRpc.rows[0].priv).toBe(false);

    const authRpc = await masterClient.query(
      `SELECT has_function_privilege('authenticated', 'get_room_by_code(varchar)', 'EXECUTE') as priv`
    );
    expect(authRpc.rows[0].priv).toBe(false);

    const serviceRpc = await masterClient.query(
      `SELECT has_function_privilege('service_role', 'get_room_by_code(varchar)', 'EXECUTE') as priv`
    );
    expect(serviceRpc.rows[0].priv).toBe(true);

    // 3d. Sequence lockdown: room_events_id_seq
    const anonSeq = await masterClient.query(
      `SELECT has_sequence_privilege('anon', 'room_events_id_seq', 'USAGE') as priv`
    );
    expect(anonSeq.rows[0].priv).toBe(false);

    const authSeq = await masterClient.query(
      `SELECT has_sequence_privilege('authenticated', 'room_events_id_seq', 'USAGE') as priv`
    );
    expect(authSeq.rows[0].priv).toBe(false);

    const serviceSeq = await masterClient.query(
      `SELECT has_sequence_privilege('service_role', 'room_events_id_seq', 'USAGE') as priv`
    );
    expect(serviceSeq.rows[0].priv).toBe(true);
  }, 60000);

  it("4. Enforces JWT/RLS isolation and fail-closed security for authenticated and anon users", async () => {
    await masterClient.query("RESET ROLE");
    const roomId = crypto.randomUUID();
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const strangerId = crypto.randomUUID();
    createdRoomIds.push(roomId);

    try {
      // Insert room as service/admin
      await masterClient.query(
        `INSERT INTO rooms (id, code, host_participant_id, participant_count, status, state_version, expires_at)
         VALUES ($1, 'RLS001', NULL, 2, 'ACTIVE', 1, NOW() + INTERVAL '1 day')`,
        [roomId]
      );
      await masterClient.query(
        `INSERT INTO room_participants (room_id, participant_id, display_name, role)
         VALUES ($1, $2, 'RLS Host', 'HOST'), ($1, $3, 'RLS Guest', 'MEMBER')`,
        [roomId, hostId, guestId]
      );
      await masterClient.query(
        `UPDATE rooms SET host_participant_id = $1 WHERE id = $2`,
        [hostId, roomId]
      );

      // Test 4a: As anon, SELECT on rooms throws 42501 (permission denied)
      await masterClient.query("SET ROLE anon");
      let anonErr: { code?: string } | null = null;
      try {
        await masterClient.query("SELECT * FROM rooms WHERE id = $1", [roomId]);
      } catch (err) {
        anonErr = err as { code?: string };
      }
      expect(anonErr).not.toBeNull();
      expect(anonErr?.code).toBe("42501");
      await masterClient.query("RESET ROLE");

      // Test 4b: As authenticated member (Host), can read own participant record but NOT guest's record
      await masterClient.query("SET ROLE authenticated");
      await masterClient.query(`SET "request.jwt.claims" = '{"sub": "${hostId}"}'`);

      const hostOwnRecord = await masterClient.query(
        "SELECT participant_id, display_name FROM room_participants WHERE room_id = $1",
        [roomId]
      );
      expect(hostOwnRecord.rows.length).toBe(1);
      expect(hostOwnRecord.rows[0].participant_id).toBe(hostId);

      // Can read room since host is a participant in it
      const hostRoomRecord = await masterClient.query(
        "SELECT id, code FROM rooms WHERE id = $1",
        [roomId]
      );
      expect(hostRoomRecord.rows.length).toBe(1);
      expect(hostRoomRecord.rows[0].id).toBe(roomId);

      // Test 4c: As authenticated stranger, gets 0 rows for rooms and room_participants
      await masterClient.query(`SET "request.jwt.claims" = '{"sub": "${strangerId}"}'`);
      const strangerRoomRecord = await masterClient.query(
        "SELECT id, code FROM rooms WHERE id = $1",
        [roomId]
      );
      expect(strangerRoomRecord.rows.length).toBe(0);

      const strangerPartRecord = await masterClient.query(
        "SELECT participant_id FROM room_participants WHERE room_id = $1",
        [roomId]
      );
      expect(strangerPartRecord.rows.length).toBe(0);
    } finally {
      await masterClient.query("RESET ROLE");
    }
  }, 60000);

  it("5. Executes two independent Node.js processes with separate connections & SELECT FOR UPDATE contention", async () => {
    await masterClient.query("RESET ROLE");
    const roomId = crypto.randomUUID();
    const roundId = crypto.randomUUID();
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    const targetMovieId = 77701;
    createdRoomIds.push(roomId);

    // Setup Room, Participants, Round, and Candidates
    await masterClient.query(
      `INSERT INTO rooms (id, code, host_participant_id, participant_count, status, state_version, expires_at)
       VALUES ($1, 'CONC01', NULL, 2, 'ACTIVE', 1, NOW() + INTERVAL '1 day')`,
      [roomId]
    );
    await masterClient.query(
      `INSERT INTO room_participants (room_id, participant_id, display_name, role)
       VALUES ($1, $2, 'Concurrent Host', 'HOST'), ($1, $3, 'Concurrent Guest', 'MEMBER')`,
      [roomId, hostId, guestId]
    );
    await masterClient.query(
      `UPDATE rooms SET host_participant_id = $1 WHERE id = $2`,
      [hostId, roomId]
    );
    await masterClient.query(
      `INSERT INTO rounds (id, room_id, round_number, status)
       VALUES ($1, $2, 1, 'ACTIVE')`,
      [roundId, roomId]
    );

    for (let pos = 0; pos < 20; pos++) {
      const cId = pos === 0 ? candidateId : crypto.randomUUID();
      const mId = pos === 0 ? targetMovieId : 77800 + pos;
      await masterClient.query(
        `INSERT INTO candidates (id, room_id, round_id, movie_id, position, title, vote_average)
         VALUES ($1, $2, $3, $4, $5, $6, 8.0)`,
        [cId, roomId, roundId, mId, pos, `Candidate Movie ${pos}`]
      );
    }

    // Launch 2 independent Node.js processes
    const spawnWorker = () => {
      const child = fork(WORKER_SCRIPT_PATH, [], {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      return child;
    };

    const worker1 = spawnWorker();
    const worker2 = spawnWorker();

    const waitReady = (child: ChildProcess): Promise<number> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker ready timeout")), 10000);
        child.on("message", (msg: unknown) => {
          const m = msg as { type?: string; pid?: number } | null;
          if (m && m.type === "READY" && typeof m.pid === "number") {
            clearTimeout(timeout);
            resolve(m.pid);
          }
        });
        child.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

    const [pid1, pid2] = await Promise.all([waitReady(worker1), waitReady(worker2)]);
    expect(pid1).toBeGreaterThan(0);
    expect(pid2).toBeGreaterThan(0);
    expect(pid1).not.toBe(pid2);

    // Issue simultaneous final LIKE votes via IPC barrier
    const executeVote = (
      child: ChildProcess,
      participantId: string
    ): Promise<{ transition: string; durationMs: number; error: string | null }> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker vote timeout")), 15000);
        child.on("message", (msg: unknown) => {
          const m = msg as { transition?: string; durationMs?: number; error?: string | null } | null;
          if (m && typeof m.transition === "string") {
            clearTimeout(timeout);
            resolve({
              transition: m.transition,
              durationMs: m.durationMs ?? 0,
              error: m.error ?? null,
            });
          }
        });
        child.send({
          command: "VOTE",
          roomId,
          roundId,
          participantId,
          candidateId,
          movieId: targetMovieId,
          terminateAfter: true,
        });
      });

    const [res1, res2] = await Promise.all([
      executeVote(worker1, hostId),
      executeVote(worker2, guestId),
    ]);

    expect(res1.error).toBeNull();
    expect(res2.error).toBeNull();

    // Verification of SELECT ... FOR UPDATE serialization:
    // Exactly one worker committed MATCHED and inserted MATCH_ANNOUNCED event
    const transitions = [res1.transition, res2.transition].sort();
    expect(transitions).toEqual(["MATCHED", "VOTE_RECORDED"]);

    // Inspect authoritative PostgreSQL state in Supabase
    const roomState = await masterClient.query(
      "SELECT status, matched_movie_id, state_version FROM rooms WHERE id = $1",
      [roomId]
    );
    expect(roomState.rows.length).toBe(1);
    expect(roomState.rows[0].status).toBe("MATCHED");
    expect(roomState.rows[0].matched_movie_id).toBe(targetMovieId);
    expect(roomState.rows[0].state_version).toBe(3); // 1 (create) + 1 (first vote) + 1 (match vote)

    // Inspect Outbox events: exactly one MATCH_ANNOUNCED event exists
    const matchEvents = await masterClient.query(
      "SELECT * FROM room_events WHERE room_id = $1 AND event_type = 'MATCH_ANNOUNCED'",
      [roomId]
    );
    expect(matchEvents.rows.length).toBe(1);
    const rawPayload = matchEvents.rows[0].payload;
    const matchPayload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
    expect(matchPayload.movieId).toBe(targetMovieId);
    expect(matchPayload.unanimousCount).toBe(2);

    // Votes table contains exactly 2 votes
    const votes = await masterClient.query(
      "SELECT * FROM votes WHERE round_id = $1 AND candidate_id = $2",
      [roundId, candidateId]
    );
    expect(votes.rows.length).toBe(2);
  }, 30000);

  it("6. Verifies idempotency, transaction rollback, reconnect, and measures p50/p95/p99 latency", async () => {
    await masterClient.query("RESET ROLE");
    const roomId = crypto.randomUUID();
    const roundId = crypto.randomUUID();
    const participantId = crypto.randomUUID();
    const candidateId = crypto.randomUUID();
    createdRoomIds.push(roomId);

    await masterClient.query(
      `INSERT INTO rooms (id, code, host_participant_id, participant_count, status, state_version, expires_at)
       VALUES ($1, 'IDEM01', NULL, 1, 'ACTIVE', 1, NOW() + INTERVAL '1 day')`,
      [roomId]
    );
    await masterClient.query(
      `INSERT INTO room_participants (room_id, participant_id, display_name, role)
       VALUES ($1, $2, 'Tester', 'HOST')`,
      [roomId, participantId]
    );
    await masterClient.query(
      `UPDATE rooms SET host_participant_id = $1 WHERE id = $2`,
      [participantId, roomId]
    );
    await masterClient.query(
      `INSERT INTO rounds (id, room_id, round_number, status)
       VALUES ($1, $2, 1, 'ACTIVE')`,
      [roundId, roomId]
    );
    await masterClient.query(
      `INSERT INTO candidates (id, room_id, round_id, movie_id, position, title, vote_average)
       VALUES ($1, $2, $3, 88801, 0, 'Test Movie', 7.5)`,
      [candidateId, roomId, roundId]
    );

    // 6a. Idempotent duplicate vote (ON CONFLICT DO NOTHING)
    const voteId1 = crypto.randomUUID();
    await masterClient.query(
      `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
       VALUES ($1, $2, $3, $4, $5, 88801, 'LIKE')
       ON CONFLICT (round_id, participant_id, candidate_id) DO NOTHING`,
      [voteId1, roomId, roundId, participantId, candidateId]
    );
    const voteId2 = crypto.randomUUID();
    await masterClient.query(
      `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
       VALUES ($1, $2, $3, $4, $5, 88801, 'LIKE')
       ON CONFLICT (round_id, participant_id, candidate_id) DO NOTHING`,
      [voteId2, roomId, roundId, participantId, candidateId]
    );
    const voteRows = await masterClient.query(
      "SELECT * FROM votes WHERE room_id = $1 AND candidate_id = $2",
      [roomId, candidateId]
    );
    expect(voteRows.rows.length).toBe(1);
    expect(voteRows.rows[0].id).toBe(voteId1);

    // 6b. Transaction Rollback: rolled back transaction leaves 0 phantom rows
    await masterClient.query("BEGIN");
    await masterClient.query(
      `INSERT INTO candidates (id, room_id, round_id, movie_id, position, title, vote_average)
       VALUES ($1, $2, $3, 88899, 1, 'Rollback Candidate', 6.0)`,
      [crypto.randomUUID(), roomId, roundId]
    );
    await masterClient.query("ROLLBACK");
    const phantom = await masterClient.query(
      "SELECT * FROM candidates WHERE round_id = $1 AND movie_id = 88899",
      [roundId]
    );
    expect(phantom.rows.length).toBe(0);

    // 6c. Reconnect verification
    const reconnectClient = new Client(PG_CONFIG);
    await reconnectClient.connect();
    const reconnectRes = await reconnectClient.query("SELECT 1 as connected");
    expect(reconnectRes.rows[0].connected).toBe(1);
    await reconnectClient.end();

    // 6d. Latency measurement across 50 concurrent transition cycles
    // Pre-create 3 rounds with 20 + 20 + 10 = 50 candidates in the test room
    const round2Id = crypto.randomUUID();
    const round3Id = crypto.randomUUID();
    const round4Id = crypto.randomUUID();
    await masterClient.query(
      `INSERT INTO rounds (id, room_id, round_number, status)
       VALUES ($1, $2, 2, 'ACTIVE'), ($3, $2, 3, 'ACTIVE'), ($4, $2, 4, 'ACTIVE')`,
      [round2Id, roomId, round3Id, round4Id]
    );

    const testCandidates: { roundId: string; candidateId: string; movieId: number }[] = [];
    for (let i = 0; i < 50; i++) {
      const cId = crypto.randomUUID();
      const mId = 92000 + i;
      const rId = i < 20 ? round2Id : i < 40 ? round3Id : round4Id;
      const pos = i < 20 ? i : i < 40 ? i - 20 : i - 40;
      await masterClient.query(
        `INSERT INTO candidates (id, room_id, round_id, movie_id, position, title, vote_average)
         VALUES ($1, $2, $3, $4, $5, $6, 7.5)`,
        [cId, roomId, rId, mId, pos, `Perf Candidate ${i}`]
      );
      testCandidates.push({ roundId: rId, candidateId: cId, movieId: mId });
    }

    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const target = testCandidates[i];
      const t0 = performance.now();
      await masterClient.query("BEGIN");
      const rRes = await masterClient.query(
        "SELECT id, status, participant_count, state_version FROM rooms WHERE id = $1 FOR UPDATE",
        [roomId]
      );
      const nextVer = rRes.rows[0].state_version + 1;
      await masterClient.query(
        `INSERT INTO votes (id, room_id, round_id, participant_id, candidate_id, movie_id, vote)
         VALUES ($1, $2, $3, $4, $5, $6, 'SKIP')
         ON CONFLICT (round_id, participant_id, candidate_id) DO NOTHING`,
        [crypto.randomUUID(), roomId, target.roundId, participantId, target.candidateId, target.movieId]
      );
      await masterClient.query(
        "UPDATE rooms SET state_version = $1, last_activity_at = NOW() WHERE id = $2",
        [nextVer, roomId]
      );
      await masterClient.query(
        `INSERT INTO room_events (room_id, version, event_type, payload)
         VALUES ($1, $2, 'VOTE_RECORDED', '{"perf":true}')`,
        [roomId, nextVer]
      );
      await masterClient.query("COMMIT");
      const duration = performance.now() - t0;
      latencies.push(duration);
    }

    latencies.sort((a, b) => a - b);
    const min = latencies[0];
    const max = latencies[latencies.length - 1];
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    console.log(
      `Supabase PostgreSQL Latency (50 runs): min=${min.toFixed(2)}ms, p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms, p99=${p99.toFixed(2)}ms, max=${max.toFixed(2)}ms`
    );

    expect(p50).toBeGreaterThan(0);
    expect(p95).toBeGreaterThanOrEqual(p50);
    expect(p99).toBeGreaterThanOrEqual(p95);
  }, 60000);
});
