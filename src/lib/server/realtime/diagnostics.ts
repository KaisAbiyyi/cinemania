import { createHash, randomBytes } from "node:crypto";
import { subscribe } from "node:diagnostics_channel";

/**
 * Opt-in, privacy-bounded attempt diagnostics for the Realtime publisher and outbox.
 *
 * Records contain only fixed enumerations, small integers, a per-process salted room token (not
 * reversible and not comparable across processes) and the authoritative version number. They never
 * contain URLs, headers, keys, room or participant identifiers, votes, payloads or error messages.
 */
export const TRANSPORT_CATEGORIES = [
  "client_deadline", "client_abort", "dns_failure", "connect_timeout", "connect_unreachable",
  "connection_reset", "connection_closed", "response_timeout", "tls_failure", "unexpected_redirect",
  "unknown_fetch_failure",
] as const;
export type TransportCategory = (typeof TRANSPORT_CATEGORIES)[number];

/** How far the request got before the failure. Derived from undici diagnostics channels. */
export const TRANSPORT_PHASES = [
  "connecting_or_queued", "request_head_written", "request_written_awaiting_response", "unobserved",
] as const;
export type TransportPhase = (typeof TRANSPORT_PHASES)[number];

const salt = randomBytes(16);
export function realtimeDiagnosticsEnabled(): boolean {
  return process.env.CINEMATCH_REALTIME_DIAGNOSTICS === "1";
}

export function roomToken(roomId: string): string {
  return createHash("sha256").update(salt).update(roomId).digest("hex").slice(0, 8);
}

export function emitRealtimeDiagnostic(tag: "ATTEMPT" | "OUTBOX", record: Record<string, string | number | boolean>): void {
  if (!realtimeDiagnosticsEnabled()) return;
  console.warn(`[CINEMATCH_REALTIME_${tag}] ${JSON.stringify(record)}`);
}

const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
function codeOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const code = (value as { code?: unknown }).code;
  if (typeof code === "string" && SAFE_CODE.test(code)) return code;
  const errors = (value as { errors?: unknown }).errors;
  if (Array.isArray(errors)) for (const inner of errors) { const found = codeOf(inner); if (found) return found; }
  return undefined;
}

/** Maps a rejected fetch to a fixed category and an optional allowlisted system/undici code. */
export function classifyTransportFailure(error: unknown): { category: TransportCategory; code?: string } {
  const name = typeof error === "object" && error !== null ? String((error as { name?: unknown }).name) : "";
  if (name === "TimeoutError") return { category: "client_deadline" };
  if (name === "AbortError") return { category: "client_abort" };
  const cause = typeof error === "object" && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const code = codeOf(cause) ?? codeOf(error);
  const causeMessage = typeof cause === "object" && cause !== null ? String((cause as { message?: unknown }).message) : "";
  const withCode = (category: TransportCategory) => (code ? { category, code } : { category });
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return withCode("dns_failure");
  if (code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT") return withCode("connect_timeout");
  if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ENETUNREACH") return withCode("connect_unreachable");
  if (code === "ECONNRESET" || code === "EPIPE") return withCode("connection_reset");
  if (code === "UND_ERR_SOCKET" || code === "UND_ERR_CLOSED" || code === "UND_ERR_DESTROYED") return withCode("connection_closed");
  if (code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return withCode("response_timeout");
  if (code && /^(ERR_TLS|ERR_SSL|ERR_OSSL|CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_)/.test(code)) return withCode("tls_failure");
  if (/redirect/i.test(causeMessage)) return withCode("unexpected_redirect");
  return withCode("unknown_fetch_failure");
}

// Request progress is keyed by path+query only inside this map; keys are never logged.
const progress = new Map<string, 1 | 2 | 3>();
let installed = false;
function pathOf(message: unknown): string | undefined {
  const request = typeof message === "object" && message !== null ? (message as { request?: { path?: unknown } }).request : undefined;
  return typeof request?.path === "string" ? request.path : undefined;
}
function raise(key: string | undefined, level: 1 | 2 | 3) {
  if (key === undefined) return;
  const current = progress.get(key);
  if (current !== undefined && current < level) progress.set(key, level);
}
function install() {
  if (installed) return;
  installed = true;
  subscribe("undici:request:create", message => { const key = pathOf(message); if (key !== undefined) progress.set(key, 1); });
  subscribe("undici:client:sendHeaders", message => raise(pathOf(message), 2));
  subscribe("undici:request:bodySent", message => raise(pathOf(message), 3));
}

/** Observes one attempt. Returns a reader for the furthest observed phase; call `done` in `finally`. */
export function trackRequestPhase(path: string): { phase(): TransportPhase; done(): void } {
  if (!realtimeDiagnosticsEnabled()) return { phase: () => "unobserved", done() {} };
  install();
  progress.delete(path);
  return {
    phase() {
      const level = progress.get(path);
      return level === 1 ? "connecting_or_queued" : level === 2 ? "request_head_written" :
        level === 3 ? "request_written_awaiting_response" : "unobserved";
    },
    done() { progress.delete(path); },
  };
}
