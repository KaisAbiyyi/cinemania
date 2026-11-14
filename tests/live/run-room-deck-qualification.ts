// tests/live/run-room-deck-qualification.ts
// Standalone isolated-schema PostgreSQL qualification runner for CINE-016:
// Common filter validation/persistence, 0-result recoverable 422 DECK_EMPTY,
// concurrent start vs PATCH /filters race (DECK_FILTER_CONFLICT), atomic round+roster+deck commit,
// 100->20 cap, 5-participant deck equality under REPEATABLE READ, FILTER_LOCKED post-start,
// and 1-card shortage + posterless deck + EXHAUSTED vote transition.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client, Pool } from "pg";
import { PostgresRoomRepository } from "../../src/lib/server/room/postgresRoomRepository";
import { RoomCapacityError } from "../../src/lib/server/room/roomRepository";
import {
  createRoomWithSession,
  getAuthenticatedRoomDeck,
  getAuthenticatedRoomSnapshot,
  joinRoomWithSession,
  startRoomRoundWithSession,
  updateRoomFiltersWithSession,
} from "../../src/lib/server/room/roomSnapshot";
import { PostgresRoomAuthorityStore } from "../../src/lib/server/room/roomStore";
import { DeckEmptyError } from "../../src/lib/server/room/stateMachine";
import tmdbApi from "../../src/services/tmdbApi";

const envPath = path.join(process.cwd(), ".env.test.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

const ALLOWED_PROJECT_REF = "dmrbticnsczhyaiftrar";
const PG_HOST = process.env.SUPABASE_PG_HOST || "";
const PG_USER = process.env.SUPABASE_PG_USER || "";
const PG_PASSWORD = process.env.SUPABASE_PG_PASSWORD || "";
const PG_PORT = Number.parseInt(process.env.SUPABASE_PG_PORT || "5432", 10);
const PG_DATABASE = process.env.SUPABASE_PG_DATABASE || "postgres";

const RUN_SUFFIX = crypto.randomBytes(4).toString("hex");
const TIMESTAMP = Math.floor(Date.now() / 1000);
const TEST_SCHEMA = `cinematch_qual016_${TIMESTAMP}_${RUN_SUFFIX}`;

if (!/^cinematch_qual016_[0-9]+_[a-f0-9]{8}$/.test(TEST_SCHEMA)) {
  throw new Error(`Invalid test schema identifier: ${TEST_SCHEMA}`);
}

if (process.env.ALLOW_DESTRUCTIVE_PG_TESTS !== "true") {
  console.error("FAIL-CLOSED REFUSAL: Set ALLOW_DESTRUCTIVE_PG_TESTS=true to run PG qualification.");
  process.exit(1);
}

if (!PG_HOST.includes(ALLOWED_PROJECT_REF) && !PG_USER.includes(ALLOWED_PROJECT_REF)) {
  console.error(`FAIL-CLOSED REFUSAL: Target host/user must match ${ALLOWED_PROJECT_REF}.`);
  process.exit(1);
}

if (!PG_PASSWORD) {
  console.error("FAIL-CLOSED REFUSAL: Missing SUPABASE_PG_PASSWORD.");
  process.exit(1);
}

const CA_PATH = path.join(process.cwd(), "src", "db", "supabase-root-ca.crt");
if (!fs.existsSync(CA_PATH)) {
  console.error(`FAIL-CLOSED REFUSAL: Root CA missing at ${CA_PATH}`);
  process.exit(1);
}
const CA_CERT = fs.readFileSync(CA_PATH, "utf-8");

const POOL_CONFIG = {
  host: PG_HOST,
  port: PG_PORT,
  database: PG_DATABASE,
  user: PG_USER,
  password: PG_PASSWORD,
  ssl: {
    rejectUnauthorized: true,
    ca: CA_CERT,
    servername: PG_HOST,
  },
  connectionTimeoutMillis: 10000,
};

function adaptSql(raw: string, schema: string): string {
  return raw
    .replace(/public\.room_participants/g, `"${schema}".room_participants`)
    .replace(/public\.rooms/g, `"${schema}".rooms`)
    .replace(/SET search_path = public, pg_temp/g, `SET search_path = "${schema}", pg_temp`);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`QUALIFICATION ASSERTION FAILED: ${message}`);
  }
}

