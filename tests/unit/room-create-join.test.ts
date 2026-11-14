// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CODE_GENERATION_MAX_RETRIES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomCodeGenerationError,
  buildRoomInvitePath,
  generateRoomCode,
  normalizeRoomCodeInput,
} from "@/lib/server/room/roomCode";
import {
  RoomCapacityError,
  RoomExpiredError,
  SqliteRoomRepository,
} from "@/lib/server/room/roomRepository";
import {
  PostgresRoomRepository,
  assertValidPgSchema,
} from "@/lib/server/room/postgresRoomRepository";
import {
  PostgresRoomAuthorityStore,
  SqliteRoomAuthorityStore,
  applySqliteMigrations,
} from "@/lib/server/room/roomStore";
import {
  buildSafeRoomSnapshot,
  createRoomWithSession,
  getAuthenticatedRoomSnapshot,
  joinRoomWithSession,
  normalizeDisplayName,
} from "@/lib/server/room/roomSnapshot";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";

const tempPaths: string[] = [];
const openDbs: DatabaseSync[] = [];

function createTestSqliteRepo(): { repo: SqliteRoomRepository; db: DatabaseSync } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine014-unit-"));
  tempPaths.push(tmpDir);
  const dbPath = path.join(tmpDir, "rooms.sqlite");
  const db = new DatabaseSync(dbPath);
  openDbs.push(db);
  applySqliteMigrations(db);
  return { repo: new SqliteRoomRepository(db), db };
}

