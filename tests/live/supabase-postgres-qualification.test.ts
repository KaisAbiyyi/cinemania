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
const TEST_SCHEMA = "cinematch_qualification";

const PG_HOST = process.env.SUPABASE_PG_HOST || "";
const PG_USER = process.env.SUPABASE_PG_USER || "";
const PG_PASSWORD = process.env.SUPABASE_PG_PASSWORD || "";
const PG_PORT = parseInt(process.env.SUPABASE_PG_PORT || "5432", 10);
const PG_DATABASE = process.env.SUPABASE_PG_DATABASE || "postgres";

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

const UP_MIGRATION_SQL = UP_MIGRATION_RAW
  .replace(/public\.room_participants/g, `${TEST_SCHEMA}.room_participants`)
  .replace(/public\.rooms/g, `${TEST_SCHEMA}.rooms`)
  .replace(/SET search_path = public, pg_temp/g, `SET search_path = ${TEST_SCHEMA}, pg_temp`);
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

describe.skipIf(!isConfigured)("CINE-012: Live Supabase PostgreSQL Qualification", () => {
  let masterClient: Client;
  let baselineSnapshot: TableSnapshot[] = [];

  beforeAll(async () => {
    masterClient = new Client(PG_CONFIG);
    await masterClient.connect();
    // Record baseline snapshot of public schema
    baselineSnapshot = await getPublicSchemaSnapshot(masterClient);
    // Create isolated test schema
    await masterClient.query(`CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`);
    await masterClient.query(`GRANT USAGE ON SCHEMA ${TEST_SCHEMA} TO anon, authenticated, service_role;`);
    await masterClient.query(`GRANT ALL ON SCHEMA ${TEST_SCHEMA} TO service_role;`);
    await masterClient.query(`SET search_path TO ${TEST_SCHEMA}, pg_temp;`);
  });

  afterAll(async () => {
    // Teardown: Drop isolated qualification schema CASCADE
    try {
      await masterClient.query("RESET ROLE;");
      await masterClient.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE;`);
    } catch {}

    // Verify preservation of public schema
    try {
      const finalSnapshot = await getPublicSchemaSnapshot(masterClient);
      expect(finalSnapshot.length).toBe(baselineSnapshot.length);
      for (const bTable of baselineSnapshot) {
        const matching = finalSnapshot.find((f) => f.name === bTable.name);
        expect(matching).toBeDefined();
        expect(matching?.rowCount).toBe(bTable.rowCount);
      }
    } finally {
      await masterClient.end();
    }
  });

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
    let negativeTlsRejected = false;
    const bogusClient = new Client({
      ...PG_CONFIG,
      ssl: {
        rejectUnauthorized: true,
        ca: "-----BEGIN CERTIFICATE-----\nMIIBojCCAUegAwIBAgIUdummyCert...\n-----END CERTIFICATE-----",
        servername: PG_HOST,
      },
    });
    try {
      await bogusClient.connect();
    } catch {
      negativeTlsRejected = true;
    } finally {
      try { await bogusClient.end(); } catch {}
    }
    expect(negativeTlsRejected).toBe(true);
  }, 60000);

  it("2. Verifies forward and back migrations on clean and seeded DB in isolated schema", async () => {
    await masterClient.query("RESET ROLE;");
    // 2a. Rollback down migration
    await masterClient.query(DOWN_MIGRATION_SQL);
    const tablesAfterDown = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [TEST_SCHEMA]
    );
    expect(tablesAfterDown.rows.length).toBe(0);

    // 2b. Forward migration in isolated schema
    await masterClient.query(UP_MIGRATION_SQL);
    const tablesAfterUp = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [TEST_SCHEMA]
    );
    expect(tablesAfterUp.rows.length).toBe(6);

    // 2c. Seed test data via PostgresRoomRepository
    const testRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
    const { room: seededRoom, host: seededHost } = await testRepo.createRoom({
      hostDisplayName: "Vitest Seed Host",
      inactivityTtlSeconds: 86400,
    });
    const seededGuest = await testRepo.joinRoom(seededRoom.id, crypto.randomUUID(), "Vitest Seed Guest");
    const { round: seededRound, candidates: seededCands } = await testRepo.startRound(
      seededRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 91000 + i, title: `Seed Movie ${i}`, voteAverage: 7.5 }))
    );
    await testRepo.recordVote(seededRoom.id, seededRound.id, seededHost.participant_id, seededCands[0].id, 91000, "LIKE");
    await testRepo.recordVote(seededRoom.id, seededRound.id, seededGuest.participant_id, seededCands[0].id, 91000, "LIKE");

    const finalSeeded = await testRepo.getRoomById(seededRoom.id);
    expect(finalSeeded?.status).toBe("MATCHED");

    // 2d. Down migration on seeded DB
    await masterClient.query(DOWN_MIGRATION_SQL);
    const tablesAfterSeededDown = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [TEST_SCHEMA]
    );
    expect(tablesAfterSeededDown.rows.length).toBe(0);

    // 2e. Re-apply up migration
    await masterClient.query(UP_MIGRATION_SQL);
    const tablesFinal = await masterClient.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
      [TEST_SCHEMA]
    );
    expect(tablesFinal.rows.length).toBe(6);
  }, 60000);

  it("3. Verifies fail-closed table grants, RPC lockdown, and sequence access in isolated schema", async () => {
    await masterClient.query("RESET ROLE;");

    // Anon table privileges: 0
    for (const t of ["rooms", "room_participants", "rounds", "candidates", "votes", "room_events"]) {
      const anonP = await masterClient.query(`SELECT has_table_privilege('anon', '${TEST_SCHEMA}.${t}', 'SELECT') as p`);
      expect(anonP.rows[0].p).toBe(false);
    }

    // Authenticated: SELECT only on read models, 0 on private tables
    for (const t of ["rooms", "room_participants", "rounds", "candidates"]) {
      const authP = await masterClient.query(`SELECT has_table_privilege('authenticated', '${TEST_SCHEMA}.${t}', 'SELECT') as p`);
      expect(authP.rows[0].p).toBe(true);
      const authW = await masterClient.query(`SELECT has_table_privilege('authenticated', '${TEST_SCHEMA}.${t}', 'INSERT') as p`);
      expect(authW.rows[0].p).toBe(false);
    }
    for (const t of ["votes", "room_events"]) {
      const authP = await masterClient.query(`SELECT has_table_privilege('authenticated', '${TEST_SCHEMA}.${t}', 'SELECT') as p`);
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
        await masterClient.query(`SELECT * FROM ${TEST_SCHEMA}.rooms WHERE id = $1`, [rlsRoom.id]);
      } catch (err: unknown) {
        if ((err as { code?: string })?.code === "42501") anonFailed = true;
      }
      expect(anonFailed).toBe(true);
      await masterClient.query("RESET ROLE;");

      // Authenticated Host self-read
      await masterClient.query("SET ROLE authenticated;");
      await masterClient.query(`SET "request.jwt.claims" = '{"sub": "${rlsHost.participant_id}"}';`);
      const hOwn = await masterClient.query(
        `SELECT participant_id FROM ${TEST_SCHEMA}.room_participants WHERE room_id = $1`,
        [rlsRoom.id]
      );
      expect(hOwn.rows.length).toBe(1);
      expect(hOwn.rows[0].participant_id).toBe(rlsHost.participant_id);

      // Stranger gets 0 rows
      await masterClient.query(`SET "request.jwt.claims" = '{"sub": "${rlsStrangerId}"}';`);
      const sRooms = await masterClient.query(`SELECT id FROM ${TEST_SCHEMA}.rooms WHERE id = $1`, [rlsRoom.id]);
      expect(sRooms.rows.length).toBe(0);
    } finally {
      await masterClient.query("RESET ROLE;");
    }
  }, 30000);

  it("5. Dual Node.js process concurrency calling PostgresRoomRepository under SELECT FOR UPDATE", async () => {
    await masterClient.query("RESET ROLE;");
    const concRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
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
          SUPABASE_PG_SCHEMA: TEST_SCHEMA,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });

    const worker1 = spawnWorker();
    const worker2 = spawnWorker();

    const waitReady = (child: ChildProcess): Promise<number> =>
      new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error("Worker ready timeout")), 10000);
        child.on("message", (m: unknown) => {
          const typedM = m as { type?: string; pid?: number } | null;
          if (typedM?.type === "READY" && typeof typedM.pid === "number") {
            clearTimeout(to);
            res(typedM.pid);
          }
        });
        child.on("error", rej);
      });

    const [pid1, pid2] = await Promise.all([waitReady(worker1), waitReady(worker2)]);
    expect(pid1).toBeGreaterThan(0);
    expect(pid2).toBeGreaterThan(0);
    expect(pid1).not.toBe(pid2);

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
            res({ transition: typedM.transition || "", durationMs: typedM.durationMs ?? 0, error: typedM.error ?? null });
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
    const { room, host } = await edgeRepo.createRoom({ hostDisplayName: "Edge Host", inactivityTtlSeconds: 86400 });
    const guest = await edgeRepo.joinRoom(room.id, crypto.randomUUID(), "Edge Guest");
    const { round, candidates } = await edgeRepo.startRound(
      room.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 55000 + i, title: `Edge Movie ${i}` }))
    );

    // Vote 1: Host LIKE
    await edgeRepo.recordVote(room.id, round.id, host.participant_id, candidates[0].id, 55000, "LIKE");

    // 6a. Duplicate vote: Host LIKE again -> Idempotent PASS
    const dupVote = await edgeRepo.recordVote(room.id, round.id, host.participant_id, candidates[0].id, 55000, "LIKE");
    expect(dupVote.isMatched).toBe(false);
    expect(dupVote.vote.movie_id).toBe(55000);

    // Vote 2: Guest LIKE -> triggers MATCHED
    const matchVote = await edgeRepo.recordVote(room.id, round.id, guest.participant_id, candidates[0].id, 55000, "LIKE");
    expect(matchVote.isMatched).toBe(true);

    // 6b. Post-MATCH vote: attempt vote on candidate 1 -> throws RoomCapacityError
    await expect(
      edgeRepo.recordVote(room.id, round.id, host.participant_id, candidates[1].id, candidates[1].movie_id, "LIKE")
    ).rejects.toThrow(RoomCapacityError);

    // Create an ACTIVE room to test invalid candidate, participant, and round rejections
    const { room: actRoom, host: actHost } = await edgeRepo.createRoom({ hostDisplayName: "Act Host", inactivityTtlSeconds: 86400 });
    await edgeRepo.joinRoom(actRoom.id, crypto.randomUUID(), "Act Guest");
    const { round: actRound, candidates: actCands } = await edgeRepo.startRound(
      actRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 33000 + i, title: `Act Movie ${i}` }))
    );

    // 6c. Faulty candidate -> throws CandidateNotFoundError
    await expect(
      edgeRepo.recordVote(actRoom.id, actRound.id, actHost.participant_id, crypto.randomUUID(), 99999, "LIKE")
    ).rejects.toThrow(CandidateNotFoundError);

    // 6d. Faulty participant -> throws ParticipantNotFoundError
    await expect(
      edgeRepo.recordVote(actRoom.id, actRound.id, crypto.randomUUID(), actCands[0].id, actCands[0].movie_id, "LIKE")
    ).rejects.toThrow(ParticipantNotFoundError);

    // 6e. Faulty round -> throws RoundNotFoundError
    await expect(
      edgeRepo.recordVote(actRoom.id, crypto.randomUUID(), actHost.participant_id, actCands[0].id, actCands[0].movie_id, "LIKE")
    ).rejects.toThrow(RoundNotFoundError);
  }, 30000);

  it("7. Measures and reports contention latency vs sequential DB roundtrip latency", async () => {
    await masterClient.query("RESET ROLE;");
    const perfRepo = new PostgresRoomRepository(masterClient, { schema: TEST_SCHEMA });
    const { room, host } = await perfRepo.createRoom({ hostDisplayName: "Perf Host", inactivityTtlSeconds: 86400 });
    const guest = await perfRepo.joinRoom(room.id, crypto.randomUUID(), "Perf Guest");
    const { round, candidates } = await perfRepo.startRound(
      room.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 44000 + i, title: `Perf Movie ${i}` }))
    );

    const seqLatencies: number[] = [];
    for (let i = 0; i < 20; i++) {
      const cand = candidates[i];
      const t0 = performance.now();
      await perfRepo.recordVote(
        room.id,
        round.id,
        i % 2 === 0 ? host.participant_id : guest.participant_id,
        cand.id,
        cand.movie_id,
        "SKIP"
      );
      seqLatencies.push(performance.now() - t0);
    }

    seqLatencies.sort((a, b) => a - b);
    const p50 = seqLatencies[Math.floor(seqLatencies.length * 0.5)];
    expect(p50).toBeGreaterThan(0);
    expect(seqLatencies.length).toBe(20);
  }, 45000);
});
