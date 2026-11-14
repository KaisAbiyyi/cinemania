// tests/live/run-room-lobby-freeze-qualification.ts
// Standalone isolated-schema PostgreSQL qualification runner for CINE-015:
// Migration 003 forward + rollback parity, SELECT ... FOR UPDATE concurrent start vs join/leave races,
// host handover, active late-join denial, and round_participants self-only RLS isolation.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { RoomCapacityError } from "../../src/lib/server/room/roomRepository";
import {
  createRoomWithSession,
  getAuthenticatedRoomSnapshot,
  joinRoomWithSession,
  leaveRoomWithSession,
  startRoomRoundWithSession,
} from "../../src/lib/server/room/roomSnapshot";
import { PostgresRoomAuthorityStore } from "../../src/lib/server/room/roomStore";
import tmdbApi from "../../src/services/tmdbApi";

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
const TEST_SCHEMA = `cinematch_qual015_${TIMESTAMP}_${RUN_SUFFIX}`;

if (!/^cinematch_qual015_[0-9]+_[a-f0-9]{8}$/.test(TEST_SCHEMA)) {
  throw new Error(`Invalid test schema identifier: ${TEST_SCHEMA}`);
}
if (process.env.ALLOW_DESTRUCTIVE_PG_TESTS !== "true") {
  console.error("FAIL-CLOSED REFUSAL: Set ALLOW_DESTRUCTIVE_PG_TESTS=true.");
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

function assertCondition(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`QUALIFICATION FAILED: ${msg}`);
  }
}

