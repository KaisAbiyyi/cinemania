// tests/live/run-room-create-join-qualification.ts
// Standalone qualification runner for CINE-014 PostgreSQL real-database guarantees:
// atomic room/participant/capability session transactions & fault-injection rollback,
// SQLSTATE 23505 room code collision retry, concurrent 5-player capacity lock across
// multi-worker PG pools, REPEATABLE READ snapshot coherence, peer UUID confidentiality,
// reconnect revocation, and expired-room handling.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import {
  CapabilityAuthError,
  mintGuestCapabilityToken,
} from "../../src/lib/server/auth/guestCapability";
import {
  RoomCapacityError,
  RoomExpiredError,
} from "../../src/lib/server/room/roomRepository";
import {
  createRoomWithSession,
  getAuthenticatedRoomSnapshot,
  joinRoomWithSession,
} from "../../src/lib/server/room/roomSnapshot";
import { PostgresRoomAuthorityStore } from "../../src/lib/server/room/roomStore";

// Load .env.test.local automatically when running manually in non-production qualification.
// Never log env values or credentials.
const envPath = path.join(process.cwd(), ".env.test.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
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
const PG_PORT = Number.parseInt(process.env.SUPABASE_PG_PORT || "5432", 10);
const PG_DATABASE = process.env.SUPABASE_PG_DATABASE || "postgres";

const RUN_SUFFIX = crypto.randomBytes(4).toString("hex");
const TIMESTAMP = Math.floor(Date.now() / 1000);
const TEST_SCHEMA = `cinematch_qual014_${TIMESTAMP}_${RUN_SUFFIX}`;

if (!/^cinematch_qual014_[0-9]+_[a-f0-9]{8}$/.test(TEST_SCHEMA)) {
  throw new Error(`Invalid test schema identifier: ${TEST_SCHEMA}`);
}

if (process.env.ALLOW_DESTRUCTIVE_PG_TESTS !== "true") {
  console.error("FAIL-CLOSED REFUSAL: Set ALLOW_DESTRUCTIVE_PG_TESTS=true to run PG qualification.");
  process.exit(1);
}

if (!PG_HOST.includes(ALLOWED_PROJECT_REF) && !PG_USER.includes(ALLOWED_PROJECT_REF)) {
  console.error(`FAIL-CLOSED REFUSAL: Target host/user must match ${ALLOWED_PROJECT_REF}.`);
  process.exit(1);
}

if (!PG_PASSWORD) {
  console.error("FAIL-CLOSED REFUSAL: Missing SUPABASE_PG_PASSWORD.");
  process.exit(1);
}

const CA_PATH = path.join(process.cwd(), "src", "db", "supabase-root-ca.crt");
if (!fs.existsSync(CA_PATH)) {
  console.error(`FAIL-CLOSED REFUSAL: Root CA missing at ${CA_PATH}`);
  process.exit(1);
}
const CA_CERT = fs.readFileSync(CA_PATH, "utf-8");

const POOL_CONFIG = {
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

function adaptSql(raw: string, schema: string): string {
  return raw
    .replace(/public\.room_participants/g, `"${schema}".room_participants`)
    .replace(/public\.rooms/g, `"${schema}".rooms`)
    .replace(/SET search_path = public, pg_temp/g, `SET search_path = "${schema}", pg_temp`);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`QUALIFICATION ASSERTION FAILED: ${message}`);
  }
}

function makePostRequest(url: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  };
  if (cookie) {
    headers.cookie = cookie;
  }
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function assertSnapshotPrivacyAndCoherence(
  snapshotRoom: {
    participantCount: number;
    stateVersion: number;
    participants: Array<{ isSelf: boolean }>;
  },
  knownIds: Iterable<string>,
  label: string
): void {
  assertCondition(
    snapshotRoom.participantCount === snapshotRoom.participants.length,
    `${label}: participantCount (${snapshotRoom.participantCount}) !== participants.length (${snapshotRoom.participants.length})`
  );
  assertCondition(
    snapshotRoom.stateVersion === snapshotRoom.participantCount,
    `${label}: stateVersion (${snapshotRoom.stateVersion}) !== participantCount (${snapshotRoom.participantCount})`
  );
  for (const participant of snapshotRoom.participants) {
    assertCondition(
      !("participantId" in (participant as Record<string, unknown>)),
      `${label}: peer participantId leaked inside SafeRoomParticipant`
    );
  }
  assertCondition(
    snapshotRoom.participants.filter((p) => p.isSelf).length === 1,
    `${label}: expected strictly 1 isSelf=true entry`
  );
  const serialized = JSON.stringify(snapshotRoom);
  for (const pid of knownIds) {
    assertCondition(
      !serialized.includes(pid),
      `${label}: participant UUID leaked in SafeRoomSnapshot payload`
    );
  }
}

