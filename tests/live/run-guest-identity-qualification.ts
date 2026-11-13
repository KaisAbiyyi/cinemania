// tests/live/run-guest-identity-qualification.ts
// Standalone qualification runner for CINE-013 PostgreSQL migration 002, RLS/role grants,
// cross-connection persistent generation visibility, and atomic CAS rotation concurrency.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { PostgresRoomAuthorityStore } from "../../src/lib/server/room/roomStore";

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

    await adminClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    await adminClient.query(`GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO anon, authenticated, service_role;`);
    await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);
    await adminClient.query(sql001);
    await adminClient.query(sql002);

    // Dual independent pools simulating two serverless instances sharing PostgreSQL
    const poolA = new Pool({ ...POOL_CONFIG, max: 3 });
    const poolB = new Pool({ ...POOL_CONFIG, max: 3 });
    const setSchema = async (pool: Pool) => {
      pool.on("connect", (c) => {
        void c.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);
      });
    };
    await setSchema(poolA);
    await setSchema(poolB);

    const storeA = new PostgresRoomAuthorityStore(poolA, { schema: TEST_SCHEMA });
    const storeB = new PostgresRoomAuthorityStore(poolB, { schema: TEST_SCHEMA });

    try {
      const hostId = crypto.randomUUID();
      const { room } = await storeA.createRoom({
        hostParticipantId: hostId,
        hostDisplayName: "QualHost",
      });
      const expiresAt = new Date(Date.now() + 3600_000).toISOString();
      await storeA.setMinGeneration(room.id, hostId, 1, expiresAt);

      // Concurrent CAS rotations across independent Pool instances (storeA vs storeB)
      const [resA, resB] = await Promise.all([
        storeA.rotateGeneration(room.id, hostId, 1, expiresAt),
        storeB.rotateGeneration(room.id, hostId, 1, expiresAt),
      ]);

      const winners = [resA, resB].filter((v) => v === 2);
      const losers = [resA, resB].filter((v) => v === null);
      if (winners.length !== 1 || losers.length !== 1) {
        throw new Error(`Expected exactly 1 CAS winner (2) and 1 loser (null), got: ${resA}, ${resB}`);
      }

      // Cross-instance visibility check on separate Pool B after Pool A committed
      const visibleGen = await storeB.getMinGeneration(room.id, hostId);
      if (visibleGen !== 2) {
        throw new Error(`Expected persistent min_generation=2 across independent pool, got ${visibleGen}`);
      }

      // Verify RLS/REVOKE denial for anon and authenticated roles on guest_capability_sessions
      for (const roleName of ["anon", "authenticated"]) {
        await adminClient.query("BEGIN;");
        try {
          await adminClient.query(`SET LOCAL ROLE ${roleName};`);
          await adminClient.query(`SELECT * FROM "${TEST_SCHEMA}".guest_capability_sessions;`);
          throw new Error(`SECURITY FAILURE: role '${roleName}' was permitted to SELECT guest_capability_sessions`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!msg.includes("permission denied")) {
            throw err;
          }
        } finally {
          await adminClient.query("ROLLBACK;");
        }
      }

      console.log(`PASS [CINE-013 PG QUAL]: CAS winner=${winners[0]}, persistent min_generation=${visibleGen}, anon/authenticated denied cleanly.`);
    } finally {
      await poolA.end();
      await poolB.end();
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
