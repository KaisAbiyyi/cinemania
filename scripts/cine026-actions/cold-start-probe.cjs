/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

// Controlled, bounded probe of the Supabase Realtime tenant cold-start hypothesis (CINE-026/063).
//
// It sends a FIXED set of ten private-broadcast POSTs, never retries, never touches PostgreSQL and never
// creates application rows. Synthetic random topics are used; the probe uses the same endpoint, headers and
// body shape as the application publisher. A longer deadline applies to this diagnostic only; the
// application's 1500 ms publisher deadline is a separate constant that this file does not change.
// Output contains only enumerations, integers and ISO timestamps: no URLs, keys, topics or error messages.

const dc = require("node:diagnostics_channel");
const { randomUUID } = require("node:crypto");

const APP_DEADLINE_MS = 1_500; // Reference only: the application publisher's deadline.
const REQUEST_DEADLINE_MS = 10_000; // Diagnostic-only deadline per request.
const TOTAL_DEADLINE_MS = 75_000; // Hard wall bound for the whole probe.
const CONCURRENT_ROOMS = 5;
const ROLES = new Set(["cold_first", "warm_same_room", "warm_other_room", "warm_concurrent"]);
const CATEGORIES = new Set([
  "client_deadline", "client_abort", "dns_failure", "connect_timeout", "connect_unreachable",
  "connection_reset", "connection_closed", "response_timeout", "tls_failure", "unexpected_redirect",
  "unknown_fetch_failure",
]);
const VERDICTS = new Set([
  "COLD_START_REPRODUCED", "PER_ROOM_EFFECT_OBSERVED", "WARM_PATH_NOT_CLEAN",
  "INCONCLUSIVE_NOT_COLD", "INCONCLUSIVE_FIRST_PROBE_FAILED",
]);

function codeOf(value) {
  if (typeof value !== "object" || value === null) return undefined;
  if (typeof value.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value.code)) return value.code;
  if (Array.isArray(value.errors)) for (const inner of value.errors) { const found = codeOf(inner); if (found) return found; }
  return undefined;
}

