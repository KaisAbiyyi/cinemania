/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Run pinned Git SQL only inside our loopback-verified local Compose database.
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const { validateCommit, migrationPaths, downMigrationPaths, assertNoCloudTargetEnv } = require("./safety.cjs");
const { assertLocalStack } = require("./runtime.cjs");

const run = (program, args, options = {}) =>
  execFileSync(program, args, { encoding: "utf8", ...options }).trim();
const REPO_ROOT = path.resolve(__dirname, "../..");

function loadMigrationsFromCommit(commit, paths = migrationPaths()) {
  validateCommit(commit);
  run("git", ["cat-file", "-e", commit + "^{commit}"], { cwd: REPO_ROOT });
  const existing = new Set(
    run("git", ["ls-tree", "-r", "--name-only", commit, "--", "src/db/migrations"], { cwd: REPO_ROOT }).split("\n")
  );
  return paths.filter(file => existing.has(file)).map((file) => {
    const sql = run("git", ["show", commit + ":" + file], { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
    return { file, sql, hash: crypto.createHash("sha256").update(sql).digest("hex") };
  });
}

function getLocalDbContainer() {
  assertNoCloudTargetEnv();
  const containers = assertLocalStack();
  const db = containers.find((container) => container.name === "cinematch-gh52d-db-1");
  if (!db) throw new Error("Local database container missing");
  return db;
}

function applyCanonicalMigrations(commit) {
  const sqls = loadMigrationsFromCommit(commit, migrationPaths());
  const db = getLocalDbContainer();
  const preflight = run("docker", [
    "exec",
    db.id,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-tAc",
    "SELECT to_regclass('public.rooms') IS NULL AND to_regclass('public.room_events') IS NULL",
  ]);
  if (preflight !== "t") {
    throw new Error("Database is not empty; refusing to overwrite or reset");
  }
  const result = spawnSync(
    "docker",
    ["exec", "-i", db.id, "psql", "-U", "supabase_admin", "-d", "postgres", "--single-transaction", "-v", "ON_ERROR_STOP=1"],
    { input: sqls.map((item) => item.sql).join("\n"), encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`Local migration transaction failed (exit ${result.status}): ${(result.stderr ?? "").slice(-1000)}`);
  }
  return sqls;
}

function applyDownMigrations(commit) {
  const sqls = loadMigrationsFromCommit(commit, downMigrationPaths());
  const db = getLocalDbContainer();
  const result = spawnSync(
    "docker",
    ["exec", "-i", db.id, "psql", "-U", "supabase_admin", "-d", "postgres", "--single-transaction", "-v", "ON_ERROR_STOP=1"],
    { input: sqls.map((item) => item.sql).join("\n"), encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`Local down-migration transaction failed (exit ${result.status}): ${(result.stderr ?? "").slice(-1000)}`);
  }
  const postflight = run("docker", [
    "exec",
    db.id,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-tAc",
    "SELECT to_regclass('public.rooms') IS NULL AND to_regclass('public.room_events') IS NULL AND to_regclass('public.guest_capability_sessions') IS NULL AND to_regclass('public.round_participants') IS NULL",
  ]);
  if (postflight !== "t") {
    throw new Error("Down-migration verification failed: CineMatch tables still present");
  }
  return sqls;
}

if (require.main === module) {
  const commit = process.argv[2] ?? "";
  try {
    const sqls = applyCanonicalMigrations(commit);
    for (const item of sqls) console.log(item.file, item.hash);
    console.log(`Applied ${sqls.length} canonical migrations from commit`, commit, "to loopback-only local Compose database.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { loadMigrationsFromCommit, applyCanonicalMigrations, applyDownMigrations };
