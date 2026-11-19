import {
  DEFAULT_EXPIRED_ROOM_RETENTION_SECONDS,
  DEFAULT_INACTIVITY_TTL_SECONDS,
  DEFAULT_RECONNECT_GRACE_SECONDS,
  Room,
} from "@/db/schema";
import { assertValidTransition } from "./stateMachine";

export interface SyntheticClock {
  now(): Date;
}

export class SystemClock implements SyntheticClock {
  now(): Date {
    return new Date();
  }
}

export interface ExpiryResult {
  expiredRoomIds: string[];
  processedCount: number;
  evaluatedAt: string;
}

export interface GraceRoomSweepOutcome {
  roomId: string;
  changed: boolean;
  hostTransferred: boolean;
  roundCancelled: boolean;
  nextHostParticipantId?: string | null;
  timedOutParticipantIds: string[];
}

export interface GraceSweepResult {
  hostTransferredRoomIds: string[];
  cancelledRoundRoomIds: string[];
  processedCount: number;
  evaluatedAt: string;
}

export interface CleanupResult {
  expiredRoomIds: string[];
  purgedRoomIds: string[];
  expiredCount: number;
  purgedCount: number;
  evaluatedAt: string;
}

export interface LifecycleSweepResult {
  grace: GraceSweepResult;
  cleanup: CleanupResult;
  evaluatedAt: string;
}

export interface RoomPersistenceAdapter {
  findActiveRooms(): Promise<Room[]> | Room[];
  expireRoom(roomId: string, expectedVersion: number, expiredAt: string): Promise<boolean> | boolean;
}

export interface RoomLifecycleAdapter extends RoomPersistenceAdapter {
  sweepRoomGraceTimeouts(
    roomId: string,
    options?: { nowIso?: string; graceSeconds?: number; heartbeatStaleSeconds?: number }
  ): Promise<GraceRoomSweepOutcome> | GraceRoomSweepOutcome;
  purgeExpiredRooms(
    cutoffIso: string,
    options?: { roomIds?: readonly string[] }
  ): Promise<string[]> | string[];
}

function filterRoomsByIds(rooms: Room[], roomIds?: readonly string[]): Room[] {
  if (!roomIds) {
    return rooms;
  }
  if (roomIds.length === 0) {
    return [];
  }
  const allowedIds = new Set(roomIds.map((id) => id.toLowerCase()));
  return rooms.filter((room) => allowedIds.has(room.id.toLowerCase()));
}

/**
 * Lifecycle & Expiry Worker for CineMatch Rooms.
 * - Evaluates 90s disconnect reconnect grace during ACTIVE (cancelling incomplete rounds to LOBBY)
 *   and deterministic host handoff after 90s host disconnect.
 * - Evaluates configurable inactivity TTL (default 24h = 86400s) across LOBBY/ACTIVE/MATCHED/EXHAUSTED
 *   rooms using a pluggable clock, transitioning lapsed rooms to EXPIRED.
 * - Performs idempotent retention-compliant cleanup of EXPIRED rooms.
 *
 * Fenced against TOCTOU race conditions: repository adapters verify state_version and fresh
 * timestamps under exclusive room locks (`SELECT ... FOR UPDATE` / `BEGIN IMMEDIATE`).
 */
export class RoomExpiryWorker {
  private readonly defaultTtlSeconds: number;
  private readonly defaultGraceSeconds: number;
  private readonly clock: SyntheticClock;

  constructor(
    defaultTtlSeconds = DEFAULT_INACTIVITY_TTL_SECONDS,
    clock: SyntheticClock = new SystemClock(),
    defaultGraceSeconds = DEFAULT_RECONNECT_GRACE_SECONDS
  ) {
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.clock = clock;
    this.defaultGraceSeconds = defaultGraceSeconds;
  }

  /**
   * Processes all non-expired rooms, transitioning lapsed rooms to 'EXPIRED' status.
   */
  async processExpiredRooms(
    adapter: RoomPersistenceAdapter,
    options?: { roomIds?: readonly string[] }
  ): Promise<ExpiryResult> {
    const now = this.clock.now();
    const rooms = filterRoomsByIds(await adapter.findActiveRooms(), options?.roomIds);
    const expiredRoomIds: string[] = [];

    for (const room of rooms) {
      if (room.status === "EXPIRED") {
        continue;
      }

      const ttlSeconds = room.inactivity_ttl_seconds || this.defaultTtlSeconds;
      const lastActivityTime = new Date(room.last_activity_at).getTime();
      const expiresAtTime = new Date(room.expires_at).getTime();
      const nowTime = now.getTime();

      const isPastLastActivityTtl = nowTime >= lastActivityTime + ttlSeconds * 1000;
      const isPastExplicitExpiry = nowTime >= expiresAtTime;

      // Both conditions ensure a room with recent activity does not expire prematurely
      if (isPastLastActivityTtl && isPastExplicitExpiry) {
        assertValidTransition(room.status, "EXPIRED", "Inactivity TTL exceeded");

        // Pass expected state_version to adapter to prevent race condition with concurrent votes
        const didExpire = await adapter.expireRoom(room.id, room.state_version, now.toISOString());
        if (didExpire) {
          expiredRoomIds.push(room.id);
        }
      }
    }

    return {
      expiredRoomIds,
      processedCount: expiredRoomIds.length,
      evaluatedAt: now.toISOString(),
    };
  }

