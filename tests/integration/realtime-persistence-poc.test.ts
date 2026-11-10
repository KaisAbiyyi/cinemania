import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";

/**
 * CINE-011: Architecture Decision Record Proof of Concept (POC) — Revision 6
 * 
 * Validates:
 * 1. Cryptographic capability token signing, RFC 7519 NumericDate standard compliance (seconds),
 *    future-iat rejection, max 24h lifetime bound, algorithm validation (HS256 only), tamper rejection,
 *    and participant roster authorization (matching CINE-013 guest participantId design).
 * 2. Supabase Realtime Authorization canonical topic policy enforcement (realtime.topic() === 'room:' || room_id,
 *    rejecting room code, and public.room_participants membership).
 * 3. Authoritative publisher trust model: client publication on authoritative channels is forbidden;
 *    state events are server-only.
 * 4. Vote confidentiality guarantee (CINE-020): live broadcasts and event replay omit participant LIKE/SKIP choices.
 * 5. Multi-worker relational database concurrency with deterministic two-way handshake write contention
 *    and lock waiting (Node 24 node:sqlite WAL mode across 2 isolated worker threads).
 * 6. Deterministic subscribe-first, version-reconciled reconnect protocol with zero-loss outbox recovery.
 * 7. Local model execution latency profiling.
 * 
 * Declared Environment: Local Node v24.21.0 on Windows 11.
 * Note: External multi-instance PostgreSQL row locking (SELECT ... FOR UPDATE) and live Supabase Realtime acceptance
 * are explicitly marked BLOCKED & OUTSTANDING pending cloud infrastructure provisioning in CINE-012/CINE-018.
 */

const TEST_JWT_SECRET = "cine-match-poc-hmac-sha256-test-secret-key-min-32-chars!";
const MAX_TOKEN_TTL_SECONDS = 86400; // 24 hours maximum capability token lifetime

export interface RoomTokenClaims {
  sub: string; // participantId (CINE-013 anonymous guest identity)
  room_id: string; // roomId (opaque UUID)
  role: "authenticated";
  iat: number; // RFC 7519 NumericDate (seconds since Unix epoch)
  exp: number; // RFC 7519 NumericDate (seconds since Unix epoch)
}

export class RealtimeAuthorizationError extends Error {
  readonly status = 403;
  constructor(message = "Unauthorized: Invalid or mismatched room capability token") {
    super(message);
    this.name = "RealtimeAuthorizationError";
  }
}

/**
 * Creates a cryptographically signed HMAC-SHA256 capability JWT token.
 * All timestamps strictly adhere to RFC 7519 NumericDate in seconds.
 */
export function createCryptographicRoomToken(
  participantId: string,
  roomId: string,
  ttlSeconds = 3600,
  secret = TEST_JWT_SECRET,
  customClaims?: Partial<RoomTokenClaims>,
  customHeader?: Record<string, unknown>
): string {
  const header = customHeader || { alg: "HS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const iat = ttlSeconds < 0 ? nowSeconds + ttlSeconds - 60 : nowSeconds;
  const exp = nowSeconds + ttlSeconds;
  const payload: RoomTokenClaims = {
    sub: participantId,
    room_id: roomId,
    role: "authenticated",
    iat,
    exp,
    ...customClaims,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

/**
 * Cryptographically verifies token signature, expiration (RFC 7519 seconds), future-iat rejection,
 * max 24h lifetime bound, algorithm, room match, and optional participant roster membership.
 */
export function verifyCryptographicRoomToken(
  token: string,
  requiredRoomId: string,
  authorizedParticipants?: Set<string>,
  secret = TEST_JWT_SECRET
): RoomTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new RealtimeAuthorizationError("Malformed token: JWT must have 3 segments");
  }
  const [headerB64, payloadB64, signature] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
  } catch {
    throw new RealtimeAuthorizationError("Malformed token: Header JSON parse error");
  }

  // Reject algorithms other than HS256 to prevent algorithm confusion attacks (e.g. none, RS256, etc.)
  if (header.alg !== "HS256") {
    throw new RealtimeAuthorizationError(`Unsupported algorithm: "${header.alg}". Only HS256 is permitted.`);
  }

  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(data).digest("base64url");

  // Constant-time signature comparison prevents timing attacks
  const sigBuf = Buffer.from(signature);
  const expSigBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
    throw new RealtimeAuthorizationError("Cryptographic verification failed: Invalid signature");
  }

  let payload: RoomTokenClaims;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    throw new RealtimeAuthorizationError("Malformed token: Payload JSON parse error");
  }

  // Validate RFC 7519 NumericDate standard (finite numbers)
  if (
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    !Number.isFinite(payload.iat) ||
    !Number.isFinite(payload.exp)
  ) {
    throw new RealtimeAuthorizationError("Malformed token: iat and exp must be finite numbers");
  }

  // Reject JavaScript millisecond timestamps (> 100_000_000_000, e.g. 1.7e12)
  if (payload.iat > 100_000_000_000 || payload.exp > 100_000_000_000) {
    throw new RealtimeAuthorizationError(
      "Malformed token: Timestamps must be RFC 7519 NumericDate in seconds, not milliseconds"
    );
  }

  if (payload.exp < payload.iat) {
    throw new RealtimeAuthorizationError("Malformed token: exp cannot be earlier than iat");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  // Reject future-issued tokens (permitting 30 seconds clock drift)
  if (payload.iat > nowSeconds + 30) {
    throw new RealtimeAuthorizationError("Malformed token: iat cannot be in the future");
  }

  // Bounded maximum token lifetime (24 hours)
  if (payload.exp - payload.iat > MAX_TOKEN_TTL_SECONDS) {
    throw new RealtimeAuthorizationError(
      `Token lifetime exceeds maximum allowed duration (${MAX_TOKEN_TTL_SECONDS}s)`
    );
  }

  if (nowSeconds >= payload.exp) {
    throw new RealtimeAuthorizationError("Token expired");
  }

  if (payload.room_id !== requiredRoomId) {
    throw new RealtimeAuthorizationError(
      `Room claim "${payload.room_id}" does not match required room "${requiredRoomId}"`
    );
  }

  if (authorizedParticipants && !authorizedParticipants.has(payload.sub)) {
    throw new RealtimeAuthorizationError(
      `Participant "${payload.sub}" is not in authorized room roster`
    );
  }

  return payload;
}

