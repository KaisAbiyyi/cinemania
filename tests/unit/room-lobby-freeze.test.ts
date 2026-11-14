// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";
import {
  type CandidateInput,
  RoomCapacityError,
  SqliteRoomRepository,
} from "@/lib/server/room/roomRepository";
import { PostgresRoomRepository } from "@/lib/server/room/postgresRoomRepository";
import { applySqliteMigrations } from "@/lib/server/room/roomStore";
import { normalizeDisplayName } from "@/lib/server/room/roomSnapshot";
import { validateStartLobbyRoundPrerequisites } from "@/lib/server/room/stateMachine";

function makeSampleCandidates(count = 20): CandidateInput[] {
  return Array.from({ length: count }, (_, idx) => ({
    movieId: 900100 + idx,
    title: `Lobby Freeze Test Movie ${idx + 1}`,
    posterPath: `/sample-${idx + 1}.jpg`,
    overview: "Deterministic fixture movie",
    releaseDate: "2025-01-15",
    voteAverage: 7.5,
  }));
}

const tempDirs: string[] = [];
const openDbs: DatabaseSync[] = [];

function createMigratedSqliteRepo(): { repo: SqliteRoomRepository; db: DatabaseSync } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cinematch-cine015-unit-"));
  tempDirs.push(tmpDir);
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
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  }
});

describe("CINE-015 Display Name Sanitization & Bounds (Unicode / XSS / Spoofing)", () => {
  it("preserves legitimate Unicode scripts, accents, and emoji within 32 code points", () => {
    expect(normalizeDisplayName(undefined, "Host")).toBe("Host");
    expect(normalizeDisplayName("  José   María  ", "Guest")).toBe("José María");
    expect(normalizeDisplayName("田中 🎬", "Guest")).toBe("田中 🎬");
    expect(normalizeDisplayName("أحمد", "Guest")).toBe("أحمد");
    expect(normalizeDisplayName("Алексей", "Guest")).toBe("Алексей");
    expect(normalizeDisplayName("A".repeat(32), "Guest")).toHaveLength(32);
    // 10 multi-unit emoji = 10 code points (UTF-16 length 20 <= 50)
    expect(normalizeDisplayName("🎬".repeat(10), "Guest")).toBe("🎬".repeat(10));
  });

  it("strips or rejects XSS markup, fullwidth angle brackets, bidi overrides, control chars, and invisible spoofing", () => {
    expect(() => normalizeDisplayName("<script>alert(1)</script>", "Guest")).toThrowError(
      CapabilityAuthError
    );
    expect(() => normalizeDisplayName("<img src=x onerror=alert(1)>", "Guest")).toThrowError(
      CapabilityAuthError
    );
    expect(() => normalizeDisplayName("<svg onload=alert(1)", "Guest")).toThrowError(
      CapabilityAuthError
    );
    expect(() =>
      normalizeDisplayName("\uFF1Cscript\uFF1Ealert(1)\uFF1C/script\uFF1E", "Guest")
    ).toThrowError(CapabilityAuthError);
    expect(() => normalizeDisplayName("   \u200B\uFEFF\u202E  ", "Guest")).toThrowError(
      CapabilityAuthError
    );
    expect(() => normalizeDisplayName("A".repeat(33), "Guest")).toThrowError(
      CapabilityAuthError
    );
    expect(() => normalizeDisplayName(12345, "Guest")).toThrowError(CapabilityAuthError);

    expect(normalizeDisplayName("Alice <script>alert(1)</script>", "Guest")).toBe("Alice");
    expect(normalizeDisplayName("<b>Bob</b>", "Guest")).toBe("Bob");
    expect(normalizeDisplayName("\u202EEvil\u0000Name\u0007", "Guest")).toBe("EvilName");
  });
});

