// tests/live/run-room-voting-qualification.ts
// Standalone isolated-schema PostgreSQL qualification runner for CINE-017:
// Migrations 001..004, frozen round_participants quorum vs mutated participant_count,
// 2..5 voter unanimous matching, non-unanimous advancement, 1-card shortage EXHAUSTED
// when final vote is LIKE after SKIP, 409 VOTE_IMMUTABLE + PG trigger trg_votes_immutable_update,
// operationId idempotency + 409 OPERATION_ID_CONFLICT, 5-connection concurrent vote serialization
// with kernel lock probe (verifyScopedRowLockBlocking), authenticated RLS denial on votes,
// 004_down rollback + re-application, public schema preservation, and fail-closed schema teardown.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { PostgresRoomRepository } from "../../src/lib/server/room/postgresRoomRepository";
import { RoomCapacityError } from "../../src/lib/server/room/roomRepository";
import {
  ImmutableVoteError,
  OperationConflictError,
  VoterNotEligibleError,
} from "../../src/lib/server/room/votingEngine";
import { verifyScopedRowLockBlocking } from "./scoped-lock-probe";

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
const TEST_SCHEMA = `cinematch_qual_${TIMESTAMP}_${RUN_SUFFIX}`;

if (!/^cinematch_qual_[0-9]+_[a-f0-9]{8}$/.test(TEST_SCHEMA)) {
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
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function main() {
  const adminClient = new Client(POOL_CONFIG);
  const storePool = new Pool({ ...POOL_CONFIG, max: 6 });

  let prePublicSnapshot = "";
  let schemaCreated = false;

  try {
    await adminClient.connect();
    console.log(`[1/8] Capturing pre-test public schema snapshot and creating ${TEST_SCHEMA}...`);
    const pubSnapBefore = await adminClient.query(
      `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    );
    prePublicSnapshot = JSON.stringify(pubSnapBefore.rows);

    await adminClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    schemaCreated = true;
    await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);

    const migDir = path.join(process.cwd(), "src", "db", "migrations");
    for (const file of [
      "001_create_room_schema.sql",
      "002_guest_capability_sessions.sql",
      "003_round_roster_freeze.sql",
      "004_vote_operation_idempotency.sql",
    ]) {
      const sql = adaptSql(fs.readFileSync(path.join(migDir, file), "utf8"), TEST_SCHEMA);
      await adminClient.query(sql);
    }

    const repo = new PostgresRoomRepository(storePool, { schema: TEST_SCHEMA });

    console.log("[2/8] Verifying frozen round_participants quorum & non-frozen rejection...");
    const created3 = await repo.createRoom({ hostDisplayName: "Host3" });
    const g3a = crypto.randomUUID();
    const g3b = crypto.randomUUID();
    await repo.joinRoom(created3.room.id, g3a, "G3A");
    await repo.joinRoom(created3.room.id, g3b, "G3B");
    const started3 = await repo.startLobbyRound(created3.room.id, created3.host.participant_id, {
      candidates: Array.from({ length: 5 }, (_, idx) => ({
        movieId: 91000 + idx,
        title: `PG Movie ${idx + 1}`,
      })),
    });

    const intruderId = crypto.randomUUID();
    await adminClient.query(`UPDATE "${TEST_SCHEMA}".rooms SET participant_count = 2 WHERE id = $1;`, [
      created3.room.id,
    ]);
    await adminClient.query(
      `INSERT INTO "${TEST_SCHEMA}".room_participants (room_id, participant_id, display_name, role) VALUES ($1, $2, 'LatePG', 'MEMBER');`,
      [created3.room.id, intruderId]
    );

    let voterNotEligibleCaught = false;
    try {
      await repo.recordVote(
        created3.room.id,
        started3.round.id,
        intruderId,
        started3.candidates[0]!.id,
        started3.candidates[0]!.movie_id,
        "LIKE"
      );
    } catch (err) {
      voterNotEligibleCaught = err instanceof VoterNotEligibleError;
    }
    assertCondition(voterNotEligibleCaught, "Expected VoterNotEligibleError for unfrozen member");

    const v3a = await repo.recordVote(
      created3.room.id,
      started3.round.id,
      created3.host.participant_id,
      started3.candidates[0]!.id,
      started3.candidates[0]!.movie_id,
      "LIKE",
      { operationId: "pg-v3a" }
    );
    const v3b = await repo.recordVote(
      created3.room.id,
      started3.round.id,
      g3a,
      started3.candidates[0]!.id,
      started3.candidates[0]!.movie_id,
      "LIKE",
      { operationId: "pg-v3b" }
    );
    assertCondition(
      !v3a.isMatched && !v3b.isMatched && v3b.room.status === "ACTIVE",
      "2 of 3 LIKEs must NOT match when frozen round_participants = 3 despite mutated participant_count = 2"
    );

    console.log("[3/8] Verifying operationId idempotency, conflict, immutability & PG trigger...");
    const replay3a = await repo.recordVote(
      created3.room.id,
      started3.round.id,
      created3.host.participant_id,
      started3.candidates[0]!.id,
      started3.candidates[0]!.movie_id,
      "LIKE",
      { operationId: "pg-v3a" }
    );
    assertCondition(replay3a.idempotentReplay && replay3a.vote.id === v3a.vote.id, "operationId replay must be idempotent");

    let opConflictCaught = false;
    try {
      await repo.recordVote(
        created3.room.id,
        started3.round.id,
        created3.host.participant_id,
        started3.candidates[0]!.id,
        started3.candidates[0]!.movie_id,
        "SKIP",
        { operationId: "pg-v3a" }
      );
    } catch (err) {
      opConflictCaught = err instanceof OperationConflictError;
    }
    assertCondition(opConflictCaught, "Reused operationId with changed vote must reject");

    let immutableCaught = false;
    try {
      await repo.recordVote(
        created3.room.id,
        started3.round.id,
        created3.host.participant_id,
        started3.candidates[0]!.id,
        started3.candidates[0]!.movie_id,
        "SKIP",
        { operationId: "pg-v3a-flip" }
      );
    } catch (err) {
      immutableCaught = err instanceof ImmutableVoteError;
    }
    assertCondition(immutableCaught, "Vote flip must raise ImmutableVoteError");

    let triggerAborted = false;
    try {
      await adminClient.query(`UPDATE "${TEST_SCHEMA}".votes SET vote = 'SKIP' WHERE id = $1;`, [
        v3a.vote.id,
      ]);
    } catch (err) {
      triggerAborted = String(err).includes("VOTE_IMMUTABLE");
    }
    assertCondition(triggerAborted, "Direct UPDATE on votes must be rejected by trg_votes_immutable_update");

    // Finish round 3 with unanimous 3rd LIKE
    const v3c = await repo.recordVote(
      created3.room.id,
      started3.round.id,
      g3b,
      started3.candidates[0]!.id,
      started3.candidates[0]!.movie_id,
      "LIKE",
      { operationId: "pg-v3c" }
    );
    assertCondition(v3c.isMatched && v3c.room.status === "MATCHED", "3rd LIKE must trigger MATCHED");

    // Retry-after-timeout on MATCHED & late vote rejection
    const retryMatch = await repo.recordVote(
      created3.room.id,
      started3.round.id,
      g3b,
      started3.candidates[0]!.id,
      started3.candidates[0]!.movie_id,
      "LIKE",
      { operationId: "pg-v3c" }
    );
    assertCondition(
      retryMatch.idempotentReplay && retryMatch.isMatched && retryMatch.room.state_version === v3c.room.state_version,
      "Retry after MATCHED must return idempotent match"
    );

    let lateRejected = false;
    try {
      await repo.recordVote(
        created3.room.id,
        started3.round.id,
        created3.host.participant_id,
        started3.candidates[1]!.id,
        started3.candidates[1]!.movie_id,
        "LIKE"
      );
    } catch (err) {
      lateRejected = err instanceof RoomCapacityError && err.code === "ROOM_ALREADY_MATCHED";
    }
    assertCondition(lateRejected, "Fresh vote on another candidate after MATCHED must reject with ROOM_ALREADY_MATCHED");

    console.log("[4/8] Verifying 1-card shortage EXHAUSTED when final vote is LIKE after prior SKIP...");
    const exCreated = await repo.createRoom({ hostDisplayName: "ExHost" });
    const exGuest = crypto.randomUUID();
    await repo.joinRoom(exCreated.room.id, exGuest, "ExGuest");
    const exStarted = await repo.startLobbyRound(exCreated.room.id, exCreated.host.participant_id, {
      candidates: [{ movieId: 999901, title: "Single Card PG" }],
    });
    const exCard = exStarted.candidates[0]!;
    await repo.recordVote(
      exCreated.room.id,
      exStarted.round.id,
      exCreated.host.participant_id,
      exCard.id,
      exCard.movie_id,
      "SKIP"
    );
    const exDone = await repo.recordVote(
      exCreated.room.id,
      exStarted.round.id,
      exGuest,
      exCard.id,
      exCard.movie_id,
      "LIKE",
      { operationId: "pg-ex-final-like" }
    );
    assertCondition(
      !exDone.isMatched && exDone.isExhausted && exDone.room.status === "EXHAUSTED",
      "Final LIKE after SKIP on last card must transition to EXHAUSTED"
    );

    console.log("[5/8] Verifying 5-voter concurrent serialization & kernel row-lock blocking...");
    const concCreated = await repo.createRoom({ hostDisplayName: "ConcHost" });
    const concGuests = Array.from({ length: 4 }, () => crypto.randomUUID());
    for (let i = 0; i < concGuests.length; i += 1) {
      await repo.joinRoom(concCreated.room.id, concGuests[i]!, `ConcGuest${i + 1}`);
    }
    const concStarted = await repo.startLobbyRound(concCreated.room.id, concCreated.host.participant_id, {
      candidates: Array.from({ length: 3 }, (_, idx) => ({
        movieId: 92000 + idx,
        title: `Conc Movie ${idx + 1}`,
      })),
    });

    const lockProbe = await verifyScopedRowLockBlocking({
      pgConfig: POOL_CONFIG,
      observerClient: adminClient,
      schema: TEST_SCHEMA,
      roomId: concCreated.room.id,
    });
    assertCondition(lockProbe.blockingPids.includes(lockProbe.client1Pid), "Row lock probe must observe blocking PID");

    const allVoters5 = [concCreated.host.participant_id, ...concGuests];
    const concurrentResults = await Promise.all(
      allVoters5.map((pid, idx) =>
        repo.recordVote(
          concCreated.room.id,
          concStarted.round.id,
          pid,
          concStarted.candidates[0]!.id,
          concStarted.candidates[0]!.movie_id,
          "LIKE",
          { operationId: `pg-conc5-${idx}` }
        )
      )
    );
    const winners5 = concurrentResults.filter((r) => r.isMatched);
    assertCondition(winners5.length === 1, "Exactly one concurrent 5th voter must transition room to MATCHED");

    // Verify VOTE_RECORDED outbox confidentiality
    const evRes = await adminClient.query(
      `SELECT event_type, payload FROM "${TEST_SCHEMA}".room_events WHERE room_id = $1 AND event_type = 'VOTE_RECORDED';`,
      [concCreated.room.id]
    );
    assertCondition(evRes.rows.length === 4, "First 4 concurrent votes must emit 4 VOTE_RECORDED events");
    for (const row of evRes.rows) {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      assertCondition(
        Object.keys(payload).length === 1 && typeof payload.participantId === "string",
        "VOTE_RECORDED payload must ONLY contain participantId"
      );
    }

    console.log("[6/8] Verifying authenticated RLS direct denial on votes table...");
    let rlsDenied = false;
    try {
      await adminClient.query("BEGIN;");
      await adminClient.query(`SET LOCAL ROLE authenticated;`);
      await adminClient.query(`SELECT count(*) FROM "${TEST_SCHEMA}".votes;`);
      await adminClient.query("ROLLBACK;");
    } catch {
      rlsDenied = true;
      await adminClient.query("ROLLBACK;").catch(() => {});
    }
    assertCondition(rlsDenied, "authenticated role must be denied direct SELECT on votes table");

    console.log("[7/8] Verifying 004_down rollback and 004 forward re-application...");
    await adminClient.query(
      adaptSql(fs.readFileSync(path.join(migDir, "004_down_vote_operation_idempotency.sql"), "utf8"), TEST_SCHEMA)
    );
    await adminClient.query(
      adaptSql(fs.readFileSync(path.join(migDir, "004_vote_operation_idempotency.sql"), "utf8"), TEST_SCHEMA)
    );
    const trgRes = await adminClient.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_votes_immutable_update';`
    );
    assertCondition(trgRes.rows.length > 0, "trg_votes_immutable_update must exist after 004 re-application");

    console.log("[8/8] Verifying zero impact on public schema & tearing down isolated schema...");
    const pubSnapAfter = await adminClient.query(
      `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`
    );
    assertCondition(
      JSON.stringify(pubSnapAfter.rows) === prePublicSnapshot,
      "public schema must remain untouched!"
    );

    console.log(`ALL CINE-017 LIVE PG QUALIFICATION CHECKS PASSED (schema: ${TEST_SCHEMA}).`);
  } finally {
    await storePool.end().catch(() => {});
    if (schemaCreated) {
      try {
        await adminClient.query("RESET ROLE;").catch(() => {});
        await adminClient.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE;`);
        const leftRes = await adminClient.query(
          `SELECT count(*)::int AS cnt FROM information_schema.schemata WHERE schema_name = $1;`,
          [TEST_SCHEMA]
        );
        const leftoverCount = Number(leftRes.rows[0]?.cnt ?? 1);
        if (leftoverCount !== 0) {
          throw new Error(`Teardown leak: schema ${TEST_SCHEMA} still present (count=${leftoverCount})`);
        }
        console.log(`Verified schema cleanup: ${TEST_SCHEMA} dropped (leftover count = 0).`);
      } catch (dropErr) {
        console.error("CRITICAL TEARDOWN FAILURE:", dropErr);
        process.exitCode = 1;
      }
    }
    await adminClient.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("QUALIFICATION FAILED:", err);
  process.exit(1);
});
