/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const { spawnSync } = require("node:child_process");
const { Pool } = require("pg");
const { loadHostedStaging, assertEmptyHostedApplication } = require("../../tests/hosted-supabase/environment.cjs");

function run(program, args, env, shell = process.platform === "win32") {
  const result = spawnSync(program, args, { env, stdio: "inherit", shell });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

async function main() {
  // Fresh exact-project consent is mandatory and must be present before the credentials file is read.
  if (process.env.CINE018_STAGING_PROJECT !== "dmrbticnsczhyaiftrar") {
    throw new Error("Set CINE018_STAGING_PROJECT to the exact staging project for this invocation.");
  }
  if (!process.env.CINE018_STAGING_ENV_FILE) {
    throw new Error("Set CINE018_STAGING_ENV_FILE to the owner-designated credentials file.");
  }

  const staging = loadHostedStaging();
  const pool = new Pool({ ...staging.pgConfig, max: 1, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  try {
    await assertEmptyHostedApplication(pool);
  } finally {
    await pool.end();
  }

  const env = { ...process.env, ...staging.appEnv };
  // Never inherit cloud-admin selectors or destructive-test consent from the caller.
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.SUPABASE_PROJECT_REF;
  delete env.SUPABASE_DB_PASSWORD;
  env.ALLOW_DESTRUCTIVE_PG_TESTS = "false";
  env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD = "false";
  // One application process serves up to five browser contexts. Keep its pool at
  // five and leave room in the hosted session-pooler budget for the inspector.
  env.CINEMATCH_PG_POOL_MAX = "5";
  env.CINEMATCH_CAPABILITY_SECRET = "cine026-staging-only-synthetic-capability-secret-32-bytes";
  env.NEXT_PUBLIC_SUPABASE_URL = staging.url;
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = staging.stackEnv.ANON_KEY;
  env.TMDB_API_RAT = "cine026-staging-offline-mock-provider";
  env.NEXT_PUBLIC_TMDB_POSTER_URL = "https://image.tmdb.org/t/p";
  env.NEXT_PUBLIC_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
  env.NEXT_TELEMETRY_DISABLED = "1";

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // Do not preload the mock while Next.js invokes `tsc --showConfig`: the fixture's
  // diagnostic line would contaminate TypeScript's JSON output. The server needs it later.
  const buildEnv = { ...env };
  delete buildEnv.NODE_OPTIONS;
  const build = run(npm, ["run", "build"], buildEnv);
  if (build !== 0) process.exit(build);
  const testEnv = { ...env, NODE_OPTIONS: "--require ./tests/fixtures/mock-tmdb.cjs" };
  const playwrightArgs = process.argv.slice(2);
  // Invoke Playwright directly so Windows does not reinterpret forwarded options
  // through cmd.exe (notably regex grep filters containing `|`).
  const playwrightCli = require("node:path").join(require("node:path").dirname(require.resolve("playwright")), "cli.js");
  const e2e = run(process.execPath, [
    playwrightCli,
    "test",
    "--config=playwright.cine026.staging.config.ts",
    ...playwrightArgs,
  ], testEnv, false);
  process.exit(e2e);
}

main().catch((error) => {
  // Keep database error details, but never serialize environment or connection config.
  console.error("CINE-026 hosted staging qualification BLOCKED/FAILED:", error.code || error.message);
  process.exitCode = 1;
});
