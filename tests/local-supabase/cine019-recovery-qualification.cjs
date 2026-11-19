/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";
/**
 * CINE-019 real-service qualification: reconnect, concurrent actions and idempotency.
 *
 * Runs the REAL product client (src/lib/realtime/*, bundled from the exact commit) against the
 * GH-52 local Docker Supabase stack (real Realtime, real PostgreSQL) with two independent Next.js
 * instances and 2..5 synthetic clients per room. Network loss is injected with a local TCP proxy
 * in front of the Realtime gateway (hard socket destruction), process interruption by SIGKILL of
 * app instances and outbox workers, and tab freezing by Chromium's CDP lifecycle freeze.
 *
 *   node tests/local-supabase/cine019-recovery-qualification.cjs --app-commit <full SHA> [--evidence <file>] [--only A,C]
 *
 * Synthetic data only. Local by default (refuses a stack with rooms other than the two GH-52 seeds). With
 * --hosted-staging it runs against the owner-designated staging project instead: that needs fresh consent in the
 * invocation (CINE018_STAGING_PROJECT) exactly like the CINE-018 harness, refuses a non-empty application, never
 * resets or reconfigures the project, and deletes only the rooms it created. Network loss is then injected by an
 * in-process WebSocket wrapper (a TCP proxy cannot front TLS).
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const { Client } = require(path.resolve(REPO_ROOT, "scripts/local-supabase/node_modules/pg"));
const { assertLocalStack } = require("../../scripts/local-supabase/runtime.cjs");
const { validateCommit, assertNoCloudTargetEnv } = require("../../scripts/local-supabase/safety.cjs");
const { parseEnvFile, STACK_ENV_PATH } = require("../../scripts/local-supabase/generate-env.cjs");
const base = require("./two-instance-qualification.cjs");
const { loadHostedStaging, assertEmptyHostedApplication } = require("../hosted-supabase/environment.cjs");

const PORT_1 = 3111;
const PORT_2 = 3112;
const PROXY_PORT = 54399;
const REAL_GATEWAY_PORT = 54321;
const ALL_SCENARIOS = ["A", "B", "I", "H", "C", "D", "E", "F", "G", "J"];
const SEED_ROOMS = ["00000000-0000-4000-8000-000000005201", "00000000-0000-4000-8000-000000005202"];

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null; };
const ONLY = (flag("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => console.error(`[${new Date().toISOString().slice(11, 23)}]`, ...parts);

async function waitUntil(check, timeoutMs, label, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last; } catch (error) { last = error; }
    await sleep(stepMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}${last instanceof Error ? `: ${last.message}` : ""}`);
}

/** Local TCP proxy to the Realtime gateway so connectivity can be cut without touching shared containers. */
function startProxy() {
  const sockets = new Set();
  let blocked = false;
  const server = net.createServer((client) => {
    if (blocked) { client.destroy(); return; }
    const upstream = net.connect(REAL_GATEWAY_PORT, "127.0.0.1");
    sockets.add(client); sockets.add(upstream);
    const closeBoth = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on("error", closeBoth); upstream.on("error", closeBoth);
    client.on("close", closeBoth); upstream.on("close", closeBoth);
    client.pipe(upstream); upstream.pipe(client);
  });
  return new Promise((resolve) => server.listen(PROXY_PORT, "127.0.0.1", () => resolve({
    cut() { blocked = true; for (const socket of [...sockets]) socket.destroy(); sockets.clear(); },
    restore() { blocked = false; },
    close: () => new Promise((done) => { blocked = true; for (const s of sockets) s.destroy(); server.close(() => done()); }),
  })));
}

/**
 * Hosted staging only: the project's session pooler allows 15 sessions in total (EMAXCONNSESSION) while each Next
 * route bundle builds its own pg Pool (max 10). This preload, injected into the app processes of the HARNESS only,
 * clamps every pg Pool to 3 connections with a 2 s idle timeout so the two-instance topology fits the budget.
 * Product code is untouched; the clamp is recorded in the evidence.
 */
function writePoolClampPreload(filePath) {
  fs.writeFileSync(filePath, `"use strict";
const Module = require("node:module");
const originalLoad = Module._load;
const CLAMP_MAX = 3;
Module._load = function (request, parent, isMain) {
  const loaded = originalLoad.apply(this, arguments);
  if (/^pg(-[0-9a-f]+)?$/.test(request) && loaded && loaded.Pool && !loaded.__cine019Clamped) {
    const NativePool = loaded.Pool;
    const ClampedPool = class extends NativePool {
      constructor(config) { super({ ...(config || {}), max: Math.min((config && config.max) || 10, CLAMP_MAX), idleTimeoutMillis: 2000 }); }
    };
    try { loaded.Pool = ClampedPool; Object.defineProperty(loaded, "__cine019Clamped", { value: true }); } catch { /* frozen export */ }
  }
  return loaded;
};
`, "utf8");
}

/** In-process network fault injection for TLS endpoints: closes live sockets and fails new ones until restored. */
function installWebSocketFaults() {
  const Native = globalThis.WebSocket;
  const sockets = new Set();
  let blocked = false;
  class FaultySocket extends Native {
    constructor(url, protocols) {
      super(blocked ? "ws://127.0.0.1:9/cine019-blocked" : url, protocols);
      sockets.add(this);
      this.addEventListener("close", () => sockets.delete(this));
    }
  }
  globalThis.WebSocket = FaultySocket;
  return {
    cut() { blocked = true; for (const socket of [...sockets]) { try { socket.close(); } catch { /* already closing */ } } },
    restore() { blocked = false; },
    close: async () => { blocked = false; globalThis.WebSocket = Native; },
  };
}