async function getRoomTableCounts(
  adminClient: Client,
  schema: string,
  roomId: string
): Promise<{ rooms: number; participants: number; events: number; sessions: number }> {
  const res = await adminClient.query(
    `SELECT
       (SELECT COUNT(*)::int FROM "${schema}".rooms WHERE id = $1) AS rooms,
       (SELECT COUNT(*)::int FROM "${schema}".room_participants WHERE room_id = $1) AS participants,
       (SELECT COUNT(*)::int FROM "${schema}".room_events WHERE room_id = $1) AS events,
       (SELECT COUNT(*)::int FROM "${schema}".guest_capability_sessions WHERE room_id = $1) AS sessions;`,
    [roomId]
  );
  const row = res.rows[0] as Record<string, unknown>;
  return {
    rooms: Number(row.rooms),
    participants: Number(row.participants),
    events: Number(row.events),
    sessions: Number(row.sessions),
  };
}

interface ObservedInsert23505 {
  attemptedCode: string;
  pgCode: string;
  pgConstraint: string;
}

interface PgCreateTrace {
  clientAcquires: number;
  beginCount: number;
  commitCount: number;
  outerRollbackCount: number;
  precheckHits: string[];
  precheckMisses: string[];
  savepointsCreated: number;
  insertAttempts: string[];
  insert23505s: ObservedInsert23505[];
  rollbackSavepoints: number;
  releaseSavepoints: number;
  postRollbackTxIds: Array<{ xid: string; pid: number }>;
  preCommitTxIds: Array<{ xid: string; pid: number }>;
  sqlSequence: string[];
}

type RawPgQuery = (
  queryOrSql: string | { text: string; values?: unknown[] },
  values?: unknown[]
) => Promise<{ rows: Array<Record<string, unknown>> }>;

function createEmptyTrace(): PgCreateTrace {
  return {
    clientAcquires: 0,
    beginCount: 0,
    commitCount: 0,
    outerRollbackCount: 0,
    precheckHits: [],
    precheckMisses: [],
    savepointsCreated: 0,
    insertAttempts: [],
    insert23505s: [],
    rollbackSavepoints: 0,
    releaseSavepoints: 0,
    postRollbackTxIds: [],
    preCommitTxIds: [],
    sqlSequence: [],
  };
}

async function readTxMeta(origQuery: RawPgQuery): Promise<{ xid: string; pid: number }> {
  const txMeta = await origQuery(
    "SELECT pg_current_xact_id_if_assigned()::text AS xid, pg_backend_pid()::int AS pid;"
  );
  return {
    xid: String(txMeta.rows[0]?.xid ?? ""),
    pid: Number(txMeta.rows[0]?.pid ?? 0),
  };
}

/**
 * Wraps a pg Pool to record SQL control flow and inject a concurrent poolA commit after the
 * SELECT 1 pre-check passes so real INSERT INTO rooms hits PostgreSQL SQLSTATE 23505.
 */
