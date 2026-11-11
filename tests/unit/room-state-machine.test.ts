import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertValidTransition,
  InvalidStateTransitionError,
  validateStartRoundPrerequisites,
  RoomCapacityError,
  calculateExpiryTimestamp,
  isRoomExpired,
} from "@/lib/server/room/stateMachine";
import { RoomExpiryWorker, SyntheticClock } from "@/lib/server/room/expiryWorker";
import { Room, RoomStatus, DEFAULT_INACTIVITY_TTL_SECONDS } from "@/db/schema";

describe("CINE-012: Authoritative Room State Machine Transitions", () => {
  it.each([
    ["LOBBY", "ACTIVE"],
    ["ACTIVE", "MATCHED"],
    ["ACTIVE", "EXHAUSTED"],
    ["LOBBY", "EXPIRED"],
    ["ACTIVE", "EXPIRED"],
    ["MATCHED", "EXPIRED"],
    ["EXHAUSTED", "EXPIRED"],
  ] as [RoomStatus, RoomStatus][])("permits valid transition: %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each([
    ["MATCHED", "ACTIVE"],
    ["MATCHED", "LOBBY"],
    ["EXHAUSTED", "ACTIVE"],
    ["EXHAUSTED", "LOBBY"],
    ["EXPIRED", "LOBBY"],
    ["EXPIRED", "ACTIVE"],
    ["EXPIRED", "MATCHED"],
    ["EXPIRED", "EXHAUSTED"],
    ["LOBBY", "MATCHED"],
    ["LOBBY", "EXHAUSTED"],
  ] as [RoomStatus, RoomStatus][])("strictly rejects impossible transition: %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertValidTransition(from, to)).toThrowError(InvalidStateTransitionError);
  });

  it.each(["LOBBY", "ACTIVE", "MATCHED", "EXHAUSTED", "EXPIRED"] as RoomStatus[])(
    "treats idempotent self-transition as permitted: %s -> %s",
    (status) => {
      expect(canTransition(status, status)).toBe(true);
    }
  );
});

describe("CINE-012: Room Capacity & Deck Size Constraints", () => {
  it("rejects round start if participant count is less than 2", () => {
    expect(() => validateStartRoundPrerequisites(1, 20)).toThrowError(RoomCapacityError);
    expect(() => validateStartRoundPrerequisites(0, 20)).toThrowError(RoomCapacityError);
  });

  it("rejects round start if participant count exceeds 5", () => {
    expect(() => validateStartRoundPrerequisites(6, 20)).toThrowError(RoomCapacityError);
    expect(() => validateStartRoundPrerequisites(10, 20)).toThrowError(RoomCapacityError);
  });

  it("rejects round start if movie deck count is not exactly 20", () => {
    expect(() => validateStartRoundPrerequisites(3, 19)).toThrowError(
      /movie deck must contain exactly 20 titles/
    );
    expect(() => validateStartRoundPrerequisites(3, 21)).toThrowError(
      /movie deck must contain exactly 20 titles/
    );
  });

  it.each([2, 3, 4, 5])(
    "permits round start with %d participants and exactly 20 candidates",
    (participantCount) => {
      expect(() => validateStartRoundPrerequisites(participantCount, 20)).not.toThrow();
    }
  );
});

