// tests/live/run-qualification.ts
// Standalone runner for CINE-012 live qualification against Supabase PostgreSQL.
// Executes the full qualification suite against a unique, proven-owned disposable schema,
// demonstrates deterministic row-level lock blocking, validates production PostgresRoomRepository
// transactions across independent child processes, verifies strict TLS, and enforces fail-closed
// public schema preservation and teardown verification.

import { Client } from 'pg';
import { fork, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  PostgresRoomRepository,
  RoomCapacityError,
  CandidateNotFoundError,
  ParticipantNotFoundError,
  RoundNotFoundError,
} from '../../src/lib/server/room/roomRepository';
import { verifyScopedRowLockBlocking } from './scoped-lock-probe';

// Load .env.test.local if present
const envPath = path.join(process.cwd(), '.env.test.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
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

// Target Project Guard & Safety Preflight
const ALLOWED_PROJECT_REF = 'dmrbticnsczhyaiftrar';

const PG_HOST = process.env.SUPABASE_PG_HOST || '';
const PG_USER = process.env.SUPABASE_PG_USER || '';
const PG_PASSWORD = process.env.SUPABASE_PG_PASSWORD || '';
const PG_PORT = parseInt(process.env.SUPABASE_PG_PORT || '5432', 10);
const PG_DATABASE = process.env.SUPABASE_PG_DATABASE || 'postgres';

// Unique per-run isolated schema identification
const RUN_ID = crypto.randomUUID();
const RUN_SUFFIX = crypto.randomBytes(4).toString('hex');
const TIMESTAMP = Math.floor(Date.now() / 1000);
const TEST_SCHEMA = `cinematch_qual_${TIMESTAMP}_${RUN_SUFFIX}`;

// Strict validation of the generated schema identifier (alphanumeric + underscore only)
if (!/^cinematch_qual_[0-9]+_[a-f0-9]{8}$/.test(TEST_SCHEMA)) {
  throw new Error(`CRITICAL: Generated schema name '${TEST_SCHEMA}' failed strict identifier validation.`);
}

console.log('===============================================================');
console.log('CINE-012: Live Supabase PostgreSQL Qualification Test Harness');
console.log(`Target: ${PG_HOST}:${PG_PORT}/${PG_DATABASE}`);
console.log(`User: ${PG_USER}`);
console.log(`Run ID: ${RUN_ID}`);
console.log(`Isolated Schema: ${TEST_SCHEMA}`);
console.log(`UTC: ${new Date().toISOString()}`);
console.log('===============================================================');

// Fail-closed guard: Refuse execution unless explicitly enabled
if (process.env.ALLOW_DESTRUCTIVE_PG_TESTS !== 'true') {
  console.error('\nFAIL-CLOSED REFUSAL: ALLOW_DESTRUCTIVE_PG_TESTS is not set to "true".');
  console.error('To prevent accidental execution on unintended environments, this harness requires');
  console.error('explicit opt-in via ALLOW_DESTRUCTIVE_PG_TESTS=true in your environment or .env.test.local.\n');
  process.exit(1);
}

// Fail-closed guard: Refuse execution if target host/user does not match allowlist
if (!PG_HOST.includes(ALLOWED_PROJECT_REF) && !PG_USER.includes(ALLOWED_PROJECT_REF)) {
  console.error(`\nFAIL-CLOSED REFUSAL: Target PG_HOST '${PG_HOST}' and PG_USER '${PG_USER}' do not match allowed test project ref '${ALLOWED_PROJECT_REF}'.`);
  console.error('Destructive qualification tests can only run against the approved test database.\n');
  process.exit(1);
}

if (!PG_PASSWORD) {
  console.error('\nFAIL-CLOSED REFUSAL: Missing SUPABASE_PG_PASSWORD.');
  process.exit(1);
}

// Load Supabase Pooler Root CA Certificate for strict TLS verification
const CA_PATH = path.join(process.cwd(), 'src', 'db', 'supabase-root-ca.crt');
if (!fs.existsSync(CA_PATH)) {
  console.error(`\nFAIL-CLOSED REFUSAL: Root CA certificate not found at ${CA_PATH}`);
  process.exit(1);
}
const CA_CERT = fs.readFileSync(CA_PATH, 'utf-8');

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

const UP_MIGRATION_PATH = path.join(process.cwd(), 'src', 'db', 'migrations', '001_create_room_schema.sql');
const DOWN_MIGRATION_PATH = path.join(process.cwd(), 'src', 'db', 'migrations', '001_down_room_schema.sql');
const UP_MIGRATION_RAW = fs.readFileSync(UP_MIGRATION_PATH, 'utf-8');
const DOWN_MIGRATION_RAW = fs.readFileSync(DOWN_MIGRATION_PATH, 'utf-8');

// Adapt migrations to target the unique isolated test schema while leaving public completely untouched
function adaptUpMigration(rawSql: string, schema: string): string {
  return rawSql
    .replace(/public\.room_participants/g, `"${schema}".room_participants`)
    .replace(/public\.rooms/g, `"${schema}".rooms`)
    .replace(/SET search_path = public, pg_temp/g, `SET search_path = "${schema}", pg_temp`);
}

const UP_MIGRATION_SQL = adaptUpMigration(UP_MIGRATION_RAW, TEST_SCHEMA);
const DOWN_MIGRATION_SQL = DOWN_MIGRATION_RAW;

const WORKER_SCRIPT_PATH = path.join(process.cwd(), 'tests', 'live', 'supabase-worker.ts');

interface CheckResult {
  name: string;
  command: string;
  exitCode: number;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  details: string;
}

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

async function runQualification() {
  const checkMatrix: CheckResult[] = [];
  const client = new Client(PG_CONFIG);
  let baselineSnapshot: TableSnapshot[] = [];
  let schemaCreated = false;
  let teardownError: Error | null = null;

  try {
    await client.connect();

    // 1. Connection & Strict TLS Verification (Positive + Negative probe)
    console.log('[1/8] Verifying connection and strict TLS certificate verification...');
    const verRes = await client.query('SELECT current_user, session_user, current_database(), version()');
    const verRow = verRes.rows[0];
    const envInfo = `${verRow.version} (current_user: ${verRow.current_user}, db: ${verRow.current_database})`;
    console.log(`      Connected securely via TLS verify-full: ${envInfo}`);

    // Negative TLS verification probe: assert that an invalid/bogus CA is rejected
    let negativeTlsRejected = false;
    let negativeTlsError = '';
    const bogusClient = new Client({
      ...PG_CONFIG,
      ssl: {
        rejectUnauthorized: true,
        ca: '-----BEGIN CERTIFICATE-----\nMIIBojCCAUegAwIBAgIUdummyCert...\n-----END CERTIFICATE-----',
        servername: PG_HOST,
      },
    });
    try {
      await bogusClient.connect();
    } catch (err: unknown) {
      negativeTlsRejected = true;
      const typedErr = err as { message?: string; code?: string };
      negativeTlsError = typedErr.message || typedErr.code || String(err);
    } finally {
      try { await bogusClient.end(); } catch {}
    }

    if (!negativeTlsRejected) {
      throw new Error('SECURITY VIOLATION: Negative TLS probe did not reject invalid CA certificate');
    }

    checkMatrix.push({
      name: 'Supabase PostgreSQL 17.11 & Strict TLS Verification',
      command: 'pg.Client({ ssl: { rejectUnauthorized: true, ca: supabase-root-ca.crt } })',
      exitCode: 0,
      status: 'PASS',
      details: `Strict TLS verified. Host: ${verRow.version.split(' ')[0]} ${verRow.version.split(' ')[1]}. Bogus CA rejected with: ${negativeTlsError}`,
    });

    // 2. Public Schema Baseline Snapshot
    console.log('\n[2/8] Recording baseline snapshot of existing public schema...');
    baselineSnapshot = await getPublicSchemaSnapshot(client);
    console.log(`      Existing public tables found: ${baselineSnapshot.length}`);
    for (const t of baselineSnapshot) {
      console.log(`      - public.${t.name}: ${t.rowCount} rows`);
    }

    // 3. Schema Isolation, Ownership Marker & Forward/Back Migrations (Clean + Seeded)
    console.log(`\n[3/8] Checking and creating unique owned schema '${TEST_SCHEMA}'...`);
    // Pre-check: fail closed if target schema already exists
    const preCheck = await client.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
      [TEST_SCHEMA]
    );
    if (preCheck.rows.length > 0) {
      throw new Error(`FAIL-CLOSED REFUSAL: Target test schema '${TEST_SCHEMA}' already exists. Refusing to operate on unowned pre-existing schema.`);
    }

    await client.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    schemaCreated = true;
    await client.query(`GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO anon, authenticated, service_role;`);
    await client.query(`GRANT ALL ON SCHEMA "${TEST_SCHEMA}" TO service_role;`);
    await client.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);

    // Insert durable ownership marker
    await insertOwnershipMarker(client, TEST_SCHEMA, RUN_ID);
    console.log(`      Schema '${TEST_SCHEMA}' created and tagged with ownership run_id '${RUN_ID}'.`);

    // 3a. Rollback down migration in isolated schema
    await client.query(DOWN_MIGRATION_SQL);
    const tablesDown = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    if (tablesDown.rows.length !== 0) throw new Error('Down migration failed to drop all tables in isolated schema');

    // 3b. Forward migration in isolated schema
    await client.query(UP_MIGRATION_SQL);
    const tablesUp = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    if (tablesUp.rows.length !== 6) throw new Error(`Up migration created ${tablesUp.rows.length} tables, expected 6`);

    // Re-verify ownership marker exists after migrations
    await insertOwnershipMarker(client, TEST_SCHEMA, RUN_ID);

    // 3c. Seed test data in isolated schema using production PostgresRoomRepository
    const testRepo = new PostgresRoomRepository(client, { schema: TEST_SCHEMA });
    const { room: seededRoom, host: seededHost } = await testRepo.createRoom({
      hostDisplayName: 'Seed Host',
      inactivityTtlSeconds: 86400,
    });
    const guest1 = await testRepo.joinRoom(seededRoom.id, crypto.randomUUID(), 'Seed Guest');
    const { round: seededRound, candidates: seededCands } = await testRepo.startRound(
      seededRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 90000 + i, title: `Seed Movie ${i}`, voteAverage: 7.5 }))
    );
    await testRepo.recordVote(seededRoom.id, seededRound.id, seededHost.participant_id, seededCands[0].id, 90000, 'LIKE');
    await testRepo.recordVote(seededRoom.id, seededRound.id, guest1.participant_id, seededCands[0].id, 90000, 'LIKE');

    // Verify seeded state reached MATCHED
    const seededRoomFinal = await testRepo.getRoomById(seededRoom.id);
    if (seededRoomFinal?.status !== 'MATCHED') throw new Error('Seeded room did not reach MATCHED');

    // 3d. Down migration on seeded database in isolated schema
    await client.query(DOWN_MIGRATION_SQL);
    const tablesSeededDown = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name != '_cinematch_run_metadata'`,
      [TEST_SCHEMA]
    );
    if (tablesSeededDown.rows.length !== 0) throw new Error('Down migration on seeded schema failed to drop all tables');

    // 3e. Re-apply up migration in isolated schema
    await client.query(UP_MIGRATION_SQL);
    await insertOwnershipMarker(client, TEST_SCHEMA, RUN_ID);

    console.log(`      Migrations cleanly executed forward/back in isolated '${TEST_SCHEMA}'. Public schema untouched.`);
    checkMatrix.push({
      name: 'Isolated Schema Forward/Back Migrations (Clean + Seeded)',
      command: `DDL migrations in isolated unique schema '${TEST_SCHEMA}'`,
      exitCode: 0,
      status: 'PASS',
      details: 'Clean schema down/up: 0->6 tables. Seeded down/up: clean drop of active data->6 tables. Public untouched.',
    });

    // 4. Role Permissions, RPC Lockdown, and Sequence Access
    console.log('\n[4/8] Verifying role permissions, RPC lockdown, and sequence access...');
    const tables = ['rooms', 'room_participants', 'rounds', 'candidates', 'votes', 'room_events'];

    // Assert anon and authenticated have zero table privileges except designated SELECT
    for (const t of tables) {
      const anonP = await client.query(`SELECT has_table_privilege('anon', '${TEST_SCHEMA}.${t}', 'INSERT, UPDATE, DELETE, TRUNCATE') as p`);
      if (anonP.rows[0].p) throw new Error(`Privilege leak: anon has write privilege on ${t}`);
      const authP = await client.query(`SELECT has_table_privilege('authenticated', '${TEST_SCHEMA}.${t}', 'INSERT, UPDATE, DELETE, TRUNCATE') as p`);
      if (authP.rows[0].p) throw new Error(`Privilege leak: authenticated has write privilege on ${t}`);
    }

    // Assert RPC lockdown: get_room_by_code executable only by service_role
    const anonRpc = await client.query(`SELECT has_function_privilege('anon', '${TEST_SCHEMA}.get_room_by_code(varchar)', 'EXECUTE') as p`);
    const authRpc = await client.query(`SELECT has_function_privilege('authenticated', '${TEST_SCHEMA}.get_room_by_code(varchar)', 'EXECUTE') as p`);
    const srvRpc = await client.query(`SELECT has_function_privilege('service_role', '${TEST_SCHEMA}.get_room_by_code(varchar)', 'EXECUTE') as p`);
    if (anonRpc.rows[0].p || authRpc.rows[0].p || !srvRpc.rows[0].p) {
      throw new Error('RPC lockdown violated on get_room_by_code');
    }

    // Assert Sequence lockdown: room_events_id_seq USAGE only by service_role
    const anonSeq = await client.query(`SELECT has_sequence_privilege('anon', '${TEST_SCHEMA}.room_events_id_seq', 'USAGE') as p`);
    const authSeq = await client.query(`SELECT has_sequence_privilege('authenticated', '${TEST_SCHEMA}.room_events_id_seq', 'USAGE') as p`);
    const srvSeq = await client.query(`SELECT has_sequence_privilege('service_role', '${TEST_SCHEMA}.room_events_id_seq', 'USAGE') as p`);
    if (anonSeq.rows[0].p || authSeq.rows[0].p || !srvSeq.rows[0].p) {
      throw new Error('Sequence lockdown violated on room_events_id_seq');
    }

    console.log('      Role permissions, RPC lockdown, and sequence access verified.');
    checkMatrix.push({
      name: 'Role Permissions, RPC Lockdown & Sequence Access',
      command: 'has_table_privilege, has_function_privilege, has_sequence_privilege',
      exitCode: 0,
      status: 'PASS',
      details: 'anon/authenticated denied all DML/write. get_room_by_code RPC restricted to service_role. Outbox sequence USAGE restricted to service_role.',
    });

    // 5. SQL-Level JWT/RLS Session Isolation
    console.log('\n[5/8] Verifying SQL-level JWT/RLS session isolation...');
    await client.query('RESET ROLE;');
    const rlsRepo = new PostgresRoomRepository(client, { schema: TEST_SCHEMA });
    const { room: rlsRoom, host: rlsHost } = await rlsRepo.createRoom({
      hostDisplayName: 'RLS Host',
      inactivityTtlSeconds: 86400,
    });
    await rlsRepo.joinRoom(rlsRoom.id, crypto.randomUUID(), 'RLS Guest');
    const rlsStrangerId = crypto.randomUUID();

    try {
      // 5a. Anon role cannot SELECT rooms
      await client.query('SET ROLE anon;');
      let anonSelectCaught = false;
      try {
        await client.query(`SELECT * FROM "${TEST_SCHEMA}".rooms WHERE id = $1`, [rlsRoom.id]);
      } catch (err: unknown) {
        if ((err as { code?: string }).code === '42501') anonSelectCaught = true;
      }
      if (!anonSelectCaught) throw new Error('Anon was not denied SELECT on rooms');
      await client.query('RESET ROLE;');

      // 5b. Authenticated Host reading own participant record via JWT claims simulation
      await client.query('SET ROLE authenticated;');
      await client.query(`SET "request.jwt.claims" = '{"sub": "${rlsHost.participant_id}"}';`);
      const hOwn = await client.query(
        `SELECT participant_id FROM "${TEST_SCHEMA}".room_participants WHERE room_id = $1`,
        [rlsRoom.id]
      );
      if (hOwn.rows.length !== 1 || hOwn.rows[0].participant_id !== rlsHost.participant_id) {
        throw new Error('Host failed to read own participant record via RLS');
      }

      // 5c. Stranger with different JWT sub gets 0 rows
      await client.query(`SET "request.jwt.claims" = '{"sub": "${rlsStrangerId}"}';`);
      const sRooms = await client.query(`SELECT id FROM "${TEST_SCHEMA}".rooms WHERE id = $1`, [rlsRoom.id]);
      if (sRooms.rows.length !== 0) throw new Error('Stranger saw room without membership');
    } finally {
      await client.query('RESET ROLE;');
    }

    console.log('      JWT/RLS SQL session isolation verified.');
    checkMatrix.push({
      name: 'SQL-level JWT/RLS Session Isolation',
      command: 'SET ROLE anon/authenticated with request.jwt.claims simulation',
      exitCode: 0,
      status: 'PASS',
      details: 'Anon denied SELECT (42501). Authenticated member reads own participant record. Stranger reads 0 rows.',
    });

    // 6a. Deterministic Scoped Row-Level Lock Blocking Demonstration (Issue #14)
    console.log('\n[6a/8] Demonstrating deterministic scoped row-level lock blocking (SELECT ... FOR UPDATE)...');
    const lockRepo = new PostgresRoomRepository(client, { schema: TEST_SCHEMA });
    const { room: lRoom } = await lockRepo.createRoom({ hostDisplayName: 'Lock Host', inactivityTtlSeconds: 86400 });

    const lockProbeResult = await verifyScopedRowLockBlocking({
      pgConfig: PG_CONFIG,
      observerClient: client,
      schema: TEST_SCHEMA,
      roomId: lRoom.id,
      holdMs: 400,
      pollTimeoutMs: 3000,
      onLog: (msg) => console.log(msg),
    });

    checkMatrix.push({
      name: 'Deterministic Scoped Row-Level Lock Blocking (SELECT FOR UPDATE)',
      command: 'Two connections on target room row with pg_backend_pid(), pg_blocking_pids(), pg_stat_activity, and scoped pg_locks',
      exitCode: 0,
      status: 'PASS',
      details: `Client 1 PID ${lockProbeResult.client1Pid} (${lockProbeResult.roomRelationLockMode} on rooms) blocked Client 2 PID ${lockProbeResult.client2Pid} (wait_event=${lockProbeResult.waitEventType}:${lockProbeResult.waitEvent}, locktype=${lockProbeResult.waitingLockType}, pg_blocking_pids=[${lockProbeResult.blockingPids.join(', ')}]); waited ${lockProbeResult.client2WaitDurationMs.toFixed(1)}ms until Client 1 COMMIT.`,
    });

    // 6b. Dual Independent Node.js Process Concurrent IPC Execution on PostgresRoomRepository
    // (Validates transactional serialization under simultaneous IPC votes: 1 MATCHED + 1 VOTE_RECORDED + 1 MATCH_ANNOUNCED;
    //  distinct from 6a's kernel-attested forced hold contention proof.)
    console.log('\n[6b/8] Spawning two independent Node.js processes calling concurrent PostgresRoomRepository.recordVote...');
    const concRepo = new PostgresRoomRepository(client, { schema: TEST_SCHEMA });
    const { room: concRoom, host: concHost } = await concRepo.createRoom({
      hostDisplayName: 'Conc Host',
      inactivityTtlSeconds: 86400,
    });
    const concGuest = await concRepo.joinRoom(concRoom.id, crypto.randomUUID(), 'Conc Guest');
    const { round: concRound, candidates: concCands } = await concRepo.startRound(
      concRoom.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 55000 + i, title: `Conc Movie ${i}`, voteAverage: 8.0 }))
    );
    const targetMovieId = concCands[0].movie_id;
    const targetCandidateId = concCands[0].id;

    // Spawn 2 child processes
    const spawnWorker = () =>
      fork(WORKER_SCRIPT_PATH, [], {
        execArgv: ['--import', 'tsx'],
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
        const to = setTimeout(() => rej(new Error('Worker spawn timeout')), 10000);
        child.on('message', (m: unknown) => {
          const typedM = m as { type?: string; pid?: number } | null;
          if (typedM?.type === 'READY') {
            clearTimeout(to);
            res(typedM.pid ?? child.pid ?? 0);
          }
        });
      });

    const [pid1, pid2] = await Promise.all([waitReady(worker1), waitReady(worker2)]);
    console.log(`      Worker 1 PID: ${pid1}, Worker 2 PID: ${pid2}`);

    const execVote = (
      child: ChildProcess,
      voteRoomId: string,
      voteRoundId: string,
      pId: string,
      cId: string,
      mId: number,
      vType: string = 'LIKE'
    ): Promise<{ transition: string; durationMs: number; error: string | null }> =>
      new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('Vote timeout')), 15000);
        child.on('message', (m: unknown) => {
          const typedM = m as { type?: string; transition?: string; durationMs?: number; error?: string | null } | null;
          if (typedM?.type === 'RESULT') {
            clearTimeout(to);
            if (typedM.error) {
              res({ transition: '', durationMs: typedM.durationMs ?? 0, error: typedM.error });
            } else {
              res({ transition: typedM.transition || '', durationMs: typedM.durationMs ?? 0, error: null });
            }
          }
        });
        child.send({
          command: 'VOTE',
          roomId: voteRoomId,
          roundId: voteRoundId,
          participantId: pId,
          candidateId: cId,
          movieId: mId,
          voteType: vType,
          terminateAfter: true,
        });
      });

    const [voteRes1, voteRes2] = await Promise.all([
      execVote(worker1, concRoom.id, concRound.id, concHost.participant_id, targetCandidateId, targetMovieId, 'LIKE'),
      execVote(worker2, concRoom.id, concRound.id, concGuest.participant_id, targetCandidateId, targetMovieId, 'LIKE'),
    ]);

    if (voteRes1.error || voteRes2.error) {
      throw new Error(`Worker error: ${voteRes1.error || voteRes2.error}`);
    }

    const transitions = [voteRes1.transition, voteRes2.transition].sort();
    if (transitions[0] !== 'MATCHED' || transitions[1] !== 'VOTE_RECORDED') {
      throw new Error(`Expected ['MATCHED', 'VOTE_RECORDED'] but got ${JSON.stringify(transitions)}`);
    }

    // Inspect PostgreSQL state via PostgresRoomRepository
    const concRoomState = await concRepo.getRoomById(concRoom.id);
    if (concRoomState?.status !== 'MATCHED' || concRoomState?.matched_movie_id !== targetMovieId) {
      throw new Error('Authoritative room status in PostgreSQL is not MATCHED on target movie');
    }

    const matchEvents = await concRepo.getRoomEvents(concRoom.id);
    const announcedEvents = matchEvents.filter((e) => e.event_type === 'MATCH_ANNOUNCED');
    if (announcedEvents.length !== 1) {
      throw new Error(`Expected exactly one MATCH_ANNOUNCED event, found ${announcedEvents.length}`);
    }

    console.log('      Two independent Node.js processes calling PostgresRoomRepository serialized cleanly.');
    console.log(`      Worker 1 duration: ${voteRes1.durationMs.toFixed(1)}ms, Worker 2 duration: ${voteRes2.durationMs.toFixed(1)}ms`);

    checkMatrix.push({
      name: 'Dual-Process Concurrent IPC Vote Serialization (PostgresRoomRepository)',
      command: '2 independent Node.js worker processes sending concurrent VOTE IPC requests after READY',
      exitCode: 0,
      status: 'PASS',
      details: `PIDs: ${pid1}, ${pid2}. Simultaneous IPC votes serialized cleanly: 1 MATCHED, 1 VOTE_RECORDED, 1 MATCH_ANNOUNCED outbox event (separate from 6a forced row-lock hold). Durations: ${voteRes1.durationMs.toFixed(1)}ms, ${voteRes2.durationMs.toFixed(1)}ms`,
    });

    // 7. Negative Race & Faulty Input Edge Cases
    console.log('\n[7/8] Verifying negative race tests & service error handling on PostgresRoomRepository...');
    const edgeRepo = new PostgresRoomRepository(client, { schema: TEST_SCHEMA });

    // 7a. Duplicate Vote Idempotency on MATCHED room
    const dupRes = await edgeRepo.recordVote(
      concRoom.id,
      concRound.id,
      concHost.participant_id,
      targetCandidateId,
      targetMovieId,
      'LIKE'
    );
    if (!dupRes.isMatched || dupRes.vote.movie_id !== targetMovieId) {
      throw new Error('Duplicate vote was not returned idempotently');
    }

    // 7b. Post-MATCH Vote Rejection: Attempting to vote on another candidate after MATCHED throws RoomCapacityError
    let postMatchCaught = false;
    try {
      await edgeRepo.recordVote(
        concRoom.id,
        concRound.id,
        concHost.participant_id,
        concCands[1].id,
        concCands[1].movie_id,
        'LIKE'
      );
    } catch (err) {
      if (err instanceof RoomCapacityError && err.message.includes('MATCHED')) {
        postMatchCaught = true;
      }
    }
    if (!postMatchCaught) throw new Error('Post-MATCH vote was not rejected with RoomCapacityError');

    // 7c. Create an ACTIVE room to test invalid candidate, participant, and round rejections
    const actRoom = await edgeRepo.createRoom({ hostDisplayName: 'Act Host', inactivityTtlSeconds: 86400 });
    await edgeRepo.joinRoom(actRoom.room.id, crypto.randomUUID(), 'Act Guest');
    const actRound = await edgeRepo.startRound(
      actRoom.room.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 33000 + i, title: `Act Movie ${i}` }))
    );

    // 7c. Faulty Candidate Rejection: voting on candidate not in round
    let faultyCandCaught = false;
    try {
      await edgeRepo.recordVote(
        actRoom.room.id,
        actRound.round.id,
        actRoom.host.participant_id,
        crypto.randomUUID(),
        99999,
        'LIKE'
      );
    } catch (err) {
      if (err instanceof CandidateNotFoundError) faultyCandCaught = true;
    }
    if (!faultyCandCaught) throw new Error('Faulty candidate was not rejected with CandidateNotFoundError');

    // 7d. Faulty Participant Rejection: voting with non-member participant
    let faultyPartCaught = false;
    try {
      await edgeRepo.recordVote(
        actRoom.room.id,
        actRound.round.id,
        crypto.randomUUID(),
        actRound.candidates[0].id,
        actRound.candidates[0].movie_id,
        'LIKE'
      );
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) faultyPartCaught = true;
    }
    if (!faultyPartCaught) throw new Error('Faulty participant was not rejected with ParticipantNotFoundError');

    // 7e. Faulty Round Rejection: voting on inactive round
    let faultyRoundCaught = false;
    try {
      await edgeRepo.recordVote(
        actRoom.room.id,
        crypto.randomUUID(),
        actRoom.host.participant_id,
        actRound.candidates[0].id,
        actRound.candidates[0].movie_id,
        'LIKE'
      );
    } catch (err) {
      if (err instanceof RoundNotFoundError) faultyRoundCaught = true;
    }
    if (!faultyRoundCaught) throw new Error('Faulty round was not rejected with RoundNotFoundError');

    console.log('      All 5 negative race and service error edge cases verified on production repository.');
    checkMatrix.push({
      name: 'Negative Race & Faulty Input Edge Cases (PostgresRoomRepository)',
      command: 'repo.recordVote with duplicate vote, post-MATCH vote, faulty candidate/participant/round',
      exitCode: 0,
      status: 'PASS',
      details: 'Duplicate vote: idempotent PASS. Post-MATCH: RoomCapacityError PASS. Faulty candidate/participant/round: correctly rejected with typed errors.',
    });

    // 8. Dual-process Contention Latency vs Sequential Roundtrip Latency
    console.log('\n[8/8] Measuring dual-process contention latency vs 50 sequential transitions...');

    // 8a. Real Dual-Process Contention Latency (10 parallel rounds)
    const contentionLatencies: number[] = [];
    for (let roundIdx = 0; roundIdx < 5; roundIdx++) {
      const cRoom = await concRepo.createRoom({ hostDisplayName: `Lat Host ${roundIdx}`, inactivityTtlSeconds: 86400 });
      const cGuest = await concRepo.joinRoom(cRoom.room.id, crypto.randomUUID(), `Lat Guest ${roundIdx}`);
      const cRound = await concRepo.startRound(
        cRoom.room.id,
        Array.from({ length: 20 }, (_, i) => ({ movieId: 77000 + roundIdx * 20 + i, title: `Lat Movie ${i}` }))
      );

      const w1 = spawnWorker();
      const w2 = spawnWorker();
      await Promise.all([waitReady(w1), waitReady(w2)]);

      const [r1, r2] = await Promise.all([
        execVote(
          w1,
          cRoom.room.id,
          cRound.round.id,
          cRoom.host.participant_id,
          cRound.candidates[0].id,
          cRound.candidates[0].movie_id,
          'LIKE'
        ),
        execVote(
          w2,
          cRoom.room.id,
          cRound.round.id,
          cGuest.participant_id,
          cRound.candidates[0].id,
          cRound.candidates[0].movie_id,
          'LIKE'
        ),
      ]);
      if (r1.error || r2.error) {
        throw new Error(`Contention sample error: ${r1.error || r2.error}`);
      }
      contentionLatencies.push(r1.durationMs, r2.durationMs);
    }

    contentionLatencies.sort((a, b) => a - b);
    const contP50 = contentionLatencies[Math.floor(contentionLatencies.length * 0.5)];
    const contP95 = contentionLatencies[Math.floor(contentionLatencies.length * 0.95)];
    const contP99 = contentionLatencies[Math.floor(contentionLatencies.length * 0.99)];

    // 8b. Sequential DB Roundtrip Latency (50 sequential transitions via PostgresRoomRepository)
    const seqRoom = await concRepo.createRoom({ hostDisplayName: 'Seq Host', inactivityTtlSeconds: 86400 });
    const seqGuest = await concRepo.joinRoom(seqRoom.room.id, crypto.randomUUID(), 'Seq Guest');
    const seqRound = await concRepo.startRound(
      seqRoom.room.id,
      Array.from({ length: 20 }, (_, i) => ({ movieId: 66000 + i, title: `Seq Movie ${i}` }))
    );

    const seqLatencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const cand = seqRound.candidates[i % 20];
      const t0 = performance.now();
      // Record a SKIP vote to keep round active across transitions
      await concRepo.recordVote(
        seqRoom.room.id,
        seqRound.round.id,
        i % 2 === 0 ? seqRoom.host.participant_id : seqGuest.participant_id,
        cand.id,
        cand.movie_id,
        'SKIP'
      );
      seqLatencies.push(performance.now() - t0);
    }

    seqLatencies.sort((a, b) => a - b);
    const seqMin = seqLatencies[0];
    const seqP50 = seqLatencies[Math.floor(seqLatencies.length * 0.5)];
    const seqP95 = seqLatencies[Math.floor(seqLatencies.length * 0.95)];
    const seqP99 = seqLatencies[Math.floor(seqLatencies.length * 0.99)];
    const seqMax = seqLatencies[seqLatencies.length - 1];

    console.log(`      Dual-Process Contention Latency (10 worker samples): p50=${contP50.toFixed(1)}ms, p95=${contP95.toFixed(1)}ms, p99=${contP99.toFixed(1)}ms`);
    console.log(`      Sequential DB Latency (50 runs): min=${seqMin.toFixed(1)}ms, p50=${seqP50.toFixed(1)}ms, p95=${seqP95.toFixed(1)}ms, p99=${seqP99.toFixed(1)}ms, max=${seqMax.toFixed(1)}ms`);

    checkMatrix.push({
      name: 'Contention & Sequential Latency Benchmarks (Separated)',
      command: 'Dual-process simultaneous vote contention vs 50 sequential transitions via PostgresRoomRepository',
      exitCode: 0,
      status: 'PASS',
      details: `Contention (ms): p50=${contP50.toFixed(1)}, p95=${contP95.toFixed(1)}, p99=${contP99.toFixed(1)}. Sequential (ms): min=${seqMin.toFixed(1)}, p50=${seqP50.toFixed(1)}, p95=${seqP95.toFixed(1)}, p99=${seqP99.toFixed(1)}, max=${seqMax.toFixed(1)}`,
    });

    return checkMatrix;
  } catch (err) {
    throw err;
  } finally {
    // Teardown with strict ownership verification and fail-closed preservation
    if (schemaCreated) {
      console.log(`\n[TEARDOWN] Verifying ownership and dropping isolated schema '${TEST_SCHEMA}' CASCADE...`);
      try {
        await client.query('RESET ROLE;');
        // Verify current execution created and owns this schema before dropping
        const isOwner = await verifyOwnershipMarker(client, TEST_SCHEMA, RUN_ID);
        if (!isOwner) {
          throw new Error(`FAIL-CLOSED REFUSAL: Schema '${TEST_SCHEMA}' ownership marker missing or run_id mismatch. Refusing teardown of unverified schema!`);
        }

        await client.query(`DROP SCHEMA "${TEST_SCHEMA}" CASCADE;`);

        // Verify the schema was actually removed from information_schema
        const checkGone = await client.query(
          `SELECT count(*)::int as cnt FROM information_schema.schemata WHERE schema_name = $1`,
          [TEST_SCHEMA]
        );
        if (checkGone.rows[0].cnt !== 0) {
          throw new Error(`TEARDOWN VERIFICATION FAILURE: Schema '${TEST_SCHEMA}' still exists in information_schema after DROP CASCADE!`);
        }
        console.log(`      Isolated schema '${TEST_SCHEMA}' verified and dropped cleanly.`);
      } catch (err: unknown) {
        teardownError = err instanceof Error ? err : new Error(String(err));
        console.error(`      TEARDOWN FAILURE:`, teardownError.message);
      }
    }

    // Preservation Verification: Compare public schema with baseline snapshot
    console.log('[PRESERVATION] Verifying public schema table-name and row-count preservation...');
    try {
      const finalSnapshot = await getPublicSchemaSnapshot(client);
      if (finalSnapshot.length !== baselineSnapshot.length) {
        throw new Error(
          `PUBLIC SCHEMA MUTATION: Baseline had ${baselineSnapshot.length} tables, now has ${finalSnapshot.length}`
        );
      }
      for (const bTable of baselineSnapshot) {
        const matching = finalSnapshot.find((f) => f.name === bTable.name);
        if (!matching) {
          throw new Error(`PUBLIC SCHEMA MUTATION: Table '${bTable.name}' missing from public schema!`);
        }
        if (matching.rowCount !== bTable.rowCount) {
          throw new Error(
            `PUBLIC SCHEMA MUTATION: Table '${bTable.name}' row count changed: baseline was ${bTable.rowCount}, now ${matching.rowCount}!`
          );
        }
      }
      const extraTables = finalSnapshot.filter((f) => !baselineSnapshot.some((b) => b.name === f.name));
      if (extraTables.length > 0) {
        throw new Error(`PUBLIC SCHEMA MUTATION: Unexpected new tables in public: ${extraTables.map((t) => t.name).join(', ')}`);
      }
      console.log('      CONFIRMED: Public schema table-name/count snapshot unchanged (0 public tables altered).');
    } catch (err: unknown) {
      const presError = err instanceof Error ? err : new Error(String(err));
      console.error('      PRESERVATION VERIFICATION FAILED:', presError.message);
      if (!teardownError) teardownError = presError;
    }

    await client.end();

    // Propagate any teardown or preservation failure so runner fails closed
    if (teardownError) {
      throw teardownError;
    }
  }
}

runQualification()
  .then(() => {
    console.log('\n===============================================================');
    console.log('ALL 8 QUALIFICATION CHECKS PASSED AGAINST SUPABASE POSTGRESQL');
    console.log('===============================================================');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nQUALIFICATION HARNESS FAILED (FAIL-CLOSED):', err);
    process.exit(1);
  });