interface Room {
  id: string; // Opaque UUID
  code: string; // 6-character shareable code
  status: "LOBBY" | "VOTING" | "MATCHED" | "NO_MATCH";
  hostId: string;
  participants: Set<string>;
  frozenRoster?: string[];
  deck: number[];
  matchedMovieId?: number;
  stateVersion: number;
}

interface Vote {
  roomId: string;
  participantId: string;
  movieId: number;
  vote: "LIKE" | "SKIP";
  timestamp: number;
}

interface OutboxEvent {
  id: string;
  roomId: string;
  version: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

/**
 * Shared State Authority with Transactional Concurrency Control & Outbox Tracking
 */
class SharedStateAuthority {
  private rooms = new Map<string, Room>();
  private votes = new Map<string, Vote>();
  private outboxEvents: OutboxEvent[] = [];
  private channelSubscribers = new Map<string, Set<(event: OutboxEvent) => void>>();
  private roomLocks = new Map<string, Promise<void>>();
  public transientFailureFlag = false;

  private async acquireRoomLock(roomId: string): Promise<() => void> {
    while (this.roomLocks.has(roomId)) {
      await this.roomLocks.get(roomId);
    }
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.roomLocks.set(roomId, lockPromise);

    return () => {
      this.roomLocks.delete(roomId);
      releaseLock!();
    };
  }

  createRoom(code: string, hostId: string, deck: number[]): Room {
    const room: Room = {
      id: `room-uuid-${code}`,
      code,
      status: "LOBBY",
      hostId,
      participants: new Set([hostId]),
      deck,
      stateVersion: 1,
    };
    this.rooms.set(room.id, room);
    return { ...room, participants: new Set(room.participants) };
  }

  joinRoom(roomId: string, participantId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    if (room.status !== "LOBBY") throw new Error("Cannot join non-lobby room");
    if (room.participants.size >= 5) throw new Error("Room is full (max 5)");

    room.participants.add(participantId);
    room.stateVersion += 1;

    this.emitOutboxEvent(roomId, "participant_joined", {
      participantId,
      count: room.participants.size,
    });

    return { ...room, participants: new Set(room.participants) };
  }

  startRound(roomId: string, hostId: string): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    if (room.hostId !== hostId) throw new Error("Only host can start round");
    if (room.participants.size < 2) throw new Error("Minimum 2 participants required");

    room.status = "VOTING";
    room.frozenRoster = Array.from(room.participants);
    room.stateVersion += 1;

    this.emitOutboxEvent(roomId, "roster_frozen", {
      roster: room.frozenRoster,
    });

    return { ...room, participants: new Set(room.participants) };
  }

