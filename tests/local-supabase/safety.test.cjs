/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateBindings, validateHostListeners, validateCommit, migrationPaths } = require("../../scripts/local-supabase/safety.cjs");

const safe = [
  { name: "cinematch-gh52d-db-1", project: "cinematch-gh52d", ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55432" }] } },
  { name: "cinematch-gh52d-gateway-1", project: "cinematch-gh52d", ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
];

test("rejects wildcard, missing, wrong project and unexpected published bindings", () => {
  assert.doesNotThrow(() => validateBindings(safe));
  assert.throws(() => validateBindings([{ ...safe[0], ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "54322" }] } }, safe[1]]));
  assert.throws(() => validateBindings([safe[0]]));
  assert.throws(() => validateBindings([{ ...safe[0], ports: {} }, safe[1]]));
  assert.throws(() => validateBindings([safe[0], { ...safe[1], ports: { "8000/tcp": [{ HostIp: "127.0.0.1", HostPort: "9999" }] } }]));
  assert.throws(() => validateBindings([safe[0], { ...safe[1], project: "other" }]));
  assert.throws(() => validateBindings([safe[0], { ...safe[1], ports: { "8000/tcp": [{ HostIp: "::", HostPort: "54321" }] } }]));
});

test("only returns the canonical five up migrations", () => {
  assert.deepEqual(migrationPaths(), [
    "src/db/migrations/001_create_room_schema.sql",
    "src/db/migrations/002_guest_capability_sessions.sql",
    "src/db/migrations/003_round_roster_freeze.sql",
    "src/db/migrations/004_vote_operation_idempotency.sql",
    "src/db/migrations/005_realtime_authorization.sql",
  ]);
});

test("requires host listeners as well as container bindings to be loopback", () => {
  assert.doesNotThrow(() => validateHostListeners([{ address: "127.0.0.1", port: 54321 }], [54321]));
  assert.throws(() => validateHostListeners([{ address: "0.0.0.0", port: 54321 }], [54321]));
  assert.throws(() => validateHostListeners([{ address: "::", port: 54321 }], [54321]));
  assert.throws(() => validateHostListeners([], [54321]));
});

test("rejects ambiguous or executable git revision inputs", () => {
  assert.doesNotThrow(() => validateCommit("d82fa1629b7afa89c61badfe1ed9c4163eea22ab"));
  for (const value of ["main", "HEAD", "d82fa16", "a".repeat(39) + "!", "--help", "a".repeat(40) + ":file"]) {
    assert.throws(() => validateCommit(value));
  }
});


