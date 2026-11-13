// tests/live/run-guest-identity-qualification.ts
// Standalone qualification runner for CINE-013 PostgreSQL migration 002, RLS/role grants,
// cross-connection persistent generation visibility, and atomic CAS rotation concurrency.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { PostgresRoomAuthorityStore } from "../../src/lib/server/room/roomStore";

// Load .env.test.local automatically when running manually in non-production qualification
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
const TEST_SCHEMA = `cinematch_qual013_${TIMESTAMP}_${RUN_SUFFIX}`;

if (!/^cinematch_qual013_[0-9]+_[a-f0-9]{8}$/.test(TEST_SCHEMA)) {
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

async function main() {
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
      fs.readFileSync(path.join(process.cwd(), "src/db/migrations/002_guest_capability_sessions.sql"), "utf8"),
      TEST_SCHEMA
    );
    const sql002Down = fs.readFileSync(
      path.join(process.cwd(), "src/db/migrations/002_down_guest_capability_sessions.sql"),
      "utf8"
    );

    await adminClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    await adminClient.query(`GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO anon, authenticated, service_role;`);
    await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);
    await adminClient.query(sql001);
    await adminClient.query(sql002);

    // Confirm RLS is enabled on guest_capability_sessions
    const rlsRes = await adminClient.query(
      `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1 AND c.relname = 'guest_capability_sessions';`,
      [TEST_SCHEMA]
    );
    if (rlsRes.rows[0]?.relrowsecurity !== true) {
      throw new Error("SECURITY FAILURE: RLS is not enabled on guest_capability_sessions.");
    }

    // Three independent Pool instances simulating multiple serverless workers
    const poolA = new Pool({ ...POOL_CONFIG, max: 6 });
    const poolB = new Pool({ ...POOL_CONFIG, max: 6 });
    const poolC = new Pool({ ...POOL_CONFIG, max: 2 });

    const storeA = new PostgresRoomAuthorityStore(poolA, { schema: TEST_SCHEMA });
    const storeB = new PostgresRoomAuthorityStore(poolB, { schema: TEST_SCHEMA });
    const storeC = new PostgresRoomAuthorityStore(poolC, { schema: TEST_SCHEMA });

    try {
      const hostId = crypto.randomUUID();
      const { room } = await storeA.createRoom({
        hostParticipantId: hostId,
        hostDisplayName: "QualHost",
      });
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      await storeA.setMinGeneration(room.id, hostId, 1, expiresAt);

      // Cross-instance baseline read from separate Pool B
      const initialOnB = await storeB.getMinGeneration(room.id, hostId);
      if (initialOnB !== 1) {
        throw new Error(`Expected initial min_generation=1 on Pool B, got ${initialOnB}`);
      }

      // 10-way concurrent CAS rotation race spanning independent Pool A & Pool B
      const raceCalls = Array.from({ length: 10 }, (_, idx) =>
        (idx % 2 === 0 ? storeA : storeB).rotateGeneration(room.id, hostId, 1, expiresAt)
      );
      const raceResults = await Promise.all(raceCalls);
      const winners = raceResults.filter((v) => v === 2);
      const losers = raceResults.filter((v) => v === null);
      if (winners.length !== 1 || losers.length !== 9) {
        throw new Error(
          `Expected exactly 1 CAS winner (2) and 9 losers (null), got: ${JSON.stringify(raceResults)}`
        );
      }

      // Fresh third Pool C observes durable min_generation=2 and rejects stale expectedGeneration=1
      const visibleOnC = await storeC.getMinGeneration(room.id, hostId);
      if (visibleOnC !== 2) {
        throw new Error(`Expected persistent min_generation=2 across independent Pool C, got ${visibleOnC}`);
      }
      const staleRetry = await storeC.rotateGeneration(room.id, hostId, 1, expiresAt);
      if (staleRetry !== null) {
        throw new Error(`Expected stale expectedGeneration=1 rejection (null), got ${staleRetry}`);
      }

      // Verify RLS/REVOKE denial across SELECT/INSERT/UPDATE/DELETE for anon and authenticated
      for (const roleName of ["anon", "authenticated"]) {
        const deniedQueries = [
          `SELECT * FROM "${TEST_SCHEMA}".guest_capability_sessions;`,
          `INSERT INTO "${TEST_SCHEMA}".guest_capability_sessions (room_id, participant_id, min_generation, expires_at) VALUES ('${room.id}', '${hostId}', 99, NOW());`,
          `UPDATE "${TEST_SCHEMA}".guest_capability_sessions SET min_generation = 99 WHERE room_id = '${room.id}';`,
          `DELETE FROM "${TEST_SCHEMA}".guest_capability_sessions WHERE room_id = '${room.id}';`,
        ];
        for (const sql of deniedQueries) {
          await adminClient.query("BEGIN;");
          try {
            await adminClient.query(`SET LOCAL ROLE ${roleName};`);
            await adminClient.query(sql);
            throw new Error(`SECURITY FAILURE: role '${roleName}' was permitted to run: ${sql}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes("permission denied")) {
              throw err;
            }
          } finally {
            await adminClient.query("ROLLBACK;");
          }
        }
      }

      // Positive check: service_role retains explicit authority
      await adminClient.query("BEGIN;");
      try {
        await adminClient.query("SET LOCAL ROLE service_role;");
        const srRes = await adminClient.query(
          `SELECT min_generation FROM "${TEST_SCHEMA}".guest_capability_sessions WHERE room_id = $1 AND participant_id = $2;`,
          [room.id, hostId]
        );
        if (Number(srRes.rows[0]?.min_generation) !== 2) {
          throw new Error("SECURITY/CONTRACT FAILURE: service_role could not read min_generation=2.");
        }
      } finally {
        await adminClient.query("ROLLBACK;");
      }

      // Verify reversible down migration 002_down inside isolated schema
      await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);
      await adminClient.query(sql002Down);
      const downCheck = await adminClient.query(
        `SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'guest_capability_sessions';`,
        [TEST_SCHEMA]
      );
      if (Number(downCheck.rows[0].cnt) !== 0) {
        throw new Error("Down migration 002 failed to drop guest_capability_sessions.");
      }

      console.log(
        `PASS [CINE-013 PG QUAL]: schema=${TEST_SCHEMA}, RLS=true, CAS_race=1/10_winner(${winners[0]}), cross_pool_visible=${visibleOnC}, anon/auth_denied=true, service_role=true, down_migration=clean.`
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
