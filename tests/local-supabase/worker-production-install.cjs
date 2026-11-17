/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Exact-HEAD production-only worker install; no hosted access or developer rows.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const { Pool } = require("pg");
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { assertNoCloudTargetEnv } = require("../../scripts/local-supabase/safety.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("../../scripts/local-supabase/generate-env.cjs");
const root = path.resolve(__dirname, "../..");

async function main() {
  assertNoCloudTargetEnv();
  assertLocalStack();
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cine018-worker-prod-"));
  const schema = `cinematch_qual_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const env = parseEnvFile(STACK_ENV_PATH);
  const pool = new Pool({ host: "127.0.0.1", port: 55432, user: "supabase_admin", password: env.POSTGRES_PASSWORD, database: "postgres" });
  let owned = false, child;
  try {
    const tar = path.join(temp, "source.tar");
    execFileSync("git", ["archive", "--format=tar", "-o", tar, head], { cwd: root });
    execFileSync("tar", ["-xf", tar, "-C", temp]);
    fs.unlinkSync(tar);
    const npm = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    execFileSync(process.execPath, [npm, "ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd: temp, stdio: "pipe", windowsHide: true });
    assert(!fs.existsSync(path.join(temp, "node_modules/vitest")), "Development test runtime must be absent");
    for (const pkg of ["pg", "tsx"]) assert(fs.existsSync(path.join(temp, "node_modules", pkg)), `${pkg} must survive production install`);
    await pool.query(`CREATE SCHEMA "${schema}"`); owned = true;
    await pool.query(`CREATE TABLE "${schema}".room_events (room_id uuid, permanent_retry_count int, retry_count int, poison boolean, dispatched boolean)`);
    child = spawn(process.execPath, ["--import", "tsx", "--conditions=react-server", "scripts/realtime-worker.ts"], {
      cwd: temp, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ALLOW_DESTRUCTIVE_PG_TESTS: "false", NODE_ENV: "production", NODE_OPTIONS: "", DATABASE_URL: "", SUPABASE_PG_HOST: "127.0.0.1", SUPABASE_PG_PORT: "55432", SUPABASE_PG_USER: "supabase_admin", SUPABASE_PG_PASSWORD: env.POSTGRES_PASSWORD, SUPABASE_PG_DATABASE: "postgres", SUPABASE_PG_SSLMODE: "disable", SUPABASE_URL: "https://worker-package-control.supabase.co", SUPABASE_SECRET_KEY: "synthetic-never-used-no-pending-events", CINEMATCH_ALLOW_LOCAL_REALTIME: "false", CINEMATCH_OUTBOX_SCHEMA: schema, CINEMATCH_OUTBOX_POLL_MS: "100" },
    });
    let output = "";
    child.stdout.on("data", d => { output += d.toString(); });
    child.stderr.on("data", d => { output += d.toString(); });
    const until = Date.now() + 15000;
    while (!output.includes("Realtime outbox worker ready") && child.exitCode === null && Date.now() < until) await new Promise(r => setTimeout(r, 50));
    assert(output.includes("Realtime outbox worker ready"), "Production worker failed to reach ready; no secrets logged");
    await new Promise(r => setTimeout(r, 450));
    assert.equal(child.exitCode, null, "Worker must remain alive across idle autonomous sweeps");
    assert(!output.includes("sweep failed"), "Idle sweep must succeed against disposable schema");
    console.log(JSON.stringify({ ok: true, head, install: "npm ci --omit=dev --no-audit --no-fund", developmentRuntimeAbsent: true, productionWorkerReady: true, idleSweepsAlive: true, transport: "NOT RUN: no pending events; synthetic unused publisher key", deployment: "NOT RUN" }));
  } finally {
    if (child && child.exitCode === null) {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else child.kill("SIGTERM");
      await Promise.race([new Promise(r => child.once("exit", r)), new Promise(r => setTimeout(r, 3000))]);
    }
    if (owned) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
    const resolved = fs.realpathSync(temp);
    assert(path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith("cine018-worker-prod-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("Production worker qualification failed; private logs/credentials suppressed."); process.exitCode = 1; });