function makeRequest(method: "POST" | "PATCH" | "GET", url: string, body?: unknown, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers.origin = "http://localhost:3000";
    headers["content-type"] = "application/json";
  }
  if (cookie) {
    headers.cookie = cookie;
  }
  return new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function makeMovieBatch(count: number, baseId: number, nullPoster = false) {
  return Array.from({ length: count }, (_, idx) => ({
    id: baseId + idx,
    title: `PG Deck Movie ${idx + 1}`,
    poster_path: nullPoster ? null : `/pg-${baseId + idx}.jpg`,
    release_date: "2024-04-01",
    vote_average: 7.2,
    overview: `PG overview ${baseId + idx}`,
    adult: false,
  }));
}

async function runQualification() {
  const adminClient = new Client(POOL_CONFIG);
  const storePool = new Pool({ ...POOL_CONFIG, max: 6 });
  const prevSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
  const prevRat = process.env.TMDB_API_RAT;
  const prevAdapter = tmdbApi.defaults.adapter;

  let adapterCalls = 0;

  process.env.CINEMATCH_CAPABILITY_SECRET =
    "live-qualification-secret-cine-016-minimum-32-bytes-ok";
  process.env.TMDB_API_RAT = prevRat || "offline-qual-cine-016-rat";

  tmdbApi.defaults.adapter = async (config) => {
    adapterCalls += 1;
    const params = (config.params ?? {}) as Record<string, unknown>;
    assertCondition(params.include_adult === false, "Upstream TMDB call must lock include_adult=false");

    const kw = String(params.with_keywords ?? "");
    let results = makeMovieBatch(25, 930000);
    if (kw === "999991") {
      results = [];
    } else if (kw === "999992") {
      results = makeMovieBatch(1, 940000, true);
    } else if (kw === "999995") {
      results = makeMovieBatch(100, 950000);
    }

    return {
      data: {
        page: 1,
        total_pages: 1,
        total_results: results.length,
        results,
      },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };

  try {
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA "${TEST_SCHEMA}";`);
    await adminClient.query(`GRANT USAGE ON SCHEMA "${TEST_SCHEMA}" TO authenticated;`);
    await adminClient.query(`SET search_path TO "${TEST_SCHEMA}", pg_temp;`);

    for (const file of [
      "001_create_room_schema.sql",
      "002_guest_capability_sessions.sql",
      "003_round_roster_freeze.sql",
    ]) {
      const sql = adaptSql(
        fs.readFileSync(path.join(process.cwd(), "src/db/migrations", file), "utf8"),
        TEST_SCHEMA
      );
      await adminClient.query(sql);
    }

    const store = new PostgresRoomAuthorityStore(storePool, { schema: TEST_SCHEMA });
    const repo = new PostgresRoomRepository(storePool, { schema: TEST_SCHEMA });

    // 1. Host creates room with initial filter; 4 guests join
    const created = await createRoomWithSession(
      makeRequest("POST", "http://localhost:3000/api/rooms", {
        displayName: "Host",
        deckFilter: { with_genres: "28", "vote_average.gte": 7 },
      }),
      { displayName: "Host", deckFilter: { with_genres: "28", "vote_average.gte": 7 } },
      store
    );
    assertCondition(Boolean(created.cookie), "Expected host cookie");
    const roomId = created.room.roomId;
    const hostCookie = `${created.cookie!.name}=${created.cookie!.value}`;
    assertCondition(created.room.deckFilter.include_adult === false, "include_adult must default false");

    const guestCookies: string[] = [];
    for (let i = 1; i <= 4; i += 1) {
      const joined = await joinRoomWithSession(
        makeRequest("POST", "http://localhost:3000/api/rooms/join", {
          code: created.room.code,
          displayName: `Guest ${i}`,
        }),
        { code: created.room.code, displayName: `Guest ${i}` },
        store
      );
      guestCookies.push(`${joined.cookie!.name}=${joined.cookie!.value}`);
    }

    // 2. Non-host guest cannot update filters; host can update to 999991 (0-result fixture)
    let guestDenied = false;
    try {
      await updateRoomFiltersWithSession(
        makeRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, undefined, guestCookies[0]),
        roomId,
        { with_genres: "35" },
        store
      );
    } catch (err) {
      guestDenied = (err as { code?: string })?.code === "HOST_ONLY_ACTION";
    }
    assertCondition(guestDenied, "Non-host guest must get HOST_ONLY_ACTION on filter update");

    const updatedEmpty = await updateRoomFiltersWithSession(
      makeRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, undefined, hostCookie),
      roomId,
      { with_keywords: "999991" },
      store
    );
    assertCondition(updatedEmpty.room.deckFilter.with_keywords === "999991", "Filter updated cleanly");

    // 3. 0-result start throws DeckEmptyError (422) and leaves room in LOBBY
    let emptyCaught = false;
    try {
      await startRoomRoundWithSession(
        makeRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, undefined, hostCookie),
        roomId,
        store
      );
    } catch (err) {
      emptyCaught = err instanceof DeckEmptyError && err.status === 422 && err.code === "DECK_EMPTY";
    }
    assertCondition(emptyCaught, "0-result discover must fail with recoverable 422 DECK_EMPTY");

    const stillLobby = await adminClient.query(
      "SELECT status, current_round_id FROM rooms WHERE id = $1;",
      [roomId]
    );
    assertCondition(stillLobby.rows[0].status === "LOBBY", "Room must stay in LOBBY after 422 DECK_EMPTY");
    assertCondition(stillLobby.rows[0].current_round_id === null, "No round created after 422 DECK_EMPTY");

    // 4. Concurrent start vs PATCH /filters race -> DECK_FILTER_CONFLICT
    let conflictCaught = false;
    try {
      await startRoomRoundWithSession(
        makeRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, undefined, hostCookie),
        roomId,
        store,
        {
          discoverFetcher: async () => {
            await updateRoomFiltersWithSession(
              makeRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, undefined, hostCookie),
              roomId,
              { with_keywords: "999995" },
              store
            );
            return {
              page: 1,
              total_pages: 1,
              total_results: 20,
              results: makeMovieBatch(20, 960000),
            };
          },
        }
      );
    } catch (err) {
      conflictCaught = err instanceof RoomCapacityError && err.code === "DECK_FILTER_CONFLICT";
    }
    assertCondition(conflictCaught, "Concurrent filter update during start must raise DECK_FILTER_CONFLICT");

    // 5. Real start with 999995 (100 provider results -> capped to 20) + double-start serialization
    const callsBeforeStart = adapterCalls;
    const [r1, r2] = await Promise.allSettled([
      startRoomRoundWithSession(
        makeRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, undefined, hostCookie),
        roomId,
        store
      ),
      startRoomRoundWithSession(
        makeRequest("POST", `http://localhost:3000/api/rooms/${roomId}/start`, undefined, hostCookie),
        roomId,
        store
      ),
    ]);
    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    assertCondition(fulfilled.length === 1 && rejected.length === 1, "Concurrent double-start must yield 1 win + 1 reject");

    const startedSnap = (fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof startRoomRoundWithSession>>>).value;
    assertCondition(startedSnap.room.status === "ACTIVE", "Room transitioned to ACTIVE");
    assertCondition(startedSnap.room.deckSize === 20, "100 upstream results must cap strictly at 20");
    assertCondition(startedSnap.room.frozenQuorum === 5, "Quorum frozen at 5");
    assertCondition(
      adapterCalls >= callsBeforeStart + 1 && adapterCalls <= callsBeforeStart + 2,
      "Expected bounded upstream start calls across concurrent double-start"
    );

    // 6. All 5 participants read /deck and snapshot with ZERO additional TMDB calls & identical order
    const callsAfterStart = adapterCalls;
    const expectedMovieOrder = startedSnap.room.deck.map((c) => c.movieId);
    for (const cookie of [hostCookie, ...guestCookies]) {
      const snap = await getAuthenticatedRoomSnapshot(
        makeRequest("GET", `http://localhost:3000/api/rooms/${roomId}`, undefined, cookie),
        roomId,
        store
      );
      const deckRes = await getAuthenticatedRoomDeck(
        makeRequest("GET", `http://localhost:3000/api/rooms/${roomId}/deck`, undefined, cookie),
        roomId,
        store
      );
      assertCondition(
        JSON.stringify(snap.room.deck.map((c) => c.movieId)) === JSON.stringify(expectedMovieOrder),
        "Snapshot deck must match host deck order across all 5 participants"
      );
      assertCondition(
        JSON.stringify(deckRes.deck.map((c) => c.movieId)) === JSON.stringify(expectedMovieOrder),
        "/deck endpoint must match host deck order across all 5 participants"
      );
    }
    assertCondition(adapterCalls === callsAfterStart, "Zero per-swipe / per-read TMDB calls permitted");

    // 7. Post-start filter update denied with FILTER_LOCKED
    let lockCaught = false;
    try {
      await updateRoomFiltersWithSession(
        makeRequest("PATCH", `http://localhost:3000/api/rooms/${roomId}/filters`, undefined, hostCookie),
        roomId,
        { with_genres: "18" },
        store
      );
    } catch (err) {
      lockCaught = err instanceof RoomCapacityError && err.code === "FILTER_LOCKED";
    }
    assertCondition(lockCaught, "Filter edits after ACTIVE must raise FILTER_LOCKED");

    // 8. 1-movie shortage + posterless room -> all-SKIP EXHAUSTED transition in PostgreSQL
    const shortCreated = await createRoomWithSession(
      makeRequest("POST", "http://localhost:3000/api/rooms", {
        displayName: "Short Host",
        deckFilter: { with_keywords: "999992" },
      }),
      { displayName: "Short Host", deckFilter: { with_keywords: "999992" } },
      store
    );
    const shortHostCookie = `${shortCreated.cookie!.name}=${shortCreated.cookie!.value}`;
    const shortGuestJoined = await joinRoomWithSession(
      makeRequest("POST", "http://localhost:3000/api/rooms/join", {
        code: shortCreated.room.code,
        displayName: "Short Guest",
      }),
      { code: shortCreated.room.code, displayName: "Short Guest" },
      store
    );

    const shortStarted = await startRoomRoundWithSession(
      makeRequest("POST", `http://localhost:3000/api/rooms/${shortCreated.room.roomId}/start`, undefined, shortHostCookie),
      shortCreated.room.roomId,
      store
    );
    assertCondition(shortStarted.room.deckSize === 1, "Shortage deck has 1 movie");
    assertCondition(shortStarted.room.isDeckShortage === true, "isDeckShortage must be true");
    assertCondition(shortStarted.room.deck[0]?.posterUrl === null, "Missing poster normalizes to null");

    const singleCand = shortStarted.room.deck[0]!;
    await repo.recordVote(
      shortCreated.room.roomId,
      shortStarted.room.currentRoundId!,
      shortCreated.viewer.participantId,
      singleCand.candidateId,
      singleCand.movieId,
      "SKIP"
    );
    const exhaustedVote = await repo.recordVote(
      shortCreated.room.roomId,
      shortStarted.room.currentRoundId!,
      shortGuestJoined.viewer.participantId,
      singleCand.candidateId,
      singleCand.movieId,
      "SKIP"
    );
    assertCondition(exhaustedVote.room.status === "EXHAUSTED", "All-SKIP on 1-card shortage deck must transition PG room to EXHAUSTED");

    // 9. Verify non-member authenticated RLS blocks direct candidates read
    const outsiderId = crypto.randomUUID();
    await adminClient.query("BEGIN;");
    await adminClient.query("SET LOCAL ROLE authenticated;");
    await adminClient.query(
      "SELECT set_config('request.jwt.claims', $1, true);",
      [JSON.stringify({ sub: outsiderId, role: "authenticated" })]
    );
    const rlsRes = await adminClient.query("SELECT id FROM candidates WHERE room_id = $1;", [roomId]);
    await adminClient.query("COMMIT;");
    assertCondition(rlsRes.rows.length === 0, "Non-member authenticated query on candidates must return 0 rows");

    console.log(
      JSON.stringify({
        ok: true,
        schema: TEST_SCHEMA,
        deckSizeCapped: startedSnap.room.deckSize,
        fiveClientParityVerified: true,
        shortageExhaustedVerified: true,
        rlsIsolationVerified: true,
      })
    );
  } finally {
    tmdbApi.defaults.adapter = prevAdapter;
    if (prevRat === undefined) {
      delete process.env.TMDB_API_RAT;
    } else {
      process.env.TMDB_API_RAT = prevRat;
    }
    if (prevSecret === undefined) {
      delete process.env.CINEMATCH_CAPABILITY_SECRET;
    } else {
      process.env.CINEMATCH_CAPABILITY_SECRET = prevSecret;
    }

    await storePool.end().catch(() => {});
    try {
      await adminClient.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE;`);
      const leftovers = await adminClient.query(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'cinematch_qual%';"
      );
      console.log(
        JSON.stringify({
          cleanupOk: leftovers.rows.length === 0,
          leftoverSchemas: leftovers.rows,
        })
      );
      if (leftovers.rows.length > 0) {
        process.exitCode = 1;
      }
    } catch (cleanupErr) {
      console.error("Failed to drop isolated test schema:", cleanupErr);
      process.exitCode = 1;
    } finally {
      await adminClient.end().catch(() => {});
    }
  }
}

runQualification().catch((err) => {
  console.error("PG Qualification failed:", err);
  process.exit(1);
});