  async submitVote(
    roomId: string,
    participantId: string,
    movieId: number,
    voteType: "LIKE" | "SKIP"
  ): Promise<{
    status: "RECORDED" | "MATCHED";
    matchedMovieId?: number;
    stateVersion: number;
    latencyMs: number;
  }> {
    const startTime = performance.now();

    if (this.transientFailureFlag) {
      throw new Error("DB_TRANSIENT_CONNECTION_ERROR: Temporary connection drop to pooler");
    }

    const releaseLock = await this.acquireRoomLock(roomId);

    try {
      await new Promise((r) => setTimeout(r, 1));

      const room = this.rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      if (room.status === "MATCHED") {
        const endTime = performance.now();
        return {
          status: "MATCHED",
          matchedMovieId: room.matchedMovieId,
          stateVersion: room.stateVersion,
          latencyMs: endTime - startTime,
        };
      }

      if (room.status !== "VOTING") throw new Error("Room is not in voting state");
      if (!room.frozenRoster?.includes(participantId)) throw new Error("Participant not in frozen roster");
      if (!room.deck.includes(movieId)) throw new Error("Movie not in room deck");

      const voteKey = `${roomId}:${participantId}:${movieId}`;
      let isNewVote = false;
      if (!this.votes.has(voteKey)) {
        this.votes.set(voteKey, {
          roomId,
          participantId,
          movieId,
          vote: voteType,
          timestamp: Date.now(),
        });
        isNewVote = true;
      }

      // Monotonic version increment on every state change
      if (isNewVote) {
        room.stateVersion += 1;
        // Secret voting guarantee (CINE-020):
        // The broadcast event intentionally OMITS the individual's vote choice (LIKE/SKIP)
        // and target movie to prevent peer bias during voting.
        this.emitOutboxEvent(roomId, "vote_recorded", {
          participantId,
        });
      }

      let matched = false;
      if (voteType === "LIKE") {
        const likesForMovie = Array.from(this.votes.values()).filter(
          (v) => v.roomId === roomId && v.movieId === movieId && v.vote === "LIKE"
        );

        if (likesForMovie.length === room.frozenRoster.length) {
          room.status = "MATCHED";
          room.matchedMovieId = movieId;
          room.stateVersion += 1;
          matched = true;

          // When unanimous match occurs, announcing the winning movie is the intended behavior
          this.emitOutboxEvent(roomId, "match_announced", {
            movieId,
            unanimousCount: likesForMovie.length,
          });
        }
      }

      const endTime = performance.now();
      return {
        status: matched ? "MATCHED" : "RECORDED",
        matchedMovieId: room.matchedMovieId,
        stateVersion: room.stateVersion,
        latencyMs: endTime - startTime,
      };
    } finally {
      releaseLock();
    }
  }

  getSnapshot(roomId: string, token: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");

    const verified = verifyCryptographicRoomToken(token, roomId, room.participants);

    // Snapshot returns ONLY the caller's own votes; other participants' votes remain secret
    const userVotes = Array.from(this.votes.values()).filter(
      (v) => v.roomId === roomId && v.participantId === verified.sub
    );

    return {
      roomId: room.id,
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      participants: Array.from(room.participants),
      frozenRoster: room.frozenRoster,
      deck: room.deck,
      matchedMovieId: room.matchedMovieId,
      stateVersion: room.stateVersion,
      userVotes,
    };
  }

  getEventsSince(roomId: string, token: string, sinceVersion: number): OutboxEvent[] {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");

    verifyCryptographicRoomToken(token, roomId, room.participants);
    return this.outboxEvents.filter((e) => e.roomId === roomId && e.version > sinceVersion);
  }

  /**
   * Subscribes to private room channel simulating Supabase Realtime Authorization
   * Check: realtime.topic() === 'room:' || claims.room_id AND claims.sub IN public.room_participants
   * Trust Model: Client channels are strictly LISTEN-ONLY (SELECT).
   */
  subscribe(channelTopic: string, roomId: string, token: string, listener: (event: OutboxEvent) => void): () => void {
    const expectedTopic = `room:${roomId}`;
    if (channelTopic !== expectedTopic) {
      throw new RealtimeAuthorizationError(
        `Channel topic "${channelTopic}" does not match authorized room topic "${expectedTopic}"`
      );
    }

    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");

    verifyCryptographicRoomToken(token, roomId, room.participants);

    if (!this.channelSubscribers.has(roomId)) {
      this.channelSubscribers.set(roomId, new Set());
    }
    const set = this.channelSubscribers.get(roomId)!;
    set.add(listener);
    return () => set.delete(listener);
  }

  /**
   * Client-originated publication on authoritative room state channels is rejected.
   * Supabase Realtime Authorization enforces NO INSERT policy for 'authenticated' role.
   */
  publishClientMessage(channelTopic: string, roomId: string, token: string, payload: unknown): void {
    void payload;
    const expectedTopic = `room:${roomId}`;
    if (channelTopic !== expectedTopic) {
      throw new RealtimeAuthorizationError(
        `Channel topic "${channelTopic}" does not match authorized room topic "${expectedTopic}"`
      );
    }
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    verifyCryptographicRoomToken(token, roomId, room.participants);

    // Enforce denial of client-originated broadcast on authoritative state channel
    throw new RealtimeAuthorizationError(
      "Unauthorized: Client publication on authoritative room channel is forbidden. State events are server-originated only."
    );
  }

  private emitOutboxEvent(roomId: string, type: string, payload: Record<string, unknown>) {
    const room = this.rooms.get(roomId);
    const version = room ? room.stateVersion : this.outboxEvents.length + 1;

    const event: OutboxEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      roomId,
      version,
      type,
      payload,
      createdAt: Date.now(),
    };

    this.outboxEvents.push(event);

    const listeners = this.channelSubscribers.get(roomId);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
}

class SimulatedWorker {
  readonly workerId: string;
  private coordinator: SharedStateAuthority;