describe("CINE-012: Inactivity TTL & Expiry Worker with Synthetic Clock", () => {
  class TestSyntheticClock implements SyntheticClock {
    private currentTime: number;

    constructor(initialTime: number) {
      this.currentTime = initialTime;
    }

    now(): Date {
      return new Date(this.currentTime);
    }

    advance(seconds: number): void {
      this.currentTime += seconds * 1000;
    }
  }

  it("calculates exact expiry timestamp with default 24h (86400s) TTL", () => {
    const baseTime = new Date("2026-11-11T12:00:00.000Z");
    const expiry = calculateExpiryTimestamp(baseTime, DEFAULT_INACTIVITY_TTL_SECONDS);
    expect(expiry.toISOString()).toBe("2026-11-12T12:00:00.000Z");
  });

  it("supports configurable TTL duration (e.g. 1 hour = 3600s)", () => {
    const baseTime = new Date("2026-11-11T12:00:00.000Z");
    const expiry = calculateExpiryTimestamp(baseTime, 3600);
    expect(expiry.toISOString()).toBe("2026-11-11T13:00:00.000Z");
  });

  it("evaluates room expiry correctly before and after threshold", () => {
    const baseTime = new Date("2026-11-11T12:00:00.000Z");
    const beforeExpiry = new Date("2026-11-12T11:59:59.000Z");
    const atExpiry = new Date("2026-11-12T12:00:00.000Z");
    const afterExpiry = new Date("2026-11-12T12:00:01.000Z");

    expect(isRoomExpired(baseTime, DEFAULT_INACTIVITY_TTL_SECONDS, beforeExpiry)).toBe(false);
    expect(isRoomExpired(baseTime, DEFAULT_INACTIVITY_TTL_SECONDS, atExpiry)).toBe(true);
    expect(isRoomExpired(baseTime, DEFAULT_INACTIVITY_TTL_SECONDS, afterExpiry)).toBe(true);
  });

  it("expires abandoned rooms safely using synthetic clock without data deletion", async () => {
    const startTime = new Date("2026-11-11T12:00:00.000Z").getTime();
    const clock = new TestSyntheticClock(startTime);
    const worker = new RoomExpiryWorker(DEFAULT_INACTIVITY_TTL_SECONDS, clock);

    const testRooms: Room[] = [
      {
        id: "room-active-1",
        code: "ABC123",
        status: "LOBBY",
        host_participant_id: "host-1",
        state_version: 1,
        participant_count: 2,
        matched_movie_id: null,
        current_round_id: null,
        deck_filter: null,
        inactivity_ttl_seconds: 86400,
        last_activity_at: "2026-11-11T12:00:00.000Z",
        expires_at: "2026-11-12T12:00:00.000Z",
        created_at: "2026-11-11T12:00:00.000Z",
        updated_at: "2026-11-11T12:00:00.000Z",
      },
      {
        id: "room-already-expired",
        code: "OLD999",
        status: "EXPIRED",
        host_participant_id: "host-2",
        state_version: 5,
        participant_count: 2,
        matched_movie_id: null,
        current_round_id: null,
        deck_filter: null,
        inactivity_ttl_seconds: 86400,
        last_activity_at: "2026-11-10T12:00:00.000Z",
        expires_at: "2026-11-11T12:00:00.000Z",
        created_at: "2026-11-10T12:00:00.000Z",
        updated_at: "2026-11-10T12:00:00.000Z",
      },
    ];

    const expiredCalls: { id: string; version: number }[] = [];
    const mockAdapter = {
      findActiveRooms: () => testRooms,
      expireRoom: (roomId: string, newVersion: number) => {
        expiredCalls.push({ id: roomId, version: newVersion });
        const room = testRooms.find((r) => r.id === roomId);
        if (room) {
          room.status = "EXPIRED";
          room.state_version = newVersion;
        }
      },
    };

    // Advance clock by 12 hours: room should still be active
    clock.advance(12 * 3600);
    const resultMid = await worker.processExpiredRooms(mockAdapter);
    expect(resultMid.processedCount).toBe(0);
    expect(expiredCalls.length).toBe(0);

    // Advance clock past 24 hours: room should expire
    clock.advance(12 * 3600 + 1); // 24h + 1s elapsed
    const resultFinal = await worker.processExpiredRooms(mockAdapter);
    expect(resultFinal.processedCount).toBe(1);
    expect(resultFinal.expiredRoomIds).toEqual(["room-active-1"]);
    expect(expiredCalls).toEqual([{ id: "room-active-1", version: 2 }]);

    // Running again is idempotent and processes 0 rooms
    const resultIdempotent = await worker.processExpiredRooms(mockAdapter);
    expect(resultIdempotent.processedCount).toBe(0);
  });
});
