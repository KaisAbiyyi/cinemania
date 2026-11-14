import crypto from "node:crypto";
import type { ParticipantRole } from "@/db/schema";

export const GUEST_COOKIE_PREFIX = "cm_guest_";
export const DEFAULT_CAPABILITY_TTL_SECONDS = 7200; // 2 hours
export const MAX_CAPABILITY_TTL_SECONDS = 86400; // 24 hours (ADR-003 ceiling)
export const MAX_CLOCK_SKEW_SECONDS = 60;

const TOKEN_VERSION = 1;
const MIN_SECRET_BYTES = 16;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Guard against millisecond timestamps accidentally encoded as RFC 7519 NumericDate seconds.
const MAX_PLAUSIBLE_EPOCH_SECONDS = 1e11;

export interface GuestCapabilityClaims {
  v: 1;
  sid: string;
  rid: string;
  pid: string;
  role: ParticipantRole;
  gen: number;
  iat: number;
  exp: number;
}

export interface MintCapabilityOptions {
  roomId: string;
  participantId: string;
  role: ParticipantRole;
  generation?: number;
  ttlSeconds?: number;
  nowMs?: number;
  secret?: string;
}

export interface VerifyCapabilityOptions {
  expectedRoomId: string;
  minGeneration?: number;
  nowMs?: number;
  secret?: string;
}

export interface CookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  secure: boolean;
  maxAge: number;
}

export class CapabilityAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CapabilityAuthError";
    this.status = status;
    this.code = code;
  }
}

const globalForSecret = globalThis as typeof globalThis & {
  __cinematchDevCapabilitySecret?: string;
};

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function getCapabilitySecret(explicitSecret?: string): string {
  const configured = explicitSecret ?? process.env.CINEMATCH_CAPABILITY_SECRET;
  if (typeof configured === "string" && configured.length > 0) {
    if (Buffer.byteLength(configured, "utf8") < MIN_SECRET_BYTES) {
      throw new CapabilityAuthError(
        500,
        "CAPABILITY_SECRET_MISCONFIGURED",
        "Capability secret does not meet minimum entropy length."
      );
    }
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new CapabilityAuthError(
      500,
      "CAPABILITY_SECRET_MISSING",
      "Server capability secret is not configured."
    );
  }

  if (!globalForSecret.__cinematchDevCapabilitySecret) {
    globalForSecret.__cinematchDevCapabilitySecret = crypto.randomBytes(32).toString("base64url");
  }
  return globalForSecret.__cinematchDevCapabilitySecret;
}

export function getGuestCookieName(roomId: string): string {
  if (!isValidUuid(roomId)) {
    throw new CapabilityAuthError(400, "INVALID_ROOM_ID", "Invalid room identifier.");
  }
  return `${GUEST_COOKIE_PREFIX}${roomId.toLowerCase()}`;
}

function signPayloadSegment(payloadSegment: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`v${TOKEN_VERSION}.${payloadSegment}`, "utf8")
    .digest("base64url");
}

function constantTimeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function mintGuestCapabilityToken(options: MintCapabilityOptions): {
  token: string;
  claims: GuestCapabilityClaims;
} {
  if (!isValidUuid(options.roomId)) {
    throw new CapabilityAuthError(400, "INVALID_ROOM_ID", "Invalid room identifier.");
  }
  if (!isValidUuid(options.participantId)) {
    throw new CapabilityAuthError(400, "INVALID_PARTICIPANT_ID", "Invalid participant identifier.");
  }
  if (options.role !== "HOST" && options.role !== "MEMBER") {
    throw new CapabilityAuthError(400, "INVALID_ROLE", "Invalid participant role.");
  }

  const generation = options.generation ?? 1;
  if (!Number.isInteger(generation) || generation < 1) {
    throw new CapabilityAuthError(400, "INVALID_GENERATION", "Capability generation must be >= 1.");
  }

  const ttlSeconds = Math.floor(options.ttlSeconds ?? DEFAULT_CAPABILITY_TTL_SECONDS);
  if (ttlSeconds < 1 || ttlSeconds > MAX_CAPABILITY_TTL_SECONDS) {
    throw new CapabilityAuthError(400, "INVALID_TTL", "Capability TTL is out of allowed bounds.");
  }

  const nowMs = options.nowMs ?? Date.now();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSeconds;

  const claims: GuestCapabilityClaims = {
    v: TOKEN_VERSION,
    sid: crypto.randomUUID(),
    rid: options.roomId.toLowerCase(),
    pid: options.participantId.toLowerCase(),
    role: options.role,
    gen: generation,
    iat,
    exp,
  };

  const payloadSegment = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const secret = getCapabilitySecret(options.secret);
  const signatureSegment = signPayloadSegment(payloadSegment, secret);

  return {
    token: `v${TOKEN_VERSION}.${payloadSegment}.${signatureSegment}`,
    claims,
  };
}

