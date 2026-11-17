"use strict";
// Run pinned Git SQL only inside our loopback-verified local Compose database.
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const { validateCommit, migrationPaths } = require("./safety.cjs");
const { assertLocalStack } = require("./runtime.cjs");
const commit = process.argv[2] ?? "";
validateCommit(commit);
const run = (program, args, options = {}) => execFileSync(program, args, { encoding: "utf8", ...options }).trim();
run("git", ["cat-file", "-e", commit + "^{commit}"]);
const sqls = migrationPaths().map((file) => {
  const sql = run("git", ["show", commit + ":" + file], { maxBuffer: 10 * 1024 * 1024 });
  return { file, sql, hash: crypto.createHash("sha256").update(sql).digest("hex") };
});
const containers = assertLocalStack();
const db = containers.find((container) => container.name === "cinematch-gh52d-db-1");
if (!db) throw new Error("Local database missing");
const preflight = run("docker", ["exec", db.id, "psql", "-U", "supabase_admin", "-d", "postgres", "-tAc", "SELECT to_regclass('public.rooms') IS NULL"]);
if (preflight !== "t") throw new Error("Database is not empty; refusing to overwrite or reset");
const result = spawnSync("docker", ["exec", "-i", db.id, "psql", "-U", "supabase_admin", "-d", "postgres", "--single-transaction", "-v", "ON_ERROR_STOP=1"], { input: sqls.map((item) => item.sql).join("\n"), encoding: "utf8" });
if (result.status !== 0) {
  // Do not print connection details or credentials.
  console.error("Local migration transaction failed; exit", result.status, (result.stderr ?? "").slice(-1000));
  process.exitCode = 1;
} else {
  for (const item of sqls) console.log(item.file, item.hash);
  console.log("Applied five canonical migrations from commit", commit, "to loopback-only local Compose database.");
}
