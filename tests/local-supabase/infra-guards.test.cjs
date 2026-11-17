/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  downMigrationPaths,
  isLoopbackUrl,
  assertNoCloudTargetEnv,
} = require("../../scripts/local-supabase/safety.cjs");
const { parseLinuxListeners } = require("../../scripts/local-supabase/runtime.cjs");
const { SYNTHETIC_IDS } = require("../../scripts/local-supabase/seed.cjs");

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

test("downMigrationPaths reverses canonical 001-005 order", () => {
  assert.deepEqual(downMigrationPaths(), [
    "src/db/migrations/005_down_realtime_authorization.sql",
    "src/db/migrations/004_down_vote_operation_idempotency.sql",
    "src/db/migrations/003_down_round_roster_freeze.sql",
    "src/db/migrations/002_down_guest_capability_sessions.sql",
    "src/db/migrations/001_down_room_schema.sql",
  ]);
});

test("isLoopbackUrl and assertNoCloudTargetEnv reject hosted targets", () => {
  assert.equal(isLoopbackUrl("http://127.0.0.1:54321"), true);
  assert.equal(isLoopbackUrl("http://localhost:54321"), true);
  assert.equal(isLoopbackUrl("https://example.supabase.co"), false);

  assert.doesNotThrow(() =>
    assertNoCloudTargetEnv({
      DATABASE_URL: "postgresql://supabase_admin:pw@127.0.0.1:55432/postgres",
      SUPABASE_URL: "http://127.0.0.1:54321",
    })
  );
  assert.throws(() => assertNoCloudTargetEnv({ SUPABASE_ACCESS_TOKEN: "sbp_fake" }));
  assert.throws(() => assertNoCloudTargetEnv({ SUPABASE_PROJECT_REF: "abc123" }));
  assert.throws(() => assertNoCloudTargetEnv({ SUPABASE_URL: "https://abc.supabase.co" }));
  assert.throws(() => assertNoCloudTargetEnv({ DATABASE_URL: "postgresql://u:p@db.abc.supabase.co:5432/postgres" }));
});

test("parseLinuxListeners extracts loopback and wildcard sockets", () => {
  const parsed = parseLinuxListeners("LISTEN 0 4096 127.0.0.1:54321 0.0.0.0:*\nLISTEN 0 4096 *:55432 *:*\n");
  assert.deepEqual(parsed, [
    { address: "127.0.0.1", port: 54321 },
    { address: "0.0.0.0", port: 55432 },
  ]);
});

test("synthetic seed room codes adhere strictly to ROOM_CODE_ALPHABET", () => {
  for (const code of [SYNTHETIC_IDS.lobbyCode, SYNTHETIC_IDS.activeCode]) {
    assert.equal(code.length, 6);
    for (const ch of code) {
      assert.equal(ROOM_CODE_ALPHABET.includes(ch), true, `Invalid room code char ${ch} in ${code}`);
    }
  }
});
