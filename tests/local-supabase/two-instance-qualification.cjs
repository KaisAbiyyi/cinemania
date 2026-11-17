/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
/**
 * Real Two-Instance Next.js + Local Docker Supabase Realtime Qualification Suite.
 *
 * Uses PR #51 HEAD d82fa1629b7afa89c61badfe1ed9c4163eea22ab (containing the
 * guarded loopback fix in src/lib/server/realtime/supabasePublisher.ts) without
 * reimplementing or modifying any CINE-018 files inside GH-52.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const { Client } = require(path.resolve(__dirname, "../../scripts/local-supabase/node_modules/pg"));
const { createClient } = require(path.resolve(__dirname, "../../scripts/local-supabase/node_modules/@supabase/supabase-js"));
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { validateCommit, assertNoCloudTargetEnv } = require("../../scripts/local-supabase/safety.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("../../scripts/local-supabase/generate-env.cjs");

const DEFAULT_APP_COMMIT = "d82fa1629b7afa89c61badfe1ed9c4163eea22ab";
const PORT_1 = 3101;
const PORT_2 = 3102;

function getFlagValue(args, name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function extractCookieHeader(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  assert(raw.length > 0, "Expected Set-Cookie header");
  return raw.map((entry) => entry.split(";")[0]).join("; ");
}

function writeHermeticTmdbPreload(filePath) {
  const movies = Array.from({ length: 20 }, (_, i) => ({
    id: 910001 + i,
    title: `GH52 Local Film ${i + 1}`,
    original_title: `GH52 Local Film ${i + 1}`,
    poster_path: `/gh52_${i + 1}.jpg`,
    overview: `Synthetic local qualification title ${i + 1}`,
    release_date: "2026-01-15",
    vote_average: 7.8,
    adult: false,
  }));
  const payload = JSON.stringify({ page: 1, total_pages: 1, total_results: 20, results: movies });

  const script = `/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const https = require("node:https");
const http = require("node:http");
const { PassThrough } = require("node:stream");
const PAYLOAD = ${JSON.stringify(payload)};
function mockDiscover(cb) {
  const res = new PassThrough();
  res.statusCode = 200;
  res.headers = { "content-type": "application/json" };
  const req = new PassThrough();
  req.setTimeout = () => req;
  req.abort = () => {};
  req.destroy = () => {};
  process.nextTick(() => {
    if (typeof cb === "function") cb(res);
    req.emit("response", res);
    res.push(PAYLOAD);
    res.push(null);
  });
  return req;
}
function getTargetHost(options) {
  if (typeof options === "string") return new URL(options).hostname.toLowerCase();
  if (options instanceof URL) return options.hostname.toLowerCase();
  const raw = String(options?.hostname || options?.host || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end !== -1 ? raw.slice(1, end) : raw;
  }
  return raw.replace(/:\d+$/, "");
}
function isTmdbTarget(options) {
  return getTargetHost(options) === "api.themoviedb.org";
}
function isLoopbackOrSocket(options) {
  if (options && typeof options === "object" && !(options instanceof URL) && options.socketPath && !options.hostname && !options.host) {
    return true;
  }
  const host = getTargetHost(options);
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
const origHttpsReq = https.request;
https.request = function(urlOrOpts, optsOrCb, maybeCb) {
  const opts = typeof urlOrOpts === "string" || urlOrOpts instanceof URL ? urlOrOpts : urlOrOpts;
  const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
  if (isTmdbTarget(opts)) return mockDiscover(cb);
  if (!isLoopbackOrSocket(opts)) throw new Error("FAIL_CLOSED outbound https blocked: " + getTargetHost(opts));
  return origHttpsReq.apply(this, arguments);
};
https.get = function(urlOrOpts, optsOrCb, maybeCb) {
  const req = https.request(urlOrOpts, optsOrCb, maybeCb);
  req.end();
  return req;
};
const origHttpReq = http.request;
http.request = function(urlOrOpts) {
  const opts = typeof urlOrOpts === "string" || urlOrOpts instanceof URL ? urlOrOpts : urlOrOpts;
  if (!isLoopbackOrSocket(opts)) throw new Error("FAIL_CLOSED outbound http blocked: " + getTargetHost(opts));
  return origHttpReq.apply(this, arguments);
};
`;
  fs.writeFileSync(filePath, script, "utf8");
}

async function waitForServer(origin, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/api/rooms/00000000-0000-4000-8000-000000000000`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 401 || res.status === 404 || res.status === 400) return;
    } catch {
      // keep polling until deadline
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for Next.js instance at ${origin}`);
}

function spawnNextInstance({ cwd, port, env }) {
  const nextBin = path.join(cwd, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "-p", String(port), "-H", "127.0.0.1"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (d) => { logs = (logs + d.toString()).slice(-4000); });
  child.stderr.on("data", (d) => { logs = (logs + d.toString()).slice(-4000); });
  return { child, getLogs: () => logs };
}

async function stopChild(proc) {
  if (!proc || proc.child.killed || proc.child.exitCode !== null) return;
  proc.child.kill("SIGKILL");
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 2000);
    proc.child.once("exit", () => { clearTimeout(t); resolve(); });
  });
}

async function connectRoomWs({ supabaseUrl, anonKey, origin, roomId, cookie }) {
  const tokenRes = await fetch(`${origin}/api/rooms/${roomId}/realtime-token`, {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(tokenRes.status, 200, `realtime-token expected 200, got ${tokenRes.status}`);
  const { token } = await tokenRes.json();
  assert.equal(typeof token, "string");

  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  await client.realtime.setAuth(token);
  const hints = [];
  const listeners = new Set();
  const channel = client.channel(`room:${roomId}`, { config: { private: true } });
  channel.on("broadcast", { event: "room_changed" }, (msg) => {
    hints.push({ payload: msg.payload, receivedAtMs: performance.now() });
    for (const fn of listeners) fn(msg.payload);
  });

  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("TIMEOUT"), 8000);
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
        clearTimeout(timer);
        resolve(s);
      }
    });
  });
  assert.equal(status, "SUBSCRIBED", `Expected private WS SUBSCRIBED, got ${status}`);

  function waitForVersion(version, timeoutMs = 12000) {
    if (hints.some((h) => h.payload?.version === version)) {
      return Promise.resolve(hints.find((h) => h.payload?.version === version));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        listeners.delete(onMsg);
        reject(new Error(`Timed out waiting for WS version ${version}; saw [${hints.map((h) => h.payload?.version).join(",")}]`));
      }, timeoutMs);
      function onMsg(payload) {
        if (payload?.version === version) {
          clearTimeout(timer);
          listeners.delete(onMsg);
          resolve(hints.find((h) => h.payload?.version === version));
        }
      }
      listeners.add(onMsg);
    });
  }

  return { client, channel, hints, waitForVersion };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(2));
}

async function main() {
  assertNoCloudTargetEnv();
  assertLocalStack();
  const appCommit = getFlagValue(process.argv.slice(2), "--app-commit") || DEFAULT_APP_COMMIT;
  validateCommit(appCommit);
  execFileSync("git", ["-C", REPO_ROOT, "cat-file", "-e", `${appCommit}^{commit}`]);

  const stackEnv = parseEnvFile(STACK_ENV_PATH);
  const databaseUrl = `postgresql://supabase_admin:${stackEnv.POSTGRES_PASSWORD}@127.0.0.1:55432/postgres`;
  const supabaseUrl = "http://127.0.0.1:54321";
  const capabilitySecret = crypto.randomBytes(32).toString("hex");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-gh52-2inst-"));
  const buildDir = path.join(tempRoot, "app");
  const inst1Dir = path.join(tempRoot, "inst1");
  const inst2Dir = path.join(tempRoot, "inst2");
  const preloadPath = path.join(tempRoot, "tmdb-offline-preload.cjs");
  const tarPath = path.join(tempRoot, "app.tar");

  let proc1 = null;
  let proc2 = null;
  const wsClients = [];
  const createdRoomIds = [];
  const db = new Client({
    host: "127.0.0.1",
    port: 55432,
    user: "supabase_admin",
    password: stackEnv.POSTGRES_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });

  try {
    // 1. Extract exact PR #51 HEAD d82fa162 into isolated temp dir
    fs.mkdirSync(buildDir, { recursive: true });
    execFileSync("git", ["-C", REPO_ROOT, "archive", "--format=tar", "-o", tarPath, appCommit]);
    execFileSync("tar", ["-xf", tarPath, "-C", buildDir]);
    fs.unlinkSync(tarPath);

    if (process.platform === "win32") {
      execFileSync("cmd.exe", ["/d", "/s", "/c", "npm ci --prefer-offline --no-audit --no-fund"], {
        cwd: buildDir,
        stdio: "pipe",
      });
    } else {
      execFileSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], {
        cwd: buildDir,
        stdio: "pipe",
      });
    }

    // 2. Negative control: verify PR #51 supabasePublisher rejects http://127.0.0.1:54321 in NODE_ENV=production
    const tsxBin = path.join(buildDir, "node_modules", "tsx", "dist", "cli.mjs");
    const negRes = execFileSync(
      process.execPath,
      [
        tsxBin,
        "-e",
        `import { createSupabasePublisher } from "./src/lib/server/realtime/supabasePublisher";
         let threw = false;
         try { createSupabasePublisher("http://127.0.0.1:54321", "secret"); } catch (e) { threw = /Invalid Supabase broadcast configuration/.test(e.message); }
         if (!threw) process.exit(2);
         console.log("NEG_PROD_LOOPBACK_REJECTED");`,
      ],
      {
        cwd: buildDir,
        env: { ...process.env, NODE_ENV: "production", CINEMATCH_ALLOW_LOCAL_REALTIME: "true" },
        encoding: "utf8",
      }
    ).trim();
    assert.equal(negRes, "NEG_PROD_LOOPBACK_REJECTED");

    // 3. Prepare two completely independent runtime directories (real src + real node_modules, zero junctions/env files)
    writeHermeticTmdbPreload(preloadPath);
    fs.renameSync(buildDir, inst1Dir);
    fs.cpSync(inst1Dir, inst2Dir, { recursive: true });

    const baseAppEnv = {
      ...process.env,
      NODE_ENV: "development",
      CINEMATCH_ALLOW_LOCAL_REALTIME: "true",
      DATABASE_URL: databaseUrl,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SECRET_KEY: stackEnv.SERVICE_ROLE_KEY,
      SUPABASE_JWT_SECRET: stackEnv.JWT_SECRET,
      CINEMATCH_CAPABILITY_SECRET: capabilitySecret,
      TMDB_API_RAT: "synthetic-local-tmdb-rat",
      IPINFO_TOKEN: "synthetic-local-ipinfo",
      YOUTUBE_API_KEY: "synthetic-local-youtube",
      NEXT_PUBLIC_TMDB_POSTER_URL: "https://image.tmdb.org/t/p",
      NEXT_PUBLIC_IMAGE_BASE_URL: "https://image.tmdb.org/t/p",
      NODE_OPTIONS: `--require ${preloadPath}`,
    };

    const origin1 = `http://127.0.0.1:${PORT_1}`;
    const origin2 = `http://127.0.0.1:${PORT_2}`;
    proc1 = spawnNextInstance({ cwd: inst1Dir, port: PORT_1, env: { ...baseAppEnv, PORT: String(PORT_1) } });
    proc2 = spawnNextInstance({ cwd: inst2Dir, port: PORT_2, env: { ...baseAppEnv, PORT: String(PORT_2) } });
    await Promise.all([waitForServer(origin1, 90000), waitForServer(origin2, 90000)]);

    await db.connect();

    // 4. Test A: Host creates room on Instance 1, Guest joins on Instance 2
    const createRes = await fetch(`${origin1}/api/rooms`, {
      method: "POST",
      headers: { origin: origin1, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Host Inst1" }),
    });
    assert.equal(createRes.status, 201, `Create room expected 201, got ${createRes.status}`);
    const hostCookie = extractCookieHeader(createRes);
    const createdBody = await createRes.json();
    const roomId = createdBody.room.roomId;
    const roomCode = createdBody.room.code;
    createdRoomIds.push(roomId);

    const joinRes = await fetch(`${origin2}/api/rooms/join`, {
      method: "POST",
      headers: { origin: origin2, "content-type": "application/json" },
      body: JSON.stringify({ code: roomCode, displayName: "Guest Inst2" }),
    });
    assert.equal(joinRes.status, 200, `Join room expected 200, got ${joinRes.status}`);
    const guestCookie = extractCookieHeader(joinRes);

    const hostWs = await connectRoomWs({ supabaseUrl, anonKey: stackEnv.ANON_KEY, origin: origin1, roomId, cookie: hostCookie });
    wsClients.push(hostWs.client);
    const guestWs = await connectRoomWs({ supabaseUrl, anonKey: stackEnv.ANON_KEY, origin: origin2, roomId, cookie: guestCookie });
    wsClients.push(guestWs.client);

    // 5. Test B: Cross-instance filter -> start -> confidential LIKE vote -> unanimous MATCHED
    const filterRes = await fetch(`${origin1}/api/rooms/${roomId}/filters`, {
      method: "PATCH",
      headers: { origin: origin1, cookie: hostCookie, "content-type": "application/json" },
      body: JSON.stringify({ sort_by: "vote_average.desc" }),
    });
    assert.equal(filterRes.status, 200);
    const filterBody = await filterRes.json();
    await guestWs.waitForVersion(filterBody.room.stateVersion);

    const startRes = await fetch(`${origin1}/api/rooms/${roomId}/start`, {
      method: "POST",
      headers: { origin: origin1, cookie: hostCookie, "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(startRes.status, 200, `Start round expected 200, got ${startRes.status}`);
    const startBody = await startRes.json();
    await guestWs.waitForVersion(startBody.room.stateVersion);

    const snapGuestAfterStart = await fetch(`${origin2}/api/rooms/${roomId}`, { headers: { cookie: guestCookie } });
    assert.equal(snapGuestAfterStart.status, 200);
    const guestSnap1 = await snapGuestAfterStart.json();
    assert.equal(guestSnap1.room.status, "ACTIVE");
    assert.equal(guestSnap1.room.deck.length, 20);

    const cand0 = guestSnap1.room.deck[0];
    const hostVoteRes = await fetch(`${origin1}/api/rooms/${roomId}/votes`, {
      method: "POST",
      headers: { origin: origin1, cookie: hostCookie, "content-type": "application/json" },
      body: JSON.stringify({
        roundId: guestSnap1.room.currentRoundId,
        candidateId: cand0.candidateId,
        movieId: cand0.movieId,
        vote: "LIKE",
        operationId: crypto.randomUUID(),
      }),
    });
    assert.equal(hostVoteRes.status, 200);
    const hostVoteBody = await hostVoteRes.json();
    await guestWs.waitForVersion(hostVoteBody.room.stateVersion);

    // Verify zero vote leak in WS hints and Guest snapshot
    for (const hint of guestWs.hints) {
      assert.deepEqual(Object.keys(hint.payload).sort(), ["roomId", "version"], "WS hint must contain only roomId and version");
    }
    const snapGuestMid = await (await fetch(`${origin2}/api/rooms/${roomId}`, { headers: { cookie: guestCookie } })).json();
    assert.equal(snapGuestMid.room.status, "ACTIVE");
    assert.equal(Object.prototype.hasOwnProperty.call(snapGuestMid.viewer.userVotes ?? {}, cand0.candidateId), false);
    assert.equal(JSON.stringify(snapGuestMid).includes('"LIKE"'), false, "Host LIKE vote must not leak to Guest snapshot");

    // Guest votes LIKE on Instance 2 -> Host WS on Instance 1 converges to MATCHED
    const guestVoteRes = await fetch(`${origin2}/api/rooms/${roomId}/votes`, {
      method: "POST",
      headers: { origin: origin2, cookie: guestCookie, "content-type": "application/json" },
      body: JSON.stringify({
        roundId: guestSnap1.room.currentRoundId,
        candidateId: cand0.candidateId,
        movieId: cand0.movieId,
        vote: "LIKE",
        operationId: crypto.randomUUID(),
      }),
    });
    assert.equal(guestVoteRes.status, 200);
    const guestVoteBody = await guestVoteRes.json();
    await hostWs.waitForVersion(guestVoteBody.room.stateVersion);

    const hostFinalSnap = await (await fetch(`${origin1}/api/rooms/${roomId}`, { headers: { cookie: hostCookie } })).json();
    assert.equal(hostFinalSnap.room.status, "MATCHED");
    assert.equal(hostFinalSnap.room.matchedMovieId, cand0.movieId);

    // 6. Test C: Reconnect + gap replay + out-of-order / duplicate reconciler resilience
    const create2 = await fetch(`${origin1}/api/rooms`, {
      method: "POST",
      headers: { origin: origin1, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Reconnect Host" }),
    });
    assert.equal(create2.status, 201);
    const host2Cookie = extractCookieHeader(create2);
    const room2 = (await create2.json()).room;
    createdRoomIds.push(room2.roomId);

    const join2 = await fetch(`${origin2}/api/rooms/join`, {
      method: "POST",
      headers: { origin: origin2, "content-type": "application/json" },
      body: JSON.stringify({ code: room2.code, displayName: "Reconnect Guest" }),
    });
    assert.equal(join2.status, 200);
    const guest2Cookie = extractCookieHeader(join2);

    const guest2WsA = await connectRoomWs({ supabaseUrl, anonKey: stackEnv.ANON_KEY, origin: origin2, roomId: room2.roomId, cookie: guest2Cookie });
    wsClients.push(guest2WsA.client);
    // Disconnect Guest WS before offline mutations
    await guest2WsA.client.removeAllChannels();
    await guest2WsA.client.realtime.disconnect();

    for (const sort_by of ["vote_average.desc", "primary_release_date.desc", "popularity.desc"]) {
      const res = await fetch(`${origin1}/api/rooms/${room2.roomId}/filters`, {
        method: "PATCH",
        headers: { origin: origin1, cookie: host2Cookie, "content-type": "application/json" },
        body: JSON.stringify({ sort_by }),
      });
      assert.equal(res.status, 200);
    }

    const guest2WsB = await connectRoomWs({ supabaseUrl, anonKey: stackEnv.ANON_KEY, origin: origin2, roomId: room2.roomId, cookie: guest2Cookie });
    wsClients.push(guest2WsB.client);
    const replayRes = await fetch(`${origin2}/api/rooms/${room2.roomId}/events?since=2`, { headers: { cookie: guest2Cookie } });
    assert.equal(replayRes.status, 200);
    const replayBody = await replayRes.json();
    assert.deepEqual(replayBody.events.map((e) => e.version), [3, 4, 5]);

    const reconTsxBin = path.join(inst1Dir, "node_modules", "tsx", "dist", "cli.mjs");
    const reconOut = execFileSync(
      process.execPath,
      [
        reconTsxBin,
        "-e",
        `import assert from "node:assert/strict";
         import { createRoomReconciler } from "./src/lib/realtime/roomReconciler";
         (async () => {
           let v = 4; const seen = [];
           const r = createRoomReconciler({
             loadSnapshot: async () => ({ stateVersion: v, snapshot: { v } }),
             onSnapshot: ({ stateVersion }) => seen.push(stateVersion),
           });
           await r.connected();
           await r.notify(2);
           await r.notify(4);
           v = 7; await r.notify(7);
           await r.notify(6);
           await r.notify(7);
           assert.deepEqual(seen, [4, 7]);
           console.log("RECONCILER_OK");
         })().catch((e) => { console.error(e); process.exit(1); });`,
      ],
      { cwd: inst1Dir, encoding: "utf8" }
    ).trim();
    assert.equal(reconOut, "RECONCILER_OK");

    // 7. Crash/restart + request-assisted recovery of a synthetic stranded outbox row.
    // The authorized GET below triggers dispatch; this does not test an autonomous worker.
    await stopChild(proc1);
    const inst2Health = await fetch(`${origin2}/api/rooms/${room2.roomId}`, { headers: { cookie: guest2Cookie } });
    assert.equal(inst2Health.status, 200, "Instance 2 must stay available while Instance 1 is down");

    // Simulate committed outbox row stranded before publish (version 6)
    await db.query("BEGIN");
    await db.query("UPDATE public.rooms SET state_version = 6 WHERE id = $1", [room2.roomId]);
    await db.query(
      "INSERT INTO public.room_events (room_id, version, event_type, payload, dispatched) VALUES ($1, 6, 'FILTERS_UPDATED', '{\"synthetic\":true}'::jsonb, false)",
      [room2.roomId]
    );
    await db.query("COMMIT");

    proc1 = spawnNextInstance({ cwd: inst1Dir, port: PORT_1, env: { ...baseAppEnv, PORT: String(PORT_1) } });
    await waitForServer(origin1, 90000);

    const recoverRes = await fetch(`${origin1}/api/rooms/${room2.roomId}/events?since=5`, { headers: { cookie: host2Cookie } });
    assert.equal(recoverRes.status, 200);
    await guest2WsB.waitForVersion(6);
    const outboxCheck = await db.query("SELECT dispatched FROM public.room_events WHERE room_id = $1 AND version = 6", [room2.roomId]);
    assert.equal(outboxCheck.rows[0].dispatched, true, "Recovered outbox row must be marked dispatched=true");

    // 8. Test E: Measured request-to-WebSocket latency over 30 real mutations (Instance 1 -> Postgres -> Realtime -> Guest WS)
    const latenciesMs = [];
    let currentVersion = 6;
    for (let i = 0; i < 30; i++) {
      currentVersion += 1;
      const sort_by = i % 2 === 0 ? "vote_average.desc" : "popularity.desc";
      const t0 = performance.now();
      const [res, wsEvent] = await Promise.all([
        fetch(`${origin1}/api/rooms/${room2.roomId}/filters`, {
          method: "PATCH",
          headers: { origin: origin1, cookie: host2Cookie, "content-type": "application/json" },
          body: JSON.stringify({ sort_by }),
        }),
        guest2WsB.waitForVersion(currentVersion, 5000),
      ]);
      assert.equal(res.status, 200);
      latenciesMs.push(wsEvent.receivedAtMs - t0);
    }
    const sorted = [...latenciesMs].sort((a, b) => a - b);

    console.log(
      JSON.stringify(
        {
          ok: true,
          appCommit,
          negativeProdControl: "PASS",
          twoInstances: { port1: PORT_1, port2: PORT_2 },
          unanimousMatchConverged: true,
          votePrivacyVerified: true,
          reconnectGapReplayVerified: true,
          outOfOrderDuplicateIgnored: true,
          processCrashRestartRequestAssistedOutboxRecovered: true,
          recoveryTrigger: "authorized GET /api/rooms/<id>/events?since=5",
          autonomousNoTrafficRecovery: "NOT RUN — CINE-018 dispatcher remains a separate gate",
          latencyMs: {
            samples: sorted.length,
            min: Number(sorted[0].toFixed(2)),
            p50: percentile(sorted, 50),
            p95: percentile(sorted, 95),
            p99: percentile(sorted, 99),
            max: Number(sorted[sorted.length - 1].toFixed(2)),
          },
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("--- INSTANCE 1 LOGS ---\n" + (proc1?.getLogs() || ""));
    console.error("--- INSTANCE 2 LOGS ---\n" + (proc2?.getLogs() || ""));
    throw err;
  } finally {
    await Promise.allSettled(wsClients.map((c) => c.removeAllChannels()));
    await Promise.allSettled(
      wsClients.map((c) => Promise.race([c.realtime.disconnect(), new Promise((r) => setTimeout(r, 250))]))
    );
    await stopChild(proc1);
    await stopChild(proc2);
    if (createdRoomIds.length > 0) {
      await db.query("UPDATE public.rooms SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 second' WHERE id = ANY($1::uuid[])", [createdRoomIds]);
      await db.query("DELETE FROM public.rooms WHERE id = ANY($1::uuid[])", [createdRoomIds]);
      const leftover = await db.query("SELECT count(*)::int AS cnt FROM public.rooms WHERE id = ANY($1::uuid[])", [createdRoomIds]);
      assert.equal(leftover.rows[0].cnt, 0, "Teardown must remove temporary qualification rooms");
    }
    await db.end().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main()
  .catch((error) => {
    console.error("Two-instance qualification failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
