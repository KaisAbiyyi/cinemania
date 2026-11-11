import { DEFAULT_INACTIVITY_TTL_SECONDS, Room } from "@/db/schema";
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

export interface RoomPersistenceAdapter {
  findActiveRooms(): Promise<Room[]> | Room[];
  expireRoom(roomId: string, expectedVersion: number, expiredAt: string): Promise<boolean> | boolean;
}

/**
 * Expiry Worker for CineMatch Rooms.
 * Evaluates configurable inactivity TTL (default 24h = 86400s) using a pluggable clock
 * to safely expire abandoned or timed-out rooms without destructive data loss.
 * 
 * Invariant: Active rooms that regularly submit votes or joins have their expires_at
 * renewed atomically and will never expire prematurely.
 * Fenced against TOCTOU race condition: adapter verifies expectedVersion and fresh
 * last_activity_at under atomic transaction / row lock.
 */
export class RoomExpiryWorker {
  private readonly defaultTtlSeconds: number;
  private readonly clock: SyntheticClock;

  constructor(
    defaultTtlSeconds = DEFAULT_INACTIVITY_TTL_SECONDS,
    clock: SyntheticClock = new SystemClock()
  ) {
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.clock = clock;
  }

  /**
   * Processes all active or idle rooms, transitioning expired rooms to 'EXPIRED' status.
   */
  async processExpiredRooms(adapter: RoomPersistenceAdapter): Promise<ExpiryResult> {
    const now = this.clock.now();
    const rooms = await adapter.findActiveRooms();
    const expiredRoomIds: string[] = [];

    for (const room of rooms) {
      if (room.status === "EXPIRED" || room.status === "MATCHED" || room.status === "EXHAUSTED") {
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
}
