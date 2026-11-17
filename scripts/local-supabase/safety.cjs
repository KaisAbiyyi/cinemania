"use strict";

/** Never treat Docker's default bridge option as proof of a loopback bind. */
function validateBindings(containers) {
  const expected = new Map([["cinematch-gh52d-db-1", ["5432/tcp", "55432"]], ["cinematch-gh52d-gateway-1", ["8000/tcp", "54321"]]]);
  const required = new Set(expected.keys());
  for (const container of containers) {
    if (container.project !== "cinematch-gh52d") throw new Error("Unexpected Docker project");
    required.delete(container.name);
    if (expected.has(container.name)) {
      const [containerPort, hostPort] = expected.get(container.name);
      if (!container.ports?.[containerPort]?.some((binding) => binding.HostPort === hostPort)) throw new Error("Expected published port missing");
    }
    for (const bindings of Object.values(container.ports ?? {})) {
      for (const binding of bindings ?? []) {
        if (binding.HostIp !== "127.0.0.1" && binding.HostIp !== "::1") throw new Error("Non-loopback Docker port");
      }
    }
  }
  if (required.size) throw new Error("Expected local containers missing");
}

function migrationPaths() {
  return [
    "src/db/migrations/001_create_room_schema.sql",
    "src/db/migrations/002_guest_capability_sessions.sql",
    "src/db/migrations/003_round_roster_freeze.sql",
    "src/db/migrations/004_vote_operation_idempotency.sql",
    "src/db/migrations/005_realtime_authorization.sql",
  ];
}

function validateHostListeners(listeners, expectedPorts) {
  for (const port of expectedPorts) {
    const matching = listeners.filter((item) => item.port === port);
    if (matching.length === 0) throw new Error("Expected local listener missing");
    if (matching.some((item) => item.address !== "127.0.0.1" && item.address !== "::1")) {
      throw new Error("Host proxy is not loopback-only");
    }
  }
}

function validateCommit(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("Full lowercase commit SHA required");
}

module.exports = { validateBindings, validateHostListeners, validateCommit, migrationPaths };