afterEach(() => {
  while (openDbs.length > 0) {
    const db = openDbs.pop();
    try {
      db?.close();
    } catch {
      // ignore if already closed
    }
  }
  while (tempPaths.length > 0) {
    const dir = tempPaths.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
});

describe("CINE-014 Room Code Generation, Normalization, and Repository Collisions", () => {
  it("generates 10,000 valid unambiguous 6-character codes cleanly (statistical sample, not mathematical proof)", () => {
    const sampleSize = 10_000;
    const rawSeen = new Set<string>();
    const charHistogram = new Map<string, number>();

    for (let i = 0; i < sampleSize; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) {
        expect(ROOM_CODE_ALPHABET).toContain(ch);
        charHistogram.set(ch, (charHistogram.get(ch) ?? 0) + 1);
      }
      rawSeen.add(code);
    }

    // 32^6 = 1,073,741,824; expected birthday collisions in 10,000 draws is ~0.0465 (~4.5% chance of >=1).
    // Assert statistical health without inducing ~4.5% CI flake on raw RNG, then verify retry-backed uniqueness below.
    expect(rawSeen.size).toBeGreaterThanOrEqual(9_995);
    expect(charHistogram.size).toBe(ROOM_CODE_ALPHABET.length);

    // Retry-backed allocator guarantees 10,000 / 10,000 distinct codes even if a natural birthday collision occurs.
    const allocated = new Set<string>();
    for (let i = 0; i < sampleSize; i++) {
      let candidate = "";
      for (let attempt = 0; attempt < DEFAULT_CODE_GENERATION_MAX_RETRIES; attempt++) {
        const next = generateRoomCode();
        if (!allocated.has(next)) {
          candidate = next;
          break;
        }
      }
      expect(candidate).not.toBe("");
      allocated.add(candidate);
    }
    expect(allocated.size).toBe(sampleSize);
  });

  it("retries mocked collisions in SQLite createRoom and throws RoomCodeGenerationError when exhausted", () => {
    const { repo } = createTestSqliteRepo();
    const first = repo.createRoom({
      hostDisplayName: "Host One",
      codeGenerator: () => "AB23CD",
    });
    expect(first.room.code).toBe("AB23CD");

    let attempt = 0;
    const second = repo.createRoom({
      hostDisplayName: "Host Two",
      codeGenerator: () => {
        attempt += 1;
        return attempt <= 3 ? "AB23CD" : "EF45GH";
      },
      maxCodeAttempts: 5,
    });
    expect(second.room.code).toBe("EF45GH");
    expect(attempt).toBe(4);

    expect(() =>
      repo.createRoom({
        hostDisplayName: "Host Fail",
        codeGenerator: () => "AB23CD",
        maxCodeAttempts: 4,
      })
    ).toThrowError(RoomCodeGenerationError);
  });

  it("handles mocked code collisions and savepoint 23505 retries in PostgresRoomRepository", async () => {
    expect(() => assertValidPgSchema("bad; DROP TABLE rooms;")).toThrowError(/Invalid PostgreSQL schema/);
    expect(assertValidPgSchema("cinematch_test")).toBe("cinematch_test");

    const queries: string[] = [];
    let codeCall = 0;
    let insertAttempts = 0;

    let savedRoom: Record<string, unknown> | null = null;
    let savedHost: Record<string, unknown> | null = null;

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("SELECT 1 FROM rooms WHERE code = $1")) {
          const code = params?.[0];
          // Attempt 1 collides on pre-check
          if (code === "DUP234") {
            return { rows: [{ "?column?": 1 }] };
          }
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO rooms")) {
          insertAttempts += 1;
          // Attempt 2 collides on concurrent unique index race (23505), recovered by SAVEPOINT
          if (insertAttempts === 1) {
            const err = Object.assign(new Error("duplicate key value violates unique constraint"), {
              code: "23505",
              constraint: "idx_rooms_code",
            });
            throw err;
          }
          savedRoom = {
            id: params?.[0],
            code: params?.[1],
            status: "LOBBY",
            host_participant_id: null,
            state_version: 1,
            participant_count: 1,
            matched_movie_id: null,
            current_round_id: null,
            deck_filter: null,
            inactivity_ttl_seconds: params?.[3],
            last_activity_at: params?.[4],
            expires_at: params?.[5],
            created_at: params?.[4],
            updated_at: params?.[4],
          };
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO room_participants")) {
          savedHost = {
            room_id: params?.[0],
            participant_id: params?.[1],
            display_name: params?.[2],
            role: "HOST",
            is_connected: true,
            joined_at: params?.[3],
            last_seen_at: params?.[3],
          };
          return { rows: [] };
        }
        if (sql.includes("UPDATE rooms SET host_participant_id = $1") && savedRoom) {
          savedRoom.host_participant_id = params?.[0];
          return { rows: [] };
        }
        if (sql.includes("SELECT * FROM rooms WHERE id = $1")) {
          return { rows: savedRoom ? [savedRoom] : [] };
        }
        if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1")) {
          return { rows: savedHost ? [savedHost] : [] };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };

    const mockPool = {
      totalCount: 1,
      connect: async () => mockClient,
    };

    const repo = new PostgresRoomRepository(mockPool as never, { schema: "cinematch_qual" });
    const sequence = ["DUP234", "RAC567", "WIN89A"];
    const created = await repo.createRoom({
      hostDisplayName: "PG Host",
      codeGenerator: () => sequence[codeCall++] ?? "FALL23",
      maxCodeAttempts: 5,
    });

    expect(created.room.code).toBe("WIN89A");
    expect(insertAttempts).toBe(2);
    expect(queries.some((q) => q.includes('SET search_path TO "cinematch_qual", pg_temp;'))).toBe(true);
    expect(queries.some((q) => q.includes("ROLLBACK TO SAVEPOINT sp_create_room_code;"))).toBe(true);

    // Verify retry exhaustion throws RoomCodeGenerationError
    await expect(
      repo.createRoom({
        hostDisplayName: "PG Exhausted",
        codeGenerator: () => "DUP234",
        maxCodeAttempts: 3,
      })
    ).rejects.toThrowError(RoomCodeGenerationError);

    // Verify PostgresRoomRepository.joinRoom expired / non-LOBBY / full / getParticipantsByRoom parity
    const expiredPgPool = {
      totalCount: 1,
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
            return {
              rows: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  code: "WIN89A",
                  status: "LOBBY",
                  host_participant_id: "00000000-0000-4000-8000-000000000002",
                  state_version: 1,
                  participant_count: 1,
                  matched_movie_id: null,
                  current_round_id: null,
                  deck_filter: null,
                  inactivity_ttl_seconds: 86400,
                  last_activity_at: "2020-01-01T00:00:00.000Z",
                  expires_at: "2020-01-02T00:00:00.000Z",
                  created_at: "2020-01-01T00:00:00.000Z",
                  updated_at: "2020-01-01T00:00:00.000Z",
                },
              ],
            };
          }
          return { rows: [] };
        },
        release: () => undefined,
      }),
    };
    const expiredPgRepo = new PostgresRoomRepository(expiredPgPool as never);
    await expect(
      expiredPgRepo.joinRoom(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000003",
        "Guest"
      )
    ).rejects.toThrowError(RoomExpiredError);

    const fullPgPool = {
      totalCount: 1,
      connect: async () => ({
        query: async (sql: string) => {
          if (sql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
            return {
              rows: [
                {
                  id: "00000000-0000-4000-8000-000000000001",
                  code: "WIN89A",
                  status: "LOBBY",
                  host_participant_id: "00000000-0000-4000-8000-000000000002",
                  state_version: 5,
                  participant_count: 5,
                  matched_movie_id: null,
                  current_round_id: null,
                  deck_filter: null,
                  inactivity_ttl_seconds: 86400,
                  last_activity_at: new Date().toISOString(),
                  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
              ],
            };
          }
          if (sql.includes("ORDER BY joined_at ASC, participant_id ASC")) {
            return {
              rows: [
                {
                  room_id: "00000000-0000-4000-8000-000000000001",
                  participant_id: "00000000-0000-4000-8000-000000000002",
                  display_name: "PG Host",
                  role: "HOST",
                  is_connected: true,
                  joined_at: "2026-11-13T00:00:00.000Z",
                  last_seen_at: "2026-11-13T00:00:00.000Z",
                },
              ],
            };
          }
          return { rows: [] };
        },
        release: () => undefined,
      }),
    };
    const fullPgRepo = new PostgresRoomRepository(fullPgPool as never);
    await expect(
      fullPgRepo.joinRoom(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000009",
        "Sixth Guest"
      )
    ).rejects.toMatchObject({ code: "ROOM_FULL" });
    const pgRoster = await fullPgRepo.getParticipantsByRoom("00000000-0000-4000-8000-000000000001");
    expect(pgRoster).toHaveLength(1);
    expect(pgRoster[0].role).toBe("HOST");
  });

  it("enforces distinct RoomExpiredError and RoomCapacityError codes in SQLite joinRoom", () => {
    const { repo, db } = createTestSqliteRepo();
    const pastIso = new Date(Date.now() - 60_000).toISOString();

    const { room } = repo.createRoom({ hostDisplayName: "Host" });
    // Force expires_at into past without mutating status to verify lazy TTL clock expiry
    db.prepare("UPDATE rooms SET expires_at = ? WHERE id = ?").run(pastIso, room.id);

    expect(() =>
      repo.joinRoom(room.id, crypto.randomUUID(), "Late Guest")
    ).toThrowError(RoomExpiredError);

    // Verify capacity error code distinction when active room reaches 5/5
    const activeRoom = repo.createRoom({ hostDisplayName: "Host2" }).room;
    for (let i = 0; i < 4; i++) {
      repo.joinRoom(activeRoom.id, crypto.randomUUID(), `Member ${i + 2}`);
    }
    try {
      repo.joinRoom(activeRoom.id, crypto.randomUUID(), "Sixth Member");
      expect.unreachable("Should have thrown RoomCapacityError");
    } catch (err) {
      expect(err).toBeInstanceOf(RoomCapacityError);
      expect((err as RoomCapacityError).code).toBe("ROOM_FULL");
    }
  });

  it("normalizes codes and invite links while excluding secret parameters and rejecting invalid inputs", () => {
    expect(normalizeRoomCodeInput("  ab-cd 23  ")).toBe("ABCD23");
    expect(normalizeRoomCodeInput("/join/ef-45gh")).toBe("EF45GH");
    expect(normalizeRoomCodeInput("join/xy78zw/")).toBe("XY78ZW");
    expect(normalizeRoomCodeInput("https://cinematch.example/room?code=mn-23pq#frag")).toBe("MN23PQ");
    expect(normalizeRoomCodeInput("https://cinematch.example/join/qr45st?token=secret-ignored")).toBe("QR45ST");

    expect(buildRoomInvitePath("ab-23cd")).toBe("/join/AB23CD");
    expect(buildRoomInvitePath("ab-23cd")).not.toContain("token");
    expect(buildRoomInvitePath("ab-23cd")).not.toContain("secret");

    for (const invalid of ["", "   ", "ABC", "ABCDEFGH", "000000", "OOOOOO", "II1122", "<script>alert(1)</script>", "/join/"]) {
      expect(() => normalizeRoomCodeInput(invalid)).toThrowError(CapabilityAuthError);
    }
  });

  it("normalizes display names, enforces peer participantId confidentiality, and rejects torn snapshots", () => {
    expect(normalizeDisplayName(undefined, "Host")).toBe("Host");
    expect(normalizeDisplayName("  Alice   Bob  ", "Guest")).toBe("Alice Bob");
    expect(() => normalizeDisplayName("   ", "Guest")).toThrowError(CapabilityAuthError);
    expect(() => normalizeDisplayName("A".repeat(33), "Guest")).toThrowError(CapabilityAuthError);

    const { repo } = createTestSqliteRepo();
    const { room, host } = repo.createRoom({ hostDisplayName: "Host" });
    const snapshot1 = buildSafeRoomSnapshot(room, [host], host.participant_id);
    expect(snapshot1.canStart).toBe(false);
    expect(snapshot1.maxParticipants).toBe(5);
    expect(snapshot1.minParticipantsToStart).toBe(2);
    expect(snapshot1.invitePath).toBe(`/join/${room.code}`);
    expect(snapshot1.participants).toHaveLength(1);
    expect("participantId" in snapshot1.participants[0]).toBe(false);
    expect(snapshot1.participants[0].isSelf).toBe(true);

    const guest = repo.joinRoom(room.id, crypto.randomUUID(), "Guest Two");
    const updatedRoom = repo.getRoomById(room.id)!;
    const participants = repo.getParticipantsByRoom(room.id);
    const hostView = buildSafeRoomSnapshot(updatedRoom, participants, host.participant_id);
    expect(hostView.participantCount).toBe(2);
    expect(hostView.canStart).toBe(true);
    expect(hostView.participants.map((p) => ({ displayName: p.displayName, role: p.role, isSelf: p.isSelf }))).toEqual([
      { displayName: "Host", role: "HOST", isSelf: true },
      { displayName: "Guest Two", role: "MEMBER", isSelf: false },
    ]);
    for (const p of hostView.participants) {
      expect("participantId" in p).toBe(false);
    }
    const serializedHostView = JSON.stringify(hostView);
    expect(serializedHostView).not.toContain("cm_guest_");
    expect(serializedHostView).not.toContain(host.participant_id);
    expect(serializedHostView).not.toContain(guest.participant_id);

    const guestView = buildSafeRoomSnapshot(updatedRoom, participants, guest.participant_id);
    expect(guestView.participants.map((p) => p.isSelf)).toEqual([false, true]);

    // Torn snapshot must fail closed rather than masking via Math.max
    expect(() =>
      buildSafeRoomSnapshot(
        { ...updatedRoom, participant_count: 1 },
        participants,
        host.participant_id
      )
    ).toThrowError(CapabilityAuthError);
  });

  it("rolls back SQLite room create and 5th-slot join across both post-write fault boundaries and retries cleanly", async () => {
    const prevSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
    process.env.CINEMATCH_CAPABILITY_SECRET =
      "test-capability-signing-secret-cine-014-64-characters-long-abcdef01";

    try {
      const { db } = createTestSqliteRepo();
      const store = new SqliteRoomAuthorityStore(db);
      const countRows = () => ({
        rooms: Number((db.prepare("SELECT count(*) AS c FROM rooms;").get() as { c: number }).c),
        participants: Number(
          (db.prepare("SELECT count(*) AS c FROM room_participants;").get() as { c: number }).c
        ),
        events: Number((db.prepare("SELECT count(*) AS c FROM room_events;").get() as { c: number }).c),
        sessions: Number(
          (db.prepare("SELECT count(*) AS c FROM guest_capability_sessions;").get() as { c: number }).c
        ),
      });

      const mkReq = (url: string, body: unknown, cookie?: string) =>
        new Request(url, {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        });

      // 1a. Create fails afterWriteBeforeSessionInit -> full rollback
      await expect(
        createRoomWithSession(
          mkReq("http://localhost:3000/api/rooms", { displayName: "Host" }),
          { displayName: "Host" },
          store,
          {
            hooks: {
              afterWriteBeforeSessionInit: () => {
                throw new Error("INJECTED_AFTER_WRITE_BEFORE_SESSION");
              },
            },
          }
        )
      ).rejects.toThrow("INJECTED_AFTER_WRITE_BEFORE_SESSION");
      expect(countRows()).toEqual({ rooms: 0, participants: 0, events: 0, sessions: 0 });

      // 1b. Create fails at beforeCommit -> guest_capability_sessions also rolled back
      await expect(
        createRoomWithSession(
          mkReq("http://localhost:3000/api/rooms", { displayName: "Host" }),
          { displayName: "Host" },
          store,
          {
            hooks: {
              beforeCommit: () => {
                throw new Error("INJECTED_BEFORE_COMMIT");
              },
            },
          }
        )
      ).rejects.toThrow("INJECTED_BEFORE_COMMIT");
      expect(countRows()).toEqual({ rooms: 0, participants: 0, events: 0, sessions: 0 });

      // 1c. Create retries cleanly
      const created = await createRoomWithSession(
        mkReq("http://localhost:3000/api/rooms", { displayName: "Host" }),
        { displayName: "Host" },
        store
      );
      expect(created.room.participantCount).toBe(1);
      expect(created.room.stateVersion).toBe(1);
      expect(countRows()).toEqual({ rooms: 1, participants: 1, events: 1, sessions: 1 });

      // Bring room to 4/5 capacity
      for (let i = 2; i <= 4; i++) {
        await joinRoomWithSession(
          mkReq("http://localhost:3000/api/rooms/join", {
            code: created.room.code,
            displayName: `Guest ${i}`,
          }),
          { code: created.room.code, displayName: `Guest ${i}` },
          store
        );
      }
      expect(countRows()).toEqual({ rooms: 1, participants: 4, events: 4, sessions: 4 });

      // 2a. 5th join fails at afterWriteBeforeSessionInit -> still 4/5, no leaked session/outbox
      await expect(
        joinRoomWithSession(
          mkReq("http://localhost:3000/api/rooms/join", {
            code: created.room.code,
            displayName: "Guest 5",
          }),
          { code: created.room.code, displayName: "Guest 5" },
          store,
          {
            hooks: {
              afterWriteBeforeSessionInit: () => {
                throw new Error("INJECTED_JOIN_AFTER_WRITE");
              },
            },
          }
        )
      ).rejects.toThrow("INJECTED_JOIN_AFTER_WRITE");
      expect(countRows()).toEqual({ rooms: 1, participants: 4, events: 4, sessions: 4 });

      // 2b. 5th join fails at beforeCommit -> still 4/5, session row rolled back too
      await expect(
        joinRoomWithSession(
          mkReq("http://localhost:3000/api/rooms/join", {
            code: created.room.code,
            displayName: "Guest 5",
          }),
          { code: created.room.code, displayName: "Guest 5" },
          store,
          {
            hooks: {
              beforeCommit: () => {
                throw new Error("INJECTED_JOIN_BEFORE_COMMIT");
              },
            },
          }
        )
      ).rejects.toThrow("INJECTED_JOIN_BEFORE_COMMIT");
      expect(countRows()).toEqual({ rooms: 1, participants: 4, events: 4, sessions: 4 });

      // 2c. Retrying 5th join WITHOUT cookie succeeds cleanly; 6th fails ROOM_FULL
      const guest5 = await joinRoomWithSession(
        mkReq("http://localhost:3000/api/rooms/join", {
          code: created.room.code,
          displayName: "Guest 5",
        }),
        { code: created.room.code, displayName: "Guest 5" },
        store
      );
      expect(guest5.room.participantCount).toBe(5);
      expect(guest5.room.stateVersion).toBe(5);
      expect(countRows()).toEqual({ rooms: 1, participants: 5, events: 5, sessions: 5 });

      const guest5View = await getAuthenticatedRoomSnapshot(
        new Request(`http://localhost:3000/api/rooms/${created.room.roomId}`, {
          headers: { cookie: `${guest5.cookie!.name}=${guest5.cookie!.value}` },
        }),
        created.room.roomId,
        store
      );
      expect(guest5View.viewer.participantId).toBe(guest5.viewer.participantId);
      expect(JSON.stringify(guest5View.room)).not.toContain(created.viewer.participantId);
      expect(JSON.stringify(guest5View.room)).not.toContain(guest5.viewer.participantId);

      await expect(
        joinRoomWithSession(
          mkReq("http://localhost:3000/api/rooms/join", {
            code: created.room.code,
            displayName: "Guest 6",
          }),
          { code: created.room.code, displayName: "Guest 6" },
          store
        )
      ).rejects.toThrowError(RoomCapacityError);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.CINEMATCH_CAPABILITY_SECRET;
      } else {
        process.env.CINEMATCH_CAPABILITY_SECRET = prevSecret;
      }
    }
  });

  it("executes PostgresRoomAuthorityStore atomic session create/join rollback and REPEATABLE READ snapshot queries on a single client", async () => {
    const prevSecret = process.env.CINEMATCH_CAPABILITY_SECRET;
    process.env.CINEMATCH_CAPABILITY_SECRET =
      "test-capability-signing-secret-cine-014-64-characters-long-abcdef01";

    try {
      const queries: string[] = [];
      let committed = {
        rooms: new Map<string, Record<string, unknown>>(),
        participants: new Map<string, Record<string, unknown>[]>(),
        sessions: new Map<string, number>(),
      };
      let staged: typeof committed | null = null;
      const cloneState = (s: typeof committed): typeof committed => ({
        rooms: new Map(Array.from(s.rooms.entries()).map(([k, v]) => [k, { ...v }])),
        participants: new Map(
          Array.from(s.participants.entries()).map(([k, list]) => [k, list.map((p) => ({ ...p }))])
        ),
        sessions: new Map(s.sessions),
      });

      const mockClient = {
        query: async (sql: string, params?: unknown[]) => {
          queries.push(sql);
          if (sql.startsWith("BEGIN")) {
            staged = cloneState(committed);
            return { rows: [] };
          }
          if (sql === "COMMIT;") {
            if (staged) {
              committed = staged;
              staged = null;
            }
            return { rows: [] };
          }
          if (sql === "ROLLBACK;") {
            staged = null;
            return { rows: [] };
          }
          const active = staged ?? committed;
          if (sql.startsWith("SAVEPOINT") || sql.startsWith("RELEASE SAVEPOINT")) {
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO rooms")) {
            const [id, code, deckFilter, ttl, nowIso, expiresAt] = params as [
              string,
              string,
              string | null,
              number,
              string,
              string,
            ];
            active.rooms.set(id, {
              id,
              code,
              status: "LOBBY",
              host_participant_id: null,
              state_version: 1,
              participant_count: 1,
              matched_movie_id: null,
              current_round_id: null,
              deck_filter: deckFilter,
              inactivity_ttl_seconds: ttl,
              last_activity_at: nowIso,
              expires_at: expiresAt,
              created_at: nowIso,
              updated_at: nowIso,
            });
            active.participants.set(id, []);
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO room_participants")) {
            const [roomId, participantId, displayName, nowIso] = params as [string, string, string, string];
            const role = sql.includes("'HOST'") ? "HOST" : "MEMBER";
            const list = active.participants.get(roomId) ?? [];
            list.push({
              room_id: roomId,
              participant_id: participantId,
              display_name: displayName,
              role,
              is_connected: true,
              joined_at: nowIso,
              last_seen_at: nowIso,
            });
            active.participants.set(roomId, list);
            return { rows: [] };
          }
          if (sql.includes("UPDATE rooms SET host_participant_id = $1")) {
            const [hostId, roomId] = params as [string, string];
            const r = active.rooms.get(roomId);
            if (r) r.host_participant_id = hostId;
            return { rows: [] };
          }
          if (sql.includes("UPDATE rooms") && sql.includes("SET state_version")) {
            const [nextVer, nextCount, nowIso, expiresAt, roomId] = params as [
              number,
              number,
              string,
              string,
              string,
            ];
            const r = active.rooms.get(roomId);
            if (r) {
              r.state_version = nextVer;
              r.participant_count = nextCount;
              r.last_activity_at = nowIso;
              r.expires_at = expiresAt;
              r.updated_at = nowIso;
            }
            return { rows: [] };
          }
          if (sql.includes("INSERT INTO guest_capability_sessions")) {
            const [roomId, participantId] = params as [string, string];
            const key = `${roomId}:${participantId}`;
            const gen = active.sessions.get(key) ?? 1;
            active.sessions.set(key, gen);
            return { rows: [{ min_generation: gen }] };
          }
          if (sql.includes("SELECT * FROM rooms WHERE id = $1")) {
            const [roomId] = params as [string];
            const r = active.rooms.get(roomId);
            return { rows: r ? [{ ...r }] : [] };
          }
          if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2")) {
            const [roomId, pid] = params as [string, string];
            const list = (active.participants.get(roomId) ?? []).filter((p) => p.participant_id === pid);
            return { rows: list.map((p) => ({ ...p })) };
          }
          if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1")) {
            const [roomId] = params as [string];
            return { rows: (active.participants.get(roomId) ?? []).map((p) => ({ ...p })) };
          }
          if (sql.includes("SELECT min_generation FROM guest_capability_sessions")) {
            const [roomId, pid] = params as [string, string];
            const val = active.sessions.get(`${roomId}:${pid}`);
            return { rows: val !== undefined ? [{ min_generation: val }] : [] };
          }
          return { rows: [] };
        },
        release: () => undefined,
      };

      const mockPool = { totalCount: 1, connect: async () => mockClient };
      const pgStore = new PostgresRoomAuthorityStore(mockPool as never);

      // Fault injection beforeCommit rolls back PG transaction completely
      await expect(
        pgStore.createRoomWithSession({
          hostDisplayName: "PG Rollback Host",
          hooks: {
            beforeCommit: async () => {
              throw new Error("PG_INJECTED_BEFORE_COMMIT");
            },
          },
        })
      ).rejects.toThrow("PG_INJECTED_BEFORE_COMMIT");
      expect(committed.rooms.size).toBe(0);
      expect(committed.sessions.size).toBe(0);
      expect(queries[queries.length - 1]).toBe("ROLLBACK;");

      const created = await pgStore.createRoomWithSession({ hostDisplayName: "PG Live Host" });
      expect(committed.rooms.size).toBe(1);
      expect(committed.sessions.size).toBe(1);
      expect(created.sessionGeneration).toBe(1);

      // Join fault beforeCommit leaves host intact and zero leaked session
      await expect(
        pgStore.joinRoomWithSession({
          roomId: created.room.id,
          participantId: crypto.randomUUID(),
          displayName: "PG Guest Fail",
          hooks: {
            beforeCommit: async () => {
              throw new Error("PG_JOIN_FAULT");
            },
          },
        })
      ).rejects.toThrow("PG_JOIN_FAULT");
      expect(committed.participants.get(created.room.id)?.length).toBe(1);
      expect(committed.sessions.size).toBe(1);

      const snapshot = await pgStore.getConsistentRoomSnapshot(created.room.id);
      expect(snapshot?.room.state_version).toBe(1);
      expect(snapshot?.participants).toHaveLength(1);
      expect(queries).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;");
    } finally {
      if (prevSecret === undefined) {
        delete process.env.CINEMATCH_CAPABILITY_SECRET;
      } else {
        process.env.CINEMATCH_CAPABILITY_SECRET = prevSecret;
      }
    }
  });
});
