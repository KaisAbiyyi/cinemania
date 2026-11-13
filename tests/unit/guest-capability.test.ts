// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { assertSameOriginCsrf } from "@/lib/server/auth/csrfGuard";
import {
  CapabilityAuthError,
  getGuestCookieName,
  mintGuestCapabilityToken,
  shouldUseSecureCookie,
  verifyGuestCapabilityToken,
} from "@/lib/server/auth/guestCapability";
import { mintSupabaseRealtimeJwt } from "@/lib/server/auth/roomAuth";
import {
  getRoomAuthorityStore,
  resetRoomAuthorityStoreForTests,
  resolvePostgresPoolConfig,
} from "@/lib/server/room/roomStore";

const TEST_SECRET = "unit-test-capability-secret-32-bytes-minimum";
const ROOM_A = "11111111-1111-4111-8111-111111111111";
const ROOM_B = "22222222-2222-4222-8222-222222222222";
const PARTICIPANT_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SECRET = process.env.CINEMATCH_CAPABILITY_SECRET;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_PG_HOST = process.env.SUPABASE_PG_HOST;
const ORIGINAL_PG_PASSWORD = process.env.SUPABASE_PG_PASSWORD;
const ORIGINAL_ALLOW_SQLITE = process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD;

afterEach(() => {
  resetRoomAuthorityStoreForTests();
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
  for (const [key, value] of [
    ["CINEMATCH_CAPABILITY_SECRET", ORIGINAL_SECRET],
    ["DATABASE_URL", ORIGINAL_DATABASE_URL],
    ["SUPABASE_PG_HOST", ORIGINAL_PG_HOST],
    ["SUPABASE_PG_PASSWORD", ORIGINAL_PG_PASSWORD],
    ["CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD", ORIGINAL_ALLOW_SQLITE],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("CINE-013: Guest Capability Token Unit Tests", () => {
  it("mints and verifies signed v1 capability claims with RFC 7519 integer seconds", () => {
    const nowMs = 1_760_000_000_500;
    const { token, claims } = mintGuestCapabilityToken({
      roomId: ROOM_A,
      participantId: PARTICIPANT_1,
      role: "HOST",
      generation: 1,
      ttlSeconds: 3600,
      nowMs,
      secret: TEST_SECRET,
    });

    expect(token.startsWith("v1.")).toBe(true);
    expect(claims.iat).toBe(1_760_000_000);
    expect(claims.exp).toBe(1_760_003_600);
    expect(claims.iat).toBeLessThan(1e11);

    const verified = verifyGuestCapabilityToken(token, {
      expectedRoomId: ROOM_A,
      nowMs: nowMs + 60_000,
      secret: TEST_SECRET,
    });
    expect(verified).toEqual(claims);
  });

  it("rejects tampered payloads, forged signatures, and wrong signing secrets", () => {
    const nowMs = 1_760_000_000_000;
    const { token } = mintGuestCapabilityToken({
      roomId: ROOM_A,
      participantId: PARTICIPANT_1,
      role: "MEMBER",
      nowMs,
      secret: TEST_SECRET,
    });

    const parts = token.split(".");
    // Escalate role in payload without updating HMAC
    const payloadObj = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    payloadObj.role = "HOST";
    const escalatedPayload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
    const tamperedToken = `${parts[0]}.${escalatedPayload}.${parts[2]}`;

    expect(() =>
      verifyGuestCapabilityToken(tamperedToken, {
        expectedRoomId: ROOM_A,
        nowMs,
        secret: TEST_SECRET,
      })
    ).toThrowError(CapabilityAuthError);

    expect(() =>
      verifyGuestCapabilityToken(token, {
        expectedRoomId: ROOM_A,
        nowMs,
        secret: "completely-different-secret-with-enough-length",
      })
    ).toThrowError(/signature/i);

    expect(() =>
      verifyGuestCapabilityToken(`v2.${parts[1]}.${parts[2]}`, {
        expectedRoomId: ROOM_A,
        nowMs,
        secret: TEST_SECRET,
      })
    ).toThrowError(/Malformed/);
  });

  it("enforces token expiration, millisecond timestamp rejection, and generation revocation", () => {
    const nowMs = 1_760_000_000_000;
    const { token } = mintGuestCapabilityToken({
      roomId: ROOM_A,
      participantId: PARTICIPANT_1,
      role: "HOST",
      generation: 2,
      ttlSeconds: 300,
      nowMs,
      secret: TEST_SECRET,
    });

    // Expired
    expect(() =>
      verifyGuestCapabilityToken(token, {
        expectedRoomId: ROOM_A,
        nowMs: nowMs + 300_000,
        secret: TEST_SECRET,
      })
    ).toThrowError(/expired/i);

    // Rotated / revoked generation
    expect(() =>
      verifyGuestCapabilityToken(token, {
        expectedRoomId: ROOM_A,
        minGeneration: 3,
        nowMs: nowMs + 10_000,
        secret: TEST_SECRET,
      })
    ).toThrowError(/rotated or revoked/i);

    // Room mismatch (cross-room replay attempt)
    expect(() =>
      verifyGuestCapabilityToken(token, {
        expectedRoomId: ROOM_B,
        nowMs: nowMs + 10_000,
        secret: TEST_SECRET,
      })
    ).toThrowError(/not valid for this room/i);

    // Craft HMAC-signed token carrying millisecond timestamps -> rejected
    const badClaims = {
      v: 1,
      sid: crypto.randomUUID(),
      rid: ROOM_A,
      pid: PARTICIPANT_1,
      role: "HOST",
      gen: 1,
      iat: nowMs,
      exp: nowMs + 3600_000,
    };
    const badPayload = Buffer.from(JSON.stringify(badClaims), "utf8").toString("base64url");
    const badSig = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(`v1.${badPayload}`, "utf8")
      .digest("base64url");

    expect(() =>
      verifyGuestCapabilityToken(`v1.${badPayload}.${badSig}`, {
        expectedRoomId: ROOM_A,
        nowMs,
        secret: TEST_SECRET,
      })
    ).toThrowError(/lifetime/i);
  });

  it("sets Secure flag appropriately for HTTPS, production hosts, and local HTTP loopback", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";

    expect(
      shouldUseSecureCookie(new Request("https://cinematch.example/api/guest/session"))
    ).toBe(true);
    expect(
      shouldUseSecureCookie(
        new Request("http://internal-proxy:3000/api/guest/session", {
          headers: { "x-forwarded-proto": "https" },
        })
      )
    ).toBe(true);
    expect(
      shouldUseSecureCookie(new Request("http://cinematch.example/api/guest/session"))
    ).toBe(true);
    expect(
      shouldUseSecureCookie(new Request("http://127.0.0.1:3055/api/guest/session"))
    ).toBe(false);
    expect(
      shouldUseSecureCookie(new Request("http://localhost:3000/api/guest/session"))
    ).toBe(false);
  });

  it("fails closed in production when CINEMATCH_CAPABILITY_SECRET is missing", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.CINEMATCH_CAPABILITY_SECRET;

    expect(() =>
      mintGuestCapabilityToken({
        roomId: ROOM_A,
        participantId: PARTICIPANT_1,
        role: "HOST",
      })
    ).toThrowError(/not configured/i);
  });

  it("derives unique room-scoped cookie names", () => {
    expect(getGuestCookieName(ROOM_A)).toBe(`cm_guest_${ROOM_A}`);
    expect(getGuestCookieName(ROOM_A)).not.toBe(getGuestCookieName(ROOM_B));
  });

  it("enforces same-origin CSRF checks on mutating requests", () => {
    expect(() =>
      assertSameOriginCsrf(new Request("http://localhost:3000/api/guest/session"))
    ).not.toThrow();

    expect(() =>
      assertSameOriginCsrf(
        new Request("https://app.cinematch.test/api/guest/session", {
          method: "POST",
          headers: { origin: "https://app.cinematch.test" },
        })
      )
    ).not.toThrow();

    expect(() =>
      assertSameOriginCsrf(
        new Request("https://app.cinematch.test/api/guest/session", {
          method: "POST",
          headers: { "sec-fetch-site": "same-origin" },
        })
      )
    ).not.toThrow();

    expect(() =>
      assertSameOriginCsrf(
        new Request("https://app.cinematch.test/api/guest/session", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        })
      )
    ).toThrowError(/Origin/);

    expect(() =>
      assertSameOriginCsrf(
        new Request("https://app.cinematch.test/api/guest/session", {
          method: "POST",
          headers: { origin: "null" },
        })
      )
    ).toThrowError(/Origin/);

    expect(() =>
      assertSameOriginCsrf(
        new Request("https://app.cinematch.test/api/guest/session", {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site", origin: "https://app.cinematch.test" },
        })
      )
    ).toThrowError(/Cross-site/);

    expect(() =>
      assertSameOriginCsrf(
        new Request("https://app.cinematch.test/api/guest/session", {
          method: "POST",
        })
      )
    ).toThrowError(/Missing Origin/);
  });

  it("mints RFC 7519 integer-second HS256 Supabase Realtime JWT scoped to room and participant", () => {
    const nowMs = 1_760_000_000_900;
    const jwt = mintSupabaseRealtimeJwt(
      {
        room: { id: ROOM_A } as never,
        participant: { participant_id: PARTICIPANT_1 } as never,
      },
      { secret: "supabase-realtime-jwt-secret-32bytes", ttlSeconds: 1800, nowMs }
    );

    const [headerB64, payloadB64, sigB64] = jwt.split(".");
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));

    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload.sub).toBe(PARTICIPANT_1);
    expect(payload.room_id).toBe(ROOM_A);
    expect(payload.role).toBe("authenticated");
    expect(payload.iat).toBe(1_760_000_000);
    expect(payload.exp).toBe(1_760_001_800);
    expect(sigB64.length).toBeGreaterThan(20);
  });

  it("fails closed in production when shared PostgreSQL config is missing or partial", () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.SUPABASE_PG_HOST;
    delete process.env.SUPABASE_PG_PASSWORD;
    delete process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD;

    expect(() => getRoomAuthorityStore()).toThrowError(/Shared PostgreSQL/);

    // Partial SUPABASE_PG_HOST without password fails closed instead of undefined Pool connectionString
    process.env.SUPABASE_PG_HOST = "aws-1-ap-northeast-2.pooler.supabase.com";
    expect(() => resolvePostgresPoolConfig()).toThrowError(/SUPABASE_PG_PASSWORD/);

    // Valid SUPABASE_PG_HOST + password builds structured PoolConfig with strict Supabase TLS
    process.env.SUPABASE_PG_PASSWORD = "dummy-password";
    const resolved = resolvePostgresPoolConfig();
    expect(resolved?.source).toBe("supabase_pg_env");
    expect(resolved?.poolConfig.host).toBe("aws-1-ap-northeast-2.pooler.supabase.com");
    expect(resolved?.poolConfig.password).toBe("dummy-password");
    expect(resolved?.poolConfig.ssl).toBeDefined();
  });
});