function bundleClient(instDir, tempRoot, format, platform, name) {
  const entry = path.join(instDir, `cine019-entry-${name}.ts`);
  fs.writeFileSync(entry, 'export * from "./src/lib/realtime/roomRealtime";\nexport * from "./src/lib/realtime/roomActions";\n');
  const outfile = path.join(tempRoot, `client-${name}.${format === "iife" ? "js" : "cjs"}`);
  require(path.join(REPO_ROOT, "node_modules/esbuild")).buildSync({
    entryPoints: [entry], bundle: true, format, platform, outfile, absWorkingDir: instDir,
    ...(format === "iife" ? { globalName: "CineClient" } : {}),
  });
  fs.rmSync(entry, { force: true });
  return outfile;
}

function assertStrictlyIncreasing(versions, label) {
  for (let i = 1; i < versions.length; i++) {
    assert(versions[i] > versions[i - 1], `${label}: delivered versions must strictly increase, saw [${versions.join(",")}]`);
  }
}

async function main() {
  const hosted = argv.includes("--hosted-staging") ? loadHostedStaging() : null;
  if (!hosted) { assertNoCloudTargetEnv(); assertLocalStack(); }
  const appCommit = flag("--app-commit") || execFileSync("git", ["-C", REPO_ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  validateCommit(appCommit);
  execFileSync("git", ["-C", REPO_ROOT, "cat-file", "-e", `${appCommit}^{commit}`]);

  const stackEnv = hosted ? hosted.stackEnv : parseEnvFile(STACK_ENV_PATH);
  const databaseUrl = hosted ? "" : `postgresql://supabase_admin:${stackEnv.POSTGRES_PASSWORD}@127.0.0.1:55432/postgres`;
  const realSupabaseUrl = hosted ? hosted.url : `http://127.0.0.1:${REAL_GATEWAY_PORT}`;
  const proxiedSupabaseUrl = hosted ? hosted.url : `http://127.0.0.1:${PROXY_PORT}`;
  const hostedHostname = hosted ? new URL(hosted.url).hostname : "";
  const capabilitySecret = crypto.randomBytes(32).toString("hex");
  // --keep-dir reuses an already prepared exact-commit copy (debugging only; never deleted).
  const keepDir = flag("--keep-dir");
  const tempRoot = keepDir ? path.resolve(keepDir) : fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine019-"));
  if (keepDir) fs.mkdirSync(tempRoot, { recursive: true });
  const reuse = Boolean(keepDir) && fs.existsSync(path.join(tempRoot, "inst2", "package.json"));
  const debugClientFromWorktree = argv.includes("--client-from-worktree"); // NOT qualification evidence
  const buildDir = path.join(tempRoot, "app");
  const inst1Dir = path.join(tempRoot, "inst1");
  const inst2Dir = path.join(tempRoot, "inst2");
  const preloadPath = path.join(tempRoot, "tmdb-offline-preload.cjs");
  const tarPath = path.join(tempRoot, "app.tar");

  const db = new Client(hosted ? { ...hosted.pgConfig, connectionTimeoutMillis: 30000 } : { host: "127.0.0.1", port: 55432, user: "supabase_admin", password: stackEnv.POSTGRES_PASSWORD, database: "postgres", connectionTimeoutMillis: 5000 });
  const evidence = { skipped: [], appCommit, environment: hosted ? `hosted staging ${hosted.project} (synthetic data)` : "local Docker (GH-52 stack, synthetic data)", startedAt: new Date().toISOString(), scenarios: [] };
  const createdRoomIds = [];
  const writeEvidence = () => {
    // A cleanup failure invalidates a PASS: the file must never say allPass while staging/local rooms remain.
    if (evidence.cleanup && evidence.cleanup.result === "FAIL") evidence.allPass = false;
    const out = flag("--evidence");
    if (out) fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
  };
  const liveMembers = new Set();
  let proc1 = null, proc2 = null, worker1 = null, worker2 = null, proxy = null, browser = null;
  let baseAppEnv, origin1, origin2;

  const startInstance = (n) => {
    const proc = base.spawnNextInstance({ cwd: n === 1 ? inst1Dir : inst2Dir, port: n === 1 ? PORT_1 : PORT_2, env: { ...baseAppEnv, PORT: String(n === 1 ? PORT_1 : PORT_2) } });
    if (n === 1) proc1 = proc; else proc2 = proc;
    return proc;
  };
  const startWorker = async (n) => {
    const w = base.spawnWorker({ cwd: n === 1 ? inst1Dir : inst2Dir, env: baseAppEnv });
    if (n === 1) worker1 = w; else worker2 = w;
    await base.waitForWorker(w);
  };

  try {
    if (!reuse) {
      fs.mkdirSync(buildDir, { recursive: true });
      execFileSync("git", ["-C", REPO_ROOT, "archive", "--format=tar", "-o", tarPath, appCommit]);
      execFileSync("tar", ["-xf", tarPath, "-C", buildDir]);
      fs.unlinkSync(tarPath);
      log("npm ci in exact-commit copy");
      if (process.platform === "win32") execFileSync("cmd.exe", ["/d", "/s", "/c", "npm ci --prefer-offline --no-audit --no-fund"], { cwd: buildDir, stdio: "pipe" });
      else execFileSync("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], { cwd: buildDir, stdio: "pipe" });
      fs.renameSync(buildDir, inst1Dir);
      fs.cpSync(inst1Dir, inst2Dir, { recursive: true });
    } else { log("reusing prepared copy", tempRoot); evidence.nonQualifying = "prepared copy reused via --keep-dir; not verified against --app-commit"; }
    base.writeHermeticTmdbPreload(preloadPath, hostedHostname);
    const poolClampPath = path.join(tempRoot, "pg-pool-clamp-preload.cjs");
    if (hosted) { writePoolClampPreload(poolClampPath); evidence.hostedTopology = { sessionPoolerLimit: 15, appPoolMax: 3, appPoolIdleMs: 2000, workers: 1, maxRequestsInFlightScenarioA: 4, otherBurstsUnbounded: true, appInstances: 2 }; }
    const bundleRoot = debugClientFromWorktree ? REPO_ROOT : inst1Dir;
    const clientCjs = bundleClient(bundleRoot, tempRoot, "cjs", "node", "node");
    const clientIife = bundleClient(bundleRoot, tempRoot, "iife", "browser", "browser");
    const Lib = require(clientCjs);
    if (debugClientFromWorktree) evidence.nonQualifying = "client bundled from the working tree, not the exact commit";

    baseAppEnv = {
      ...process.env, NODE_ENV: "development", CINEMATCH_ALLOW_LOCAL_REALTIME: "true",
      DATABASE_URL: databaseUrl, SUPABASE_URL: realSupabaseUrl, SUPABASE_SECRET_KEY: stackEnv.SERVICE_ROLE_KEY,
      SUPABASE_JWT_SECRET: stackEnv.JWT_SECRET, CINEMATCH_CAPABILITY_SECRET: capabilitySecret,
      TMDB_API_RAT: "synthetic-local-tmdb-rat", IPINFO_TOKEN: "synthetic-local-ipinfo", YOUTUBE_API_KEY: "synthetic-local-youtube",
      NEXT_PUBLIC_TMDB_POSTER_URL: "https://image.tmdb.org/t/p", NEXT_PUBLIC_IMAGE_BASE_URL: "https://image.tmdb.org/t/p",
      NODE_OPTIONS: `--require ${preloadPath}${hosted ? ` --require ${poolClampPath}` : ""}`, ALLOW_DESTRUCTIVE_PG_TESTS: "false",
      ...(hosted ? hosted.appEnv : {}),
    };
    origin1 = `http://127.0.0.1:${PORT_1}`;
    origin2 = `http://127.0.0.1:${PORT_2}`;
    startInstance(1); startInstance(2);
    await Promise.all([base.waitForServer(origin1, 120000), base.waitForServer(origin2, 120000)]);
    {
      const t0 = Date.now();
      try { await db.connect(); log("database connected in", Date.now() - t0, "ms"); }
      catch (error) { log("database connect failed after", Date.now() - t0, "ms:", String(error && error.message).slice(0, 160)); throw error; }
    }
    if (hosted) await assertEmptyHostedApplication(db);
    const unknown = await db.query("SELECT count(*)::int AS n FROM public.rooms WHERE id <> ALL($1::uuid[])", [SEED_ROOMS]);
    assert.equal(unknown.rows[0].n, 0, "Synthetic-only qualification refused: unknown existing rooms (another run may be using the stack)");
    // The staging session pooler allows 15 sessions in total (EMAXCONNSESSION): hosted runs use ONE worker.
    await Promise.all(hosted ? [startWorker(1)] : [startWorker(1), startWorker(2)]);
    proxy = hosted ? installWebSocketFaults() : await startProxy();

    // ---------- helpers bound to the running stack ----------
    const post = (origin, cookie, url, body) => fetch(`${origin}${url}`, { method: "POST", headers: { origin, cookie: cookie ?? "", "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
    const patch = (origin, cookie, url, body) => fetch(`${origin}${url}`, { method: "PATCH", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const getSnap = async (member) => (await fetch(`${member.origin}/api/rooms/${member.roomId}`, { headers: { cookie: member.cookie } })).json();
    const dbVersion = async (roomId) => (await db.query("SELECT state_version FROM public.rooms WHERE id=$1", [roomId])).rows[0].state_version;

    async function createRoom(size, tag) {
      const create = await post(origin1, "", "/api/rooms", { displayName: `${tag} host` });
      assert.equal(create.status, 201);
      const room = (await create.json()).room;
      createdRoomIds.push(room.roomId);
      const members = [{ cookie: base.extractCookieHeader(create), origin: origin1, roomId: room.roomId }];
      for (let i = 1; i < size; i++) {
        const origin = i % 2 ? origin2 : origin1;
        const join = await post(origin, "", "/api/rooms/join", { code: room.code, displayName: `${tag} member ${i}` });
        assert.equal(join.status, 200);
        members.push({ cookie: base.extractCookieHeader(join), origin, roomId: room.roomId });
      }
      return { roomId: room.roomId, code: room.code, members };
    }

    function makeClient(member, { tuning, supabaseUrl = proxiedSupabaseUrl, label }) {
      const rec = { label, versions: [], statuses: [], errors: [], tokenRequests: 0, snapshotRequests: 0, handle: null, latest: null };
      const fetcher = async (input, init = {}) => {
        const text = String(input);
        if (text.endsWith("/realtime-token")) rec.tokenRequests++;
        else if (text.endsWith(member.roomId)) rec.snapshotRequests++;
        return fetch(text.startsWith("http") ? text : member.origin + text, { ...init, headers: { ...(init.headers || {}), cookie: member.cookie, origin: member.origin } });
      };
      rec.start = async () => {
        rec.handle = await Lib.startRoomRealtime({
          roomId: member.roomId, supabaseUrl, publishableKey: stackEnv.ANON_KEY, fetcher, tuning,
          onSnapshot: (s) => { rec.versions.push(s.room.stateVersion); rec.latest = s; },
          onError: (e) => { rec.errors.push(e.code || e.message); if (process.env.CINE019_DEBUG) log(label, "error", e.code || e.message, e.status ?? ""); },
          onStatus: (s) => { rec.statuses.push(s); if (process.env.CINE019_DEBUG) log(label, "status", s); },
        });
        liveMembers.add(rec);
        return rec;
      };
      rec.stop = async () => { liveMembers.delete(rec); if (rec.handle) await rec.handle().catch(() => {}); };
      rec.actions = () => Lib.createRoomActions({ roomId: member.roomId, fetcher, accept: (s) => rec.handle.accept(s), resync: () => rec.handle.resync() });
      return rec;
    }

    async function startClients(room, opts) {
      const clients = room.members.map((m, i) => makeClient(m, { ...opts, label: `${opts.label}-${i}` }));
      await Promise.all(clients.map((c) => c.start()));
      return clients;
    }
    async function converge(room, clients, timeoutMs, label) {
      const truth = await dbVersion(room.roomId);
      await waitUntil(() => clients.every((c) => c.versions.at(-1) === truth), timeoutMs, `${label}: all clients at DB version ${truth}`);
      for (const c of clients) assertStrictlyIncreasing(c.versions, `${label}/${c.label}`);
      return truth;
    }
    const allLive = (clients, label) => waitUntil(() => clients.every((c) => c.handle.status() === "live"), 40000, `${label}: every client reports live`, 250);
    async function startRound(room) {
      const res = await post(room.members[0].origin, room.members[0].cookie, `/api/rooms/${room.roomId}/start`, {});
      assert.equal(res.status, 200, `start expected 200 got ${res.status}`);
      const snap = await getSnap(room.members[0]);
      assert.equal(snap.room.deck.length, 20);
      return { roundId: snap.room.currentRoundId, deck: snap.room.deck };
    }
    const voteBody = (round, card, vote, operationId) => ({ roundId: round.roundId, candidateId: card.candidateId, movieId: card.movieId, vote, operationId });
    // Hosted staging: at most 4 requests in flight at once (session pooler cap 15 = 2 apps + worker + harness + clients).
    const burstLimit = hosted ? 4 : Infinity;
    async function runLimited(thunks, limit) {
      const results = new Array(thunks.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(limit, thunks.length) }, async () => {
        while (next < thunks.length) { const i = next++; results[i] = await thunks[i](); }
      }));
      return results;
    }
    const castVote = (member, body) => post(member.origin, member.cookie, `/api/rooms/${member.roomId}/votes`, body);
    async function dbCounts(roomId) {
      const q = async (sql) => (await db.query(sql, [roomId])).rows[0].n;
      return {
        participants: await q("SELECT count(*)::int n FROM public.room_participants WHERE room_id=$1"),
        votes: await q("SELECT count(*)::int n FROM public.votes WHERE room_id=$1"),
        frozen: await q("SELECT count(*)::int n FROM public.round_participants WHERE room_id=$1"),
        rounds: await q("SELECT count(*)::int n FROM public.rounds WHERE room_id=$1"),
        matchEvents: await q("SELECT count(*)::int n FROM public.room_events WHERE room_id=$1 AND event_type='MATCH_ANNOUNCED'"),
        version: await q("SELECT state_version::int n FROM public.rooms WHERE id=$1"),
      };
    }
    const scenarios = {};
    const run = async (id, title, fn) => {
      if (ONLY.length && !ONLY.includes(id)) { evidence.skipped.push(id); return; }
      const t0 = Date.now();
      log(`>>> ${id} ${title}`);
      const detail = await fn();
      const record = { id, title, result: "PASS", seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), ...detail };
      evidence.scenarios.push(record);
      log(`<<< ${id} PASS ${record.seconds}s`);
    };

    // A. Concurrent duplicate votes across two app instances (real PostgreSQL), 2..5 clients.
    scenarios.A = () => run("A", "concurrent duplicate votes across two instances; single authoritative MATCH", async () => {
      const sizes = {};
      for (const size of [2, 3, 4, 5]) {
        const room = await createRoom(size, `A${size}`);
        const clients = await startClients(room, { label: `A${size}` });
        const round = await startRound(room);
        await converge(room, clients, 15000, `A${size} after start`);
        const card = round.deck[0];
        const calls = [];
        room.members.forEach((member, i) => {
          const body = voteBody(round, card, "LIKE", `a-${size}-${i}`);
          for (const origin of [origin1, origin2, origin1]) calls.push(() => castVote({ ...member, origin }, body));
        });
        const responses = await runLimited(calls, burstLimit);
        if (!responses.every((r) => r.status === 200)) {
          // Error codes only (never bodies with data): the server returns { error, message } for failures.
          const detail = await Promise.all(responses.map(async (r) => r.status === 200 ? 200 : `${r.status}:${String((await r.clone().json().catch(() => ({}))).error ?? "?")}`));
          assert.fail(`all duplicate votes must be 200, got ${detail}`);
        }
        const bodies = await Promise.all(responses.map((r) => r.json()));
        assert.equal(bodies.filter((b) => b.idempotentReplay === false).length, size, "exactly one fresh vote per participant");
        const truth = await converge(room, clients, 20000, `A${size} after votes`);
        const counts = await dbCounts(room.roomId);
        assert.equal(counts.votes, size); assert.equal(counts.matchEvents, 1); assert.equal(counts.frozen, size); assert.equal(counts.rounds, 1);
        for (const c of clients) {
          assert.equal(c.latest.room.status, "MATCHED");
          assert.equal(c.latest.room.matchedMovieId, card.movieId);
          assert.equal(c.versions.filter((v) => v === truth).length, 1, "final state delivered exactly once");
        }
        sizes[size] = { finalVersion: truth, deliveredPerClient: clients.map((c) => c.versions) };
        await Promise.all(clients.map((c) => c.stop()));
      }
      return { sizes };
    });

    // B. Duplicate, stale and future hints delivered over real Realtime never repeat or regress state.
    scenarios.B = () => run("B", "duplicate/old/future hints are ignored", async () => {
      const room = await createRoom(2, "B");
      const clients = await startClients(room, { label: "B" });
      const round = await startRound(room);
      for (const [i, m] of room.members.entries()) assert.equal((await castVote(m, voteBody(round, round.deck[0], "LIKE", `b-${i}`))).status, 200);
      const truth = await converge(room, clients, 15000, "B matched");
      const before = clients.map((c) => c.versions.length);
      for (const version of [truth, truth - 1, truth, truth + 3]) {
        const sent = await fetch(`${realSupabaseUrl}/realtime/v1/api/broadcast/${encodeURIComponent(`room:${room.roomId}`)}/events/room_changed?private=true`, {
          method: "POST", headers: { apikey: stackEnv.SERVICE_ROLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ roomId: room.roomId, version }),
        });
        assert.equal(sent.ok, true);
      }
      await sleep(4000);
      clients.forEach((c, i) => { assert.equal(c.versions.length, before[i], "no extra snapshot delivery"); assert.equal(c.latest.room.status, "MATCHED"); });
      await Promise.all(clients.map((c) => c.stop()));
      return { replayedVersions: [truth, truth - 1, truth, truth + 3] };
    });

    // C. Short network loss: events missed while disconnected are recovered by the client alone.
    scenarios.C = () => run("C", "network loss and reconnect (short)", async () => {
      const room = await createRoom(3, "C");
      const clients = await startClients(room, { label: "C" });
      const round = await startRound(room);
      await converge(room, clients, 15000, "C after start");
      const tokenBefore = clients.map((c) => c.tokenRequests);
      proxy.cut();
      await sleep(1500);
      for (const [i, m] of room.members.entries()) assert.equal((await castVote(m, voteBody(round, round.deck[0], "SKIP", `c-${i}`))).status, 200);
      assert.equal((await castVote(room.members[0], voteBody(round, round.deck[1], "LIKE", "c-next"))).status, 200);
      await sleep(2000);
      proxy.restore();
      const truth = await converge(room, clients, 45000, "C after reconnect");
      for (const c of clients) {
        assert(c.statuses.includes("reconnecting") || c.statuses.includes("degraded"), `${c.label} must have reported the outage: ${c.statuses}`);
      }
      await allLive(clients, "C");
      await Promise.all(clients.map((c) => c.stop()));
      return { finalVersion: truth, statuses: clients.map((c) => c.statuses), tokenRenewalsDuringRecovery: clients.map((c, i) => c.tokenRequests - tokenBefore[i]) };
    });

    // D. Outage longer than the 60 s JWT lifetime: the closed private channel must be replaced, not revived.
    scenarios.D = () => run("D", "outage longer than JWT lifetime", async () => {
      const room = await createRoom(4, "D");
      const clients = await startClients(room, { label: "D" });
      const round = await startRound(room);
      await converge(room, clients, 15000, "D after start");
      const tokenBefore = clients.map((c) => c.tokenRequests);
      proxy.cut();
      await sleep(30000);
      for (const [i, m] of room.members.entries()) assert.equal((await castVote(m, voteBody(round, round.deck[0], "SKIP", `d-${i}`))).status, 200);
      await sleep(45000); // total outage ~75 s > 60 s token lifetime
      proxy.restore();
      const truth = await converge(room, clients, 60000, "D after long outage");
      for (const c of clients) assert(c.tokenRequests > tokenBefore[clients.indexOf(c)], "capability must have been renewed");
      await allLive(clients, "D");
      // The recovered channel must deliver hints again (not only polled snapshots): disable nothing, just mutate and time it.
      const t0 = Date.now();
      assert.equal((await castVote(room.members[0], voteBody(round, round.deck[1], "LIKE", "d-live"))).status, 200);
      const live = await dbVersion(room.roomId);
      await waitUntil(() => clients.every((c) => c.versions.at(-1) === live), 10000, "D post-recovery live delivery");
      await Promise.all(clients.map((c) => c.stop()));
      return { finalVersion: truth, postRecoveryDeliveryMs: Date.now() - t0, statuses: clients.map((c) => c.statuses) };
    });

    // E. Idle across more than two JWT lifetimes with polling disabled: only live hints can deliver.
    scenarios.E = () => run("E", "idle across JWT expiry, hint-only delivery", async () => {
      const room = await createRoom(2, "E");
      const clients = await startClients(room, { label: "E", tuning: { pollMs: 3_600_000 } });
      const round = await startRound(room);
      await converge(room, clients, 15000, "E after start");
      const tokenBefore = clients.map((c) => c.tokenRequests);
      await sleep(135000);
      for (const c of clients) assert.deepEqual(c.statuses, ["live"], `${c.label} must stay live through token rotations (no flap): ${c.statuses}`);
      for (const c of clients) assert(c.tokenRequests - tokenBefore[clients.indexOf(c)] >= 3, `${c.label} must renew about every 30 s`);
      const t0 = Date.now();
      assert.equal((await castVote(room.members[0], voteBody(round, round.deck[0], "LIKE", "e-0"))).status, 200);
      const live = await dbVersion(room.roomId);
      await waitUntil(() => clients.every((c) => c.versions.at(-1) === live), 8000, "E hint delivery after 135 s idle");
      const latencyMs = Date.now() - t0;
      await Promise.all(clients.map((c) => c.stop()));
      return { idleSeconds: 135, renewals: clients.map((c, i) => c.tokenRequests - tokenBefore[i]), hintDeliveryMs: latencyMs, statusesDuringIdle: clients.map((c) => c.statuses.filter((s) => s !== "closed")) };
    });

    // F. Process interruption: app instance 1 and both workers are killed during a vote storm.
    scenarios.F = () => run("F", "app instance and worker interruption during concurrent votes", async () => {
      const room = await createRoom(3, "F");
      const clients = await startClients(room, { label: "F" });
      const round = await startRound(room);
      await converge(room, clients, 15000, "F after start");
      const votes = room.members.map((m, i) => castVote({ ...m, origin: origin2 }, voteBody(round, round.deck[0], "SKIP", `f-${i}`)));
      await base.stopChild(worker1); await base.stopChild(worker2); worker1 = worker2 = null;
      await base.stopChild(proc1); proc1 = null;
      await Promise.allSettled(votes);
      const followUp = await castVote({ ...room.members[0], origin: origin2 }, voteBody(round, round.deck[1], "LIKE", "f-1"));
      assert([200, 409].includes(followUp.status));
      await sleep(3000);
      // Dispatchers and instance 1 come back; clients on instance 1 recover on their own.
      startInstance(1);
      await base.waitForServer(origin1, 120000);
      await Promise.all(hosted ? [startWorker(1)] : [startWorker(1), startWorker(2)]);
      const truth = await converge(room, clients, 60000, "F after restart");
      const counts = await dbCounts(room.roomId);
      assert.equal(counts.votes >= 3, true);
      await Promise.all(clients.map((c) => c.stop()));
      return { finalVersion: truth, counts, errorsSeen: clients.map((c) => [...new Set(c.errors)]) };
    });

    // G. Real Chromium tab frozen across the JWT lifetime (CDP lifecycle freeze), then resumed.
    scenarios.G = () => run("G", "browser tab frozen for > JWT lifetime then resumed", async () => {
      const room = await createRoom(2, "G");
      const round = await startRound(room);
      browser = await require(path.join(REPO_ROOT, "node_modules/@playwright/test")).chromium.launch({ headless: true });
      const context = await browser.newContext();
      await context.route("**/*", (route) => { const u = new URL(route.request().url()); return u.hostname === "127.0.0.1" || (hostedHostname && u.hostname === hostedHostname) ? route.continue() : route.abort(); });
      const member = room.members[1];
      await context.addCookies(member.cookie.split("; ").map((item) => { const k = item.indexOf("="); return { name: item.slice(0, k), value: item.slice(k + 1), url: member.origin }; }));
      const page = await context.newPage();
      await page.goto(member.origin + "/__cine019_probe__");
      await page.addScriptTag({ path: clientIife });
      await page.evaluate(async (config) => {
        globalThis.versions = []; globalThis.statuses = [];
        globalThis.stop = await globalThis.CineClient.startRoomRealtime({ ...config, onSnapshot: (s) => globalThis.versions.push(s.room.stateVersion), onStatus: (s) => globalThis.statuses.push(s) });
      }, { roomId: room.roomId, supabaseUrl: realSupabaseUrl, publishableKey: stackEnv.ANON_KEY });
      await waitUntil(async () => (await page.evaluate(() => globalThis.versions.at(-1))) === (await dbVersion(room.roomId)), 15000, "G initial snapshot");
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable");
      await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
      await sleep(5000);
      assert.equal((await castVote(room.members[0], voteBody(round, round.deck[0], "LIKE", "g-0"))).status, 200);
      assert.equal((await castVote(room.members[0], voteBody(round, round.deck[0], "LIKE", "g-0"))).status, 200); // duplicate while frozen
      await sleep(70000); // wall-clock passes the 60 s token lifetime with zero page timers firing
      assert.equal((await castVote(room.members[1], voteBody(round, round.deck[0], "LIKE", "g-1"))).status, 200);
      const truth = await dbVersion(room.roomId);
      await cdp.send("Page.setWebLifecycleState", { state: "active" });
      await waitUntil(async () => (await page.evaluate(() => globalThis.versions.at(-1))) === truth, 45000, "G resync after unfreeze");
      const result = await page.evaluate(() => ({ versions: globalThis.versions, statuses: globalThis.statuses }));
      assertStrictlyIncreasing(result.versions, "G browser");
      const finalView = await page.evaluate(async (args) => (await fetch(args.url, { credentials: "same-origin" })).json(), { url: `${member.origin}/api/rooms/${room.roomId}` });
      assert.equal(finalView.room.status, "MATCHED");
      await page.evaluate(() => globalThis.stop());
      await browser.close(); browser = null;
      return { finalVersion: truth, deliveredVersions: result.versions, statuses: result.statuses };
    });

    // H. Simultaneous host actions across two app instances: single start, stable frozen quorum.
    scenarios.H = () => run("H", "simultaneous host start/filter/join/leave across instances", async () => {
      const outcomes = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        const room = await createRoom(3, `H${attempt}`);
        const host = room.members[0];
        const late = post(origin2, "", "/api/rooms/join", { code: room.code, displayName: "late joiner" });
        const [s1, s2, s3, filterRes, joinRes] = await Promise.all([
          post(origin1, host.cookie, `/api/rooms/${room.roomId}/start`, {}),
          post(origin2, host.cookie, `/api/rooms/${room.roomId}/start`, {}),
          post(origin1, host.cookie, `/api/rooms/${room.roomId}/start`, {}),
          patch(origin2, host.cookie, `/api/rooms/${room.roomId}/filters`, { sort_by: "vote_average.desc" }),
          late,
        ]);
        const results = [s1, s2, s3];
        const codes = await Promise.all(results.map(async (r) => (r.status === 200 ? 200 : `${r.status}:${String((await r.clone().json().catch(() => ({}))).error ?? "?")}`)));
        const wins = results.filter((r) => r.status === 200).length;
        // Invariants (order-independent, so they hold at local and hosted latencies): never more than one start wins and
        // every loser is a plain 409. Zero winners is legitimate: the host's concurrent filter edit can commit before any
        // start takes the room lock, and the server rejects a start whose lobby filter changed underneath it.
        assert(wins <= 1, `at most one start may win, got ${codes}`);
        assert(results.every((r) => r.status === 200 || r.status === 409), `losers must be 409, got ${codes}`);
        let counts = await dbCounts(room.roomId);
        assert.equal(counts.rounds, wins, "rounds created equals winning starts");
        let retried = false;
        if (wins === 0) {
          assert.equal(filterRes.status, 200, `no start won, so the filter edit must have: ${codes}`);
          assert.equal((await db.query("SELECT status FROM public.rooms WHERE id=$1", [room.roomId])).rows[0].status, "LOBBY");
          const retry = await post(origin1, host.cookie, `/api/rooms/${room.roomId}/start`, {});
          assert.equal(retry.status, 200, "a deliberate retry after the filter edit starts the round");
          retried = true;
          counts = await dbCounts(room.roomId);
        }
        assert.equal(counts.rounds, 1);
        const joined = joinRes.status === 200;
        assert.equal(counts.frozen, counts.participants, "frozen quorum equals the roster at start");
        assert.equal(counts.participants, joined ? 4 : 3);
        assert([200, 409].includes(filterRes.status));
        const cand = await db.query("SELECT count(*)::int n FROM public.candidates WHERE room_id=$1", [room.roomId]);
        assert.equal(cand.rows[0].n, 20);
        outcomes.push({ starts: codes, retried, filter: filterRes.status, lateJoin: joinRes.status, quorum: counts.frozen });
      }
      return { outcomes };
    });

    // I. Reloads: cookie rejoin on either instance never creates participants, votes or versions.
    scenarios.I = () => run("I", "reload/rejoin creates no extra participant, vote or version", async () => {
      const room = await createRoom(3, "I");
      const round = await startRound(room);
      assert.equal((await castVote(room.members[0], voteBody(round, round.deck[0], "LIKE", "i-0"))).status, 200);
      const before = await dbCounts(room.roomId);
      for (let reload = 0; reload < 4; reload++) {
        for (const m of room.members) for (const origin of [origin1, origin2]) {
          const res = await post(origin, m.cookie, "/api/rooms/join", { code: room.code, displayName: "reload" });
          assert.equal(res.status, 200);
        }
      }
      assert.deepEqual(await dbCounts(room.roomId), before);
      return { counts: before };
    });

    // J. The product action layer (single flight, stable operation ids, stale handling, snapshot gate) over the
    //    real HTTP API with duplicate tabs on two app instances.
    scenarios.J = () => run("J", "action layer over real HTTP: duplicate tabs, double clicks, stale replay", async () => {
      const room = await createRoom(3, "J");
      const clients = await startClients(room, { label: "J" });
      const hostTab2Member = { ...room.members[0], origin: origin2 };
      const hostTab2 = makeClient(hostTab2Member, { label: "J-host-tab2" });
      await hostTab2.start();
      const everyone = [...clients, hostTab2];
      const a = clients[0].actions();
      const b = hostTab2.actions();
      const [s1, s2, s3] = await Promise.all([a.startRound(), a.startRound(), b.startRound()]);
      assert.equal(s1, s2, "double click on one tab shares one request");
      const wins = [s1, s3].filter((r) => r.ok);
      const losses = [s1, s3].filter((r) => !r.ok);
      assert.equal(wins.length, 1, "exactly one tab starts the round");
      assert.equal(losses[0].stale, true, "the other tab is told its view was stale");
      await converge(room, everyone, 20000, "J after start");
      const latest = clients[1].latest;
      assert.equal(latest.room.status, "ACTIVE");
      const round = { roundId: latest.room.currentRoundId, deck: latest.room.deck };
      const card = round.deck[0];
      const voteCalls = [];
      for (const [i, c] of clients.entries()) {
        const actions = c.actions();
        const input = { candidateId: card.candidateId, movieId: card.movieId, vote: "LIKE", roundId: round.roundId };
        voteCalls.push(actions.vote(input), actions.vote(input)); // double click
        if (i === 0) voteCalls.push(b.vote(input)); // same participant, second tab, other instance
      }
      const voteResults = await Promise.all(voteCalls);
      assert(voteResults.every((r) => r.ok), `every vote resolves ok (fresh or replay): ${JSON.stringify(voteResults.filter((r) => !r.ok))}`);
      const truth = await converge(room, everyone, 25000, "J after votes");
      const counts = await dbCounts(room.roomId);
      assert.equal(counts.votes, 3); assert.equal(counts.matchEvents, 1);
      for (const c of everyone) {
        assert.equal(c.latest.room.status, "MATCHED");
        assert.equal(c.versions.filter((v) => v === truth).length, 1, "terminal state delivered exactly once");
      }
      const stale = await clients[2].actions().vote({ candidateId: round.deck[1].candidateId, movieId: round.deck[1].movieId, vote: "LIKE", roundId: round.roundId });
      assert.equal(stale.ok, false); assert.equal(stale.stale, true);
      await sleep(1500);
      for (const c of everyone) assertStrictlyIncreasing(c.versions, `J/${c.label}`);
      await Promise.all(everyone.map((c) => c.stop()));
      return { finalVersion: truth, replays: voteResults.filter((r) => r.replayed).length, staleCode: stale.code };
    });

    for (const id of ALL_SCENARIOS) await scenarios[id]();
    evidence.finishedAt = new Date().toISOString();
    evidence.requested = ONLY.length ? ONLY : ALL_SCENARIOS;
    evidence.partial = evidence.skipped.length > 0;
    evidence.allPass = !evidence.partial && !evidence.nonQualifying && evidence.scenarios.length === ALL_SCENARIOS.length && evidence.scenarios.every((s) => s.result === "PASS");
    writeEvidence();
    console.log(JSON.stringify(evidence, null, 2));
    // Debug runs (--only / --keep-dir / --client-from-worktree) report allPass=false instead of failing.
    if (!evidence.partial && !evidence.nonQualifying) assert(evidence.allPass, "a scenario did not pass");
  } catch (error) {
    console.error("--- INSTANCE 1 LOGS ---\n" + (proc1?.getLogs() || ""));
    console.error("--- INSTANCE 2 LOGS ---\n" + (proc2?.getLogs() || ""));
    console.error("--- WORKER LOGS ---\n" + (worker1?.getLogs() || "") + "\n" + (worker2?.getLogs() || ""));
    evidence.failure = String(error && error.stack || error);
    evidence.finishedAt = new Date().toISOString();
    const out = flag("--evidence");
    if (out) fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const c of [...liveMembers]) await c.stop();
    await Promise.all([base.stopChild(worker1), base.stopChild(worker2)]);
    await base.stopChild(proc1); await base.stopChild(proc2);
    if (proxy) await proxy.close();
    if (createdRoomIds.length && db._connected !== false) {
      try {
        await db.query("UPDATE public.rooms SET status='EXPIRED', expires_at=NOW() - INTERVAL '1 second' WHERE id = ANY($1::uuid[])", [createdRoomIds]);
        await db.query("DELETE FROM public.rooms WHERE id = ANY($1::uuid[])", [createdRoomIds]);
        const left = await db.query("SELECT count(*)::int n FROM public.rooms WHERE id <> ALL($1::uuid[])", [SEED_ROOMS]);
        evidence.cleanup = { result: left.rows[0].n === 0 ? "PASS" : "FAIL", remainingNonSeedRooms: left.rows[0].n, createdRooms: createdRoomIds.length };
        console.error(JSON.stringify({ fixtureCleanup: evidence.cleanup.result, ...evidence.cleanup }));
        if (left.rows[0].n !== 0) process.exitCode = 1;
      } catch (error) { evidence.cleanup = { result: "FAIL", error: String(error).slice(0, 200) }; console.error("fixture cleanup failed:", String(error)); process.exitCode = 1; }
      writeEvidence();
    }
    await db.end().catch(() => {});
    if (!keepDir) fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error("CINE-019 qualification FAILED:", error); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
