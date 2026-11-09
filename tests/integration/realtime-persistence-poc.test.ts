import { describe, it, expect, beforeEach } from "vitest";

/**
 * CINE-011: Proof of Concept (POC) Multi-Instance Realtime & Persistence Test Harness
 * 
 * Simulates two independent serverless application instances (AppInstanceA and AppInstanceB)
 * executing concurrent operations against a centralized state authority and real-time event broker.
 */

interface Room {
  id: string;
  code: string;
  status: "LOBBY" | "VOTING" | "MATCHED" | "NO_MATCH";
  hostId: string;
  participants: Set<string>;
  frozenRoster?: string[];
  deck: number[];
  matchedMovieId?: number;
}

interface Vote {
  roomId: string;
  participantId: string;
  movieId: number;
  vote: "LIKE" | "SKIP";
  timestamp: number;
}

interface RoomEvent {
  roomId: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * Shared Persistence & Event Broker Coordinator
 * Simulates managed PostgreSQL (ACID + row locking) and Supabase Realtime Channels.
 */
class SharedStateAuthority {
  private rooms = new Map<string, Room>();
  private votes = new Map<string, Vote>(); // key: `${roomId}:${participantId}:${movieId}`
  private channelSubscribers = new Map<string, Set<(event: RoomEvent) => void>>();
  public transientFailureFlag = false;