function createPgInsertRaceBarrierPool(
  basePool: Pool,
  trace: PgCreateTrace,
  onBeforeRoomInsert?: (attemptedCode: string) => Promise<void>
): Pool {
  return new Proxy(basePool, {
    get(targetPool, prop) {
      if (prop !== "connect") {
        const val = Reflect.get(targetPool, prop);
        return typeof val === "function" ? val.bind(targetPool) : val;
      }

      return async () => {
        const realClient = await targetPool.connect();
        trace.clientAcquires += 1;
        const origQuery = (realClient as unknown as { query: RawPgQuery }).query.bind(realClient);

        const wrappedQuery: RawPgQuery = async (queryOrSql, values) => {
          const sqlText = typeof queryOrSql === "string" ? queryOrSql : queryOrSql.text;
          const params = typeof queryOrSql === "string" ? values : queryOrSql.values;
          const trimmed = sqlText.trim();

          if (trimmed === "BEGIN;" || trimmed.startsWith("BEGIN ")) {
            trace.beginCount += 1;
            trace.sqlSequence.push("BEGIN");
            return origQuery(queryOrSql, values);
          }
          if (trimmed === "COMMIT;") {
            trace.commitCount += 1;
            trace.sqlSequence.push("COMMIT");
            return origQuery(queryOrSql, values);
          }
          if (trimmed === "ROLLBACK;") {
            trace.outerRollbackCount += 1;
            trace.sqlSequence.push("ROLLBACK");
            return origQuery(queryOrSql, values);
          }
          if (trimmed === "SAVEPOINT sp_create_room_code;") {
            trace.savepointsCreated += 1;
            trace.sqlSequence.push("SAVEPOINT");
            return origQuery(queryOrSql, values);
          }
          if (trimmed === "RELEASE SAVEPOINT sp_create_room_code;") {
            trace.releaseSavepoints += 1;
            trace.sqlSequence.push("RELEASE_SAVEPOINT");
            return origQuery(queryOrSql, values);
          }
          if (trimmed === "ROLLBACK TO SAVEPOINT sp_create_room_code;") {
            const res = await origQuery(queryOrSql, values);
            trace.rollbackSavepoints += 1;
            trace.sqlSequence.push("ROLLBACK_TO_SAVEPOINT");
            // Proves outer transaction was NOT aborted (no 25P02) and retains the exact XID/PID.
            trace.postRollbackTxIds.push(await readTxMeta(origQuery));
            return res;
          }
          if (trimmed.includes("SELECT 1 FROM rooms WHERE code = $1")) {
            const candidateCode = String(params?.[0] ?? "");
            const res = await origQuery(queryOrSql, values);
            const bucket = res.rows.length > 0 ? trace.precheckHits : trace.precheckMisses;
            bucket.push(candidateCode);
            trace.sqlSequence.push(`${res.rows.length > 0 ? "PRECHECK_HIT" : "PRECHECK_MISS"}:${candidateCode}`);
            return res;
          }
          if (trimmed.startsWith("INSERT INTO rooms")) {
            const attemptedCode = String(params?.[1] ?? "");
            trace.insertAttempts.push(attemptedCode);
            if (onBeforeRoomInsert) {
              await onBeforeRoomInsert(attemptedCode);
            }
            try {
              const res = await origQuery(queryOrSql, values);
              trace.sqlSequence.push(`INSERT_ROOM_OK:${attemptedCode}`);
              return res;
            } catch (err: unknown) {
              const pgCode =
                typeof err === "object" && err !== null && "code" in err
                  ? String((err as { code?: unknown }).code)
                  : "";
              const pgConstraint =
                typeof err === "object" && err !== null && "constraint" in err
                  ? String((err as { constraint?: unknown }).constraint)
                  : "";
              if (pgCode === "23505") {
                trace.insert23505s.push({ attemptedCode, pgCode, pgConstraint });
                trace.sqlSequence.push(`INSERT_ROOM_23505:${attemptedCode}:${pgConstraint}`);
              }
              throw err;
            }
          }
          if (trimmed.includes("INSERT INTO guest_capability_sessions")) {
            const res = await origQuery(queryOrSql, values);
            trace.preCommitTxIds.push(await readTxMeta(origQuery));
            trace.sqlSequence.push("INSERT_SESSION_OK");
            return res;
          }

          return origQuery(queryOrSql, values);
        };

        return new Proxy(realClient, {
          get(targetClient, clientProp) {
            if (clientProp === "query") {
              return wrappedQuery;
            }
            const val = Reflect.get(targetClient, clientProp);
            return typeof val === "function" ? val.bind(targetClient) : val;
          },
        });
      };
    },
  });
}

