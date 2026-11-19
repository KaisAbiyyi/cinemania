/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Destructive SQL is confined to an exclusively created disposable database.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { loadMigrationsFromCommit } = require("../../scripts/local-supabase/apply-migrations.cjs");
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { validateCommit, downMigrationPaths } = require("../../scripts/local-supabase/safety.cjs");
const { withDisposableDatabase } = require("./disposable-migration-db.cjs");

const DEFAULT_CANONICAL_COMMIT = "d82fa1629b7afa89c61badfe1ed9c4163eea22ab";

async function main() {
  const args = process.argv.slice(2);
  let commit = DEFAULT_CANONICAL_COMMIT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--commit") throw new Error("Unsupported roundtrip option: " + args[i]);
    commit = args[++i];
  }
  validateCommit(commit);
  // Resolve every canonical file before creating anything; no shared-DB runners.
  const up = loadMigrationsFromCommit(commit);
  const down = loadMigrationsFromCommit(commit, downMigrationPaths());
  assert.ok(up.length === 5 || up.length === 6);
  assert.equal(up.length, down.length);
  const db = assertLocalStack().find(c => c.name === "cinematch-gh52d-db-1");
  assert(db, "Local database container missing");
  // Compare schema, rows and sequence state without logging developer content.
  // PG17 dump restrict tokens are random per invocation and carry no DB state.
  const fingerprint = () => createHash("sha256").update(execFileSync("docker", [
    "exec", db.id, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema=public",
    "--no-owner", "--no-privileges",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] })
    .replace(/^\\(?:un)?restrict .*$/gm, "")).digest("hex");
  const before = fingerprint();

  const result = await withDisposableDatabase(db.id, async (sql, database) => {
    // Minimal synthetic prerequisites, NOT a clone of developer auth/realtime data.
    // Real WS/JWT/RLS enforcement is qualified by the separate real-service suite.
    sql(`BEGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      CREATE SCHEMA realtime;
      CREATE TABLE realtime.messages (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, topic text);
      ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
      CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
        $$ SELECT current_setting('realtime.topic', true) $$;
      COMMIT;`);
    const apply = migrations => sql("BEGIN;\n" + migrations.map(m => m.sql).join("\n") + "\nCOMMIT;");
    apply(up);
    // A real row proves rollback is destructive only in the disposable target.
    sql("INSERT INTO public.rooms (id, code) VALUES ('00000000-0000-4000-8000-000000000052', 'GH52T2');");
    apply(down);
    assert.equal(sql("SELECT to_regclass('public.rooms') IS NULL AND to_regclass('public.room_events') IS NULL AND to_regclass('public.guest_capability_sessions') IS NULL AND to_regclass('public.round_participants') IS NULL;"), "t");
    apply(up);
    assert.equal(sql("SELECT count(*) FROM public.rooms;"), "0");
    assert.equal(sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='room_events' AND column_name='permanent_retry_count';"), "1");
    assert.equal(sql("SELECT count(*) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname IN ('cinematch_room_select_allow','cinematch_room_select_fence','cinematch_room_insert_fence');"), "3");
    return { database };
  });
  const after = fingerprint();
  assert.equal(after, before, "Developer public schema/data/sequence fingerprint changed");
  console.log(JSON.stringify({ ok: true, commit, ...result, disposableDatabaseDropped: true,
    developerPublicFingerprintUnchanged: true, publicSha256Before: before, publicSha256After: after,
    downMigrations: down.map(d => ({ file: d.file, sha256: d.hash })),
    upMigrations: up.map(u => ({ file: u.file, sha256: u.hash })),
  }));
}

main().catch(error => {
  console.error("Migration roundtrip failed:", error.message);
  process.exitCode = 1;
});
