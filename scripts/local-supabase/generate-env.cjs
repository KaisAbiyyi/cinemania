/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
// Generates fresh synthetic credentials for this disposable local stack only.
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const SUPABASE_DIR = path.resolve(__dirname, "../../supabase");
const STACK_ENV_PATH = path.join(SUPABASE_DIR, ".env.local");
const APP_ENV_PATH = path.join(SUPABASE_DIR, ".env.app.local");

function encodeBase64Url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signLocalJwt(role, secret) {
  const body = [
    encodeBase64Url({ alg: "HS256", typ: "JWT" }),
    encodeBase64Url({ role, iss: "supabase", iat: 1700000000, exp: 4102444800 }),
  ].join(".");
  return body + "." + crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

function parseEnvFile(filePath) {
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    result[line.slice(0, eqIdx).trim()] = line.slice(eqIdx + 1).trim();
  }
  return result;
}

function ensureStackEnv({ force = false } = {}) {
  if (fs.existsSync(STACK_ENV_PATH)) {
    if (!force) return { created: false, path: STACK_ENV_PATH };
    fs.unlinkSync(STACK_ENV_PATH);
  }
  fs.mkdirSync(SUPABASE_DIR, { recursive: true });
  const secret = crypto.randomBytes(32).toString("hex");
  const env = {
    POSTGRES_PASSWORD: crypto.randomBytes(24).toString("hex"),
    JWT_SECRET: secret,
    SECRET_KEY_BASE: crypto.randomBytes(48).toString("hex"),
    ANON_KEY: signLocalJwt("anon", secret),
    SERVICE_ROLE_KEY: signLocalJwt("service_role", secret),
  };
  fs.writeFileSync(
    STACK_ENV_PATH,
    Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    { flag: "wx", mode: 0o600 }
  );
  return { created: true, path: STACK_ENV_PATH };
}

function ensureAppEnv({ force = false } = {}) {
  if (!fs.existsSync(STACK_ENV_PATH)) {
    throw new Error("Stack credentials missing in supabase/.env.local; run generate-env.cjs first");
  }
  if (fs.existsSync(APP_ENV_PATH)) {
    if (!force) return { created: false, path: APP_ENV_PATH };
    fs.unlinkSync(APP_ENV_PATH);
  }
  const stackEnv = parseEnvFile(STACK_ENV_PATH);
  for (const key of ["POSTGRES_PASSWORD", "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY"]) {
    if (!stackEnv[key]) throw new Error(`Missing ${key} in supabase/.env.local`);
  }
  const appEnv = {
    DATABASE_URL: `postgresql://supabase_admin:${stackEnv.POSTGRES_PASSWORD}@127.0.0.1:55432/postgres`,
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: stackEnv.SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: stackEnv.JWT_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stackEnv.ANON_KEY,
    CINEMATCH_ALLOW_LOCAL_REALTIME: "true",
    CINEMATCH_CAPABILITY_SECRET: crypto.randomBytes(32).toString("hex"),
    TMDB_API_RAT: "synthetic-local-tmdb-rat",
    IPINFO_TOKEN: "synthetic-local-ipinfo-token",
    YOUTUBE_API_KEY: "synthetic-local-youtube-key",
    NEXT_PUBLIC_TMDB_POSTER_URL: "https://image.tmdb.org/t/p",
    NEXT_PUBLIC_IMAGE_BASE_URL: "https://image.tmdb.org/t/p",
  };
  fs.writeFileSync(
    APP_ENV_PATH,
    Object.entries(appEnv).map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
    { flag: "wx", mode: 0o600 }
  );
  return { created: true, path: APP_ENV_PATH };
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const force = args.has("--force");
  const wantAppEnv = args.has("--app-env");
  if (!wantAppEnv && !force && fs.existsSync(STACK_ENV_PATH)) {
    throw new Error("Refusing to replace existing local credentials");
  }
  const stackResult = ensureStackEnv({ force });
  if (stackResult.created) {
    console.log("Created local-only stack credentials in ignored supabase/.env.local; values withheld.");
  }
  if (wantAppEnv) {
    const appResult = ensureAppEnv({ force });
    console.log(
      appResult.created
        ? "Created local-only Next.js loopback config in ignored supabase/.env.app.local; values withheld."
        : "Kept existing supabase/.env.app.local; values withheld."
    );
  }
}

module.exports = { ensureStackEnv, ensureAppEnv, parseEnvFile, STACK_ENV_PATH, APP_ENV_PATH };
