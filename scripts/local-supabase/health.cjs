/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Comprehensive loopback-only health check for the local CineMatch Supabase stack.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { Client } = require("pg");
const { assertLocalStack } = require("./runtime.cjs");
const { assertNoCloudTargetEnv } = require("./safety.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("./generate-env.cjs");

async function runHealthCheck() {
  assertNoCloudTargetEnv();
  const dockerVersion = execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim();
  const supabaseBin = path.resolve(__dirname, "node_modules/supabase/dist/supabase.js");
  const cliVersion = execFileSync(process.execPath, [supabaseBin, "--version"], { encoding: "utf8" }).trim();

  const containers = assertLocalStack();
  for (const container of containers) {
    if (container.status !== "running") {
      throw new Error(`Container ${container.name} is not running (${container.status})`);
    }
    if (container.health !== "healthy") {
      throw new Error(`Container ${container.name} is not healthy (${container.health})`);
    }
  }

  const env = parseEnvFile(STACK_ENV_PATH);
  if (!env.POSTGRES_PASSWORD || !env.JWT_SECRET || !env.ANON_KEY || !env.SERVICE_ROLE_KEY) {
    throw new Error("Local credentials incomplete in supabase/.env.local");
  }

  const client = new Client({
    host: "127.0.0.1",
    port: 55432,
    user: "supabase_admin",
    password: env.POSTGRES_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  let schemaSummary;
  try {
    const pgVersionRes = await client.query("SHOW server_version;");
    const tenantRes = await client.query(
      "SELECT external_id, private_only FROM _realtime.tenants WHERE external_id = 'realtime-dev';"
    );
    if (tenantRes.rows.length !== 1 || tenantRes.rows[0].private_only !== true) {
      throw new Error("Realtime tenant realtime-dev does not have private_only=true");
    }

    const tablesRes = await client.query(
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename IN ('rooms', 'room_participants', 'rounds', 'candidates', 'votes', 'room_events', 'guest_capability_sessions', 'round_participants')
       ORDER BY tablename ASC;`
    );
    const col005Res = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'room_events' AND column_name = 'permanent_retry_count';`
    );
    const policiesRes = await client.query(
      `SELECT policyname, permissive
       FROM pg_policies
       WHERE schemaname = 'realtime' AND tablename = 'messages'
         AND policyname IN ('cinematch_room_select_allow', 'cinematch_room_select_fence', 'cinematch_room_insert_fence')
       ORDER BY policyname ASC;`
    );

    schemaSummary = {
      postgresVersion: pgVersionRes.rows[0].server_version,
      realtimePrivateOnly: tenantRes.rows[0].private_only,
      canonicalTablesPresent: tablesRes.rows.map((row) => row.tablename),
      has005RetryColumn: col005Res.rows.length === 1,
      realtimePolicies: policiesRes.rows.map((row) => `${row.policyname}:${row.permissive}`),
    };

    if (schemaSummary.canonicalTablesPresent.length !== 8 || !schemaSummary.has005RetryColumn) {
      throw new Error("Canonical migrations 001-005 are not fully applied");
    }
    if (schemaSummary.realtimePolicies.length !== 3) {
      throw new Error("Expected 3 CINE-018 realtime.messages policies from migration 005");
    }
  } finally {
    await client.end();
  }

  const gwHealth = await fetch("http://127.0.0.1:54321/healthz", { signal: AbortSignal.timeout(3000) });
  if (gwHealth.status !== 200) throw new Error(`Gateway /healthz returned ${gwHealth.status}`);

  const tenantsBlock = await fetch("http://127.0.0.1:54321/realtime/v1/api/tenants", { signal: AbortSignal.timeout(3000) });
  if (tenantsBlock.status !== 403) throw new Error(`Gateway /realtime/v1/api/tenants expected 403, got ${tenantsBlock.status}`);

  const openapiBlock = await fetch("http://127.0.0.1:54321/realtime/v1/api/openapi", { signal: AbortSignal.timeout(3000) });
  if (openapiBlock.status !== 403) throw new Error(`Gateway /realtime/v1/api/openapi expected 403, got ${openapiBlock.status}`);

  return {
    ok: true,
    dockerEngineVersion: dockerVersion,
    pinnedSupabaseCliVersion: cliVersion,
    loopbackGateway: "http://127.0.0.1:54321",
    loopbackPostgres: "127.0.0.1:55432",
    containers: containers.map((c) => `${c.name}:${c.status}:${c.health}`),
    gatewayChecks: { healthz: gwHealth.status, tenantsBlocked: tenantsBlock.status, openapiBlocked: openapiBlock.status },
    ...schemaSummary,
  };
}

if (require.main === module) {
  runHealthCheck()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error("Health check failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = { runHealthCheck };
