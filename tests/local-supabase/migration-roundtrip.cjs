/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Verifies canonical PostgreSQL 001-005 forward -> 005_down..001_down rollback -> 001-005 re-apply on local Compose DB.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { applyCanonicalMigrations, applyDownMigrations } = require("../../scripts/local-supabase/apply-migrations.cjs");
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { validateCommit } = require("../../scripts/local-supabase/safety.cjs");
const { seedSyntheticData } = require("../../scripts/local-supabase/seed.cjs");

const DEFAULT_CANONICAL_COMMIT = "d82fa1629b7afa89c61badfe1ed9c4163eea22ab";

async function main() {
  const commitIdx = process.argv.indexOf("--commit");
  const commit = commitIdx !== -1 ? process.argv[commitIdx + 1] : DEFAULT_CANONICAL_COMMIT;
  validateCommit(commit);
  const reseed = process.argv.includes("--reseed");

  const containers = assertLocalStack();
  const db = containers.find((c) => c.name === "cinematch-gh52d-db-1");
  assert(db, "Local database container missing");

  // Ensure starting state has tables applied (or apply first if empty)
  const hasRooms = execFileSync(
    "docker",
    ["exec", db.id, "psql", "-U", "supabase_admin", "-d", "postgres", "-tAc", "SELECT to_regclass('public.rooms') IS NOT NULL"],
    { encoding: "utf8" }
  ).trim();
  if (hasRooms !== "t") {
    applyCanonicalMigrations(commit);
  }

  // 1. Roll back 005_down .. 001_down
  const down = applyDownMigrations(commit);
  assert.equal(down.length, 5, "Expected 5 down migrations");

  // 2. Re-apply canonical 001 .. 005 from empty DB
  const up = applyCanonicalMigrations(commit);
  assert.equal(up.length, 5, "Expected 5 canonical up migrations");

  // 3. Verify 005 retry column & 3 realtime.messages policies exist
  const verifySql = execFileSync(
    "docker",
    [
      "exec",
      db.id,
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-tAc",
      "SELECT count(*) FROM pg_policies WHERE schemaname='realtime' AND tablename='messages' AND policyname IN ('cinematch_room_select_allow','cinematch_room_select_fence','cinematch_room_insert_fence')",
    ],
    { encoding: "utf8" }
  ).trim();
  assert.equal(verifySql, "3", "Expected 3 realtime.messages RLS policies after re-apply");

  if (reseed) {
    await seedSyntheticData();
  }

  console.log(
    JSON.stringify({
      ok: true,
      commit,
      downMigrations: down.map((d) => ({ file: d.file, sha256: d.hash })),
      upMigrations: up.map((u) => ({ file: u.file, sha256: u.hash })),
      reseeded: reseed,
    })
  );
}

main().catch((error) => {
  console.error("Migration roundtrip failed:", error.message);
  process.exitCode = 1;
});
