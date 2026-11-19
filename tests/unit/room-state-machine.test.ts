import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertValidTransition,
  InvalidStateTransitionError,
  validateStartRoundPrerequisites,
  RoomCapacityError,
  calculateExpiryTimestamp,
  calculateGraceExpiryTimestamp,
  isGraceExpired,
  isRoomExpired,
  selectDeterministicHostSuccessor,
} from "@/lib/server/room/stateMachine";
import { RoomExpiryWorker, SyntheticClock } from "@/lib/server/room/expiryWorker";
import {
  Room,
  RoomParticipant,
  RoomStatus,
  DEFAULT_INACTIVITY_TTL_SECONDS,
  DEFAULT_RECONNECT_GRACE_SECONDS,
} from "@/db/schema";

describe("CINE-012 / CINE-020: Authoritative Room State Machine Transitions", () => {
  it.each([
    ["LOBBY", "ACTIVE"],
    ["ACTIVE", "MATCHED"],
    ["ACTIVE", "EXHAUSTED"],
    ["ACTIVE", "LOBBY"],
    ["EXHAUSTED", "LOBBY"],
    ["EXHAUSTED", "ACTIVE"],
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
    ["MATCHED", "EXHAUSTED"],
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
      expireRoom: (roomId: string, expectedVersion: number) => {
        expiredCalls.push({ id: roomId, version: expectedVersion });
        const room = testRooms.find((r) => r.id === roomId);
        if (room) {
          room.status = "EXPIRED";
          room.state_version = expectedVersion + 1;
          return true;
        }
        return false;
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
    expect(expiredCalls).toEqual([{ id: "room-active-1", version: 1 }]);

    // Running again is idempotent and processes 0 rooms
    const resultIdempotent = await worker.processExpiredRooms(mockAdapter);
    expect(resultIdempotent.processedCount).toBe(0);
  });

  it("calculates 90s reconnect grace deadlines and selects deterministic connected host successors", () => {
    const disconnectAt = new Date("2026-11-11T12:00:00.000Z");
    const deadline = calculateGraceExpiryTimestamp(disconnectAt, DEFAULT_RECONNECT_GRACE_SECONDS);
    expect(deadline.toISOString()).toBe("2026-11-11T12:01:30.000Z");

    expect(isGraceExpired(disconnectAt, 90, new Date("2026-11-11T12:01:29.999Z"))).toBe(false);
    expect(isGraceExpired(disconnectAt, 90, new Date("2026-11-11T12:01:30.000Z"))).toBe(true);

    const roster: RoomParticipant[] = [
      {
        room_id: "r1",
        participant_id: "host-a",
        display_name: "Host A",
        role: "HOST",
        is_connected: false,
        joined_at: "2026-11-11T12:00:00.000Z",
        last_seen_at: "2026-11-11T12:00:10.000Z",
      },
      {
        room_id: "r1",
        participant_id: "guest-b-disconnected",
        display_name: "Guest B",
        role: "MEMBER",
        is_connected: false,
        joined_at: "2026-11-11T12:00:01.000Z",
        last_seen_at: "2026-11-11T12:00:10.000Z",
      },
      {
        room_id: "r1",
        participant_id: "guest-c-connected",
        display_name: "Guest C",
        role: "MEMBER",
        is_connected: true,
        joined_at: "2026-11-11T12:00:02.000Z",
        last_seen_at: "2026-11-11T12:01:00.000Z",
      },
      {
        room_id: "r1",
        participant_id: "guest-d-tiebreak",
        display_name: "Guest D",
        role: "MEMBER",
        is_connected: true,
        joined_at: "2026-11-11T12:00:02.000Z",
        last_seen_at: "2026-11-11T12:01:00.000Z",
      },
    ];

    const successor = selectDeterministicHostSuccessor(roster, "host-a", {
      requireConnected: true,
    });
    expect(successor?.participant_id).toBe("guest-c-connected");
  });

  it("expires MATCHED and EXHAUSTED rooms once 24h TTL elapses", async () => {
    const startTime = new Date("2026-11-11T12:00:00.000Z").getTime();
    const clock = new TestSyntheticClock(startTime);
    const worker = new RoomExpiryWorker(DEFAULT_INACTIVITY_TTL_SECONDS, clock);

    const testRooms: Room[] = [
      {
        id: "room-matched",
        code: "MAT123",
        status: "MATCHED",
        host_participant_id: "host-1",
        state_version: 10,
        participant_count: 2,
        matched_movie_id: 555,
        current_round_id: "round-1",
        deck_filter: null,
        inactivity_ttl_seconds: 86400,
        last_activity_at: "2026-11-11T12:00:00.000Z",
        expires_at: "2026-11-12T12:00:00.000Z",
        created_at: "2026-11-11T12:00:00.000Z",
        updated_at: "2026-11-11T12:00:00.000Z",
      },
      {
        id: "room-exhausted",
        code: "EXH456",
        status: "EXHAUSTED",
        host_participant_id: "host-2",
        state_version: 22,
        participant_count: 2,
        matched_movie_id: null,
        current_round_id: "round-2",
        deck_filter: null,
        inactivity_ttl_seconds: 86400,
        last_activity_at: "2026-11-11T12:00:00.000Z",
        expires_at: "2026-11-12T12:00:00.000Z",
        created_at: "2026-11-11T12:00:00.000Z",
        updated_at: "2026-11-11T12:00:00.000Z",
      },
    ];

    const adapter = {
      findActiveRooms: () => testRooms,
      expireRoom: (roomId: string, expectedVersion: number) => {
        const room = testRooms.find((r) => r.id === roomId);
        if (!room || room.state_version !== expectedVersion || room.status === "EXPIRED") {
          return false;
        }
        room.status = "EXPIRED";
        room.state_version += 1;
        return true;
      },
    };

    clock.advance(86400);
    const result = await worker.processExpiredRooms(adapter);
    expect(result.processedCount).toBe(2);
    expect(result.expiredRoomIds).toEqual(["room-matched", "room-exhausted"]);
  });
});
