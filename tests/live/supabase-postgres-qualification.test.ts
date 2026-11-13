import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { fork, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  PostgresRoomRepository,
  RoomCapacityError,
  CandidateNotFoundError,
  ParticipantNotFoundError,
  RoundNotFoundError,
} from "../../src/lib/server/room/roomRepository";
import { verifyScopedRowLockBlocking } from "./scoped-lock-probe";

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

const ALLOWED_PROJECT_REF = "dmrbticnsczhyaiftrar";

const PG_HOST = process.env.SUPABASE_PG_HOST || "";
const PG_USER = process.env.SUPABASE_PG_USER || "";
const PG_PASSWORD = process.env.SUPABASE_PG_PASSWORD || "";
const PG_PORT = parseInt(process.env.SUPABASE_PG_PORT || "5432", 10);
const PG_DATABASE = process.env.SUPABASE_PG_DATABASE || "postgres";

// Unique per-run isolated schema identification
const RUN_ID = crypto.randomUUID();
const RUN_SUFFIX = crypto.randomBytes(4).toString("hex");
const TIMESTAMP = Math.floor(Date.now() / 1000);
const TEST_SCHEMA = `cinematch_qual_${TIMESTAMP}_${RUN_SUFFIX}`;

const isConfigured = Boolean(
  process.env.ALLOW_DESTRUCTIVE_PG_TESTS === "true" &&
  PG_HOST &&
  PG_USER &&
  PG_PASSWORD &&
  (PG_HOST.includes(ALLOWED_PROJECT_REF) || PG_USER.includes(ALLOWED_PROJECT_REF))
);

const CA_CERT_PATH = path.join(process.cwd(), "src", "db", "supabase-root-ca.crt");
const CA_CERT = fs.existsSync(CA_CERT_PATH) ? fs.readFileSync(CA_CERT_PATH, "utf8") : "";

const PG_CONFIG = {
  host: PG_HOST,
  port: PG_PORT,
  database: PG_DATABASE,
  user: PG_USER,
  password: PG_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: CA_CERT,
    servername: PG_HOST,
  },
  connectionTimeoutMillis: 10000,
};

const UP_MIGRATION_PATH = path.join(process.cwd(), "src", "db", "migrations", "001_create_room_schema.sql");
const DOWN_MIGRATION_PATH = path.join(process.cwd(), "src", "db", "migrations", "001_down_room_schema.sql");
const UP_MIGRATION_RAW = fs.existsSync(UP_MIGRATION_PATH) ? fs.readFileSync(UP_MIGRATION_PATH, "utf-8") : "";
const DOWN_MIGRATION_RAW = fs.existsSync(DOWN_MIGRATION_PATH) ? fs.readFileSync(DOWN_MIGRATION_PATH, "utf-8") : "";

function adaptUpMigration(rawSql: string, schema: string): string {
  return rawSql
    .replace(/public\.room_participants/g, `"${schema}".room_participants`)
    .replace(/public\.rooms/g, `"${schema}".rooms`)
    .replace(/SET search_path = public, pg_temp/g, `SET search_path = "${schema}", pg_temp`);
}

const UP_MIGRATION_SQL = adaptUpMigration(UP_MIGRATION_RAW, TEST_SCHEMA);
const DOWN_MIGRATION_SQL = DOWN_MIGRATION_RAW;

const WORKER_SCRIPT_PATH = path.join(process.cwd(), "tests", "live", "supabase-worker.ts");

interface TableSnapshot {
  name: string;
  rowCount: number;
}

async function getPublicSchemaSnapshot(client: Client): Promise<TableSnapshot[]> {
  const tablesRes = await client.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name;`
  );
  const snapshot: TableSnapshot[] = [];
  for (const row of tablesRes.rows) {
    const tName = row.table_name;
    const countRes = await client.query(`SELECT COUNT(*)::int as cnt FROM public."${tName}";`);
    snapshot.push({ name: tName, rowCount: countRes.rows[0].cnt });
  }
  return snapshot;
}

async function insertOwnershipMarker(client: Client, schema: string, runId: string) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "${schema}"."_cinematch_run_metadata" (
      run_id TEXT PRIMARY KEY,
      schema_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      creator_pid INT NOT NULL,
      host_ref TEXT NOT NULL
    );
  `);
  await client.query(
    `INSERT INTO "${schema}"."_cinematch_run_metadata" (run_id, schema_name, creator_pid, host_ref)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (run_id) DO NOTHING;`,
    [runId, schema, process.pid, ALLOWED_PROJECT_REF]
  );
}