function classify(error) {
  const name = typeof error === "object" && error !== null ? String(error.name) : "";
  if (name === "TimeoutError") return "client_deadline";
  if (name === "AbortError") return "client_abort";
  const cause = typeof error === "object" && error !== null ? error.cause : undefined;
  const code = codeOf(cause) ?? codeOf(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns_failure";
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return "connect_timeout";
  if (["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) return "connect_unreachable";
  if (code === "ECONNRESET" || code === "EPIPE") return "connection_reset";
  if (["UND_ERR_SOCKET", "UND_ERR_CLOSED", "UND_ERR_DESTROYED"].includes(code)) return "connection_closed";
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return "response_timeout";
  if (code && /^(ERR_TLS|ERR_SSL|ERR_OSSL|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_)/.test(code)) return "tls_failure";
  if (/redirect/i.test(String(cause?.message ?? ""))) return "unexpected_redirect";
  return "unknown_fetch_failure";
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Fixed probe plan: 1 cold, 2 warm same room, 2 warm other room, 5 concurrent warm rooms. */
function buildPlan(makeRoom = randomUUID) {
  const a = makeRoom();
  const b = makeRoom();
  const sequential = [
    { id: "P1", role: "cold_first", room: a, version: 1 },
    { id: "P2", role: "warm_same_room", room: a, version: 2 },
    { id: "P3", role: "warm_other_room", room: b, version: 1 },
    { id: "P4", role: "warm_same_room", room: a, version: 3 },
    { id: "P5", role: "warm_other_room", room: b, version: 2 },
  ];
  const concurrent = Array.from({ length: CONCURRENT_ROOMS }, (_, i) => (
    { id: "P" + (6 + i), role: "warm_concurrent", room: makeRoom(), version: 1 }));
  return { sequential, concurrent };
}

const isSequentialWarm = r => r.role === "warm_same_room" || r.role === "warm_other_room";

// The verdict about the cold-start hypothesis uses the sequential probes only. The concurrent group is
// reported separately because it also opens extra connections.
function interpret(results) {
  const first = results.find(r => r.id === "P1");
  if (!first || first.http !== 202) return "INCONCLUSIVE_FIRST_PROBE_FAILED";
  if (first.ms <= APP_DEADLINE_MS) return "INCONCLUSIVE_NOT_COLD";
  const warm = results.filter(isSequentialWarm);
  const answered = warm.filter(r => r.http === 202);
  const slow = answered.filter(r => r.ms > APP_DEADLINE_MS);
  if (warm.length !== 4 || answered.length !== warm.length || slow.some(r => r.role !== "warm_other_room")) {
    return "WARM_PATH_NOT_CLEAN";
  }
  return slow.length ? "PER_ROOM_EFFECT_OBSERVED" : "COLD_START_REPRODUCED";
}

function summarize(results) {
  const warm = results.filter(r => isSequentialWarm(r) && r.http === 202).map(r => r.ms);
  const concurrent = results.filter(r => r.role === "warm_concurrent");
  const concurrentAnswered = concurrent.filter(r => r.http === 202).map(r => r.ms);
  const first = results.find(r => r.id === "P1");
  const warmMedian = median(warm);
  return {
    verdict: interpret(results),
    appDeadlineMs: APP_DEADLINE_MS,
    coldFirstMs: first && first.http === 202 ? first.ms : null,
    warmMedianMs: warmMedian,
    warmMaxMs: warm.length ? Math.max(...warm) : null,
    coldToWarmMedianRatio: first && first.http === 202 && warmMedian ? Math.round((first.ms / warmMedian) * 10) / 10 : null,
    coldReusedConnection: first ? first.newConnections === 0 : null,
    concurrentMaxMs: concurrentAnswered.length ? Math.max(...concurrentAnswered) : null,
    concurrentOverAppDeadline: concurrent.filter(r => r.http !== 202 || r.ms > APP_DEADLINE_MS).length,
  };
}

async function runColdStartProbe({
  url, secret, send = fetch, now = () => performance.now(), makeRoom = randomUUID,
  timeout = ms => AbortSignal.timeout(ms), channel = dc,
}) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || typeof secret !== "string" || !secret) {
    throw new Error("PROBE_CONFIGURATION_INVALID");
  }
  const progress = new Map();
  let connections = 0;
  const pathOf = message => (typeof message?.request?.path === "string" ? message.request.path : undefined);
  const onConnected = () => { connections++; };
  const onHeaders = message => { const key = pathOf(message); if (key && progress.has(key)) progress.get(key).headWrittenAt ??= now(); };
  const onBody = message => { const key = pathOf(message); if (key && progress.has(key)) progress.get(key).bodyWrittenAt ??= now(); };
  channel.subscribe("undici:client:connected", onConnected);
  channel.subscribe("undici:client:sendHeaders", onHeaders);
  channel.subscribe("undici:request:bodySent", onBody);
  const overall = new AbortController();
  const wall = setTimeout(() => overall.abort(), TOTAL_DEADLINE_MS);

  async function one(step) {
    const endpoint = new URL("/realtime/v1/api/broadcast/" + encodeURIComponent("room:" + step.room) +
      "/events/room_changed?private=true", url);
    const key = endpoint.pathname + endpoint.search;
    const state = {};
    progress.set(key, state);
    const connectionsBefore = connections;
    const startedAt = new Date().toISOString();
    const started = now();
    const record = { id: step.id, role: step.role, version: step.version, startedAt, deadlineMs: REQUEST_DEADLINE_MS };
    try {
      const response = await send(endpoint, {
        method: "POST", redirect: "error",
        headers: { "content-type": "application/json", apikey: secret },
        body: JSON.stringify({ roomId: step.room, version: step.version }),
        signal: AbortSignal.any([timeout(REQUEST_DEADLINE_MS), overall.signal]),
      });
      record.ms = Math.round(now() - started);
      record.http = response.status;
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      record.ms = Math.round(now() - started);
      record.http = null;
      record.failure = classify(error);
    } finally {
      progress.delete(key);
    }
    record.bodyWrittenAfterMs = state.bodyWrittenAt === undefined ? null : Math.round(state.bodyWrittenAt - started);
    record.newConnections = connections - connectionsBefore;
    return record;
  }

  const results = [];
  let warmup = null;
  try {
    // Warm only the TCP/TLS connection (Auth health, not Realtime) so P1 isolates the provider's tenant start.
    const warmStart = now();
    try {
      const response = await send(new URL("/auth/v1/health", url), {
        redirect: "error", headers: { apikey: secret }, signal: AbortSignal.any([timeout(REQUEST_DEADLINE_MS), overall.signal]),
      });
      warmup = { http: response.status, ms: Math.round(now() - warmStart) };
      await response.body?.cancel().catch(() => {});
    } catch (error) {
      warmup = { http: null, ms: Math.round(now() - warmStart), failure: classify(error) };
    }
    const plan = buildPlan(makeRoom);
    for (const step of plan.sequential) {
      const record = await one(step);
      results.push(record);
      // Credential/policy problems are not a latency result: stop instead of probing further.
      if (step.id === "P1" && record.http !== null && (record.http === 401 || record.http === 403)) break;
      if (overall.signal.aborted) break;
    }
    if (results.length === plan.sequential.length && !overall.signal.aborted) {
      results.push(...await Promise.all(plan.concurrent.map(one)));
    }
  } finally {
    clearTimeout(wall);
    channel.unsubscribe("undici:client:connected", onConnected);
    channel.unsubscribe("undici:client:sendHeaders", onHeaders);
    channel.unsubscribe("undici:request:bodySent", onBody);
  }
  return { connectionWarmup: warmup, requests: results, ...summarize(results), concurrentRequests: CONCURRENT_ROOMS, totalDeadlineMs: TOTAL_DEADLINE_MS };
}

// Rebuilds a probe result from fixed enumerations and bounded integers before it can reach evidence.
function readProbe(value) {
  const int = n => Number.isSafeInteger(n) && n >= 0;
  if (!value || !VERDICTS.has(value.verdict) || !Array.isArray(value.requests) || value.requests.length > 10) return null;
  const requests = [];
  for (const r of value.requests) {
    if (!/^P(?:[1-9]|10)$/.test(r?.id) || !ROLES.has(r.role) || !int(r.version) || !int(r.ms) || !int(r.newConnections) ||
      !(r.http === null || (Number.isSafeInteger(r.http) && r.http >= 100 && r.http <= 599)) ||
      !(r.failure === undefined || CATEGORIES.has(r.failure)) ||
      !(r.bodyWrittenAfterMs === null || int(r.bodyWrittenAfterMs)) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.startedAt)) return null;
    requests.push({
      id: r.id, role: r.role, version: r.version, startedAt: r.startedAt, ms: r.ms, http: r.http,
      failure: r.failure ?? null, bodyWrittenAfterMs: r.bodyWrittenAfterMs, newConnections: r.newConnections,
      deadlineMs: REQUEST_DEADLINE_MS,
    });
  }
  const optional = n => (n === null || int(n) ? n : undefined);
  const ratio = value.coldToWarmMedianRatio;
  const w = value.connectionWarmup;
  if ([value.coldFirstMs, value.warmMedianMs, value.warmMaxMs, value.concurrentMaxMs].some(n => optional(n) === undefined) ||
    !int(value.concurrentOverAppDeadline) || !(ratio === null || (Number.isFinite(ratio) && ratio >= 0)) ||
    !(w === null || (int(w.ms) && (w.http === null || (Number.isSafeInteger(w.http) && w.http >= 100 && w.http <= 599)) &&
      (w.failure === undefined || CATEGORIES.has(w.failure))))) return null;
  return {
    verdict: value.verdict, appDeadlineMs: APP_DEADLINE_MS, coldFirstMs: value.coldFirstMs, warmMedianMs: value.warmMedianMs,
    warmMaxMs: value.warmMaxMs, coldToWarmMedianRatio: ratio, coldReusedConnection: value.coldReusedConnection === true,
    concurrentMaxMs: value.concurrentMaxMs, concurrentOverAppDeadline: value.concurrentOverAppDeadline,
    connectionWarmup: w ? { http: w.http, ms: w.ms, failure: w.failure ?? null } : null,
    concurrentRequests: CONCURRENT_ROOMS, totalDeadlineMs: TOTAL_DEADLINE_MS, requests,
  };
}

module.exports = {
  APP_DEADLINE_MS, CATEGORIES, REQUEST_DEADLINE_MS, TOTAL_DEADLINE_MS, buildPlan, classify, interpret, readProbe, runColdStartProbe,
};
