/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { withDisposableDatabase } = require("./disposable-migration-db.cjs");

async function main() {
  const db = assertLocalStack().find(c => c.name === "cinematch-gh52d-db-1");
  assert(db);
  const exists = name => execFileSync("docker", ["exec", db.id, "psql", "-X", "-U", "supabase_admin", "-d", "postgres", "-tAc",
    `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${name}');`], { encoding: "utf8" }).trim();
  let sentinelDatabase;
  await withDisposableDatabase(db.id, async (sql, name) => {
    sentinelDatabase = name;
    sql("CREATE TABLE owner_data (value text); INSERT INTO owner_data VALUES ('non-synthetic developer-like sentinel');");
    // A real non-empty DB with a syntactically valid test name is still not ours.
    await assert.rejects(withDisposableDatabase(db.id, async () => assert.fail("collision entered work"), { name }), /already exists/);
    assert.equal(sql("SELECT value FROM owner_data;"), "non-synthetic developer-like sentinel");
    assert.equal(exists(name), "t");
  });
  assert.equal(exists(sentinelDatabase), "f");
  let failedDatabase;
  await assert.rejects(withDisposableDatabase(db.id, async (sql, name) => {
    failedDatabase = name;
    sql("CREATE TABLE synthetic_before_failure (id int);");
    sql("SELECT * FROM deliberately_missing_table;");
  }), /deliberately_missing_table/);
  assert.equal(exists(failedDatabase), "f");
  console.log(JSON.stringify({ ok: true, realCreateCollisionDenied: true, existingSentinelPreserved: true,
    successCleanupVerified: true, sqlFailureCleanupVerified: true }));
}
main().catch(error => { console.error("Migration isolation qualification failed:", error.message); process.exitCode = 1; });