  /**
   * Evaluates 90s disconnect grace timeouts across LOBBY/ACTIVE rooms, executing
   * deterministic host handoffs and cancelling incomplete ACTIVE rounds back to LOBBY.
   */
  async processGraceTimeouts(
    adapter: Pick<RoomLifecycleAdapter, "findActiveRooms" | "sweepRoomGraceTimeouts">,
    options?: { graceSeconds?: number; heartbeatStaleSeconds?: number; roomIds?: readonly string[] }
  ): Promise<GraceSweepResult> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const graceSeconds = options?.graceSeconds ?? this.defaultGraceSeconds;
    const rooms = filterRoomsByIds(await adapter.findActiveRooms(), options?.roomIds);

    const hostTransferredRoomIds: string[] = [];
    const cancelledRoundRoomIds: string[] = [];
    let processedCount = 0;

    for (const room of rooms) {
      if (room.status !== "LOBBY" && room.status !== "ACTIVE") {
        continue;
      }
      const outcome = await adapter.sweepRoomGraceTimeouts(room.id, {
        nowIso,
        graceSeconds,
        heartbeatStaleSeconds: options?.heartbeatStaleSeconds,
      });
      if (outcome.changed) {
        processedCount += 1;
      }
      if (outcome.hostTransferred) {
        hostTransferredRoomIds.push(room.id);
      }
      if (outcome.roundCancelled) {
        cancelledRoundRoomIds.push(room.id);
      }
    }

    return {
      hostTransferredRoomIds,
      cancelledRoundRoomIds,
      processedCount,
      evaluatedAt: nowIso,
    };
  }

  /**
   * Idempotently marks TTL-lapsed rooms EXPIRED and purges retention-eligible EXPIRED rooms.
   */
  async cleanupExpiredRooms(
    adapter: Pick<RoomLifecycleAdapter, "findActiveRooms" | "expireRoom" | "purgeExpiredRooms">,
    options?: { retentionGraceSeconds?: number; roomIds?: readonly string[] }
  ): Promise<CleanupResult> {
    const expiry = await this.processExpiredRooms(
      adapter,
      options?.roomIds ? { roomIds: options.roomIds } : undefined
    );
    const now = this.clock.now();
    const retentionSeconds =
      options?.retentionGraceSeconds ?? DEFAULT_EXPIRED_ROOM_RETENTION_SECONDS;
    const cutoffIso = new Date(now.getTime() - retentionSeconds * 1000).toISOString();
    const purgedRoomIds = await adapter.purgeExpiredRooms(
      cutoffIso,
      options?.roomIds ? { roomIds: options.roomIds } : undefined
    );

    return {
      expiredRoomIds: expiry.expiredRoomIds,
      purgedRoomIds,
      expiredCount: expiry.expiredRoomIds.length,
      purgedCount: purgedRoomIds.length,
      evaluatedAt: now.toISOString(),
    };
  }

  /**
   * Runs one complete deterministic lifecycle sweep: grace timeouts first, then expiry & cleanup.
   */
  async runLifecycleSweep(
    adapter: RoomLifecycleAdapter,
    options?: {
      graceSeconds?: number;
      heartbeatStaleSeconds?: number;
      retentionGraceSeconds?: number;
      roomIds?: readonly string[];
    }
  ): Promise<LifecycleSweepResult> {
    const grace = await this.processGraceTimeouts(adapter, {
      graceSeconds: options?.graceSeconds,
      heartbeatStaleSeconds: options?.heartbeatStaleSeconds,
      ...(options?.roomIds ? { roomIds: options.roomIds } : {}),
    });
    const cleanup = await this.cleanupExpiredRooms(adapter, {
      retentionGraceSeconds: options?.retentionGraceSeconds,
      ...(options?.roomIds ? { roomIds: options.roomIds } : {}),
    });
    return {
      grace,
      cleanup,
      evaluatedAt: this.clock.now().toISOString(),
    };
  }
}
