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
  expireRoom(roomId: string, newVersion: number, expiredAt: string): Promise<void> | void;
}

/**
 * Expiry Worker for CineMatch Rooms.
 * Evaluates configurable inactivity TTL (default 24h = 86400s) using a pluggable clock
 * to safely expire abandoned or timed-out rooms without destructive data loss.
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
      if (room.status === "EXPIRED") continue;

      const ttlSeconds = room.inactivity_ttl_seconds || this.defaultTtlSeconds;
      const lastActivityTime = new Date(room.last_activity_at).getTime();
      const expiresAtTime = new Date(room.expires_at).getTime();
      const nowTime = now.getTime();

      const isPastLastActivityTtl = nowTime >= lastActivityTime + ttlSeconds * 1000;
      const isPastExplicitExpiry = nowTime >= expiresAtTime;

      if (isPastLastActivityTtl || isPastExplicitExpiry) {
        // Enforce state machine rules: assert valid transition from current status to EXPIRED
        assertValidTransition(room.status, "EXPIRED", "Inactivity TTL exceeded");

        const newVersion = room.state_version + 1;
        await adapter.expireRoom(room.id, newVersion, now.toISOString());
        expiredRoomIds.push(room.id);
      }
    }

    return {
      expiredRoomIds,
      processedCount: expiredRoomIds.length,
      evaluatedAt: now.toISOString(),
    };
  }
}