export function verifyGuestCapabilityToken(
  token: string,
  options: VerifyCapabilityOptions
): GuestCapabilityClaims {
  if (!isValidUuid(options.expectedRoomId)) {
    throw new CapabilityAuthError(400, "INVALID_ROOM_ID", "Invalid room identifier.");
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) {
    throw new CapabilityAuthError(401, "CAPABILITY_MISSING", "Missing or malformed guest capability.");
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== `v${TOKEN_VERSION}`) {
    throw new CapabilityAuthError(401, "CAPABILITY_MALFORMED", "Malformed guest capability token.");
  }

  const [, payloadSegment, signatureSegment] = parts;
  if (!payloadSegment || !signatureSegment) {
    throw new CapabilityAuthError(401, "CAPABILITY_MALFORMED", "Malformed guest capability token.");
  }

  const secret = getCapabilitySecret(options.secret);
  const expectedSig = signPayloadSegment(payloadSegment, secret);
  if (!constantTimeEqualStrings(signatureSegment, expectedSig)) {
    throw new CapabilityAuthError(401, "CAPABILITY_INVALID_SIGNATURE", "Invalid guest capability signature.");
  }

  let parsed: unknown;
  try {
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new CapabilityAuthError(401, "CAPABILITY_MALFORMED", "Unreadable guest capability payload.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new CapabilityAuthError(401, "CAPABILITY_MALFORMED", "Invalid guest capability payload.");
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.v !== TOKEN_VERSION ||
    !isValidUuid(candidate.sid) ||
    !isValidUuid(candidate.rid) ||
    !isValidUuid(candidate.pid) ||
    (candidate.role !== "HOST" && candidate.role !== "MEMBER") ||
    typeof candidate.gen !== "number" ||
    !Number.isInteger(candidate.gen) ||
    candidate.gen < 1 ||
    typeof candidate.iat !== "number" ||
    !Number.isInteger(candidate.iat) ||
    typeof candidate.exp !== "number" ||
    !Number.isInteger(candidate.exp)
  ) {
    throw new CapabilityAuthError(401, "CAPABILITY_INVALID_CLAIMS", "Invalid guest capability claims.");
  }

  if (
    candidate.iat <= 0 ||
    candidate.iat >= MAX_PLAUSIBLE_EPOCH_SECONDS ||
    candidate.exp <= 0 ||
    candidate.exp >= MAX_PLAUSIBLE_EPOCH_SECONDS ||
    candidate.exp <= candidate.iat ||
    candidate.exp - candidate.iat > MAX_CAPABILITY_TTL_SECONDS
  ) {
    throw new CapabilityAuthError(401, "CAPABILITY_INVALID_TIMESTAMPS", "Invalid capability token lifetime.");
  }

  const normalizedExpectedRoomId = options.expectedRoomId.toLowerCase();
  if (candidate.rid.toLowerCase() !== normalizedExpectedRoomId) {
    throw new CapabilityAuthError(
      403,
      "CAPABILITY_ROOM_MISMATCH",
      "Guest capability is not valid for this room."
    );
  }

  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (candidate.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS) {
    throw new CapabilityAuthError(401, "CAPABILITY_NOT_YET_VALID", "Guest capability issued in the future.");
  }
  if (nowSeconds >= candidate.exp) {
    throw new CapabilityAuthError(401, "CAPABILITY_EXPIRED", "Guest capability has expired.");
  }

  if (options.minGeneration !== undefined && candidate.gen < options.minGeneration) {
    throw new CapabilityAuthError(
      401,
      "CAPABILITY_REVOKED",
      "Guest capability has been rotated or revoked."
    );
  }

  return {
    v: TOKEN_VERSION,
    sid: candidate.sid.toLowerCase(),
    rid: candidate.rid.toLowerCase(),
    pid: candidate.pid.toLowerCase(),
    role: candidate.role,
    gen: candidate.gen,
    iat: candidate.iat,
    exp: candidate.exp,
  };
}

export function extractCookieValue(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";");
  for (const rawPair of pairs) {
    const eqIndex = rawPair.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = rawPair.slice(0, eqIndex).trim();
    if (name !== cookieName) continue;
    const rawValue = rawPair.slice(eqIndex + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function extractHostname(hostHeader: string | null): string {
  if (!hostHeader) return "";
  const first = hostHeader.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("[")) {
    const closing = first.indexOf("]");
    return closing > 0 ? first.slice(0, closing + 1) : first;
  }
  const colonIdx = first.indexOf(":");
  return colonIdx > -1 ? first.slice(0, colonIdx) : first;
}

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Sets Secure on HTTPS requests (including reverse-proxied x-forwarded-proto=https)
 * and non-loopback production hosts while keeping plain HTTP loopback E2E functional.
 */
export function shouldUseSecureCookie(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") {
    return true;
  }

  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(request.url);
    if (parsedUrl.protocol === "https:") {
      return true;
    }
  } catch {
    // Fall through to host inspection
  }

  const host = extractHostname(
    request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      parsedUrl?.host ||
      null
  );

  if (isLoopbackHostname(host)) {
    return false;
  }

  return process.env.NODE_ENV === "production";
}

export function buildGuestCookieAttributes(
  request: Request,
  roomId: string,
  token: string,
  maxAgeSeconds = DEFAULT_CAPABILITY_TTL_SECONDS
): CookieAttributes {
  return {
    name: getGuestCookieName(roomId),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: shouldUseSecureCookie(request),
    maxAge: maxAgeSeconds,
  };
}

export function buildClearedGuestCookieAttributes(
  request: Request,
  roomId: string
): CookieAttributes {
  return buildGuestCookieAttributes(request, roomId, "", 0);
}
