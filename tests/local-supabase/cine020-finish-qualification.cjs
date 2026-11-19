/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
/**
 * CINE-020 Real Two-Instance Next.js + PostgreSQL + Realtime Qualification Suite.
 *
 * Tests an explicit exact app commit archived cleanly via `git archive` and `npm ci`:
 *   K. Exhausted 20-card round -> secret vote hiding -> host-only guard -> concurrent retry race ->
 *      idempotent operationId replay -> filtered Round 2 convergence across 2 instances & Realtime -> MATCHED.
 *   L. 90s disconnect grace during ACTIVE -> <90s reconnect without duplicate member/vote -> >90s host loss
 *      deterministic handoff & round cancellation (LOBBY) across 2 instances -> zero split-brain (403) ->
 *      ROUND_CANCELLED stale vote rejection (409) -> safe post-vote leave -> Round 2 frozenQuorum = 2.
 *   M. 24h TTL expiry across LOBBY/ACTIVE/MATCHED/EXHAUSTED -> 410 ROOM_EXPIRED across all endpoints & both
 *      instances -> permanent realtime client shutdown -> idempotent PG retention-compliant cleanup.
 *
 * Usage:
 *   node tests/local-supabase/cine020-finish-qualification.cjs --app-commit <full 40-char SHA> [--env-file <path>] [--evidence <path>]
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const PG_MODULE_PATH = fs.existsSync(path.join(REPO_ROOT, "node_modules/pg"))
  ? path.join(REPO_ROOT, "node_modules/pg")
  : path.join(REPO_ROOT, "scripts/local-supabase/node_modules/pg");
const { Client, Pool } = require(PG_MODULE_PATH);
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { validateCommit, assertNoCloudTargetEnv } = require("../../scripts/local-supabase/safety.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("../../scripts/local-supabase/generate-env.cjs");
const base = require("./two-instance-qualification.cjs");

const PORT_1 = 3121;
const PORT_2 = 3122;
const REAL_GATEWAY_PORT = 54321;
const SEED_ROOMS = ["00000000-0000-4000-8000-000000005201", "00000000-0000-4000-8000-000000005202"];

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.log(`[CINE020 ${new Date().toISOString().slice(11, 23)}]`, ...parts);

async function waitUntil(check, timeoutMs, label, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await sleep(stepMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}

function writeCinemaniaTmdbPreload(filePath) {
  const mkMovies = (offset) =>
    JSON.stringify({
      page: 1,
      total_pages: 1,
      total_results: 20,
      results: Array.from({ length: 20 }, (_, i) => ({
        id: offset + i,
        title: `CINE020 PG Film ${offset + i}`,
        original_title: `CINE020 PG Film ${offset + i}`,
        poster_path: `/cine020_${offset + i}.jpg`,
        overview: `Synthetic PG qualification movie ${offset + i}`,
        release_date: "2026-02-01",
        vote_average: 7.9,
        adult: false,
      })),
    });
  const defaultPayload = mkMovies(910001);
  const genre28Payload = mkMovies(920001);
  const genre35Payload = mkMovies(930001);

  const script = `/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
const https = require("node:https");
const http = require("node:http");
const { PassThrough } = require("node:stream");
const DEFAULT_PAYLOAD = ${JSON.stringify(defaultPayload)};
const GENRE_28_PAYLOAD = ${JSON.stringify(genre28Payload)};
const GENRE_35_PAYLOAD = ${JSON.stringify(genre35Payload)};
function mockDiscover(opts, cb) {
  const rawUrl = typeof opts === "string" ? opts : opts instanceof URL ? opts.toString() : String(opts?.path || "");
  const payload = rawUrl.includes("with_genres=28")
    ? GENRE_28_PAYLOAD
    : rawUrl.includes("with_genres=35")
      ? GENRE_35_PAYLOAD
      : DEFAULT_PAYLOAD;
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
    res.push(payload);
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
  return raw.replace(/:\\d+$/, "");
}
function isTmdbTarget(options) { return getTargetHost(options) === "api.themoviedb.org"; }
function isLoopbackOrSocket(options) {
  if (options && typeof options === "object" && !(options instanceof URL) && options.socketPath && !options.hostname && !options.host) return true;
  const host = getTargetHost(options);
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
const origHttpsReq = https.request;
https.request = function(urlOrOpts, optsOrCb, maybeCb) {
  const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
  if (isTmdbTarget(urlOrOpts)) return mockDiscover(urlOrOpts, cb);
  if (!isLoopbackOrSocket(urlOrOpts)) throw new Error("FAIL_CLOSED outbound https blocked: " + getTargetHost(urlOrOpts));
  return origHttpsReq.apply(this, arguments);
};
https.get = function(urlOrOpts, optsOrCb, maybeCb) {
  const req = https.request(urlOrOpts, optsOrCb, maybeCb);
  req.end();
  return req;
};
const origHttpReq = http.request;
http.request = function(urlOrOpts) {
  if (!isLoopbackOrSocket(urlOrOpts)) throw new Error("FAIL_CLOSED outbound http blocked: " + getTargetHost(urlOrOpts));
  return origHttpReq.apply(this, arguments);
};
`;
  fs.writeFileSync(filePath, script, "utf8");
}

function bundleTarget(instDir, outDir, entryCode, name, extraExternal = [], conditions = []) {
  const entry = path.join(instDir, `cine020-entry-${name}.ts`);
  fs.writeFileSync(entry, entryCode, "utf8");
  const outfile = path.join(outDir, `cine020-bundle-${name}.cjs`);
  require(path.join(REPO_ROOT, "node_modules/esbuild")).buildSync({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile,
    absWorkingDir: instDir,
    ...(conditions.length > 0 ? { conditions } : {}),
    external: ["node:*", ...extraExternal],
  });
  fs.rmSync(entry, { force: true });
  return outfile;
}

async function main() {
  assertNoCloudTargetEnv();
  assertLocalStack();

  const appCommit = flag("--app-commit") || execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  validateCommit(appCommit);
  execFileSync("git", ["-C", REPO_ROOT, "cat-file", "-e", `${appCommit}^{commit}`]);

  const envFile = flag("--env-file") || (fs.existsSync(STACK_ENV_PATH) ? STACK_ENV_PATH : "D:/projects/cinemania/supabase/.env.local");
  assert(fs.existsSync(envFile), `Local stack env file missing: ${envFile}`);
  const stackEnv = parseEnvFile(envFile);
  const databaseUrl = `postgresql://supabase_admin:${stackEnv.POSTGRES_PASSWORD}@127.0.0.1:55432/postgres`;
  const supabaseUrl = `http://127.0.0.1:${REAL_GATEWAY_PORT}`;
  const capabilitySecret = crypto.randomBytes(32).toString("hex");

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine020-pg-"));
  const buildDir = path.join(tempRoot, "app");
  const inst1Dir = path.join(tempRoot, "inst1");
  const inst2Dir = path.join(tempRoot, "inst2");
  const preloadPath = path.join(tempRoot, "tmdb-cine020-preload.cjs");
  const tarPath = path.join(tempRoot, "app.tar");

  const db = new Client({
    host: "127.0.0.1",
    port: 55432,
    user: "supabase_admin",
    password: stackEnv.POSTGRES_PASSWORD,
    database: "postgres",
    connectionTimeoutMillis: 5000,
  });
  const pool = new Pool({
    host: "127.0.0.1",
    port: 55432,
    user: "supabase_admin",
    password: stackEnv.POSTGRES_PASSWORD,
    database: "postgres",
    max: 5,
  });

  const evidence = {
    appCommit,
    environment: "local Docker PostgreSQL + Realtime (GH-52 stack, synthetic data)",
    startedAt: new Date().toISOString(),
    scenarios: [],
  };
  const createdRoomIds = [];
  const liveClients = new Set();
  let proc1 = null;
  let proc2 = null;
  let worker1 = null;
  let worker2 = null;
  let dbConnected = false;

  try {
    fs.mkdirSync(buildDir, { recursive: true });
    execFileSync("git", ["-C", REPO_ROOT, "archive", "--format=tar", "-o", tarPath, appCommit]);
    execFileSync("tar", ["-xf", tarPath, "-C", buildDir]);
    fs.unlinkSync(tarPath);

    log("npm ci in exact-commit copy");
    if (process.platform === "win32") {
      execFileSync("cmd.exe", ["/d", "/s", "/c", "npm ci --prefer-offline --no-audit --no-fund --fetch-retries=0 --fetch-timeout=3000"], { cwd: buildDir, stdio: "pipe" });
    } else {
      execFileSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: buildDir, stdio: "pipe" });
    }
    fs.renameSync(buildDir, inst1Dir);
    log("replicating second instance copy");
    if (process.platform === "win32") {
      const rc = spawnSync("robocopy", [inst1Dir, inst2Dir, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NC", "/NS", "/NP", "/MT:16"], { stdio: "pipe" });
      if (rc.status === null || rc.status > 7) {
        throw new Error(`robocopy failed copying inst1 -> inst2 (status=${String(rc.status)})`);
      }
    } else {
      fs.cpSync(inst1Dir, inst2Dir, { recursive: true });
    }

    writeCinemaniaTmdbPreload(preloadPath);
    log("bundling realtime client and server store helpers");
    const clientCjs = bundleTarget(
      inst1Dir,
      inst1Dir,
      'export * from "./src/lib/realtime/roomRealtime";\nexport * from "./src/lib/realtime/roomActions";\n',
      "client"
    );
    const serverHelperCjs = bundleTarget(
      inst1Dir,
      inst1Dir,
      'export { RoomExpiryWorker, SystemClock } from "./src/lib/server/room/expiryWorker";\n' +
        'export { PostgresRoomAuthorityStore } from "./src/lib/server/room/roomStore";\n' +
        'export { mintGuestCapabilityToken, getGuestCookieName } from "./src/lib/server/auth/guestCapability";\n',
      "server-helper",
      ["pg", "node:sqlite"],
      ["react-server", "node"]
    );
    const Lib = require(clientCjs);
    const ServerHelper = require(serverHelperCjs);

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
      ALLOW_DESTRUCTIVE_PG_TESTS: "false",
    };

    const origin1 = `http://127.0.0.1:${PORT_1}`;
    const origin2 = `http://127.0.0.1:${PORT_2}`;
    proc1 = base.spawnNextInstance({ cwd: inst1Dir, port: PORT_1, env: { ...baseAppEnv, PORT: String(PORT_1) } });
    proc2 = base.spawnNextInstance({ cwd: inst2Dir, port: PORT_2, env: { ...baseAppEnv, PORT: String(PORT_2) } });
    await Promise.all([base.waitForServer(origin1, 120000), base.waitForServer(origin2, 120000)]);

    await db.connect();
    dbConnected = true;
    const unknownPre = await db.query("SELECT count(*)::int AS n FROM public.rooms WHERE id <> ALL($1::uuid[]);", [SEED_ROOMS]);
    assert.equal(unknownPre.rows[0].n, 0, "Refused: pre-existing non-seed rooms found on shared local stack");

    worker1 = base.spawnWorker({ cwd: inst1Dir, env: baseAppEnv });
    worker2 = base.spawnWorker({ cwd: inst2Dir, env: baseAppEnv });
    await Promise.all([base.waitForWorker(worker1), base.waitForWorker(worker2)]);

    const post = (origin, cookie, url, body, extraHeaders = {}) =>
      fetch(`${origin}${url}`, {
        method: "POST",
        headers: { origin, cookie: cookie ?? "", "content-type": "application/json", ...extraHeaders },
        body: JSON.stringify(body ?? {}),
      });
    const getSnap = async (origin, cookie, roomId) =>
      fetch(`${origin}/api/rooms/${roomId}`, { headers: { cookie } });
    const dbVersion = async (roomId) =>
      (await db.query("SELECT state_version FROM public.rooms WHERE id = $1;", [roomId])).rows[0].state_version;

    async function createRoom(size, tag) {
      const create = await post(origin1, "", "/api/rooms", { displayName: `${tag} Host` });
      assert.equal(create.status, 201);
      const created = await create.json();
      const roomId = created.room.roomId;
      createdRoomIds.push(roomId);
      const members = [
        { origin: origin1, cookie: base.extractCookieHeader(create), roomId, pid: created.viewer.participantId },
      ];
      for (let i = 1; i < size; i += 1) {
        await sleep(15);
        const origin = i % 2 ? origin2 : origin1;
        const join = await post(origin, "", "/api/rooms/join", { code: created.room.code, displayName: `${tag} Guest ${i}` });
        assert.equal(join.status, 200);
        const joined = await join.json();
        members.push({ origin, cookie: base.extractCookieHeader(join), roomId, pid: joined.viewer.participantId });
      }
      return { roomId, code: created.room.code, members };
    }

    async function startClients(room) {
      const clients = [];
      for (const m of room.members) {
        const rec = { versions: [], latest: null, statuses: [], handle: null };
        const fetcher = async (input, init = {}) => {
          const text = String(input);
          return fetch(text.startsWith("http") ? text : m.origin + text, {
            ...init,
            headers: { ...(init.headers || {}), cookie: m.cookie, origin: m.origin },
          });
        };
        rec.handle = await Lib.startRoomRealtime({
          roomId: room.roomId,
          supabaseUrl,
          publishableKey: stackEnv.ANON_KEY,
          fetcher,
          onSnapshot: (s) => {
            rec.versions.push(s.room.stateVersion);
            rec.latest = s;
          },
          onStatus: (s) => rec.statuses.push(s),
        });
        liveClients.add(rec);
        clients.push(rec);
      }
      return clients;
    }

    async function stopClients(clients) {
      for (const c of clients) {
        liveClients.delete(c);
        await c.handle().catch(() => {});
      }
    }

    async function converge(room, clients, label, timeoutMs = 15000) {
      const truth = await dbVersion(room.roomId);
      await waitUntil(() => clients.every((c) => c.versions.at(-1) === truth), timeoutMs, `${label} @ v${truth}`);
      return truth;
    }

    // ---------- Scenario K: EXHAUSTED -> Filtered Retry + Concurrent Race + Filtered Match across 2 Instances ----------
    log(">>> Scenario K: EXHAUSTED finish, secret-vote protection, concurrent retry race, idempotency & Round 2 MATCHED");
    const roomK = await createRoom(2, "K");
    const clientsK = await startClients(roomK);
    const startK1 = await post(origin1, roomK.members[0].cookie, `/api/rooms/${roomK.roomId}/start`, {});
    assert.equal(startK1.status, 200);
    const sK1 = await startK1.json();
    const rK1Id = sK1.room.currentRoundId;
    await converge(roomK, clientsK, "K after Round 1 start");

    for (let i = 0; i < sK1.room.deck.length; i += 1) {
      const card = sK1.room.deck[i];
      const v0 = await post(origin1, roomK.members[0].cookie, `/api/rooms/${roomK.roomId}/votes`, {
        roundId: rK1Id,
        candidateId: card.candidateId,
        movieId: card.movieId,
        vote: "LIKE",
        operationId: `k-r1-${i}-0`,
      });
      assert.equal(v0.status, 200);
      const v1 = await post(origin2, roomK.members[1].cookie, `/api/rooms/${roomK.roomId}/votes`, {
        roundId: rK1Id,
        candidateId: card.candidateId,
        movieId: card.movieId,
        vote: "SKIP",
        operationId: `k-r1-${i}-1`,
      });
      assert.equal(v1.status, 200);
    }

    await converge(roomK, clientsK, "K after EXHAUSTED");
    assert.equal(clientsK[0].latest.room.status, "EXHAUSTED");
    assert.equal(clientsK[1].latest.room.status, "EXHAUSTED");
    assert.equal(clientsK[1].latest.room.finishState.code, "DECK_EXHAUSTED");
    assert.equal(JSON.stringify(clientsK[1].latest.room).includes('"LIKE"'), false);
    assert.equal(JSON.stringify(clientsK[1].latest.room).includes('"SKIP"'), false);

    // Non-host guest cannot retry
    const guestRetry = await post(origin2, roomK.members[1].cookie, `/api/rooms/${roomK.roomId}/retry`, { startRound: false });
    assert.equal(guestRetry.status, 403);
    assert.equal((await guestRetry.json()).error, "HOST_ONLY_ACTION");

    // Concurrent host retry across Inst 1 & Inst 2 (both direct startRound=true with different operationIds)
    const [raceRetry1, raceRetry2] = await Promise.all([
      post(origin1, roomK.members[0].cookie, `/api/rooms/${roomK.roomId}/retry`, {
        startRound: true,
        deckFilter: { with_genres: "28" },
        operationId: "k-race-inst1",
      }),
      post(origin2, roomK.members[0].cookie, `/api/rooms/${roomK.roomId}/retry`, {
        startRound: true,
        deckFilter: { with_genres: "35" },
        operationId: "k-race-inst2",
      }),
    ]);
    assert.deepEqual([raceRetry1.status, raceRetry2.status].sort((a, b) => a - b), [200, 409]);
    const winnerRes = raceRetry1.status === 200 ? raceRetry1 : raceRetry2;
    const winningOp = raceRetry1.status === 200 ? "k-race-inst1" : "k-race-inst2";
    const winningGenre = raceRetry1.status === 200 ? "28" : "35";
    const winBody = await winnerRes.json();
    assert.equal(winBody.room.status, "ACTIVE");
    const expectedMinMovieId = winningGenre === "28" ? 920001 : 930001;
    const expectedMaxMovieId = expectedMinMovieId + 19;
    assert.equal(winBody.room.deck.length, 20);
    assert.equal(new Set(winBody.room.deck.map((c) => c.movieId)).size, 20);
    assert.equal(
      winBody.room.deck.every((c) => c.movieId >= expectedMinMovieId && c.movieId <= expectedMaxMovieId),
      true,
      `Expected filtered genre ${winningGenre} deck [${expectedMinMovieId}..${expectedMaxMovieId}], got first=${winBody.room.deck[0]?.movieId}`,
    );

    // Idempotent replay across the OTHER instance
    const replayRetry = await post(origin2, roomK.members[0].cookie, `/api/rooms/${roomK.roomId}/retry`, {
      startRound: true,
      deckFilter: { with_genres: winningGenre },
      operationId: winningOp,
    });
    assert.equal(replayRetry.status, 200);
    assert.equal((await replayRetry.json()).idempotentReplay, true);

    await converge(roomK, clientsK, "K after filtered retry start");
    const rK2Card0 = winBody.room.deck[0];
    const rK2Id = winBody.room.currentRoundId;
    await post(origin1, roomK.members[0].cookie, `/api/rooms/${roomK.roomId}/votes`, {
      roundId: rK2Id,
      candidateId: rK2Card0.candidateId,
      movieId: rK2Card0.movieId,
      vote: "LIKE",
    });
    await post(origin2, roomK.members[1].cookie, `/api/rooms/${roomK.roomId}/votes`, {
      roundId: rK2Id,
      candidateId: rK2Card0.candidateId,
      movieId: rK2Card0.movieId,
      vote: "LIKE",
    });
    await converge(roomK, clientsK, "K after Round 2 MATCHED");
    assert.equal(clientsK[0].latest.room.status, "MATCHED");
    assert.equal(clientsK[1].latest.room.matchedMovieId, rK2Card0.movieId);
    await stopClients(clientsK);
    evidence.scenarios.push({ id: "K", result: "PASS", roomId: roomK.roomId, finalVersion: await dbVersion(roomK.roomId) });
    log("<<< Scenario K PASS");

    // ---------- Scenario L: 90s Grace during ACTIVE, Deterministic Host Handoff & Round Cancel across 2 Instances ----------
    log(">>> Scenario L: 90s grace timeout, host handoff, round cancellation & zero split-brain");
    const roomL = await createRoom(3, "L");
    const clientsL = await startClients(roomL);
    const startL1 = await (await post(origin1, roomL.members[0].cookie, `/api/rooms/${roomL.roomId}/start`, {})).json();
    const rL1Id = startL1.room.currentRoundId;
    const lCard0 = startL1.room.deck[0];
    await converge(roomL, clientsL, "L after start");

    // Host votes once, then disconnects on Inst 2
    const hostVoteL = await post(origin1, roomL.members[0].cookie, `/api/rooms/${roomL.roomId}/votes`, {
      roundId: rL1Id,
      candidateId: lCard0.candidateId,
      movieId: lCard0.movieId,
      vote: "LIKE",
    });
    assert.equal(hostVoteL.status, 200);
    const discL = await post(origin2, roomL.members[0].cookie, `/api/rooms/${roomL.roomId}/presence`, { connected: false });
    assert.equal(discL.status, 200);

    // Quick disconnect + reconnect (< 90s) by Guest 2 must NOT cancel round or duplicate participant
    await post(origin1, roomL.members[2].cookie, `/api/rooms/${roomL.roomId}/presence`, { connected: false });
    await post(origin2, roomL.members[2].cookie, `/api/rooms/${roomL.roomId}/presence`, { connected: true });
    assert.equal((await db.query("SELECT status FROM public.rooms WHERE id = $1;", [roomL.roomId])).rows[0].status, "ACTIVE");

    // Shift Host's persisted last_seen_at past 90s in PG to simulate elapsed disconnect grace without sleeping 90s
    await db.query(
      "UPDATE public.room_participants SET last_seen_at = NOW() - INTERVAL '91 seconds' WHERE room_id = $1 AND participant_id = $2;",
      [roomL.roomId, roomL.members[0].pid]
    );

    // Guest 1 reads snapshot on Inst 2 -> lazy grace sweep triggers atomic host transfer + ACTIVE->LOBBY round cancellation
    const guest1SnapL = await getSnap(origin2, roomL.members[1].cookie, roomL.roomId);
    assert.equal(guest1SnapL.status, 200);
    const snapLBody = await guest1SnapL.json();
    assert.equal(snapLBody.room.status, "LOBBY");
    assert.equal(snapLBody.room.finishState.code, "ROUND_CANCELLED");
    assert.equal(snapLBody.viewer.role, "HOST");

    // Remaining connected clients converge via Realtime
    await waitUntil(
      () => clientsL[1].latest?.room?.status === "LOBBY" && clientsL[2].latest?.room?.status === "LOBBY",
      15000,
      "L remaining clients converge to LOBBY after cancel"
    );

    // Demoted former Host gets 403 HOST_ONLY_ACTION on Inst 1 (zero split-brain!)
    const staleHostStart = await post(origin1, roomL.members[0].cookie, `/api/rooms/${roomL.roomId}/start`, {});
    assert.equal(staleHostStart.status, 403);
    assert.equal((await staleHostStart.json()).error, "HOST_ONLY_ACTION");

    // Stale vote targeting cancelled Round 1 gets 409 ROUND_CANCELLED
    const lateVoteL = await post(origin2, roomL.members[2].cookie, `/api/rooms/${roomL.roomId}/votes`, {
      roundId: rL1Id,
      candidateId: lCard0.candidateId,
      movieId: lCard0.movieId,
      vote: "LIKE",
    });
    assert.equal(lateVoteL.status, 409);
    assert.equal((await lateVoteL.json()).error, "ROUND_CANCELLED");

    // Former Host with immutable R1 vote leaves in LOBBY safely -> capability revoked -> New Host + Guest 2 start Round 2 (quorum = 2)
    const oldLeaveL = await post(origin1, roomL.members[0].cookie, `/api/rooms/${roomL.roomId}/leave`, {});
    assert.equal(oldLeaveL.status, 200);
    assert.equal((await getSnap(origin2, roomL.members[0].cookie, roomL.roomId)).status, 401);

    const startL2 = await post(origin2, roomL.members[1].cookie, `/api/rooms/${roomL.roomId}/start`, {});
    assert.equal(startL2.status, 200);
    assert.equal((await startL2.json()).room.frozenQuorum, 2);

    await stopClients(clientsL);
    evidence.scenarios.push({ id: "L", result: "PASS", roomId: roomL.roomId, finalVersion: await dbVersion(roomL.roomId) });
    log("<<< Scenario L PASS");

    // ---------- Scenario M: 24h TTL Expiry Rejection (410) & Idempotent Cleanup across Both Instances ----------
    log(">>> Scenario M: 24h TTL expiry rejection (410), permanent client shutdown & idempotent cleanup");
    const pgStore = new ServerHelper.PostgresRoomAuthorityStore(pool);
    const worker = new ServerHelper.RoomExpiryWorker(86400, new ServerHelper.SystemClock());

    // Scope lifecycle expiry & cleanup strictly to synthetic rooms created by this run so seed/shared rooms are never touched.
    const scopedRoomIds = [...createdRoomIds];
    await db.query(
      "UPDATE public.rooms SET last_activity_at = NOW() - INTERVAL '25 hours', expires_at = NOW() - INTERVAL '1 hour' WHERE id = ANY($1::uuid[]);",
      [scopedRoomIds]
    );
    const expiryRes = await worker.processExpiredRooms(pgStore, { roomIds: scopedRoomIds });
    assert.equal(expiryRes.processedCount, 2);

    // Mint fresh valid 2h token for expired roomK host to prove 410 ROOM_EXPIRED (not just 401 token expiry)
    const freshTokenM = ServerHelper.mintGuestCapabilityToken({
      roomId: roomK.roomId,
      participantId: roomK.members[0].pid,
      role: "HOST",
      generation: 1,
      secret: capabilitySecret,
    });
    const freshCookieM = `${ServerHelper.getGuestCookieName(roomK.roomId)}=${freshTokenM.token}`;

    const checks410 = await Promise.all([
      getSnap(origin1, freshCookieM, roomK.roomId),
      getSnap(origin2, freshCookieM, roomK.roomId),
      post(origin1, "", "/api/rooms/join", { code: roomK.code, displayName: "LateM" }),
      post(origin2, freshCookieM, `/api/rooms/${roomK.roomId}/presence`, { connected: true }),
      post(origin1, freshCookieM, `/api/rooms/${roomK.roomId}/retry`, { startRound: false }),
      post(origin2, freshCookieM, `/api/rooms/${roomK.roomId}/start`, {}),
      post(origin1, freshCookieM, `/api/rooms/${roomK.roomId}/votes`, { candidateId: crypto.randomUUID(), movieId: 1, vote: "LIKE" }),
      post(origin2, freshCookieM, `/api/rooms/${roomK.roomId}/leave`, {}),
    ]);
    for (const r of checks410) {
      assert.equal(r.status, 410, `Expected 410 ROOM_EXPIRED on expired room, got ${r.status}`);
      assert.equal((await r.json()).error, "ROOM_EXPIRED");
    }

    // Expired token rejection (401 CAPABILITY_EXPIRED)
    const expTokenM = ServerHelper.mintGuestCapabilityToken({
      roomId: roomK.roomId,
      participantId: roomK.members[0].pid,
      role: "HOST",
      generation: 1,
      nowMs: Date.now() - 8000 * 1000,
      ttlSeconds: 300,
      secret: capabilitySecret,
    });
    const expTokenRes = await getSnap(origin1, `${ServerHelper.getGuestCookieName(roomK.roomId)}=${expTokenM.token}`, roomK.roomId);
    assert.equal(expTokenRes.status, 401);
    assert.equal((await expTokenRes.json()).error, "CAPABILITY_EXPIRED");

    // Idempotent PG cleanup removes only our expired synthetic rooms and leaves seed rooms untouched
    const clean1 = await worker.cleanupExpiredRooms(pgStore, { roomIds: scopedRoomIds });
    assert.deepEqual(clean1.purgedRoomIds.sort(), [...scopedRoomIds].sort());
    const clean2 = await worker.cleanupExpiredRooms(pgStore, { roomIds: scopedRoomIds });
    assert.equal(clean2.purgedCount, 0);
    const seedCheck = await db.query(
      "SELECT id::text, status::text FROM public.rooms WHERE id = ANY($1::uuid[]) ORDER BY id ASC;",
      [SEED_ROOMS]
    );
    assert.deepEqual(seedCheck.rows.map((r) => [r.id, r.status]), [
      [SEED_ROOMS[0], "LOBBY"],
      [SEED_ROOMS[1], "ACTIVE"],
    ]);
    createdRoomIds.length = 0;

    evidence.scenarios.push({ id: "M", result: "PASS", purgedCount: clean1.purgedCount, idempotentSecondPass: clean2.purgedCount });
    evidence.allPass = true;
    evidence.finishedAt = new Date().toISOString();

    const out = flag("--evidence");
    if (out) fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    log("<<< Scenario M PASS — ALL CINE-020 PG QUALIFICATION GATES PASS");
  } finally {
    for (const c of [...liveClients]) {
      await c.handle().catch(() => {});
    }
    await Promise.all([base.stopChild(worker1), base.stopChild(worker2)]);
    await Promise.all([base.stopChild(proc1), base.stopChild(proc2)]);
    if (dbConnected) {
      if (createdRoomIds.length > 0) {
        await db.query("UPDATE public.rooms SET status = 'EXPIRED', expires_at = NOW() - INTERVAL '1 second' WHERE id = ANY($1::uuid[]);", [createdRoomIds]).catch(() => {});
        await db.query("DELETE FROM public.rooms WHERE id = ANY($1::uuid[]);", [createdRoomIds]).catch(() => {});
      }
      const leftover = await db.query("SELECT count(*)::int AS n FROM public.rooms WHERE id <> ALL($1::uuid[]);", [SEED_ROOMS]).catch(() => ({ rows: [{ n: -1 }] }));
      assert.equal(leftover.rows[0].n, 0, "Teardown must leave zero non-seed synthetic rooms");
      await db.end().catch(() => {});
    }
    await pool.end().catch(() => {});
    if (process.platform === "win32") {
      spawnSync("cmd.exe", ["/d", "/s", "/c", "rmdir", "/s", "/q", tempRoot], { stdio: "ignore" });
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("CINE-020 two-instance qualification failed:", err);
  process.exitCode = 1;
});
