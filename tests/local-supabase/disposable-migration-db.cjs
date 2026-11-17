/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const { execFileSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

// Only successful exclusive CREATE grants this invocation cleanup ownership.
async function withDisposableDatabase(containerId, work, {
  name = "cinematch_roundtrip_" + randomUUID().replaceAll("-", ""),
  run = execFileSync,
} = {}) {
  if (!/^cinematch_roundtrip_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid disposable database name");
  const sql = (database, input) => run("docker", [
    "exec", "-i", containerId, "psql", "-X", "-U", "supabase_admin", "-d", database,
    "-v", "ON_ERROR_STOP=1", "-tA",
  ], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  sql("postgres", `CREATE DATABASE "${name}" WITH TEMPLATE template0;`);
  try {
    return await work((input) => sql(name, input), name);
  } finally {
    // Fail visibly if connections remain; never kill another session for cleanup.
    sql("postgres", `DROP DATABASE "${name}";`);
  }
}

module.exports = { withDisposableDatabase };