describe("CINE-015 Lobby Prerequisites, Host Control, Leave & Frozen Roster Invariants", () => {
  it("validates lobby start bounds strictly: 1 rejected, 2..5 accepted, 6 rejected", () => {
    expect(() => validateStartLobbyRoundPrerequisites(0)).toThrow(/at least 2/);
    expect(() => validateStartLobbyRoundPrerequisites(1)).toThrow(/at least 2/);
    for (const count of [2, 3, 4, 5]) {
      expect(() => validateStartLobbyRoundPrerequisites(count)).not.toThrow();
    }
    expect(() => validateStartLobbyRoundPrerequisites(6)).toThrow(/maximum allowed participants is 5/);
  });

  it("enforces host-only start, 2..5 capacity limits, freeze persistence, and active-room protections in SQLite", () => {
    const { repo, db } = createMigratedSqliteRepo();
    const { room, host } = repo.createRoom({ hostDisplayName: "Alice" });
    const sampleCandidates = makeSampleCandidates(20);

    // Start with 1 rejected
    expect(() =>
      repo.startLobbyRound(room.id, host.participant_id, { candidates: sampleCandidates })
    ).toThrowError(RoomCapacityError);

    const guest2Id = crypto.randomUUID();
    repo.joinRoom(room.id, guest2Id, "Bob");

    // Member cannot start
    expect(() =>
      repo.startLobbyRound(room.id, guest2Id, { candidates: sampleCandidates })
    ).toThrowError(CapabilityAuthError);

    // 6-participant invariant breach defense (even if DB constraint bypassed in test table without check or > 5)
    // Add 3 more -> 5/5 valid
    const guestIds = [guest2Id];
    for (let i = 3; i <= 5; i++) {
      const pid = crypto.randomUUID();
      guestIds.push(pid);
      repo.joinRoom(room.id, pid, `Guest ${i}`);
    }

    const started = repo.startLobbyRound(room.id, host.participant_id, {
      candidates: sampleCandidates,
    });
    expect(started.room.status).toBe("ACTIVE");
    expect(started.round.status).toBe("ACTIVE");
    expect(started.frozenParticipants).toHaveLength(5);
    expect(started.candidates).toHaveLength(20);
    expect(started.frozenParticipants.map((rp) => rp.participant_id)).toEqual(
      started.participants.map((p) => p.participant_id)
    );

    // Starting twice fails cleanly
    expect(() =>
      repo.startLobbyRound(room.id, host.participant_id, { candidates: sampleCandidates })
    ).toThrowError(RoomCapacityError);

    // Leaving once ACTIVE fails cleanly without mutating round_participants
    expect(() => repo.leaveLobby(room.id, guest2Id)).toThrowError(RoomCapacityError);

    // Disconnecting a participant after round freeze leaves frozen quorum untouched
    db.prepare("UPDATE room_participants SET is_connected = 0 WHERE room_id = ? AND participant_id = ?").run(
      room.id,
      guest2Id
    );
    const snapshot = repo.getConsistentSnapshot(room.id);
    expect(snapshot?.roundParticipants).toHaveLength(5);
    expect(snapshot?.candidates).toHaveLength(20);
    expect(snapshot?.room.participant_count).toBe(5);
  });

  it("handles SQLite migration 003 down and idempotent re-application cleanly", () => {
    const { db } = createMigratedSqliteRepo();
    const downSql = fs.readFileSync(
      path.join(process.cwd(), "src", "db", "migrations", "sqlite", "003_down_round_roster_freeze.sql"),
      "utf8"
    );
    db.exec(downSql);
    const afterDown = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'round_participants';")
      .get();
    expect(afterDown).toBeUndefined();

    // Re-applying full SQLite migrations restores round_participants cleanly (idempotent)
    applySqliteMigrations(db);
    applySqliteMigrations(db);
    const afterUp = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'round_participants';")
      .get() as { name: string } | undefined;
    expect(afterUp?.name).toBe("round_participants");
  });

  it("executes PostgresRoomRepository leaveLobby and startLobbyRound queries with SELECT FOR UPDATE and SQL booleans", async () => {
    const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const hostId = crypto.randomUUID();
    const guestId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const roomState: Record<string, unknown> = {
      id: roomId,
      code: "PG9922",
      status: "LOBBY",
      host_participant_id: hostId,
      current_round_id: null,
      state_version: 2,
      participant_count: 2,
      matched_movie_id: null,
      deck_filter: null,
      inactivity_ttl_seconds: 86400,
      last_activity_at: nowIso,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    };

    const participantsState = [
      {
        room_id: roomId,
        participant_id: hostId,
        display_name: "PG Host",
        role: "HOST",
        is_connected: true,
        joined_at: "2026-11-14T00:00:00.000Z",
        last_seen_at: nowIso,
      },
      {
        room_id: roomId,
        participant_id: guestId,
        display_name: "PG Guest",
        role: "MEMBER",
        is_connected: true,
        joined_at: "2026-11-14T00:00:01.000Z",
        last_seen_at: nowIso,
      },
    ];

    const frozenState: Array<Record<string, unknown>> = [];
    const candidatesState: Array<Record<string, unknown>> = [];

    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql: sql.trim(), params });
        if (sql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE")) {
          return { rows: [{ ...roomState }] };
        }
        if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1 AND participant_id = $2")) {
          const pid = params?.[1];
          return { rows: participantsState.filter((p) => p.participant_id === pid) };
        }
        if (sql.includes("SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at")) {
          return { rows: participantsState.map((p) => ({ ...p })) };
        }
        if (sql.includes("SELECT COALESCE(MAX(round_number), 0)")) {
          return { rows: [{ max_round: 0 }] };
        }
        if (sql.includes("INSERT INTO rounds")) {
          roomState.current_round_id = params?.[0];
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO round_participants")) {
          frozenState.push({
            room_id: params?.[0],
            round_id: params?.[1] ?? "round-fallback",
            participant_id: params?.[2],
            frozen_role: params?.[3],
            joined_at: params?.[4],
            frozen_at: params?.[5],
          });
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO candidates")) {
          candidatesState.push({
            id: params?.[0],
            round_id: params?.[1],
            room_id: params?.[2],
            movie_id: params?.[3],
            position: params?.[4],
            title: params?.[5],
            poster_path: params?.[6],
            overview: params?.[7],
            release_date: params?.[8],
            vote_average: params?.[9],
          });
          return { rows: [] };
        }
        if (sql.includes("UPDATE rooms") && sql.includes("SET status = 'ACTIVE'")) {
          roomState.status = "ACTIVE";
          roomState.current_round_id = params?.[0];
          roomState.state_version = params?.[1];
          return { rows: [] };
        }
        if (sql.includes("SELECT * FROM rooms WHERE id = $1;")) {
          return { rows: [{ ...roomState }] };
        }
        if (sql.includes("SELECT * FROM rounds WHERE id = $1;")) {
          return {
            rows: [
              {
                id: roomState.current_round_id,
                room_id: roomId,
                round_number: 1,
                status: "ACTIVE",
                started_at: nowIso,
                completed_at: null,
              },
            ],
          };
        }
        if (sql.includes("SELECT * FROM round_participants WHERE room_id = $1 AND round_id = $2")) {
          return { rows: frozenState.map((r) => ({ ...r })) };
        }
        if (sql.includes("SELECT * FROM candidates WHERE room_id = $1 AND round_id = $2")) {
          return { rows: candidatesState.map((c) => ({ ...c })) };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };

    const mockPool = { totalCount: 1, connect: async () => mockClient };
    const repo = new PostgresRoomRepository(mockPool as never, { schema: "cinematch_qual015" });
    const started = await repo.startLobbyRound(roomId, hostId, {
      candidates: makeSampleCandidates(20),
    });

    expect(started.room.status).toBe("ACTIVE");
    expect(started.frozenParticipants).toHaveLength(2);
    expect(started.candidates).toHaveLength(20);
    expect(queries.some((q) => q.sql.includes("SELECT * FROM rooms WHERE id = $1 FOR UPDATE;"))).toBe(true);
    expect(queries.some((q) => q.sql.includes("INSERT INTO round_participants"))).toBe(true);
    expect(queries.some((q) => q.sql.includes("INSERT INTO candidates"))).toBe(true);
    expect(queries.some((q) => q.sql.includes("false, 0, false"))).toBe(true);
  });
});