async function main() {
  const prevSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
  const createdTempSecret = !prevSecret;
  if (createdTempSecret) {
    process.env.CINEMATCH_CAPABILITY_SECRET =
      "qual014-ephemeral-signing-secret-64-chars-long-0123456789abcdef";
  }

  const adminClient = new Client(POOL_CONFIG);
  await adminClient.connect();

  let prePublicTables: string[] = [];
  let failure: unknown = null;

  try {
    const prePub = await adminClient.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    );
    prePublicTables = prePub.rows.map((r) => String(r.tablename));

    const sql001 = adaptSql(
      fs.readFileSync(path.join(process.cwd(), "src/db/migrations/001_create_room_schema.sql"), "utf8"),
      TEST_SCHEMA
    );
    const sql002 = adaptSql(
      fs.readFileSync(
        path.join(process.cwd(), "src/db/migrations/002_guest_capability_sessions.sql"),
        "utf8"
      ),
      TEST_SCHEMA
    );

    await adminClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    await adminClient.query(
      `GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO anon, authenticated, service_role;`
    );
    await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);
    await adminClient.query(sql001);
    await adminClient.query(sql002);

    const poolA = new Pool({ ...POOL_CONFIG, max: 6 });
    const poolB = new Pool({ ...POOL_CONFIG, max: 6 });
    const poolC = new Pool({ ...POOL_CONFIG, max: 4 });

    const storeA = new PostgresRoomAuthorityStore(poolA, { schema: TEST_SCHEMA });
    const storeB = new PostgresRoomAuthorityStore(poolB, { schema: TEST_SCHEMA });
    const storeC = new PostgresRoomAuthorityStore(poolC, { schema: TEST_SCHEMA });

    try {
      // 1a. Separate explicit SELECT pre-check skip vs real INSERT-time SQLSTATE 23505 + ROLLBACK TO SAVEPOINT recovery
      const seedA = await storeA.createRoomWithSession({
        hostDisplayName: "SeedHostPrecheck",
        codeGenerator: () => "PRE235",
      });
      assertCondition(seedA.room.code === "PRE235", "Expected pre-seeded room code PRE235");

      const raceCodesToInject = new Set(["RAC235", "RAC236"]);
      const injectedWinners = new Map<string, string>();
      const raceTrace = createEmptyTrace();
      const barrierPoolB = createPgInsertRaceBarrierPool(poolB, raceTrace, async (attemptedCode) => {
        if (raceCodesToInject.has(attemptedCode) && !injectedWinners.has(attemptedCode)) {
          // Concurrent poolA commit strictly AFTER poolB's SELECT 1 pre-check returned 0 rows and SAVEPOINT opened
          const winner = await storeA.createRoomWithSession({
            hostDisplayName: `Winner_${attemptedCode}`,
            codeGenerator: () => attemptedCode,
          });
          injectedWinners.set(attemptedCode, winner.room.id);
        }
      });
      const raceStoreB = new PostgresRoomAuthorityStore(barrierPoolB, { schema: TEST_SCHEMA });

      const codeSeq = ["PRE235", "RAC235", "RAC236", "WNR235"];
      let seqIdx = 0;
      const retriedRoom = await raceStoreB.createRoomWithSession({
        hostDisplayName: "RetryHost",
        codeGenerator: () => codeSeq[seqIdx++] ?? "FALLBK",
        maxCodeAttempts: 6,
      });

      assertCondition(
        retriedRoom.room.code === "WNR235" && seqIdx === 4,
        `Expected WNR235 on attempt 4 (got ${retriedRoom.room.code} at seq=${seqIdx})`
      );
      assertCondition(
        raceTrace.clientAcquires === 1 &&
          raceTrace.beginCount === 1 &&
          raceTrace.commitCount === 1 &&
          raceTrace.outerRollbackCount === 0,
        `Expected single intact outer TX without rollback/reconnect: ${JSON.stringify(raceTrace)}`
      );
      assertCondition(
        JSON.stringify(raceTrace.precheckHits) === JSON.stringify(["PRE235"]) &&
          JSON.stringify(raceTrace.precheckMisses) === JSON.stringify(["RAC235", "RAC236", "WNR235"]),
        `Expected strictly 1 SELECT precheck hit (PRE235) and 3 misses: ${JSON.stringify(raceTrace)}`
      );
      assertCondition(
        raceTrace.savepointsCreated === 3 &&
          raceTrace.insertAttempts.length === 3 &&
          raceTrace.insert23505s.length === 2 &&
          raceTrace.rollbackSavepoints === 2 &&
          raceTrace.releaseSavepoints === 1,
        `Expected 2 real PG INSERT 23505s + 2 ROLLBACK TO SAVEPOINT + 1 RELEASE SAVEPOINT: ${JSON.stringify(raceTrace)}`
      );
      for (const hit of raceTrace.insert23505s) {
        assertCondition(
          hit.pgCode === "23505" && hit.pgConstraint.includes("idx_rooms_code"),
          `Expected genuine PG SQLSTATE 23505 on idx_rooms_code, got ${JSON.stringify(hit)}`
        );
      }
      assertCondition(
        raceTrace.postRollbackTxIds.length === 2 &&
          raceTrace.preCommitTxIds.length === 1 &&
          raceTrace.postRollbackTxIds[0].xid !== "" &&
          raceTrace.postRollbackTxIds[0].xid === raceTrace.postRollbackTxIds[1].xid &&
          raceTrace.postRollbackTxIds[0].xid === raceTrace.preCommitTxIds[0].xid &&
          raceTrace.postRollbackTxIds[0].pid === raceTrace.preCommitTxIds[0].pid,
        `Expected same live outer PG xid/pid across SAVEPOINT rollbacks through commit: postRollback=${JSON.stringify(raceTrace.postRollbackTxIds)}, preCommit=${JSON.stringify(raceTrace.preCommitTxIds)}`
      );

      // Verify persisted WNR235 room, host link, ROOM_CREATED outbox event, capability session, and intact winner rooms
      const winCounts = await getRoomTableCounts(adminClient, TEST_SCHEMA, retriedRoom.room.id);
      assertCondition(
        winCounts.rooms === 1 &&
          winCounts.participants === 1 &&
          winCounts.events === 1 &&
          winCounts.sessions === 1,
        `Expected intact {1,1,1,1} rows for WNR235, got ${JSON.stringify(winCounts)}`
      );
      assertCondition(
        retriedRoom.room.host_participant_id === retriedRoom.participant.participant_id &&
          retriedRoom.room.state_version === 1 &&
          retriedRoom.room.participant_count === 1 &&
          retriedRoom.sessionGeneration === 1,
        "Expected intact host_participant_id, state_version=1, sessionGeneration=1 on WNR235"
      );
      const winEventsRes = await adminClient.query(
        `SELECT version, event_type, payload FROM "${TEST_SCHEMA}".room_events WHERE room_id = $1;`,
        [retriedRoom.room.id]
      );
      assertCondition(
        winEventsRes.rows.length === 1 &&
          winEventsRes.rows[0].event_type === "ROOM_CREATED" &&
          Number(winEventsRes.rows[0].version) === 1 &&
          (winEventsRes.rows[0].payload as { roomCode?: string }).roomCode === "WNR235",
        `Expected intact ROOM_CREATED event for WNR235: ${JSON.stringify(winEventsRes.rows)}`
      );

      for (const [winnerCode, winnerRoomId] of [
        ["PRE235", seedA.room.id],
        ["RAC235", injectedWinners.get("RAC235") ?? ""],
        ["RAC236", injectedWinners.get("RAC236") ?? ""],
      ] as const) {
        assertCondition(winnerRoomId !== "", `Missing winner room ID for ${winnerCode}`);
        const c = await getRoomTableCounts(adminClient, TEST_SCHEMA, winnerRoomId);
        assertCondition(
          c.rooms === 1 && c.participants === 1 && c.events === 1 && c.sessions === 1,
          `Expected colliding winner room ${winnerCode} intact {1,1,1,1}, got ${JSON.stringify(c)}`
        );
      }

      const winHostToken = mintGuestCapabilityToken({
        roomId: retriedRoom.room.id,
        participantId: retriedRoom.participant.participant_id,
        role: "HOST",
        generation: 1,
      }).token;
      const winSnapshot = await getAuthenticatedRoomSnapshot(
        new Request(`http://localhost:3000/api/rooms/${retriedRoom.room.id}`, {
          headers: { cookie: `cm_guest_${retriedRoom.room.id}=${winHostToken}` },
        }),
        retriedRoom.room.id,
        storeC
      );
      assertCondition(
        winSnapshot.room.code === "WNR235" &&
          winSnapshot.room.participantCount === 1 &&
          winSnapshot.viewer.role === "HOST",
        "Expected authenticated snapshot on WNR235 after 23505 savepoint recovery to succeed"
      );

      // 1b. Exhaustion under repeated genuine PG INSERT SQLSTATE 23505 collisions (zero precheck hits, 0 orphan rows)
      const exhaustCodesToInject = new Set(["EXH235", "EXH236"]);
      const exhaustWinners = new Set<string>();
      const exhaustTrace = createEmptyTrace();
      const exhaustBarrierPool = createPgInsertRaceBarrierPool(
        poolB,
        exhaustTrace,
        async (attemptedCode) => {
          if (exhaustCodesToInject.has(attemptedCode) && !exhaustWinners.has(attemptedCode)) {
            exhaustWinners.add(attemptedCode);
            await storeA.createRoomWithSession({
              hostDisplayName: `Winner_${attemptedCode}`,
              codeGenerator: () => attemptedCode,
            });
          }
        }
      );
      const exhaustStoreB = new PostgresRoomAuthorityStore(exhaustBarrierPool, { schema: TEST_SCHEMA });
      const exhaustSeq = ["EXH235", "EXH236"];
      let exhaustIdx = 0;
      let exhaustedThrew = false;
      try {
        await exhaustStoreB.createRoomWithSession({
          hostDisplayName: "Exhausted23505Host",
          codeGenerator: () => exhaustSeq[exhaustIdx++] ?? "EXHNXT",
          maxCodeAttempts: 2,
        });
      } catch (err) {
        exhaustedThrew = err instanceof Error && err.name === "RoomCodeGenerationError";
      }
      assertCondition(
        exhaustedThrew &&
          exhaustTrace.precheckHits.length === 0 &&
          exhaustTrace.insert23505s.length === 2 &&
          exhaustTrace.rollbackSavepoints === 2 &&
          exhaustTrace.outerRollbackCount === 1 &&
          exhaustTrace.commitCount === 0,
        `Expected 23505 exhaustion after 2 INSERT 23505s + clean outer rollback: ${JSON.stringify(exhaustTrace)}`
      );
      const orphanExhaust = await adminClient.query(
        `SELECT COUNT(*)::int AS c FROM "${TEST_SCHEMA}".room_participants WHERE display_name = $1;`,
        ["Exhausted23505Host"]
      );
      assertCondition(
        Number(orphanExhaust.rows[0].c) === 0,
        `Expected 0 orphan rows for exhausted 23505 create, got ${orphanExhaust.rows[0].c}`
      );
      const committedBeforeFaultsRes = await adminClient.query(
        `SELECT COUNT(*)::int AS c FROM "${TEST_SCHEMA}".rooms;`
      );
      const expectedCommittedRoomsBeforeFaults = Number(committedBeforeFaultsRes.rows[0].c);
      assertCondition(
        expectedCommittedRoomsBeforeFaults === 6,
        `Expected 6 committed rooms after step 1 (PRE235, RAC235, RAC236, WNR235, EXH235, EXH236), got ${expectedCommittedRoomsBeforeFaults}`
      );

      // 2. Atomic fault-injection rollback on create & 4/5 join + clean retry without cookie
      let createFaultHit = false;
      try {
        await createRoomWithSession(
          makePostRequest("http://localhost:3000/api/rooms", { displayName: "FaultHost1" }),
          { displayName: "FaultHost1" },
          storeA,
          {
            hooks: {
              afterWriteBeforeSessionInit: async () => {
                throw new Error("QUAL_FAULT_CREATE_AFTER_WRITE");
              },
            },
          }
        );
      } catch {
        createFaultHit = true;
      }
      assertCondition(createFaultHit, "Expected create afterWriteBeforeSessionInit fault to throw");

      let createCommitFaultHit = false;
      try {
        await createRoomWithSession(
          makePostRequest("http://localhost:3000/api/rooms", { displayName: "FaultHost2" }),
          { displayName: "FaultHost2" },
          storeA,
          {
            hooks: {
              beforeCommit: async () => {
                throw new Error("QUAL_FAULT_CREATE_BEFORE_COMMIT");
              },
            },
          }
        );
      } catch {
        createCommitFaultHit = true;
      }
      assertCondition(createCommitFaultHit, "Expected create beforeCommit fault to throw");

      const totalAfterCreateFaults = await adminClient.query(
        `SELECT COUNT(*)::int AS c FROM "${TEST_SCHEMA}".rooms;`
      );
      assertCondition(
        Number(totalAfterCreateFaults.rows[0].c) === expectedCommittedRoomsBeforeFaults,
        `Expected strictly ${expectedCommittedRoomsBeforeFaults} committed rooms after aborted creates, got ${totalAfterCreateFaults.rows[0].c}`
      );

      const atomicHost = await createRoomWithSession(
        makePostRequest("http://localhost:3000/api/rooms", { displayName: "AtomicHost" }),
        { displayName: "AtomicHost" },
        storeA
      );
      const atomicRoomId = atomicHost.room.roomId;
      for (let i = 2; i <= 4; i++) {
        await joinRoomWithSession(
          makePostRequest("http://localhost:3000/api/rooms/join", {
            code: atomicHost.room.code,
            displayName: `AtomicGuest ${i}`,
          }),
          { code: atomicHost.room.code, displayName: `AtomicGuest ${i}` },
          i % 2 === 0 ? storeB : storeC
        );
      }

      // Inject fault at 5th slot (both post-write boundaries) and assert 4/4/4/4 preservation
      for (const hookKey of ["afterWriteBeforeSessionInit", "beforeCommit"] as const) {
        let threw = false;
        try {
          await joinRoomWithSession(
            makePostRequest("http://localhost:3000/api/rooms/join", {
              code: atomicHost.room.code,
              displayName: "FaultGuest5",
            }),
            { code: atomicHost.room.code, displayName: "FaultGuest5" },
            storeB,
            {
              hooks: {
                [hookKey]: async () => {
                  throw new Error(`QUAL_JOIN_FAULT_${hookKey}`);
                },
              },
            }
          );
        } catch {
          threw = true;
        }
        assertCondition(threw, `Expected join fault ${hookKey} to throw`);
        const counts = await getRoomTableCounts(adminClient, TEST_SCHEMA, atomicRoomId);
        assertCondition(
          counts.rooms === 1 &&
            counts.participants === 4 &&
            counts.events === 4 &&
            counts.sessions === 4,
          `Post-${hookKey} counts must remain {1,4,4,4}, got ${JSON.stringify(counts)}`
        );
      }

      // Clean retry without cookie fills 5th slot; 6th rejects ROOM_FULL
      const atomicGuest5 = await joinRoomWithSession(
        makePostRequest("http://localhost:3000/api/rooms/join", {
          code: atomicHost.room.code,
          displayName: "AtomicGuest 5",
        }),
        { code: atomicHost.room.code, displayName: "AtomicGuest 5" },
        storeC
      );
      assertCondition(
        atomicGuest5.room.participantCount === 5 && atomicGuest5.room.stateVersion === 5,
        "Expected retried 5th guest to occupy 5/5 capacity"
      );

      let sixthRejected = false;
      try {
        await joinRoomWithSession(
          makePostRequest("http://localhost:3000/api/rooms/join", {
            code: atomicHost.room.code,
            displayName: "AtomicGuest 6",
          }),
          { code: atomicHost.room.code, displayName: "AtomicGuest 6" },
          storeA
        );
      } catch (err) {
        sixthRejected = err instanceof RoomCapacityError && err.code === "ROOM_FULL";
      }
      assertCondition(sixthRejected, "Expected 6th guest to fail with RoomCapacityError(ROOM_FULL)");

      // 3. 10-way parallel join race across 3 independent pools + interleaved REPEATABLE READ snapshot reads
      const raceHost = await createRoomWithSession(
        makePostRequest("http://localhost:3000/api/rooms", { displayName: "RaceHost" }),
        { displayName: "RaceHost" },
        storeA
      );
      const raceRoomId = raceHost.room.roomId;
      const raceHostCookie = `${raceHost.cookie!.name}=${raceHost.cookie!.value}`;
      const knownRaceIds = new Set<string>([raceHost.viewer.participantId]);

      const joinPromises = Array.from({ length: 10 }, (_, idx) => {
        const targetStore = idx % 3 === 0 ? storeA : idx % 3 === 1 ? storeB : storeC;
        return joinRoomWithSession(
          makePostRequest("http://localhost:3000/api/rooms/join", {
            code: raceHost.room.code,
            displayName: `RaceGuest ${idx + 1}`,
          }),
          { code: raceHost.room.code, displayName: `RaceGuest ${idx + 1}` },
          targetStore
        )
          .then((res) => ({ status: "fulfilled" as const, value: res }))
          .catch((err) => ({ status: "rejected" as const, reason: err }));
      });

      const snapshotPromises = Array.from({ length: 6 }, (_, idx) =>
        getAuthenticatedRoomSnapshot(
          new Request(`http://localhost:3000/api/rooms/${raceRoomId}`, {
            headers: { cookie: raceHostCookie },
          }),
          raceRoomId,
          idx % 2 === 0 ? storeB : storeC
        )
      );

      const [joinOutcomes, readSnapshots] = await Promise.all([
        Promise.all(joinPromises),
        Promise.all(snapshotPromises),
      ]);

      const acceptedJoins = joinOutcomes.filter((o) => o.status === "fulfilled");
      const rejectedJoins = joinOutcomes.filter((o) => o.status === "rejected");
      assertCondition(
        acceptedJoins.length === 4 && rejectedJoins.length === 6,
        `Expected strictly 4 admitted & 6 rejected parallel joins, got ${acceptedJoins.length}/${rejectedJoins.length}`
      );
      for (const r of rejectedJoins) {
        assertCondition(
          r.reason instanceof RoomCapacityError && r.reason.code === "ROOM_FULL",
          `Parallel excess join threw unexpected error: ${String(r.reason)}`
        );
      }

      for (const ok of acceptedJoins) {
        knownRaceIds.add(ok.value.viewer.participantId);
      }
      for (const ok of acceptedJoins) {
        assertSnapshotPrivacyAndCoherence(ok.value.room, knownRaceIds, "parallel-join");
      }
      for (const snap of readSnapshots) {
        assertSnapshotPrivacyAndCoherence(snap.room, knownRaceIds, "concurrent-get");
      }

      const raceEvents = await adminClient.query(
        `SELECT version, event_type FROM "${TEST_SCHEMA}".room_events WHERE room_id = $1 ORDER BY version ASC;`,
        [raceRoomId]
      );
      const versions = raceEvents.rows.map((r) => Number(r.version));
      assertCondition(
        JSON.stringify(versions) === JSON.stringify([1, 2, 3, 4, 5]),
        `Expected contiguous outbox versions [1..5], got ${JSON.stringify(versions)}`
      );

      // 4. Reconnect, revoked token rejection, and expired room (410)
      const reconnectRes = await joinRoomWithSession(
        makePostRequest(
          "http://localhost:3000/api/rooms/join",
          { code: raceHost.room.code },
          raceHostCookie
        ),
        { code: raceHost.room.code },
        storeB
      );
      assertCondition(
        reconnectRes.viewer.role === "HOST" && reconnectRes.room.participantCount === 5,
        "Expected host reconnect to remain idempotent at 5/5"
      );

      const futureExpires = new Date(Date.now() + 3600_000).toISOString();
      const rotatedGen = await storeA.rotateGeneration(
        raceRoomId,
        raceHost.viewer.participantId,
        1,
        futureExpires
      );
      assertCondition(rotatedGen === 2, `Expected rotated generation 2, got ${rotatedGen}`);

      let revokedRejected = false;
      try {
        await joinRoomWithSession(
          makePostRequest(
            "http://localhost:3000/api/rooms/join",
            { code: raceHost.room.code },
            raceHostCookie
          ),
          { code: raceHost.room.code },
          storeC
        );
      } catch (err) {
        revokedRejected = err instanceof CapabilityAuthError && err.code === "CAPABILITY_REVOKED";
      }
      assertCondition(revokedRejected, "Expected stale gen-1 reconnect to fail CAPABILITY_REVOKED");

      const gen2Token = mintGuestCapabilityToken({
        roomId: raceRoomId,
        participantId: raceHost.viewer.participantId,
        role: "HOST",
        generation: 2,
      }).token;
      const gen2Cookie = `${raceHost.cookie!.name}=${gen2Token}`;
      const gen2Reconnect = await joinRoomWithSession(
        makePostRequest(
          "http://localhost:3000/api/rooms/join",
          { code: raceHost.room.code },
          gen2Cookie
        ),
        { code: raceHost.room.code },
        storeC
      );
      assertCondition(gen2Reconnect.viewer.role === "HOST", "Expected gen-2 cookie reconnect to succeed");

      // Expire room and verify 410 ROOM_EXPIRED across join and GET snapshot
      await adminClient.query(
        `UPDATE "${TEST_SCHEMA}".rooms SET expires_at = NOW() - interval '2 minutes' WHERE id = $1;`,
        [raceRoomId]
      );
      let expiredJoinRejected = false;
      try {
        await joinRoomWithSession(
          makePostRequest("http://localhost:3000/api/rooms/join", { code: raceHost.room.code }, gen2Cookie),
          { code: raceHost.room.code },
          storeA
        );
      } catch (err) {
        expiredJoinRejected = err instanceof RoomExpiredError;
      }
      assertCondition(expiredJoinRejected, "Expected join on expired PG room to throw RoomExpiredError");

      let expiredGetRejected = false;
      try {
        await getAuthenticatedRoomSnapshot(
          new Request(`http://localhost:3000/api/rooms/${raceRoomId}`, {
            headers: { cookie: gen2Cookie },
          }),
          raceRoomId,
          storeB
        );
      } catch (err) {
        expiredGetRejected =
          err instanceof RoomExpiredError ||
          (err instanceof CapabilityAuthError && err.status === 410 && err.code === "ROOM_EXPIRED");
      }
      assertCondition(expiredGetRejected, "Expected GET on expired PG room to fail with 410 ROOM_EXPIRED");

      console.log(
        `PASS [CINE-014 PG QUAL]: schema=${TEST_SCHEMA}, pg_precheck_skips=${raceTrace.precheckHits.length}(${raceTrace.precheckHits.join(",")}), pg_insert_23505_savepoint_retries=${raceTrace.insert23505s.length}(${raceTrace.insert23505s.map((e) => `${e.attemptedCode}:${e.pgConstraint}`).join(",")}->${retriedRoom.room.code}), rollback_to_savepoint=${raceTrace.rollbackSavepoints}, release_savepoint=${raceTrace.releaseSavepoints}, outer_tx_xid=${raceTrace.preCommitTxIds[0]?.xid}, pg_23505_exhaustion=${exhaustTrace.insert23505s.length}->RoomCodeGenerationError(0_orphans), atomic_fault_rollback=create+5th_join(4/4/4/4->5/5), parallel_join_race=4_admitted/6_ROOM_FULL, repeatable_read_snapshots=6/6_coherent, peer_uuid_redacted=true, revoked_token=401, expired=410.`
      );
    } finally {
      await poolA.end();
      await poolB.end();
      await poolC.end();
    }
  } catch (err) {
    failure = err;
  } finally {
    await adminClient.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE;`);
    const postCheck = await adminClient.query(
      "SELECT COUNT(*)::int AS cnt FROM information_schema.schemata WHERE schema_name = $1;",
      [TEST_SCHEMA]
    );
    const postPub = await adminClient.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    );
    const postPublicTables = postPub.rows.map((r) => String(r.tablename));
    await adminClient.end();

    if (createdTempSecret) {
      delete process.env.CINEMATCH_CAPABILITY_SECRET;
    }

    if (Number(postCheck.rows[0].cnt) !== 0) {
      throw new Error(`Teardown verification failed: schema ${TEST_SCHEMA} still exists.`);
    }
    if (JSON.stringify(prePublicTables) !== JSON.stringify(postPublicTables)) {
      throw new Error("Teardown verification failed: public schema modified.");
    }
  }

  if (failure) {
    throw failure;
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