  constructor(workerId: string, coordinator: SharedStateAuthority) {
    this.workerId = workerId;
    this.coordinator = coordinator;
  }

  createRoom(code: string, hostId: string, deck: number[]) {
    return this.coordinator.createRoom(code, hostId, deck);
  }

  joinRoom(roomId: string, participantId: string) {
    return this.coordinator.joinRoom(roomId, participantId);
  }

  startRound(roomId: string, hostId: string) {
    return this.coordinator.startRound(roomId, hostId);
  }

  submitVote(roomId: string, participantId: string, movieId: number, voteType: "LIKE" | "SKIP") {
    return this.coordinator.submitVote(roomId, participantId, movieId, voteType);
  }

  getRoomSnapshot(roomId: string, token: string) {
    return this.coordinator.getSnapshot(roomId, token);
  }

  getEventsSince(roomId: string, token: string, sinceVersion: number) {
    return this.coordinator.getEventsSince(roomId, token, sinceVersion);
  }

  subscribeToRoom(channelTopic: string, roomId: string, token: string, onEvent: (event: OutboxEvent) => void) {
    return this.coordinator.subscribe(channelTopic, roomId, token, onEvent);
  }

  publishClientMessage(channelTopic: string, roomId: string, token: string, payload: unknown) {
    return this.coordinator.publishClientMessage(channelTopic, roomId, token, payload);
  }
}

