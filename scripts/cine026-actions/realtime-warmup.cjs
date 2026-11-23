/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Qualification-only warm-up of the Supabase REALTIME tenant (CINE-026/063).
//
// Why: the controlled cold-start probe showed that the first private broadcast after the tenant has shut
// down takes longer than the application publisher's fixed 1500 ms deadline, while later broadcasts are
// fast. Warm hosted gates therefore have to start from a tenant that is known to be running. The Auth
// health endpoint is a different service and does not start the Realtime tenant, so it is not used here.
//
// This is a harness step only. It does not change the application, its 1500 ms deadline, retry policy,
// database pool or any acceptance gate, and it never counts as evidence that the cold path passes.
//
// Bounds: exactly three private-broadcast POSTs to synthetic random topics, no retries, no PostgreSQL
// access, no application rows, a hard 20 s wall limit. Fail-closed: the tenant is READY only when
//   W1 (start)   returns HTTP 202 within the 10 s diagnostic deadline, and
//   W2, W3 (verify, different synthetic rooms) each return HTTP 202 within the application deadline.
// Anything else (401/403/other status, timeout, transport error) is NOT_READY and blocks the gates.
// Output holds only enumerations, bounded integers and ISO timestamps; never URLs, keys, topics or messages.

const { randomUUID } = require("node:crypto");
const { APP_DEADLINE_MS, CATEGORIES, classify } = require("./cold-start-probe.cjs");

const START_DEADLINE_MS = 10_000; // Diagnostic deadline for the request that starts the tenant.
const VERIFY_DEADLINE_MS = APP_DEADLINE_MS; // Readiness bar: a fresh room publishes within what the app tolerates.
const TOTAL_DEADLINE_MS = 20_000;
const STATUSES = new Set(["READY", "NOT_READY"]);
const ROLES = new Set(["start", "verify"]);

function buildWarmupPlan(makeRoom = randomUUID) {
  return [
    { id: "W1", role: "start", room: makeRoom(), deadlineMs: START_DEADLINE_MS },
    { id: "W2", role: "verify", room: makeRoom(), deadlineMs: VERIFY_DEADLINE_MS },
    { id: "W3", role: "verify", room: makeRoom(), deadlineMs: VERIFY_DEADLINE_MS },
  ];
}

async function warmRealtimeTenant({
  url, secret, send = fetch, now = () => performance.now(), makeRoom = randomUUID,
  timeout = ms => AbortSignal.timeout(ms),
}) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || typeof secret !== "string" || !secret) {
    throw new Error("WARMUP_CONFIGURATION_INVALID");
  }
  const overall = new AbortController();
  const wall = setTimeout(() => overall.abort(), TOTAL_DEADLINE_MS);
  const requests = [];
  const began = now();
  try {
    for (const step of buildWarmupPlan(makeRoom)) {
      const endpoint = new URL("/realtime/v1/api/broadcast/" + encodeURIComponent("room:" + step.room) +
        "/events/room_changed?private=true", url);
      const startedAt = new Date().toISOString();
      const started = now();
      const record = { id: step.id, role: step.role, startedAt, deadlineMs: step.deadlineMs };
      try {
        const response = await send(endpoint, {
          method: "POST", redirect: "error",
          headers: { "content-type": "application/json", apikey: secret },
          body: JSON.stringify({ roomId: step.room, version: 1 }),
          signal: AbortSignal.any([timeout(step.deadlineMs), overall.signal]),
        });
        record.ms = Math.round(now() - started);
        record.http = response.status;
        await response.body?.cancel().catch(() => {});
      } catch (error) {
        record.ms = Math.round(now() - started);
        record.http = null;
        record.failure = classify(error);
      }
      requests.push(record);
      // A 401/403, any other status, a timeout or a transport error ends the warm-up: no retry.
      if (record.http !== 202 || (step.role === "verify" && record.ms > step.deadlineMs)) break;
    }
  } finally {
    clearTimeout(wall);
  }
  const accepted = requests.length === 3 && requests.every(r => r.http === 202) &&
    requests.filter(r => r.role === "verify").every(r => r.ms <= VERIFY_DEADLINE_MS);
  const first = requests[0];
  return {
    status: accepted ? "READY" : "NOT_READY",
    // Latency classification only. Whether the tenant really started is confirmed in the provider's realtime logs.
    firstRequestOverAppDeadline: first && first.http === 202 ? first.ms > APP_DEADLINE_MS : null,
    elapsedMs: Math.round(now() - began),
    requests,
  };
}

// Rebuilds a warm-up result from fixed enumerations and bounded integers before it can reach evidence.
function readWarmup(value) {
  const int = n => Number.isSafeInteger(n) && n >= 0;
  if (!value || !STATUSES.has(value.status) || !Array.isArray(value.requests) || value.requests.length > 3 ||
    !int(value.elapsedMs) || !(value.firstRequestOverAppDeadline === null || typeof value.firstRequestOverAppDeadline === "boolean")) return null;
  const requests = [];
  for (const [index, r] of value.requests.entries()) {
    if (r?.id !== "W" + (index + 1) || !ROLES.has(r.role) || !int(r.ms) || !int(r.deadlineMs) ||
      !(r.http === null || (Number.isSafeInteger(r.http) && r.http >= 100 && r.http <= 599)) ||
      !(r.failure === undefined || CATEGORIES.has(r.failure)) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.startedAt)) return null;
    requests.push({ id: r.id, role: r.role, startedAt: r.startedAt, ms: r.ms, http: r.http,
      failure: r.failure ?? null, deadlineMs: r.deadlineMs });
  }
  // A result cannot claim READY unless the three requests really were accepted within their bounds.
  const consistent = value.status !== "READY" || (requests.length === 3 && requests.every(r => r.http === 202 && r.ms <= r.deadlineMs));
  if (!consistent) return null;
  return {
    status: value.status, firstRequestOverAppDeadline: value.firstRequestOverAppDeadline, elapsedMs: value.elapsedMs,
    appDeadlineMs: APP_DEADLINE_MS, startDeadlineMs: START_DEADLINE_MS, verifyDeadlineMs: VERIFY_DEADLINE_MS,
    totalDeadlineMs: TOTAL_DEADLINE_MS, requests,
  };
}

module.exports = {
  START_DEADLINE_MS, VERIFY_DEADLINE_MS, TOTAL_DEADLINE_MS, buildWarmupPlan, readWarmup, warmRealtimeTenant,
};