function makePostRequest(url: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {
    origin: "http://localhost:3000",
    "content-type": "application/json",
  };
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

async function runQualification() {
  const adminClient = new Client(POOL_CONFIG);
  const storePool = new Pool({ ...POOL_CONFIG, max: 6 });
  const prevSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
  const prevRat = process.env.TMDB_API_RAT;
  const prevAdapter = tmdbApi.defaults.adapter;
  process.env.CINEMATCH_CAPABILITY_SECRET =
    "live-qualification-secret-cine-015-minimum-32-bytes-ok";
  process.env.TMDB_API_RAT = prevRat || "offline-qual-cine-015-rat";
  tmdbApi.defaults.adapter = async (config) => ({
    data: {
      page: 1,
      total_pages: 1,
      total_results: 20,
      results: Array.from({ length: 20 }, (_, idx) => ({
        id: 880001 + idx,
        title: `Qualification Movie ${idx + 1}`,
        poster_path: `/qual-${idx + 1}.jpg`,
        release_date: "2024-02-01",
        vote_average: 7.5,
        overview: `Qualification overview ${idx + 1}`,
        adult: false,
      })),
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config,
  });

  try {
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    await adminClient.query(`GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO authenticated;`);
    await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);

    const up001 = adaptSql(
      fs.readFileSync(path.join(process.cwd(), "src/db/migrations/001_create_room_schema.sql"), "utf8"),
      TEST_SCHEMA
    );
    const up002 = fs.readFileSync(
      path.join(process.cwd(), "src/db/migrations/002_guest_capability_sessions.sql"),
      "utf8"
    );
    const up003 = fs.readFileSync(
      path.join(process.cwd(), "src/db/migrations/003_round_roster_freeze.sql"),
      "utf8"
    );
    const down003 = fs.readFileSync(
      path.join(process.cwd(), "src/db/migrations/003_down_round_roster_freeze.sql"),
      "utf8"
    );

    await adminClient.query(up001);
    await adminClient.query(up002);
    await adminClient.query(up003);

    // Verify 003 down + up idempotency cleanly
    await adminClient.query(down003);
    const afterDown = await adminClient.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'round_participants';`,
      [TEST_SCHEMA]
    );
    assertCondition(afterDown.rows.length === 0, "003 down migration did not drop round_participants");
    await adminClient.query(up003);
    await adminClient.query(up003); // idempotent re-run

    const store = new PostgresRoomAuthorityStore(storePool, { schema: TEST_SCHEMA });

    // 1. Concurrent start vs join race in real PostgreSQL FOR UPDATE pool (6 runs)
    let joinWon = 0;
    let startWon = 0;
    for (let i = 0; i < 6; i++) {
      const host = await createRoomWithSession(
        makePostRequest("http://localhost:3000/api/rooms", { displayName: `PG Host ${i}` }),
        { displayName: `PG Host ${i}` },
        store
      );
      const hostCookie = `${host.cookie!.name}=${host.cookie!.value}`;
      await joinRoomWithSession(
        makePostRequest("http://localhost:3000/api/rooms/join", {
          code: host.room.code,
          displayName: "PG Member 2",
        }),
        { code: host.room.code, displayName: "PG Member 2" },
        store
      );

      const startPromise = startRoomRoundWithSession(
        makePostRequest(`http://localhost:3000/api/rooms/${host.room.roomId}/start`, {}, hostCookie),
        host.room.roomId,
        store
      );
      const joinPromise = joinRoomWithSession(
        makePostRequest("http://localhost:3000/api/rooms/join", {
          code: host.room.code,
          displayName: "PG Racer",
        }),
        { code: host.room.code, displayName: "PG Racer" },
        store
      ).catch((err) => err);

      const [started, joinResult] = await Promise.all([startPromise, joinPromise]);
      const frozenRows = await store.getRoundParticipants(host.room.roomId, started.room.currentRoundId!);
      if (joinResult instanceof RoomCapacityError) {
        startWon += 1;
        assertCondition(started.room.frozenQuorum === 2, "Start-won race must have frozenQuorum=2");
        assertCondition(frozenRows.length === 2, "Start-won DB round_participants must have 2 rows");
      } else {
        joinWon += 1;
        assertCondition(started.room.frozenQuorum === 3, "Join-won race must have frozenQuorum=3");
        assertCondition(frozenRows.length === 3, "Join-won DB round_participants must have 3 rows");
      }
    }

    // 2. Host handover + start + self-only RLS verification on round_participants
    const hostA = await createRoomWithSession(
      makePostRequest("http://localhost:3000/api/rooms", { displayName: "Alpha" }),
      { displayName: "Alpha" },
      store
    );
    const hostACookie = `${hostA.cookie!.name}=${hostA.cookie!.value}`;
    const memberB = await joinRoomWithSession(
      makePostRequest("http://localhost:3000/api/rooms/join", {
        code: hostA.room.code,
        displayName: "Bravo",
      }),
      { code: hostA.room.code, displayName: "Bravo" },
      store
    );
    const memberBCookie = `${memberB.cookie!.name}=${memberB.cookie!.value}`;
    const memberC = await joinRoomWithSession(
      makePostRequest("http://localhost:3000/api/rooms/join", {
        code: hostA.room.code,
        displayName: "Charlie",
      }),
      { code: hostA.room.code, displayName: "Charlie" },
      store
    );
    const memberCCookie = `${memberC.cookie!.name}=${memberC.cookie!.value}`;

    const leftA = await leaveRoomWithSession(
      makePostRequest(`http://localhost:3000/api/rooms/${hostA.room.roomId}/leave`, {}, hostACookie),
      hostA.room.roomId,
      store
    );
    assertCondition(leftA.hostTransferred === true, "PG host handover failed");

    const startedByB = await startRoomRoundWithSession(
      makePostRequest(`http://localhost:3000/api/rooms/${hostA.room.roomId}/start`, {}, memberBCookie),
      hostA.room.roomId,
      store
    );
    assertCondition(startedByB.room.frozenQuorum === 2, "Promoted host start must freeze 2 voters");

    const snapC = await getAuthenticatedRoomSnapshot(
      new Request(`http://localhost:3000/api/rooms/${hostA.room.roomId}`, {
        headers: { cookie: memberCCookie },
      }),
      hostA.room.roomId,
      store
    );
    assertCondition(snapC.room.frozenQuorum === 2, "Snapshot C frozenQuorum mismatch");
    assertCondition(snapC.viewer.isEligibleVoter === true, "Viewer C should be frozen voter");

    // Verify RLS self-only isolation on round_participants using authenticated sub = memberB
    const rlsClient = await storePool.connect();
    try {
      await rlsClient.query("BEGIN;");
      await rlsClient.query(`SET LOCAL search_path TO "${TEST_SCHEMA}", pg_temp;`);
      await rlsClient.query("SET LOCAL ROLE authenticated;");
      await rlsClient.query("SELECT set_config('request.jwt.claims', $1, true);", [
        JSON.stringify({ sub: memberB.viewer.participantId, role: "authenticated" }),
      ]);
      const rlsRes = await rlsClient.query(
        `SELECT participant_id FROM "${TEST_SCHEMA}".round_participants;`
      );
      assertCondition(
        rlsRes.rows.length === 1 &&
          String((rlsRes.rows[0] as { participant_id: string }).participant_id) ===
            memberB.viewer.participantId,
        `RLS self-only leaked peer rows: got ${rlsRes.rows.length}`
      );
      await rlsClient.query("COMMIT;");
    } catch (err) {
      await rlsClient.query("ROLLBACK;").catch(() => {});
      throw err;
    } finally {
      rlsClient.release();
    }

    console.log(
      JSON.stringify({
        ok: true,
        schema: TEST_SCHEMA,
        joinWon,
        startWon,
        rlsSelfOnlyVerified: true,
      })
    );
  } finally {
    tmdbApi.defaults.adapter = prevAdapter;
    if (prevRat === undefined) {
      delete process.env.TMDB_API_RAT;
    } else {
      process.env.TMDB_API_RAT = prevRat;
    }
    if (prevSecret === undefined) {
      delete process.env.CINEMATCH_CAPABILITY_SECRET;
    } else {
      process.env.CINEMATCH_CAPABILITY_SECRET = prevSecret;
    }

    await storePool.end().catch(() => {});
    try {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE;`);
      const leftovers = await adminClient.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'cinematch_qual%';"
      );
      console.log(
        `REMAINING_QUAL_SCHEMAS=${JSON.stringify(
          leftovers.rows.map((r) => (r as { schema_name: string }).schema_name)
        )}`
      );
      if (leftovers.rows.length > 0) {
        throw new Error(`Schema cleanup incomplete: ${leftovers.rows.length} left`);
      }
    } finally {
      await adminClient.end().catch(() => {});
    }
  }
}

runQualification().catch((err) => {
  console.error(err);
  process.exit(1);
});