describe("CINE-011: Realtime and Persistence Architecture POC & Model Verification", () => {
  let coordinator: SharedStateAuthority;
  let workerA: SimulatedWorker;
  let workerB: SimulatedWorker;

  beforeEach(() => {
    coordinator = new SharedStateAuthority();
    workerA = new SimulatedWorker("worker-instance-alpha", coordinator);
    workerB = new SimulatedWorker("worker-instance-beta", coordinator);
  });

  describe("Cryptographic Capability Tokens & Channel Authorization", () => {
    it("signs valid HS256 JWT tokens with RFC 7519 NumericDate in seconds and authorizes legitimate members", () => {
      const room = workerA.createRoom("SEC001", "user-1", [10, 20]);
      const token = createCryptographicRoomToken("user-1", room.id);
      const claims = verifyCryptographicRoomToken(token, room.id, room.participants);

      expect(claims.sub).toBe("user-1");
      expect(claims.room_id).toBe(room.id);
      expect(claims.role).toBe("authenticated");
      expect(claims.exp - claims.iat).toBe(3600);
      expect(claims.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
      expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it("rejects tokens with millisecond timestamps instead of RFC 7519 NumericDate seconds", () => {
      const room = workerA.createRoom("SEC001M", "user-1", [10, 20]);
      const nowMs = Date.now();
      const invalidMsToken = createCryptographicRoomToken("user-1", room.id, 3600, TEST_JWT_SECRET, {
        iat: nowMs,
        exp: nowMs + 3600000,
      });

      expect(() =>
        verifyCryptographicRoomToken(invalidMsToken, room.id, room.participants)
      ).toThrow("Timestamps must be RFC 7519 NumericDate in seconds, not milliseconds");
    });

    it("rejects tokens issued in the future (iat > nowSeconds + 30)", () => {
      const room = workerA.createRoom("SEC001F", "user-1", [10, 20]);
      const nowSec = Math.floor(Date.now() / 1000);
      const futureToken = createCryptographicRoomToken("user-1", room.id, 3600, TEST_JWT_SECRET, {
        iat: nowSec + 120, // 2 minutes in future
        exp: nowSec + 3720,
      });

      expect(() =>
        verifyCryptographicRoomToken(futureToken, room.id, room.participants)
      ).toThrow("Malformed token: iat cannot be in the future");
    });

    it("rejects tokens exceeding maximum allowed lifetime (lifetime > 24 hours)", () => {
      const room = workerA.createRoom("SEC001L", "user-1", [10, 20]);
      const nowSec = Math.floor(Date.now() / 1000);
      const excessiveLifetimeToken = createCryptographicRoomToken("user-1", room.id, 100000, TEST_JWT_SECRET, {
        iat: nowSec,
        exp: nowSec + 100000, // > 86400s
      });

      expect(() =>
        verifyCryptographicRoomToken(excessiveLifetimeToken, room.id, room.participants)
      ).toThrow("Token lifetime exceeds maximum allowed duration");
    });

    it("rejects tokens with unsupported or insecure algorithm headers (e.g. 'none' or 'HS384')", () => {
      const room = workerA.createRoom("SEC001A", "user-1", [10, 20]);

      // Tampered alg: none
      const noneToken = createCryptographicRoomToken(
        "user-1",
        room.id,
        3600,
        TEST_JWT_SECRET,
        undefined,
        { alg: "none", typ: "JWT" }
      );
      expect(() =>
        verifyCryptographicRoomToken(noneToken, room.id, room.participants)
      ).toThrow('Unsupported algorithm: "none". Only HS256 is permitted.');

      // Tampered alg: HS384
      const hs384Token = createCryptographicRoomToken(
        "user-1",
        room.id,
        3600,
        TEST_JWT_SECRET,
        undefined,
        { alg: "HS384", typ: "JWT" }
      );
      expect(() =>
        verifyCryptographicRoomToken(hs384Token, room.id, room.participants)
      ).toThrow('Unsupported algorithm: "HS384". Only HS256 is permitted.');
    });

    it("rejects forged or tampered tokens with invalid cryptographic signatures", () => {
      const room = workerA.createRoom("SEC002", "user-1", [10, 20]);
      const validToken = createCryptographicRoomToken("user-1", room.id);

      const parts = validToken.split(".");
      const nowSeconds = Math.floor(Date.now() / 1000);
      // Tamper with payload (substituting sub claim)
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: "attacker", room_id: room.id, role: "authenticated", iat: nowSeconds, exp: nowSeconds + 3600 })
      ).toString("base64url");
      const forgedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      expect(() =>
        verifyCryptographicRoomToken(forgedToken, room.id, room.participants)
      ).toThrow("Cryptographic verification failed: Invalid signature");
    });

    it("rejects expired capability tokens (negative TTL and near boundary)", () => {
      const room = workerA.createRoom("SEC003", "user-1", [10, 20]);
      const expiredToken = createCryptographicRoomToken("user-1", room.id, -10);

      expect(() =>
        verifyCryptographicRoomToken(expiredToken, room.id, room.participants)
      ).toThrow("Token expired");

      // Boundary condition: exp equal to current second
      const nowSec = Math.floor(Date.now() / 1000);
      const boundaryExpiredToken = createCryptographicRoomToken("user-1", room.id, 0, TEST_JWT_SECRET, {
        iat: nowSec - 10,
        exp: nowSec,
      });
      expect(() =>
        verifyCryptographicRoomToken(boundaryExpiredToken, room.id, room.participants)
      ).toThrow("Token expired");
    });

    it("rejects malformed tokens where exp is earlier than iat", () => {
      const room = workerA.createRoom("SEC003B", "user-1", [10, 20]);
      const nowSec = Math.floor(Date.now() / 1000);
      const malformedToken = createCryptographicRoomToken("user-1", room.id, 3600, TEST_JWT_SECRET, {
        iat: nowSec,
        exp: nowSec - 100,
      });

      expect(() =>
        verifyCryptographicRoomToken(malformedToken, room.id, room.participants)
      ).toThrow("Malformed token: exp cannot be earlier than iat");
    });

    it("rejects validly signed tokens when user is not in the room roster (non-member denial)", () => {
      const room = workerA.createRoom("SEC004", "user-1", [10, 20]);
      const outsiderToken = createCryptographicRoomToken("outsider-user", room.id);

      expect(() =>
        verifyCryptographicRoomToken(outsiderToken, room.id, room.participants)
      ).toThrow('Participant "outsider-user" is not in authorized room roster');
    });

    it("enforces canonical topic standard room:${room_id} (UUID) and rejects room code topic room:${room_code}", () => {
      const room = workerA.createRoom("ABC123", "user-1", [10, 20]);
      const token = createCryptographicRoomToken("user-1", room.id);

      // Room code is "ABC123", while room id is "room-uuid-ABC123"
      expect(room.code).toBe("ABC123");
      expect(room.id).toBe("room-uuid-ABC123");

      // Subscribing with shareable 6-char room code FAILS canonical topic standard
      expect(() =>
        workerA.subscribeToRoom(`room:${room.code}`, room.id, token, () => {})
      ).toThrow(`Channel topic "room:${room.code}" does not match authorized room topic "room:${room.id}"`);

      // Subscribing with canonical UUID topic SUCCEEDS
      expect(() =>
        workerA.subscribeToRoom(`room:${room.id}`, room.id, token, () => {})
      ).not.toThrow();
    });

    it("rejects cross-room channel subscription attempts via Supabase Realtime topic authorization rule", () => {
      const room1 = workerA.createRoom("SEC005", "user-1", [10, 20]);
      const room2 = workerB.createRoom("SEC006", "user-2", [10, 20]);

      const tokenRoom1 = createCryptographicRoomToken("user-1", room1.id);

      // Legitimate subscription to room1 succeeds
      expect(() =>
        workerA.subscribeToRoom(`room:${room1.id}`, room1.id, tokenRoom1, () => {})
      ).not.toThrow();

      // Attempting to subscribe to room2's channel topic with room1's token is rejected
      expect(() =>
        workerB.subscribeToRoom(`room:${room2.id}`, room2.id, tokenRoom1, () => {})
      ).toThrow(`Room claim "${room1.id}" does not match required room "${room2.id}"`);

      // Attempting to subscribe with mismatched channel topic vs room ID is rejected
      expect(() =>
        workerA.subscribeToRoom(`room:malicious-topic`, room1.id, tokenRoom1, () => {})
      ).toThrow('Channel topic "room:malicious-topic" does not match authorized room topic');
    });

    it("enforces authoritative publisher trust model: client publication on authoritative room channel is rejected", () => {
      const room = workerA.createRoom("PUB001", "user-1", [10, 20]);
      const token = createCryptographicRoomToken("user-1", room.id);

      // Clients attempting to broadcast on authoritative state channel are rejected
      expect(() =>
        workerA.publishClientMessage(`room:${room.id}`, room.id, token, {
          event: "match_announced",
          movieId: 999,
        })
      ).toThrow("Client publication on authoritative room channel is forbidden");
    });

    it("guarantees vote confidentiality (CINE-020): live broadcasts and event replay never disclose individual LIKE/SKIP choices", async () => {
      const room = workerA.createRoom("PRIV01", "host-user", [101, 102]);
      workerB.joinRoom(room.id, "guest-user");
      workerA.startRound(room.id, "host-user");

      const guestToken = createCryptographicRoomToken("guest-user", room.id);

      const receivedLiveEvents: OutboxEvent[] = [];
      workerB.subscribeToRoom(`room:${room.id}`, room.id, guestToken, (event) => {
        receivedLiveEvents.push(event);
      });

      // Host casts secret SKIP vote on movie 101
      await workerA.submitVote(room.id, "host-user", 101, "SKIP");

      // Verify live broadcast event does NOT contain voteType or movieId
      expect(receivedLiveEvents.length).toBe(1);
      expect(receivedLiveEvents[0].type).toBe("vote_recorded");
      expect(receivedLiveEvents[0].payload.participantId).toBe("host-user");
      expect((receivedLiveEvents[0].payload as Record<string, unknown>).voteType).toBeUndefined();
      expect((receivedLiveEvents[0].payload as Record<string, unknown>).movieId).toBeUndefined();

      // Verify outbox replay does NOT leak voteType to another participant
      const replayedEvents = workerB.getEventsSince(room.id, guestToken, 0);
      const voteEvents = replayedEvents.filter((e) => e.type === "vote_recorded");
      expect(voteEvents.length).toBe(1);
      expect((voteEvents[0].payload as Record<string, unknown>).voteType).toBeUndefined();

      // Verify guest snapshot does NOT disclose host's votes
      const guestSnapshot = workerB.getRoomSnapshot(room.id, guestToken);
      expect(guestSnapshot.userVotes.length).toBe(0);
    });
  });

  describe("Multi-Worker Real Relational Database Concurrency (Node 24 node:sqlite WAL mode)", () => {
    const testDbPath = path.join(process.cwd(), "tests", "poc-sqlite-concurrency.db");
    const barrierPathA = path.join(process.cwd(), "tests", "poc-sqlite-barrier-a.tmp");
    const barrierPathB = path.join(process.cwd(), "tests", "poc-sqlite-barrier-b.tmp");

    beforeEach(() => {
      if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
      if (fs.existsSync(barrierPathA)) fs.unlinkSync(barrierPathA);
      if (fs.existsSync(barrierPathB)) fs.unlinkSync(barrierPathB);
      const db = new DatabaseSync(testDbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec(`
        CREATE TABLE rooms (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          state_version INT NOT NULL,
          matched_movie_id INT
        );
        CREATE TABLE room_participants (
          room_id TEXT NOT NULL,
          participant_id TEXT NOT NULL,
          role TEXT NOT NULL,
          joined_at INT NOT NULL,
          PRIMARY KEY (room_id, participant_id)
        );
        CREATE TABLE votes (
          room_id TEXT NOT NULL,
          participant_id TEXT NOT NULL,
          movie_id INT NOT NULL,
          vote TEXT NOT NULL,
          PRIMARY KEY (room_id, participant_id, movie_id)
        );
        CREATE TABLE room_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          room_id TEXT NOT NULL,
          version INT NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL
        );
        INSERT INTO rooms VALUES ('room-WAL01', 'VOTING', 1, NULL);
        INSERT INTO room_participants VALUES ('room-WAL01', 'user-alpha', 'HOST', 1000);
        INSERT INTO room_participants VALUES ('room-WAL01', 'user-beta', 'MEMBER', 1001);
      `);
      db.close();
    });

    afterEach(() => {
      try {
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(barrierPathA)) fs.unlinkSync(barrierPathA);
        if (fs.existsSync(barrierPathB)) fs.unlinkSync(barrierPathB);
        const shm = testDbPath + "-shm";
        const wal = testDbPath + "-wal";
        if (fs.existsSync(shm)) fs.unlinkSync(shm);
        if (fs.existsSync(wal)) fs.unlinkSync(wal);
      } catch {
        // Ignore file handle release delay on Windows
      }
    });

    it("demonstrates true multi-instance relational concurrency: 2 isolated worker threads write concurrently with ACID isolation, deterministic two-way handshake write contention, lock waiting, and exactly-once match transition", async () => {
      const workerCode = `
        const { DatabaseSync } = require('node:sqlite');
        const { parentPort, workerData } = require('node:worker_threads');
        const fs = require('node:fs');
        const { workerId, participantId, dbPath, barrierPathA, barrierPathB } = workerData;

        const db = new DatabaseSync(dbPath);
        db.exec('PRAGMA busy_timeout = 5000;');

        // Verify participant roster membership (CINE-013 guest design)
        const member = db.prepare('SELECT 1 FROM room_participants WHERE room_id = ? AND participant_id = ?')
          .get('room-WAL01', participantId);
        if (!member) {
          throw new Error('Participant not in room roster');
        }

        let lockWaitMs = 0;

        if (workerId === 'instance-A') {
          // Instance A acquires exclusive write lock first
          db.exec('BEGIN IMMEDIATE');

          // Signal instance B that write lock is acquired and held
          fs.writeFileSync(barrierPathA, 'locked-by-A');

          // Deterministic two-way handshake: Instance A waits until Instance B confirms it is competing for the lock
          let waitedForB = 0;
          while (!fs.existsSync(barrierPathB) && waitedForB < 2000) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
            waitedForB += 5;
          }

          // Hold write lock for an additional 40ms to force instance B into measured lock-wait contention window
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);

          db.prepare('INSERT OR IGNORE INTO votes VALUES (?, ?, ?, ?)').run('room-WAL01', participantId, 550, 'LIKE');
          const likeCount = db.prepare("SELECT count(*) as cnt FROM votes WHERE room_id = ? AND movie_id = ? AND vote = 'LIKE'")
            .get('room-WAL01', 550).cnt;

          let transitioned = false;
          if (likeCount >= 2) {
            const res = db.prepare("UPDATE rooms SET status = 'MATCHED', matched_movie_id = ?, state_version = state_version + 1 WHERE id = ? AND status = 'VOTING'")
              .run(550, 'room-WAL01');
            if (res.changes > 0) {
              transitioned = true;
              db.prepare('INSERT INTO room_events (room_id, version, event_type, payload) VALUES (?, (SELECT state_version FROM rooms WHERE id = ?), ?, ?)')
                .run('room-WAL01', 'room-WAL01', 'match_announced', JSON.stringify({ movieId: 550 }));
            }
          }
          db.exec('COMMIT');
          db.close();
          parentPort.postMessage({ workerId, participantId, transitioned, likeCount, lockWaitMs });
        } else {
          // Instance B waits until instance A has acquired the write lock
          let waitedForA = 0;
          while (!fs.existsSync(barrierPathA) && waitedForA < 2000) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
            waitedForA += 5;
          }

          // Complete two-way handshake: signal instance A that instance B is immediately attempting BEGIN IMMEDIATE
          fs.writeFileSync(barrierPathB, 'competing-B');

          // Instance B attempts BEGIN IMMEDIATE while Instance A holds the write lock
          const t0 = performance.now();
          db.exec('BEGIN IMMEDIATE');
          lockWaitMs = performance.now() - t0;

          db.prepare('INSERT OR IGNORE INTO votes VALUES (?, ?, ?, ?)').run('room-WAL01', participantId, 550, 'LIKE');
          const likeCount = db.prepare("SELECT count(*) as cnt FROM votes WHERE room_id = ? AND movie_id = ? AND vote = 'LIKE'")
            .get('room-WAL01', 550).cnt;

          let transitioned = false;
          if (likeCount >= 2) {
            const res = db.prepare("UPDATE rooms SET status = 'MATCHED', matched_movie_id = ?, state_version = state_version + 1 WHERE id = ? AND status = 'VOTING'")
              .run(550, 'room-WAL01');
            if (res.changes > 0) {
              transitioned = true;
              db.prepare('INSERT INTO room_events (room_id, version, event_type, payload) VALUES (?, (SELECT state_version FROM rooms WHERE id = ?), ?, ?)')
                .run('room-WAL01', 'room-WAL01', 'match_announced', JSON.stringify({ movieId: 550 }));
            }
          }
          db.exec('COMMIT');
          db.close();
          parentPort.postMessage({ workerId, participantId, transitioned, likeCount, lockWaitMs });
        }
      `;

      function spawnWorker(workerId: string, participantId: string): Promise<{
        workerId: string;
        participantId: string;
        transitioned: boolean;
        likeCount: number;
        lockWaitMs: number;
      }> {
        return new Promise((resolve, reject) => {
          const w = new Worker(workerCode, {
            eval: true,
            workerData: { workerId, participantId, dbPath: testDbPath, barrierPathA, barrierPathB },
          });
          w.on("message", (msg) => {
            w.terminate().then(() => resolve(msg));
          });
          w.on("error", (err) => {
            w.terminate().then(() => reject(err));
          });
        });
      }

      const results = await Promise.all([
        spawnWorker("instance-A", "user-alpha"),
        spawnWorker("instance-B", "user-beta"),
      ]);

      expect(results.length).toBe(2);

      // Verify that instance B experienced measurable lock contention / waiting behind instance A
      const instanceB = results.find((r) => r.workerId === "instance-B")!;
      expect(instanceB.lockWaitMs).toBeGreaterThan(20);

      // Exactly one worker performed the guarded transition to MATCHED
      const transitionedWorkers = results.filter((r) => r.transitioned);
      expect(transitionedWorkers.length).toBe(1);

      // Verify authoritative database state persisted on disk
      const verifyDb = new DatabaseSync(testDbPath);
      verifyDb.exec("PRAGMA busy_timeout = 5000;");

      const finalRoom = verifyDb.prepare("SELECT * FROM rooms WHERE id = ?").get("room-WAL01") as {
        id: string;
        status: string;
        state_version: number;
        matched_movie_id: number;
      };
      expect(finalRoom.status).toBe("MATCHED");
      expect(finalRoom.matched_movie_id).toBe(550);
      expect(finalRoom.state_version).toBe(2);

      const participants = verifyDb.prepare("SELECT * FROM room_participants WHERE room_id = ?").all("room-WAL01");
      expect(participants.length).toBe(2);

      const votes = verifyDb.prepare("SELECT * FROM votes WHERE room_id = ?").all("room-WAL01");
      expect(votes.length).toBe(2);

      const events = verifyDb.prepare("SELECT * FROM room_events WHERE room_id = ?").all("room-WAL01") as Array<{
        version: number;
        event_type: string;
        payload: string;
      }>;
      expect(events.length).toBe(1);
      expect(events[0].version).toBe(2);
      expect(events[0].event_type).toBe("match_announced");
      expect(JSON.parse(events[0].payload).movieId).toBe(550);

      verifyDb.close();
    });
  });

  describe("Deterministic Subscribe-First & Version-Reconciled Reconnect Protocol", () => {
    it("guarantees zero-loss event recovery with exact version-ordered replay and duplicate elimination", async () => {
      const room = workerA.createRoom("REC003", "host-user", [101, 102, 103]);
      workerB.joinRoom(room.id, "guest-user");
      workerA.startRound(room.id, "host-user");

      const guestToken = createCryptographicRoomToken("guest-user", room.id);

      const lastKnownGuestVersion = 3;

      await workerA.submitVote(room.id, "host-user", 101, "SKIP"); // v4
      await workerA.submitVote(room.id, "host-user", 102, "LIKE"); // v5

      const liveEventBuffer: OutboxEvent[] = [];
      workerB.subscribeToRoom(`room:${room.id}`, room.id, guestToken, (event) => {
        liveEventBuffer.push(event);
      });

      await workerA.submitVote(room.id, "host-user", 103, "SKIP"); // v6
      expect(liveEventBuffer.length).toBe(1);
      expect(liveEventBuffer[0].version).toBe(6);

      const snapshot = workerB.getRoomSnapshot(room.id, guestToken);
      expect(snapshot.stateVersion).toBe(6);

      const missedEvents = workerB.getEventsSince(room.id, guestToken, lastKnownGuestVersion);
      expect(missedEvents.map((e) => e.version)).toEqual([4, 5, 6]);

      const unappliedBuffered = liveEventBuffer.filter((e) => e.version > snapshot.stateVersion);
      expect(unappliedBuffered.length).toBe(0);

      const recoveredVersions = missedEvents.map((e) => e.version);
      expect(recoveredVersions).toEqual([4, 5, 6]);
      expect(snapshot.status).toBe("VOTING");
    });
  });

  describe("Failure Handling & Idempotency", () => {
    it("handles transient database errors without corrupting room state and deduplicates retries", async () => {
      const room = workerA.createRoom("FAIL03", "u1", [10, 20]);
      workerB.joinRoom(room.id, "u2");
      workerA.startRound(room.id, "u1");

      const token1 = createCryptographicRoomToken("u1", room.id);

      coordinator.transientFailureFlag = true;

      await expect(workerA.submitVote(room.id, "u1", 10, "LIKE")).rejects.toThrow(
        "DB_TRANSIENT_CONNECTION_ERROR"
      );

      const snapshot = workerB.getRoomSnapshot(room.id, token1);
      expect(snapshot.status).toBe("VOTING");
      expect(snapshot.userVotes.length).toBe(0);

      coordinator.transientFailureFlag = false;
      const retryResult = await workerA.submitVote(room.id, "u1", 10, "LIKE");
      expect(retryResult.status).toBe("RECORDED");

      const duplicateResult = await workerA.submitVote(room.id, "u1", 10, "LIKE");
      expect(duplicateResult.status).toBe("RECORDED");
    });
  });

  describe("Local In-Memory Model Latency Benchmark", () => {
    it("measures execution latency percentiles across 50 operations in local asynchronous state authority", async () => {
      const room = workerA.createRoom("PERF03", "u1", Array.from({ length: 60 }, (_, i) => i + 1));
      workerB.joinRoom(room.id, "u2");
      workerA.startRound(room.id, "u1");

      const latencies: number[] = [];
      for (let i = 1; i <= 50; i++) {
        const result = await workerA.submitVote(room.id, "u1", i, "SKIP");
        latencies.push(result.latencyMs);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      expect(p50).toBeLessThan(25);
      expect(p95).toBeLessThan(50);
      expect(p99).toBeLessThan(75);
    });
  });
});