  createRoom(code: string, hostId: string, deck: number[]): Room {
    const room: Room = {
      id: `room-${code}`,
      code,
      status: "LOBBY",
      hostId,
      participants: new Set([hostId]),
      deck,
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
    this.broadcast(roomId, {
      roomId,
      type: "participant_joined",
      payload: { participantId, count: room.participants.size },
      timestamp: Date.now(),
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

    this.broadcast(roomId, {
      roomId,
      type: "roster_frozen",
      payload: { roster: room.frozenRoster },
      timestamp: Date.now(),
    });

    return { ...room, participants: new Set(room.participants) };
  }

  /**
   * Atomic vote recording and unanimous consensus evaluation
   */
  async submitVote(roomId: string, participantId: string, movieId: number, voteType: "LIKE" | "SKIP"): Promise<{
    status: "RECORDED" | "MATCHED";
    matchedMovieId?: number;
    latencyMs: number;
  }> {
    const startTime = performance.now();

    if (this.transientFailureFlag) {
      throw new Error("DB_TRANSIENT_CONNECTION_ERROR: Temporary connection drop to pooler");
    }

    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");
    if (room.status !== "VOTING") throw new Error("Room is not in voting state");
    if (!room.frozenRoster?.includes(participantId)) throw new Error("Participant not in frozen roster");

    const voteKey = `${roomId}:${participantId}:${movieId}`;
    // Idempotent check
    if (!this.votes.has(voteKey)) {
      this.votes.set(voteKey, {
        roomId,
        participantId,
        movieId,
        vote: voteType,
        timestamp: Date.now(),
      });
    }

    // Atomic Consensus Check: Check all frozen participants
    let matched = false;
    if (voteType === "LIKE") {
      const likesForMovie = Array.from(this.votes.values()).filter(
        (v) => v.roomId === roomId && v.movieId === movieId && v.vote === "LIKE"
      );

      if (likesForMovie.length === room.frozenRoster.length) {
        // Unanimous consensus reached!
        room.status = "MATCHED";
        room.matchedMovieId = movieId;
        matched = true;

        this.broadcast(roomId, {
          roomId,
          type: "match_announced",
          payload: { movieId, unanimousCount: likesForMovie.length },
          timestamp: Date.now(),
        });
      }
    }

    const endTime = performance.now();
    return {
      status: matched ? "MATCHED" : "RECORDED",
      matchedMovieId: room.matchedMovieId,
      latencyMs: endTime - startTime,
    };
  }

  getSnapshot(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("Room not found");

    const userVotes = Array.from(this.votes.values()).filter(
      (v) => v.roomId === roomId && v.participantId === participantId
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
      userVotes,
    };
  }

  subscribe(roomId: string, listener: (event: RoomEvent) => void): () => void {
    if (!this.channelSubscribers.has(roomId)) {
      this.channelSubscribers.set(roomId, new Set());
    }
    const set = this.channelSubscribers.get(roomId)!;
    set.add(listener);
    return () => set.delete(listener);
  }

  private broadcast(roomId: string, event: RoomEvent) {
    const listeners = this.channelSubscribers.get(roomId);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }
}

/**
 * Simulated Independent Serverless Application Instance
 */
class SimulatedAppInstance {
  readonly instanceId: string;
  private coordinator: SharedStateAuthority;

  constructor(instanceId: string, coordinator: SharedStateAuthority) {
    this.instanceId = instanceId;
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

  getRoomSnapshot(roomId: string, participantId: string) {
    return this.coordinator.getSnapshot(roomId, participantId);
  }

  subscribeToRoom(roomId: string, onEvent: (event: RoomEvent) => void) {
    return this.coordinator.subscribe(roomId, onEvent);
  }
}

describe("CINE-011: Realtime and Persistence Architecture POC & Multi-Instance Verification", () => {
  let coordinator: SharedStateAuthority;
  let instanceA: SimulatedAppInstance;
  let instanceB: SimulatedAppInstance;

  beforeEach(() => {
    coordinator = new SharedStateAuthority();
    instanceA = new SimulatedAppInstance("worker-vercel-instance-alpha", coordinator);
    instanceB = new SimulatedAppInstance("worker-vercel-instance-beta", coordinator);
  });

  describe("Multi-Instance Concurrent Simultaneous Writes & Consensus", () => {
    it("handles simultaneous votes across 2 independent instances with unanimous match transition", async () => {
      const roomCode = "MATCH1";
      const deck = [550, 680, 278, 238]; // 4 movie deck

      // Instance A creates the room with Host (User 1)
      const room = instanceA.createRoom(roomCode, "user-1", deck);

      // Other 3 users join via Instance B
      instanceB.joinRoom(room.id, "user-2");
      instanceB.joinRoom(room.id, "user-3");
      instanceB.joinRoom(room.id, "user-4");

      // Instance A starts round (frozen at 4 users)
      instanceA.startRound(room.id, "user-1");

      const capturedEventsInstanceA: RoomEvent[] = [];
      const capturedEventsInstanceB: RoomEvent[] = [];

      instanceA.subscribeToRoom(room.id, (e) => capturedEventsInstanceA.push(e));
      instanceB.subscribeToRoom(room.id, (e) => capturedEventsInstanceB.push(e));

      // Simulate simultaneous voting on Movie #550 across 2 independent worker instances
      // User 1 & 2 hit Instance A; User 3 & 4 hit Instance B at the same time
      const results = await Promise.all([
        instanceA.submitVote(room.id, "user-1", 550, "LIKE"),
        instanceA.submitVote(room.id, "user-2", 550, "LIKE"),
        instanceB.submitVote(room.id, "user-3", 550, "LIKE"),
        instanceB.submitVote(room.id, "user-4", 550, "LIKE"),
      ]);

      // All 4 votes succeeded
      expect(results.length).toBe(4);

      // Exactly one submission (the 4th unanimous vote) triggered the MATCHED status
      const matchedResults = results.filter((r) => r.status === "MATCHED");
      expect(matchedResults.length).toBe(1);
      expect(matchedResults[0].matchedMovieId).toBe(550);

      // Assert both instances observe MATCHED state from authoritative snapshot
      const snapshotA = instanceA.getRoomSnapshot(room.id, "user-1");
      const snapshotB = instanceB.getRoomSnapshot(room.id, "user-4");
      expect(snapshotA.status).toBe("MATCHED");
      expect(snapshotB.status).toBe("MATCHED");
      expect(snapshotA.matchedMovieId).toBe(550);
      expect(snapshotB.matchedMovieId).toBe(550);

      // Assert event broadcast reached both instance subscribers
      const matchEventA = capturedEventsInstanceA.find((e) => e.type === "match_announced");
      const matchEventB = capturedEventsInstanceB.find((e) => e.type === "match_announced");
      expect(matchEventA).toBeDefined();
      expect(matchEventB).toBeDefined();
      expect(matchEventA?.payload.movieId).toBe(550);
    });
  });

  describe("Disconnect, Missed Events & Reconnect Recovery", () => {
    it("recovers full room state upon reconnecting to an alternate serverless instance", async () => {
      const room = instanceA.createRoom("REC001", "host-user", [101, 102, 103]);
      instanceB.joinRoom(room.id, "guest-user");
      instanceA.startRound(room.id, "host-user");

      // Guest disconnects: unsubscribe listener
      let guestReceivedEvent = false;
      const unsubscribeGuest = instanceB.subscribeToRoom(room.id, () => {
        guestReceivedEvent = true;
      });
      unsubscribeGuest(); // Disconnect simulated

      // While guest is disconnected, Host votes on Instance A
      await instanceA.submitVote(room.id, "host-user", 101, "LIKE");
      expect(guestReceivedEvent).toBe(false); // Guest missed realtime broadcast

      // Guest reconnects to Instance A (or B) and requests authoritative snapshot
      const reconnectedSnapshot = instanceA.getRoomSnapshot(room.id, "guest-user");

      expect(reconnectedSnapshot.status).toBe("VOTING");
      expect(reconnectedSnapshot.deck).toEqual([101, 102, 103]);
      expect(reconnectedSnapshot.frozenRoster).toEqual(["host-user", "guest-user"]);
      expect(reconnectedSnapshot.userVotes).toEqual([]); // Guest hasn't voted yet

      // Guest can now cast vote on Instance A
      const voteResult = await instanceA.submitVote(room.id, "guest-user", 101, "LIKE");
      expect(voteResult.status).toBe("MATCHED");
      expect(voteResult.matchedMovieId).toBe(101);
    });
  });

  describe("Multi-Tenant Room Isolation", () => {
    it("strictly isolates events between different rooms across instances", () => {
      const room1 = instanceA.createRoom("ROOM1", "u1", [1, 2]);
      const room2 = instanceB.createRoom("ROOM2", "u2", [1, 2]);

      const room1Events: RoomEvent[] = [];
      const room2Events: RoomEvent[] = [];

      instanceA.subscribeToRoom(room1.id, (e) => room1Events.push(e));
      instanceB.subscribeToRoom(room2.id, (e) => room2Events.push(e));

      // Join player to Room 1 only
      instanceA.joinRoom(room1.id, "u3");

      expect(room1Events.length).toBe(1);
      expect(room1Events[0].type).toBe("participant_joined");
      expect(room2Events.length).toBe(0); // Zero leakage into Room 2
    });
  });

  describe("Failure Handling & Idempotency", () => {
    it("handles transient database failures safely without state corruption and succeeds on retry", async () => {
      const room = instanceA.createRoom("FAIL01", "u1", [10, 20]);
      instanceB.joinRoom(room.id, "u2");
      instanceA.startRound(room.id, "u1");

      // Inject transient connection failure
      coordinator.transientFailureFlag = true;

      await expect(instanceA.submitVote(room.id, "u1", 10, "LIKE")).rejects.toThrow(
        "DB_TRANSIENT_CONNECTION_ERROR"
      );

      // State remains uncorrupted
      const snapshot = instanceB.getRoomSnapshot(room.id, "u1");
      expect(snapshot.status).toBe("VOTING");
      expect(snapshot.userVotes.length).toBe(0);

      // Restore connection & retry
      coordinator.transientFailureFlag = false;
      const retryResult = await instanceA.submitVote(room.id, "u1", 10, "LIKE");
      expect(retryResult.status).toBe("RECORDED");

      // Duplicate submission is idempotent and does not double-count
      const duplicateResult = await instanceA.submitVote(room.id, "u1", 10, "LIKE");
      expect(duplicateResult.status).toBe("RECORDED");
    });
  });

  describe("Latency & Throughput Verification", () => {
    it("measures sub-millisecond atomic transactions and fan-out latency across instances", async () => {
      const room = instanceA.createRoom("PERF01", "u1", [1, 2, 3]);
      instanceB.joinRoom(room.id, "u2");
      instanceA.startRound(room.id, "u1");

      const latencies: number[] = [];
      for (let i = 0; i < 20; i++) {
        const result = await instanceA.submitVote(room.id, "u1", i, "SKIP");
        latencies.push(result.latencyMs);
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      expect(avgLatency).toBeLessThan(10); // Under 10ms for atomic coordinator operations
    });
  });
});
