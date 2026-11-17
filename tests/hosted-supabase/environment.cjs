/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PROJECT = "dmrbticnsczhyaiftrar";
const ROOT = path.resolve(__dirname, "../..");
const KEYS = new Set(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_JWT_SECRET", "SUPABASE_PG_HOST", "SUPABASE_PG_PORT", "SUPABASE_PG_DATABASE", "SUPABASE_PG_USER", "SUPABASE_PG_PASSWORD"]);

function validateHostedStaging(source, invocation) {
  // Consent is read only from this invocation, before parsing any file.
  assert.equal(invocation.CINE018_STAGING_PROJECT, PROJECT, "Fresh exact-project staging consent required");
  const credentials = {};
  for (const line of source.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && KEYS.has(m[1])) credentials[m[1]] = m[2].trim();
  }
  for (const key of KEYS) assert(credentials[key], `Missing staging credential field ${key}`);
  assert.equal(credentials.SUPABASE_URL, `https://${PROJECT}.supabase.co`, "Only owner-designated staging origin allowed");
  assert.equal(credentials.SUPABASE_PG_DATABASE, "postgres");
  assert.equal(credentials.SUPABASE_PG_PORT, "5432", "Session/direct PG port required; transaction pooler forbidden");
  const host = credentials.SUPABASE_PG_HOST;
  const direct = host === `db.${PROJECT}.supabase.co`;
  const session = /^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(host) && credentials.SUPABASE_PG_USER.endsWith(`.${PROJECT}`);
  assert(direct || session, "PG endpoint/user must identify the designated staging project");
  return credentials;
}

function loadHostedStaging() {
  const file = process.env.CINE018_STAGING_ENV_FILE || path.join(ROOT, ".env.cine018-staging.local");
  // Validate consent before touching the credentials file.
  assert.equal(process.env.CINE018_STAGING_PROJECT, PROJECT, "Fresh exact-project staging consent required");
  const credentials = validateHostedStaging(fs.readFileSync(file, "utf8"), process.env);
  const pgConfig = { host: credentials.SUPABASE_PG_HOST, port: 5432, database: "postgres", user: credentials.SUPABASE_PG_USER,
    password: credentials.SUPABASE_PG_PASSWORD, ssl: { rejectUnauthorized: true, servername: credentials.SUPABASE_PG_HOST, ca: fs.readFileSync(path.join(ROOT, "src/db/supabase-root-ca.crt"), "utf8") }, connectionTimeoutMillis: 10000 };
  return { project: PROJECT, url: credentials.SUPABASE_URL, pgConfig,
    stackEnv: { ANON_KEY: credentials.SUPABASE_PUBLISHABLE_KEY, SERVICE_ROLE_KEY: credentials.SUPABASE_SECRET_KEY, JWT_SECRET: credentials.SUPABASE_JWT_SECRET },
    appEnv: { ...credentials, DATABASE_URL: "", SUPABASE_PG_SCHEMA: "public", SUPABASE_PG_SSLMODE: "verify-full", CINEMATCH_ALLOW_LOCAL_REALTIME: "false", ALLOW_DESTRUCTIVE_PG_TESTS: "false" } };
}

async function assertEmptyHostedApplication(db) {
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.rooms")).rows[0].n, 0, "Hosted fixture run refused: existing rooms have unknown ownership");
}
module.exports = { PROJECT, validateHostedStaging, loadHostedStaging, assertEmptyHostedApplication };