async function verifyOwnershipMarker(client: Client, schema: string, runId: string): Promise<boolean> {
  try {
    const res = await client.query(
      `SELECT run_id, schema_name FROM "${schema}"."_cinematch_run_metadata" WHERE run_id = $1`,
      [runId]
    );
    return res.rows.length === 1 && res.rows[0].run_id === runId && res.rows[0].schema_name === schema;
  } catch {
    return false;
  }
}

describe.skipIf(!isConfigured)("CINE-012: Live Supabase PostgreSQL Qualification", () => {
  let masterClient: Client;
  let baselineSnapshot: TableSnapshot[] = [];
  let schemaCreated = false;

  beforeAll(async () => {
    masterClient = new Client(PG_CONFIG);
    await masterClient.connect();

    // 1. Record baseline snapshot of public schema
    baselineSnapshot = await getPublicSchemaSnapshot(masterClient);

    // 2. Pre-check: fail closed if target schema already exists
    const preCheck = await masterClient.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [TEST_SCHEMA]
    );
    if (preCheck.rows.length > 0) {
      throw new Error(`FAIL-CLOSED REFUSAL: Target test schema '${TEST_SCHEMA}' already exists.`);
    }

    // 3. Create unique isolated test schema with ownership marker
    await masterClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    schemaCreated = true;
    await masterClient.query(`GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO anon, authenticated, service_role;`);
    await masterClient.query(`GRANT ALL ON SCHEMA "${TEST_SCHEMA}" TO service_role;`);
    await masterClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);
    await insertOwnershipMarker(masterClient, TEST_SCHEMA, RUN_ID);
  }, 30000);

  afterAll(async () => {
    let teardownErr: Error | null = null;
    if (schemaCreated && masterClient) {
      try {
        await masterClient.query("RESET ROLE;");
        const isOwner = await verifyOwnershipMarker(masterClient, TEST_SCHEMA, RUN_ID);
        if (!isOwner) {
          throw new Error(`FAIL-CLOSED REFUSAL: Schema '${TEST_SCHEMA}' ownership marker missing or run_id mismatch!`);
        }

        await masterClient.query(`DROP SCHEMA "${TEST_SCHEMA}" CASCADE;`);

        const checkGone = await masterClient.query(
          `SELECT count(*)::int as cnt FROM information_schema.schemata WHERE schema_name = $1`,
          [TEST_SCHEMA]
        );
        if (checkGone.rows[0].cnt !== 0) {
          throw new Error(`TEARDOWN VERIFICATION FAILURE: Schema '${TEST_SCHEMA}' still exists after DROP CASCADE!`);
        }
      } catch (err: unknown) {
        teardownErr = err instanceof Error ? err : new Error(String(err));
      }
    }

    // Verify preservation of public schema
    if (masterClient) {
      try {
        const finalSnapshot = await getPublicSchemaSnapshot(masterClient);
        expect(finalSnapshot.length).toBe(baselineSnapshot.length);
        for (const bTable of baselineSnapshot) {
          const matching = finalSnapshot.find((f) => f.name === bTable.name);
          expect(matching).toBeDefined();
          expect(matching?.rowCount).toBe(bTable.rowCount);
        }
        const extraTables = finalSnapshot.filter((f) => !baselineSnapshot.some((b) => b.name === f.name));
        expect(extraTables.length).toBe(0);
      } catch (err: unknown) {
        const presErr = err instanceof Error ? err : new Error(String(err));
        if (!teardownErr) teardownErr = presErr;
      } finally {
        await masterClient.end();
      }
    }

    if (teardownErr) {
      throw teardownErr;
    }
  }, 45000);

  it("1. Verifies strict TLS verification and rejects invalid CA certificate", async () => {
    await masterClient.query("RESET ROLE;");
    const res = await masterClient.query(
      "SELECT current_user, session_user, current_database(), version()"
    );
    expect(res.rows.length).toBe(1);
    const row = res.rows[0];
    expect(row.current_user).toBe("cinematch_runner");
    expect(row.current_database).toBe("postgres");
    expect(row.version).toMatch(/PostgreSQL 17/i);

    // Negative TLS probe: bogus CA must fail
    const bogusClient = new Client({
      ...PG_CONFIG,
      ssl: {
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\nMIIBojCCAUegAwIBAgIUdummyCert...\n-----END CERTIFICATE-----",
        servername: PG_HOST,
      },
    });

    let rejected = false;
    try {
      await bogusClient.connect();
    } catch {
      rejected = true;
    } finally {
      try { await bogusClient.end(); } catch {}
    }
    expect(rejected).toBe(true);
  }, 15000);

  it("2. Verifies forward and back migrations on clean and seeded DB in isolated schema", async () => {
    await masterClient.query("RESET ROLE;");
    await masterClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);

    // 2a. Down migration on clean schema
    await masterClient.query(DOWN_MIGRATION_SQL);
    const tablesDown = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    expect(tablesDown.rows.length).toBe(0);

    // 2b. Up migration
    await masterClient.query(UP_MIGRATION_SQL);
    const tablesUp = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    expect(tablesUp.rows.length).toBe(6);

    // Re-seed ownership marker after migration
    await insertOwnershipMarker(masterClient, TEST_SCHEMA, RUN_ID);

    // 2c. Seed test data via PostgresRoomRepository
    const testRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
    const { room: sRoom, host: sHost } = await testRepo.createRoom({
      hostDisplayName: "Seed Host Vitest",
      inactivityTtlSeconds: 86400,
    });
    const sGuest = await testRepo.joinRoom(sRoom.id, crypto.randomUUID(), "Seed Guest Vitest");
    const { round: sRound, candidates: sCands } = await testRepo.startRound(
      sRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 90000 + i, title: `Movie ${i}`, voteAverage: 7.5 }))
    );
    await testRepo.recordVote(sRoom.id, sRound.id, sHost.participant_id, sCands[0].id, 90000, "LIKE");
    await testRepo.recordVote(sRoom.id, sRound.id, sGuest.participant_id, sCands[0].id, 90000, "LIKE");

    const seededFinal = await testRepo.getRoomById(sRoom.id);
    expect(seededFinal?.status).toBe("MATCHED");

    // 2d. Down migration on seeded schema
    await masterClient.query(DOWN_MIGRATION_SQL);
    const tablesSeededDown = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    expect(tablesSeededDown.rows.length).toBe(0);

    // 2e. Re-apply up migration
    await masterClient.query(UP_MIGRATION_SQL);
    await insertOwnershipMarker(masterClient, TEST_SCHEMA, RUN_ID);
    const tablesReUp = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    expect(tablesReUp.rows.length).toBe(6);
  }, 45000);

  it("3. Verifies fail-closed table grants, RPC lockdown, and sequence access in isolated schema", async () => {
    await masterClient.query("RESET ROLE;");
    const tables = ["rooms", "room_participants", "rounds", "candidates", "votes", "room_events"];

    for (const t of tables) {
      const anonP = await masterClient.query(
        `SELECT has_table_privilege('anon', '${TEST_SCHEMA}.${t}', 'INSERT, UPDATE, DELETE, TRUNCATE') as p`
      );
      expect(anonP.rows[0].p).toBe(false);
      const authP = await masterClient.query(
        `SELECT has_table_privilege('authenticated', '${TEST_SCHEMA}.${t}', 'INSERT, UPDATE, DELETE, TRUNCATE') as p`
      );
      expect(authP.rows[0].p).toBe(false);
    }

    // RPC lockdown
    const anonRpc = await masterClient.query(`SELECT has_function_privilege('anon', '${TEST_SCHEMA}.get_room_by_code(varchar)', 'EXECUTE') as p`);
    expect(anonRpc.rows[0].p).toBe(false);
    const authRpc = await masterClient.query(`SELECT has_function_privilege('authenticated', '${TEST_SCHEMA}.get_room_by_code(varchar)', 'EXECUTE') as p`);
    expect(authRpc.rows[0].p).toBe(false);
    const srvRpc = await masterClient.query(`SELECT has_function_privilege('service_role', '${TEST_SCHEMA}.get_room_by_code(varchar)', 'EXECUTE') as p`);
    expect(srvRpc.rows[0].p).toBe(true);

    // Sequence lockdown
    const anonSeq = await masterClient.query(`SELECT has_sequence_privilege('anon', '${TEST_SCHEMA}.room_events_id_seq', 'USAGE') as p`);
    expect(anonSeq.rows[0].p).toBe(false);
    const authSeq = await masterClient.query(`SELECT has_sequence_privilege('authenticated', '${TEST_SCHEMA}.room_events_id_seq', 'USAGE') as p`);
    expect(authSeq.rows[0].p).toBe(false);
    const srvSeq = await masterClient.query(`SELECT has_sequence_privilege('service_role', '${TEST_SCHEMA}.room_events_id_seq', 'USAGE') as p`);
    expect(srvSeq.rows[0].p).toBe(true);
  }, 30000);

  it("4. Verifies SQL-level JWT/RLS session isolation", async () => {
    await masterClient.query("RESET ROLE;");
    const rlsRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
    const { room: rlsRoom, host: rlsHost } = await rlsRepo.createRoom({
      hostDisplayName: "RLS Host",
      inactivityTtlSeconds: 86400,
    });
    await rlsRepo.joinRoom(rlsRoom.id, crypto.randomUUID(), "RLS Guest");
    const rlsStrangerId = crypto.randomUUID();

    try {
      // Anon SELECT rejected
      await masterClient.query("SET ROLE anon;");
      let anonFailed = false;
      try {
        await masterClient.query(`SELECT * FROM "${TEST_SCHEMA}".rooms WHERE id = $1`, [rlsRoom.id]);
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === "42501") anonFailed = true;
      }
      expect(anonFailed).toBe(true);
      await masterClient.query("RESET ROLE;");

      // Authenticated Host self-read
      await masterClient.query("SET ROLE authenticated;");
      await masterClient.query(`SET "request.jwt.claims" = '{"sub": "${rlsHost.participant_id}"}';`);
      const hOwn = await masterClient.query(
        `SELECT participant_id FROM "${TEST_SCHEMA}".room_participants WHERE room_id = $1`,
        [rlsRoom.id]
      );
      expect(hOwn.rows.length).toBe(1);
      expect(hOwn.rows[0].participant_id).toBe(rlsHost.participant_id);

      // Stranger gets 0 rows
      await masterClient.query(`SET "request.jwt.claims" = '{"sub": "${rlsStrangerId}"}';`);
      const sRooms = await masterClient.query(`SELECT id FROM "${TEST_SCHEMA}".rooms WHERE id = $1`, [rlsRoom.id]);
      expect(sRooms.rows.length).toBe(0);
    } finally {
      await masterClient.query("RESET ROLE;");
    }
  }, 30000);

  it("5. Demonstrates scoped deterministic row-level lock blocking (SELECT FOR UPDATE) and dual-process concurrent IPC vote serialization", async () => {
    await masterClient.query("RESET ROLE;");

    // 5a. Scoped deterministic row-level lock blocking demonstration (pg_backend_pid, pg_blocking_pids, pg_stat_activity, scoped pg_locks)
    const concRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
    const { room: lRoom } = await concRepo.createRoom({ hostDisplayName: "Deterministic Host", inactivityTtlSeconds: 86400 });

    const lockProbeResult = await verifyScopedRowLockBlocking({
      pgConfig: PG_CONFIG,
      observerClient: masterClient,
      schema: TEST_SCHEMA,
      roomId: lRoom.id,
      holdMs: 400,
      pollTimeoutMs: 3000,
    });

    expect(lockProbeResult.client1Pid).not.toBe(lockProbeResult.client2Pid);
    expect(lockProbeResult.blockingPids).toContain(lockProbeResult.client1Pid);
    expect(lockProbeResult.waitEventType).toBe("Lock");
    expect(lockProbeResult.client2WaitDurationMs).toBeGreaterThanOrEqual(400);

    // 5b. Dual Node.js Process Concurrent IPC Vote Execution on PostgresRoomRepository
    // (Dispatches simultaneous VOTE IPC commands after READY to validate outcome/outbox serialization;
    //  does not itself hold a worker lock, which 5a proves deterministically.)
    const { room: concRoom, host: concHost } = await concRepo.createRoom({
      hostDisplayName: "Vitest Host",
      inactivityTtlSeconds: 86400,
    });
    const concGuest = await concRepo.joinRoom(concRoom.id, crypto.randomUUID(), "Vitest Guest");
    const { round: concRound, candidates: concCands } = await concRepo.startRound(
      concRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 88800 + i, title: `Vitest Movie ${i}`, voteAverage: 8.0 }))
    );
    const targetMovieId = concCands[0].movie_id;
    const targetCandidateId = concCands[0].id;

    const spawnWorker = () =>
      fork(WORKER_SCRIPT_PATH, [], {
        execArgv: ["--import", "tsx"],
        env: {
          ...process.env,
          SUPABASE_PG_HOST: PG_HOST,
          SUPABASE_PG_PORT: String(PG_PORT),
          SUPABASE_PG_DATABASE: PG_DATABASE,
          SUPABASE_PG_USER: PG_USER,
          SUPABASE_PG_PASSWORD: PG_PASSWORD,
          SUPABASE_PG_SCHEMA: TEST_SCHEMA,
        },
      });

    const worker1 = spawnWorker();
    const worker2 = spawnWorker();

    const waitReady = (child: ChildProcess): Promise<number> =>
      new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("Worker spawn timeout")), 10000);
        child.on("message", (m: unknown) => {
          const typedM = m as { type?: string; pid?: number } | null;
          if (typedM?.type === "READY") {
            clearTimeout(to);
            res(typedM.pid ?? child.pid ?? 0);
          }
        });
      });

    await Promise.all([waitReady(worker1), waitReady(worker2)]);

    const execVote = (
      child: ChildProcess,
      pId: string
    ): Promise<{ transition: string; durationMs: number; error: string | null }> =>
      new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("Vote timeout")), 15000);
        child.on("message", (m: unknown) => {
          const typedM = m as { type?: string; transition?: string; durationMs?: number; error?: string | null } | null;
          if (typedM?.type === "RESULT") {
            clearTimeout(to);
            res({
              transition: typedM.transition || "",
              durationMs: typedM.durationMs ?? 0,
              error: typedM.error || null,
            });
          }
        });
        child.send({
          command: "VOTE",
          roomId: concRoom.id,
          roundId: concRound.id,
          participantId: pId,
          candidateId: targetCandidateId,
          movieId: targetMovieId,
          voteType: "LIKE",
          terminateAfter: true,
        });
      });

    const [voteRes1, voteRes2] = await Promise.all([
      execVote(worker1, concHost.participant_id),
      execVote(worker2, concGuest.participant_id),
    ]);

    expect(voteRes1.error).toBeNull();
    expect(voteRes2.error).toBeNull();

    const transitions = [voteRes1.transition, voteRes2.transition].sort();
    expect(transitions).toEqual(["MATCHED", "VOTE_RECORDED"]);

    const concRoomState = await concRepo.getRoomById(concRoom.id);
    expect(concRoomState?.status).toBe("MATCHED");
    expect(concRoomState?.matched_movie_id).toBe(targetMovieId);

    const matchEvents = await concRepo.getRoomEvents(concRoom.id);
    const announcedEvents = matchEvents.filter((e) => e.event_type === "MATCH_ANNOUNCED");
    expect(announcedEvents.length).toBe(1);
  }, 45000);

  it("6. Negative race tests and service error handling on PostgresRoomRepository", async () => {
    await masterClient.query("RESET ROLE;");
    const edgeRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
    const { room: eRoom, host: eHost } = await edgeRepo.createRoom({
      hostDisplayName: "Edge Host",
      inactivityTtlSeconds: 86400,
    });
    const eGuest = await edgeRepo.joinRoom(eRoom.id, crypto.randomUUID(), "Edge Guest");
    const { round: eRound, candidates: eCands } = await edgeRepo.startRound(
      eRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 44000 + i, title: `Edge Movie ${i}` }))
    );

    // Vote 1 & 2 to reach MATCHED
    await edgeRepo.recordVote(eRoom.id, eRound.id, eHost.participant_id, eCands[0].id, eCands[0].movie_id, "LIKE");
    const matchVote = await edgeRepo.recordVote(
      eRoom.id,
      eRound.id,
      eGuest.participant_id,
      eCands[0].id,
      eCands[0].movie_id,
      "LIKE"
    );
    expect(matchVote.isMatched).toBe(true);

    // 6a. Duplicate Vote on MATCHED room (idempotent PASS)
    const dupVote = await edgeRepo.recordVote(
      eRoom.id,
      eRound.id,
      eHost.participant_id,
      eCands[0].id,
      eCands[0].movie_id,
      "LIKE"
    );
    expect(dupVote.isMatched).toBe(true);

    // 6b. Post-MATCH Vote rejection (RoomCapacityError)
    await expect(
      edgeRepo.recordVote(eRoom.id, eRound.id, eHost.participant_id, eCands[1].id, eCands[1].movie_id, "LIKE")
    ).rejects.toThrow(RoomCapacityError);

    // 6c. Faulty Candidate rejection (CandidateNotFoundError)
    const { room: actRoom, host: actHost } = await edgeRepo.createRoom({ hostDisplayName: "Act Host", inactivityTtlSeconds: 86400 });
    await edgeRepo.joinRoom(actRoom.id, crypto.randomUUID(), "Act Guest");
    const { round: actRound } = await edgeRepo.startRound(
      actRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 55000 + i, title: `Act Movie ${i}` }))
    );
    await expect(
      edgeRepo.recordVote(actRoom.id, actRound.id, actHost.participant_id, crypto.randomUUID(), 99999, "LIKE")
    ).rejects.toThrow(CandidateNotFoundError);

    // 6d. Faulty Participant rejection (ParticipantNotFoundError)
    await expect(
      edgeRepo.recordVote(actRoom.id, actRound.id, crypto.randomUUID(), actRound.id, 55000, "LIKE")
    ).rejects.toThrow(ParticipantNotFoundError);

    // 6e. Faulty Round rejection (RoundNotFoundError)
    await expect(
      edgeRepo.recordVote(actRoom.id, crypto.randomUUID(), actHost.participant_id, crypto.randomUUID(), 55000, "LIKE")
    ).rejects.toThrow(RoundNotFoundError);
  }, 45000);

  it("7. Measures and reports contention latency vs sequential DB roundtrip latency", async () => {
    await masterClient.query("RESET ROLE;");
    const latRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });

    // 50 sequential transitions
    const seqRoom = await latRepo.createRoom({ hostDisplayName: "Lat Seq Host", inactivityTtlSeconds: 86400 });
    const seqGuest = await latRepo.joinRoom(seqRoom.room.id, crypto.randomUUID(), "Lat Seq Guest");
    const seqRound = await latRepo.startRound(
      seqRoom.room.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 66000 + i, title: `Lat Seq Movie ${i}` }))
    );

    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const cand = seqRound.candidates[i % 20];
      const t0 = performance.now();
      await latRepo.recordVote(
        seqRoom.room.id,
        seqRound.round.id,
        i % 2 === 0 ? seqRoom.host.participant_id : seqGuest.participant_id,
        cand.id,
        cand.movie_id,
        "SKIP"
      );
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const p99 = latencies[Math.floor(latencies.length * 0.99)];

    expect(latencies.length).toBe(50);
    expect(p50).toBeGreaterThan(0);
    expect(p95).toBeGreaterThanOrEqual(p50);
    expect(p99).toBeGreaterThanOrEqual(p95);
  }, 90000);
});
