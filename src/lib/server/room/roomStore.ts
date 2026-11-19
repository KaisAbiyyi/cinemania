import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool, type PoolConfig } from "pg";
import type {
  Candidate,
  Room,
  RoomParticipant,
  Round,
  RoundParticipant,
  Vote,
  VoteType,
} from "@/db/schema";
import type { CanonicalRoomDeckFilter } from "@/lib/schemas/roomDeck";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";
import { dispatchPendingEvents } from "@/lib/server/realtime/dispatch";
import { postgresOutboxStore } from "@/lib/server/realtime/postgresOutbox";
import { createSupabasePublisher } from "@/lib/server/realtime/supabasePublisher";
import type {
  GraceRoomSweepOutcome,
  SyntheticClock,
} from "./expiryWorker";
import {
  PostgresRoomRepository,
  assertValidPgSchema,
  normalizeCandidate,
  normalizeParticipant,
  normalizeRoom,
  normalizeRoundParticipant,
  normalizeVote,
} from "./postgresRoomRepository";
import {
  SqliteRoomRepository,
  normalizeSqliteRoom,
  type CreateRoomOptions,
  type LeaveLobbyResult,
  type RecordVoteResult,
  type RetryRoundOptions,
  type RetryRoundResult,
  type StartLobbyRoundOptions,
  type StartLobbyRoundResult,
  type UpdateDeckFilterResult,
  type UpdatePresenceResult,
} from "./roomRepository";

export interface RoomMutationHooks {
  afterWriteBeforeSessionInit?: () => void | Promise<void>;
  beforeCommit?: (context: {
    room: Room;
    participants: RoomParticipant[];
    participant: RoomParticipant;
    sessionGeneration: number;
    rejoined: boolean;
  }) => void | Promise<void>;
}

export interface CreateRoomSessionOptions extends CreateRoomOptions {
  hooks?: RoomMutationHooks;
}

export interface JoinRoomSessionOptions {
  roomId: string;
  participantId: string;
  displayName: string;
  requireExistingParticipant?: boolean;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  hooks?: RoomMutationHooks;
}

export interface AtomicRoomSessionResult {
  room: Room;
  participants: RoomParticipant[];
  roundParticipants?: RoundParticipant[];
  candidates?: Candidate[];
  participant: RoomParticipant;
  sessionGeneration: number;
  rejoined: boolean;
}

export interface LeaveLobbySessionOptions {
  roomId: string;
  participantId: string;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  beforeCommit?: (left: LeaveLobbyResult) => void | Promise<void>;
}

export interface StartLobbyRoundSessionOptions {
  roomId: string;
  actorParticipantId: string;
  options: StartLobbyRoundOptions;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  beforeCommit?: (started: StartLobbyRoundResult) => void | Promise<void>;
}

export interface UpdateRoomDeckFilterSessionOptions {
  roomId: string;
  actorParticipantId: string;
  deckFilter: CanonicalRoomDeckFilter;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  beforeCommit?: (updated: UpdateDeckFilterResult) => void | Promise<void>;
}

export interface RecordVoteSessionOptions {
  roomId: string;
  roundId: string | null;
  participantId: string;
  candidateId: string;
  movieId: number;
  vote: VoteType;
  operationId?: string | null;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  beforeCommit?: (result: RecordVoteSessionResult) => void | Promise<void>;
}

export interface RecordVoteSessionResult extends RecordVoteResult {
  participants: RoomParticipant[];
  roundParticipants: RoundParticipant[];
  candidates: Candidate[];
  votes: Vote[];
}

export interface RetryRoundSessionOptions {
  roomId: string;
  actorParticipantId: string;
  options: RetryRoundOptions;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  beforeCommit?: (retried: RetryRoundResult) => void | Promise<void>;
}

export interface UpdatePresenceSessionOptions {
  roomId: string;
  participantId: string;
  connected: boolean;
  verifyLockedSession?: (context: { room: Room; minGeneration: number }) => void;
  beforeCommit?: (updated: UpdatePresenceResult) => void | Promise<void>;
}

function assertSyncHookResult(value: unknown, hookName: string): void {
  if (value && typeof (value as PromiseLike<unknown>).then === "function") {
    throw new CapabilityAuthError(
      500,
      "ASYNC_HOOK_UNSUPPORTED_IN_SQLITE",
      `SQLite synchronous transaction hook '${hookName}' must execute synchronously.`
    );
  }
}

export interface RoomAuthorityStore {
  dispatchRoomNotifications?(roomId: string): Promise<void>;
  listRoomEventVersions(roomId: string, since: number): Promise<number[]>;
  createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }>;
  joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant>;
  createRoomWithSession(options: CreateRoomSessionOptions): Promise<AtomicRoomSessionResult>;
  joinRoomWithSession(options: JoinRoomSessionOptions): Promise<AtomicRoomSessionResult>;
  leaveLobbyWithSession(options: LeaveLobbySessionOptions): Promise<LeaveLobbyResult>;
  updateRoomDeckFilterWithSession(
    options: UpdateRoomDeckFilterSessionOptions
  ): Promise<UpdateDeckFilterResult>;
  startLobbyRoundWithSession(options: StartLobbyRoundSessionOptions): Promise<StartLobbyRoundResult>;
  retryExhaustedRoundWithSession(options: RetryRoundSessionOptions): Promise<RetryRoundResult>;
  updateParticipantPresenceWithSession(
    options: UpdatePresenceSessionOptions
  ): Promise<UpdatePresenceResult>;
  recordVoteWithSession(options: RecordVoteSessionOptions): Promise<RecordVoteSessionResult>;
  getConsistentRoomSnapshot(
    roomId: string
  ): Promise<{
    room: Room;
    participants: RoomParticipant[];
    roundParticipants: RoundParticipant[];
    candidates: Candidate[];
    votes: Vote[];
    latestRound: Round | null;
  } | null>;
  getRoundParticipants(roomId: string, roundId: string): Promise<RoundParticipant[]>;
  getLatestRound(roomId: string): Promise<Round | null>;
  getNextRoundNumber(roomId: string): Promise<number>;
  findActiveRooms(): Promise<Room[]>;
  expireRoom(roomId: string, expectedVersion: number, expiredAt: string): Promise<boolean>;
  purgeExpiredRooms(retentionBeforeIso: string): Promise<string[]>;
  sweepRoomGraceTimeouts(
    roomId: string,
    options?: {
      nowIso?: string;
      graceSeconds?: number;
      heartbeatStaleSeconds?: number;
    }
  ): Promise<GraceRoomSweepOutcome>;
  getRoomById(roomId: string): Promise<Room | null>;
  getRoomByCode(code: string): Promise<Room | null>;
  getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null>;
  getParticipantsByRoom(roomId: string): Promise<RoomParticipant[]>;
  getMinGeneration(roomId: string, participantId: string): Promise<number>;
  setMinGeneration(
    roomId: string,
    participantId: string,
    minGeneration: number,
    expiresAt: string
  ): Promise<void>;
  /**
   * Atomically compares current persistent min_generation === expectedGeneration
   * and increments to min_generation + 1. Returns the new generation on success,
   * or null when a concurrent/prior rotation already advanced the generation.
   */
  rotateGeneration(
    roomId: string,
    participantId: string,
    expectedGeneration: number,
    expiresAt: string
  ): Promise<number | null>;
}

export interface ResolvedPostgresConfig {
  poolConfig: PoolConfig;
  source: "database_url" | "supabase_pg_env";
  fingerprint: string;
}

const DEFAULT_SQLITE_PATH = path.join(os.tmpdir(), "cinematch-rooms.sqlite");

const globalForStore = globalThis as typeof globalThis & {
  __cinematchSqliteConnection?: { path: string; db: DatabaseSync; store: SqliteRoomAuthorityStore };
  __cinematchPostgresConnection?: { fingerprint: string; pool: Pool; store: PostgresRoomAuthorityStore };
};

function loadSqliteMigrations(): { preColumnSqls: string[]; postColumnSqls: string[] } {
  const baseDir = path.join(process.cwd(), "src", "db", "migrations", "sqlite");
  return {
    preColumnSqls: [
      fs.readFileSync(path.join(baseDir, "001_create_room_schema.sql"), "utf8"),
      fs.readFileSync(path.join(baseDir, "002_guest_capability_sessions.sql"), "utf8"),
      fs.readFileSync(path.join(baseDir, "003_round_roster_freeze.sql"), "utf8"),
    ],
    postColumnSqls: [
      fs.readFileSync(path.join(baseDir, "004_vote_operation_idempotency.sql"), "utf8"),
    ],
  };
}

export function applySqliteMigrations(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  const { preColumnSqls, postColumnSqls } = loadSqliteMigrations();
  for (const sql of preColumnSqls) {
    db.exec(sql);
  }
  const voteColumns = db.prepare("PRAGMA table_info(votes);").all() as Array<{ name?: string }>;
  const hasOperationId = voteColumns.some((col) => col.name === "operation_id");
  for (const sql of postColumnSqls) {
    const executableSql = hasOperationId
      ? sql.replace(/ALTER TABLE votes\s+ADD COLUMN operation_id[^;]*;/gi, "")
      : sql;
    db.exec(executableSql);
  }
}

function loadSupabaseCaCertIfPresent(): string | undefined {
  const caPath = path.join(process.cwd(), "src", "db", "supabase-root-ca.crt");
  if (fs.existsSync(caPath)) {
    return fs.readFileSync(caPath, "utf8");
  }
  return undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]";
}

/**
 * Resolves and validates PostgreSQL pool configuration from DATABASE_URL or SUPABASE_PG_*.
 * Returns null only when no PostgreSQL environment variables are configured.
 * Throws fail-closed CapabilityAuthError(500) on partial or invalid PostgreSQL configuration.
 */
export function resolvePostgresPoolConfig(): ResolvedPostgresConfig | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const pgHost = process.env.SUPABASE_PG_HOST?.trim();

  if (databaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(databaseUrl);
    } catch {
      throw new CapabilityAuthError(
        500,
        "DATABASE_CONFIG_INVALID",
        "DATABASE_URL is not a valid connection URI."
      );
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new CapabilityAuthError(
        500,
        "DATABASE_CONFIG_INVALID",
        "DATABASE_URL must use postgres:// or postgresql:// protocol."
      );
    }

    const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
    const caCert = loadSupabaseCaCertIfPresent();
    const shouldVerifyCa =
      !isLoopbackHost(parsed.hostname) &&
      sslMode !== "disable" &&
      (Boolean(caCert) || parsed.hostname.endsWith(".supabase.co") || parsed.hostname.endsWith(".supabase.com"));

    const poolConfig: PoolConfig = {
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 10000,
      ...(shouldVerifyCa && caCert
        ? {
            ssl: {
              rejectUnauthorized: true,
              ca: caCert,
              servername: parsed.hostname,
            },
          }
        : sslMode === "require" || sslMode === "verify-full"
          ? { ssl: { rejectUnauthorized: true, servername: parsed.hostname } }
          : {}),
    };

    const fingerprint = crypto.createHash("sha256").update(`url:${databaseUrl}`).digest("hex");
    return { poolConfig, source: "database_url", fingerprint };
  }

  if (pgHost) {
    const pgPassword = process.env.SUPABASE_PG_PASSWORD;
    if (!pgPassword) {
      throw new CapabilityAuthError(
        500,
        "DATABASE_CONFIG_INVALID",
        "SUPABASE_PG_HOST is configured without SUPABASE_PG_PASSWORD."
      );
    }

    const pgPortRaw = process.env.SUPABASE_PG_PORT?.trim() || "5432";
    const pgPort = Number(pgPortRaw);
    if (!Number.isInteger(pgPort) || pgPort < 1 || pgPort > 65535) {
      throw new CapabilityAuthError(
        500,
        "DATABASE_CONFIG_INVALID",
        "SUPABASE_PG_PORT must be a valid TCP port."
      );
    }

    const pgUser = process.env.SUPABASE_PG_USER?.trim() || "postgres";
    const pgDatabase = process.env.SUPABASE_PG_DATABASE?.trim() || "postgres";
    const sslMode = process.env.SUPABASE_PG_SSLMODE?.trim().toLowerCase();
    const caCert = loadSupabaseCaCertIfPresent();

    let ssl: PoolConfig["ssl"] = undefined;
    if (sslMode !== "disable" && !isLoopbackHost(pgHost)) {
      if (!caCert && (pgHost.endsWith(".supabase.co") || pgHost.endsWith(".supabase.com"))) {
        throw new CapabilityAuthError(
          500,
          "DATABASE_CONFIG_INVALID",
          "Supabase Root CA certificate is missing for strict TLS connection."
        );
      }
      ssl = caCert
        ? { rejectUnauthorized: true, ca: caCert, servername: pgHost }
        : { rejectUnauthorized: true, servername: pgHost };
    }

    const poolConfig: PoolConfig = {
      host: pgHost,
      port: pgPort,
      user: pgUser,
      database: pgDatabase,
      password: pgPassword,
      max: 10,
      connectionTimeoutMillis: 10000,
      ...(ssl ? { ssl } : {}),
    };

    const fingerprint = crypto
      .createHash("sha256")
      .update(`pg:${pgHost}:${pgPort}:${pgDatabase}:${pgUser}:${pgPassword}:${sslMode ?? ""}`)
      .digest("hex");

    return { poolConfig, source: "supabase_pg_env", fingerprint };
  }

  return null;
}

export class SqliteRoomAuthorityStore implements RoomAuthorityStore {
  private readonly db: DatabaseSync;
  private readonly repo: SqliteRoomRepository;

  async listRoomEventVersions(roomId: string, since: number): Promise<number[]> {
    const rows = this.db.prepare("SELECT version FROM room_events WHERE room_id = ? AND version > ? ORDER BY version ASC LIMIT 100").all(roomId, since) as Array<{ version: number }>;
    return rows.map((row) => row.version);
  }

  constructor(db: DatabaseSync, options?: { clock?: SyntheticClock }) {
    this.db = db;
    this.repo = new SqliteRoomRepository(db, {
      enforceMigrationAuthority: true,
      clock: options?.clock,
    });
  }

  async createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }> {
    return this.repo.createRoom(options);
  }

  async joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant> {
    return this.repo.joinRoom(roomId, participantId, displayName);
  }

  private finalizeSqliteSessionInTx(
    room: Room,
    participant: RoomParticipant,
    rejoined: boolean,
    hooks?: RoomMutationHooks
  ): AtomicRoomSessionResult {
    if (hooks?.afterWriteBeforeSessionInit) {
      assertSyncHookResult(
        hooks.afterWriteBeforeSessionInit(),
        "afterWriteBeforeSessionInit"
      );
    }

    const rotatedAt = new Date().toISOString();
    const sessionRow = this.db
      .prepare(
        `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(room_id, participant_id) DO UPDATE SET
           expires_at = excluded.expires_at
         RETURNING min_generation;`
      )
      .get(room.id, participant.participant_id, rotatedAt, room.expires_at) as unknown as
      | { min_generation: number }
      | undefined;
    const sessionGeneration = sessionRow ? Number(sessionRow.min_generation) : 1;
    const participants = this.repo.getParticipantsByRoom(room.id);
    const roundParticipants = room.current_round_id
      ? this.repo.getRoundParticipants(room.id, room.current_round_id)
      : [];
    const candidates = room.current_round_id
      ? this.repo.getCandidatesByRound(room.current_round_id, room.id)
      : [];

    const result: AtomicRoomSessionResult = {
      room,
      participants,
      roundParticipants,
      candidates,
      participant,
      sessionGeneration,
      rejoined,
    };
    if (hooks?.beforeCommit) {
      assertSyncHookResult(hooks.beforeCommit(result), "beforeCommit");
    }
    return result;
  }

  async createRoomWithSession(options: CreateRoomSessionOptions): Promise<AtomicRoomSessionResult> {
    return this.repo.createRoomInTransaction(options, ({ room, host }) =>
      this.finalizeSqliteSessionInTx(room, host, false, options.hooks)
    );
  }

  async joinRoomWithSession(options: JoinRoomSessionOptions): Promise<AtomicRoomSessionResult> {
    return this.repo.joinRoomInTransaction(
      options.roomId,
      options.participantId,
      options.displayName,
      {
        beforeJoinLocked: (room) => {
          const row = this.db
            .prepare(
              "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
            )
            .get(room.id, options.participantId) as unknown as
            | { min_generation: number }
            | undefined;
          const minGeneration = row ? Number(row.min_generation) : 1;
          options.verifyLockedSession?.({ room, minGeneration });

          if (options.requireExistingParticipant) {
            const existing = this.repo.getParticipant(room.id, options.participantId);
            if (!existing) {
              throw new CapabilityAuthError(
                403,
                "PARTICIPANT_NOT_IN_ROOM",
                "Capability does not match an active participant in this room."
              );
            }
          }
        },
        afterJoin: ({ room, participant, rejoined }) =>
          this.finalizeSqliteSessionInTx(room, participant, rejoined, options.hooks),
      }
    );
  }

  async getConsistentRoomSnapshot(
    roomId: string
  ): Promise<{
    room: Room;
    participants: RoomParticipant[];
    roundParticipants: RoundParticipant[];
    candidates: Candidate[];
    votes: Vote[];
    latestRound: Round | null;
  } | null> {
    return this.repo.getConsistentSnapshot(roomId);
  }

  async leaveLobbyWithSession(options: LeaveLobbySessionOptions): Promise<LeaveLobbyResult> {
    return this.repo.leaveLobbyInTransaction(options.roomId, options.participantId, {
      beforeLeaveLocked: (room) => {
        const row = this.db
          .prepare(
            "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
          )
          .get(room.id, options.participantId) as unknown as
          | { min_generation: number }
          | undefined;
        const minGeneration = row ? Number(row.min_generation) : 1;
        options.verifyLockedSession?.({ room, minGeneration });
      },
      afterLeave: (left) => {
        const retainedHistoricalRow = left.participants.some(
          (p) => p.participant_id.toLowerCase() === left.leftParticipantId.toLowerCase()
        );
        if (left.roomClosed || retainedHistoricalRow) {
          const rotatedAt = new Date().toISOString();
          this.db
            .prepare(
              `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
               VALUES (?, ?, 2, ?, ?)
               ON CONFLICT(room_id, participant_id) DO UPDATE SET
                 min_generation = guest_capability_sessions.min_generation + 1,
                 rotated_at = excluded.rotated_at,
                 expires_at = excluded.expires_at;`
            )
            .run(left.room.id, left.leftParticipantId, rotatedAt, left.room.expires_at);
        }
        if (options.beforeCommit) {
          assertSyncHookResult(options.beforeCommit(left), "beforeCommit");
        }
        return left;
      },
    });
  }

  async updateRoomDeckFilterWithSession(
    options: UpdateRoomDeckFilterSessionOptions
  ): Promise<UpdateDeckFilterResult> {
    return this.repo.updateRoomDeckFilterInTransaction(
      options.roomId,
      options.actorParticipantId,
      options.deckFilter,
      {
        beforeUpdateLocked: (room) => {
          const row = this.db
            .prepare(
              "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
            )
            .get(room.id, options.actorParticipantId) as unknown as
            | { min_generation: number }
            | undefined;
          const minGeneration = row ? Number(row.min_generation) : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterUpdate: (updated) => {
          if (options.beforeCommit) {
            assertSyncHookResult(options.beforeCommit(updated), "beforeCommit");
          }
          return updated;
        },
      }
    );
  }

  async startLobbyRoundWithSession(
    options: StartLobbyRoundSessionOptions
  ): Promise<StartLobbyRoundResult> {
    return this.repo.startLobbyRoundInTransaction(
      options.roomId,
      options.actorParticipantId,
      {
        options: options.options,
        beforeStartLocked: (room) => {
          const row = this.db
            .prepare(
              "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
            )
            .get(room.id, options.actorParticipantId) as unknown as
            | { min_generation: number }
            | undefined;
          const minGeneration = row ? Number(row.min_generation) : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterStart: (started) => {
          if (options.beforeCommit) {
            assertSyncHookResult(options.beforeCommit(started), "beforeCommit");
          }
          return started;
        },
      }
    );
  }

  async retryExhaustedRoundWithSession(
    options: RetryRoundSessionOptions
  ): Promise<RetryRoundResult> {
    return this.repo.retryExhaustedRoundInTransaction(
      options.roomId,
      options.actorParticipantId,
      {
        options: options.options,
        beforeRetryLocked: (room) => {
          const row = this.db
            .prepare(
              "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
            )
            .get(room.id, options.actorParticipantId) as unknown as
            | { min_generation: number }
            | undefined;
          const minGeneration = row ? Number(row.min_generation) : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterRetry: (retried) => {
          if (options.beforeCommit) {
            assertSyncHookResult(options.beforeCommit(retried), "beforeCommit");
          }
          return retried;
        },
      }
    );
  }

  async updateParticipantPresenceWithSession(
    options: UpdatePresenceSessionOptions
  ): Promise<UpdatePresenceResult> {
    return this.repo.updateParticipantPresenceInTransaction(
      options.roomId,
      options.participantId,
      options.connected,
      {
        beforePresenceLocked: (room) => {
          const row = this.db
            .prepare(
              "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
            )
            .get(room.id, options.participantId) as unknown as
            | { min_generation: number }
            | undefined;
          const minGeneration = row ? Number(row.min_generation) : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterPresence: (updated) => {
          if (options.beforeCommit) {
            assertSyncHookResult(options.beforeCommit(updated), "beforeCommit");
          }
          return updated;
        },
      }
    );
  }

  async getLatestRound(roomId: string): Promise<Round | null> {
    return this.repo.getLatestRound(roomId);
  }

  async getNextRoundNumber(roomId: string): Promise<number> {
    return this.repo.getNextRoundNumber(roomId);
  }

  async findActiveRooms(): Promise<Room[]> {
    return this.repo.findActiveRooms();
  }

  async expireRoom(roomId: string, expectedVersion: number, expiredAt: string): Promise<boolean> {
    return this.repo.expireRoom(roomId, expectedVersion, expiredAt);
  }

  async purgeExpiredRooms(retentionBeforeIso: string): Promise<string[]> {
    return this.repo.purgeExpiredRooms(retentionBeforeIso);
  }

  async sweepRoomGraceTimeouts(
    roomId: string,
    options?: {
      nowIso?: string;
      graceSeconds?: number;
      heartbeatStaleSeconds?: number;
    }
  ): Promise<GraceRoomSweepOutcome> {
    return this.repo.sweepRoomGraceTimeouts(roomId, options);
  }

  async recordVoteWithSession(
    options: RecordVoteSessionOptions
  ): Promise<RecordVoteSessionResult> {
    return this.repo.recordVoteInTransaction(
      options.roomId,
      options.roundId,
      options.participantId,
      options.candidateId,
      options.movieId,
      options.vote,
      {
        options: { operationId: options.operationId },
        beforeVoteLocked: (room) => {
          const row = this.db
            .prepare(
              "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
            )
            .get(room.id, options.participantId) as unknown as
            | { min_generation: number }
            | undefined;
          const minGeneration = row ? Number(row.min_generation) : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterVote: (result) => {
          const participants = this.repo.getParticipantsByRoom(result.room.id);
          const roundParticipants = result.room.current_round_id
            ? this.repo.getRoundParticipants(result.room.id, result.room.current_round_id)
            : [];
          const candidates = result.room.current_round_id
            ? this.repo.getCandidatesByRound(result.room.current_round_id, result.room.id)
            : [];
          const votes = result.room.current_round_id
            ? this.repo.getVotesByRound(result.room.current_round_id, result.room.id)
            : [];
          const sessionResult: RecordVoteSessionResult = {
            ...result,
            participants,
            roundParticipants,
            candidates,
            votes,
          };
          if (options.beforeCommit) {
            assertSyncHookResult(options.beforeCommit(sessionResult), "beforeCommit");
          }
          return sessionResult;
        },
      }
    );
  }

  async getRoundParticipants(roomId: string, roundId: string): Promise<RoundParticipant[]> {
    return this.repo.getRoundParticipants(roomId, roundId);
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    return this.repo.getRoomById(roomId);
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const normalized = code.trim().toUpperCase();
    const row = this.db.prepare("SELECT * FROM rooms WHERE code = ? LIMIT 1;").get(normalized) as
      | Record<string, unknown>
      | undefined;
    return row ? normalizeSqliteRoom(row) : null;
  }

  async getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null> {
    return this.repo.getParticipant(roomId, participantId);
  }

  async getParticipantsByRoom(roomId: string): Promise<RoomParticipant[]> {
    return this.repo.getParticipantsByRoom(roomId);
  }

  async getMinGeneration(roomId: string, participantId: string): Promise<number> {
    const row = this.db
      .prepare(
        "SELECT min_generation FROM guest_capability_sessions WHERE room_id = ? AND participant_id = ? LIMIT 1;"
      )
      .get(roomId, participantId) as unknown as { min_generation: number } | undefined;
    return row ? Number(row.min_generation) : 1;
  }

  async setMinGeneration(
    roomId: string,
    participantId: string,
    minGeneration: number,
    expiresAt: string
  ): Promise<void> {
    const rotatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_id, participant_id) DO UPDATE SET
           min_generation = CASE
             WHEN excluded.min_generation > guest_capability_sessions.min_generation
               THEN excluded.min_generation
             ELSE guest_capability_sessions.min_generation
           END,
           rotated_at = excluded.rotated_at,
           expires_at = excluded.expires_at;`
      )
      .run(roomId, participantId, minGeneration, rotatedAt, expiresAt);
  }

  async rotateGeneration(
    roomId: string,
    participantId: string,
    expectedGeneration: number,
    expiresAt: string
  ): Promise<number | null> {
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 1) {
      return null;
    }

    const rotatedAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.db
        .prepare(
          `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(room_id, participant_id) DO NOTHING;`
        )
        .run(roomId, participantId, rotatedAt, expiresAt);

      const row = this.db
        .prepare(
          `UPDATE guest_capability_sessions
           SET min_generation = min_generation + 1,
               rotated_at = ?,
               expires_at = ?
           WHERE room_id = ?
             AND participant_id = ?
             AND min_generation = ?
           RETURNING min_generation;`
        )
        .get(rotatedAt, expiresAt, roomId, participantId, expectedGeneration) as unknown as
        | { min_generation: number }
        | undefined;

      this.db.exec("COMMIT;");
      return row ? Number(row.min_generation) : null;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }
}

export class PostgresRoomAuthorityStore implements RoomAuthorityStore {
  private readonly pool: Pool;
  private readonly repo: PostgresRoomRepository;
  private readonly schema?: string;

  async listRoomEventVersions(roomId: string, since: number): Promise<number[]> {
    return this.withClient(async (client) => {
      const result = await client.query<{ version: number }>("SELECT version FROM room_events WHERE room_id = $1 AND version > $2 ORDER BY version ASC LIMIT 100", [roomId, since]);
      return result.rows.map((row) => row.version);
    });
  }

  async dispatchRoomNotifications(roomId: string): Promise<void> {
    const url = process.env.SUPABASE_URL;
    const secret = process.env.SUPABASE_SECRET_KEY;
    if (!url || !secret) throw new Error("Realtime publisher configuration missing");
    const sent = await dispatchPendingEvents(roomId, postgresOutboxStore(this.pool, this.schema), createSupabasePublisher(url, secret));
    if (!sent) throw new Error("Realtime publication failed");
  }

  constructor(pool: Pool, options?: { schema?: string; clock?: SyntheticClock }) {
    try {
      this.schema = assertValidPgSchema(options?.schema);
    } catch {
      throw new CapabilityAuthError(500, "DATABASE_CONFIG_INVALID", "Invalid PostgreSQL schema identifier.");
    }
    this.pool = pool;
    this.repo = new PostgresRoomRepository(pool, {
      ...options,
      enforceMigrationAuthority: true,
    });
  }

  private async withClient<T>(
    fn: (client: import("pg").PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      if (this.schema) {
        await client.query(`SET search_path TO "${this.schema}", pg_temp;`);
      }
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async finalizeSessionInTx(
    client: import("pg").Client | import("pg").PoolClient,
    room: Room,
    participant: RoomParticipant,
    rejoined: boolean,
    hooks?: RoomMutationHooks
  ): Promise<AtomicRoomSessionResult> {
    if (hooks?.afterWriteBeforeSessionInit) {
      await hooks.afterWriteBeforeSessionInit();
    }

    const rotatedAt = new Date().toISOString();
    const sessRes = await client.query(
      `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (room_id, participant_id) DO UPDATE SET
         expires_at = EXCLUDED.expires_at
       RETURNING min_generation;`,
      [room.id, participant.participant_id, rotatedAt, room.expires_at]
    );
    const sessionGeneration =
      sessRes.rows.length > 0
        ? Number((sessRes.rows[0] as { min_generation: number }).min_generation)
        : 1;

    const partRes = await client.query(
      "SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at ASC, participant_id ASC;",
      [room.id]
    );
    const participants = partRes.rows.map((row) =>
      normalizeParticipant(row as Record<string, unknown>)
    );
    const frozenRes = room.current_round_id
      ? await client.query(
          "SELECT * FROM round_participants WHERE room_id = $1 AND round_id = $2 ORDER BY joined_at ASC, participant_id ASC;",
          [room.id, room.current_round_id]
        )
      : { rows: [] };
    const roundParticipants = frozenRes.rows.map((row) =>
      normalizeRoundParticipant(row as Record<string, unknown>)
    );
    const candRes = room.current_round_id
      ? await client.query(
          "SELECT * FROM candidates WHERE room_id = $1 AND round_id = $2 ORDER BY position ASC;",
          [room.id, room.current_round_id]
        )
      : { rows: [] };
    const candidates = candRes.rows.map((row) =>
      normalizeCandidate(row as Record<string, unknown>)
    );

    const result: AtomicRoomSessionResult = {
      room,
      participants,
      roundParticipants,
      candidates,
      participant,
      sessionGeneration,
      rejoined,
    };
    if (hooks?.beforeCommit) {
      await hooks.beforeCommit(result);
    }
    return result;
  }

  async createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }> {
    return this.repo.createRoom(options);
  }

  async joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant> {
    return this.repo.joinRoom(roomId, participantId, displayName);
  }

  async createRoomWithSession(options: CreateRoomSessionOptions): Promise<AtomicRoomSessionResult> {
    return this.repo.createRoomWithTx(options, async (client, { room, host }) =>
      this.finalizeSessionInTx(client, room, host, false, options.hooks)
    );
  }

  async joinRoomWithSession(options: JoinRoomSessionOptions): Promise<AtomicRoomSessionResult> {
    return this.repo.joinRoomWithTx(
      options.roomId,
      options.participantId,
      options.displayName,
      {
        beforeJoinLocked: async (client, room) => {
          const genRes = await client.query(
            "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
            [room.id, options.participantId]
          );
          const minGeneration =
            genRes.rows.length > 0
              ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
              : 1;
          options.verifyLockedSession?.({ room, minGeneration });

          if (options.requireExistingParticipant) {
            const partRes = await client.query(
              "SELECT 1 FROM room_participants WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
              [room.id, options.participantId]
            );
            if (partRes.rows.length === 0) {
              throw new CapabilityAuthError(
                403,
                "PARTICIPANT_NOT_IN_ROOM",
                "Capability does not match an active participant in this room."
              );
            }
          }
        },
        afterJoin: async (client, { room, participant, rejoined }) =>
          this.finalizeSessionInTx(client, room, participant, rejoined, options.hooks),
      }
    );
  }

  async getConsistentRoomSnapshot(
    roomId: string
  ): Promise<{
    room: Room;
    participants: RoomParticipant[];
    roundParticipants: RoundParticipant[];
    candidates: Candidate[];
    votes: Vote[];
    latestRound: Round | null;
  } | null> {
    return this.repo.getConsistentSnapshot(roomId);
  }

  async leaveLobbyWithSession(options: LeaveLobbySessionOptions): Promise<LeaveLobbyResult> {
    return this.repo.leaveLobbyWithTx(options.roomId, options.participantId, {
      beforeLeaveLocked: async (client, room) => {
        const genRes = await client.query(
          "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
          [room.id, options.participantId]
        );
        const minGeneration =
          genRes.rows.length > 0
            ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
            : 1;
        options.verifyLockedSession?.({ room, minGeneration });
      },
      afterLeave: async (client, left) => {
        const retainedHistoricalRow = left.participants.some(
          (p) => p.participant_id.toLowerCase() === left.leftParticipantId.toLowerCase()
        );
        if (left.roomClosed || retainedHistoricalRow) {
          const rotatedAt = new Date().toISOString();
          await client.query(
            `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
             VALUES ($1, $2, 2, $3, $4)
             ON CONFLICT (room_id, participant_id) DO UPDATE SET
               min_generation = guest_capability_sessions.min_generation + 1,
               rotated_at = EXCLUDED.rotated_at,
               expires_at = EXCLUDED.expires_at;`,
            [left.room.id, left.leftParticipantId, rotatedAt, left.room.expires_at]
          );
        }
        if (options.beforeCommit) {
          await options.beforeCommit(left);
        }
        return left;
      },
    });
  }

  async updateRoomDeckFilterWithSession(
    options: UpdateRoomDeckFilterSessionOptions
  ): Promise<UpdateDeckFilterResult> {
    return this.repo.updateRoomDeckFilterWithTx(
      options.roomId,
      options.actorParticipantId,
      options.deckFilter,
      {
        beforeUpdateLocked: async (client, room) => {
          const genRes = await client.query(
            "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
            [room.id, options.actorParticipantId]
          );
          const minGeneration =
            genRes.rows.length > 0
              ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
              : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterUpdate: async (_client, updated) => {
          if (options.beforeCommit) {
            await options.beforeCommit(updated);
          }
          return updated;
        },
      }
    );
  }

  async startLobbyRoundWithSession(
    options: StartLobbyRoundSessionOptions
  ): Promise<StartLobbyRoundResult> {
    return this.repo.startLobbyRoundWithTx(options.roomId, options.actorParticipantId, {
      options: options.options,
      beforeStartLocked: async (client, room) => {
        const genRes = await client.query(
          "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
          [room.id, options.actorParticipantId]
        );
        const minGeneration =
          genRes.rows.length > 0
            ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
            : 1;
        options.verifyLockedSession?.({ room, minGeneration });
      },
      afterStart: async (_client, started) => {
        if (options.beforeCommit) {
          await options.beforeCommit(started);
        }
        return started;
      },
    });
  }

  async retryExhaustedRoundWithSession(
    options: RetryRoundSessionOptions
  ): Promise<RetryRoundResult> {
    return this.repo.retryExhaustedRoundInTransaction(
      options.roomId,
      options.actorParticipantId,
      {
        options: options.options,
        beforeRetryLocked: async (client, room) => {
          const genRes = await client.query(
            "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
            [room.id, options.actorParticipantId]
          );
          const minGeneration =
            genRes.rows.length > 0
              ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
              : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterRetry: async (_client, retried) => {
          if (options.beforeCommit) {
            await options.beforeCommit(retried);
          }
          return retried;
        },
      }
    );
  }

  async updateParticipantPresenceWithSession(
    options: UpdatePresenceSessionOptions
  ): Promise<UpdatePresenceResult> {
    return this.repo.updateParticipantPresenceInTransaction(
      options.roomId,
      options.participantId,
      options.connected,
      {
        beforePresenceLocked: async (client, room) => {
          const genRes = await client.query(
            "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
            [room.id, options.participantId]
          );
          const minGeneration =
            genRes.rows.length > 0
              ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
              : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterPresence: async (_client, updated) => {
          if (options.beforeCommit) {
            await options.beforeCommit(updated);
          }
          return updated;
        },
      }
    );
  }

  async getLatestRound(roomId: string): Promise<Round | null> {
    return this.repo.getLatestRound(roomId);
  }

  async getNextRoundNumber(roomId: string): Promise<number> {
    return this.repo.getNextRoundNumber(roomId);
  }

  async findActiveRooms(): Promise<Room[]> {
    return this.repo.findActiveRooms();
  }

  async expireRoom(roomId: string, expectedVersion: number, expiredAt: string): Promise<boolean> {
    return this.repo.expireRoom(roomId, expectedVersion, expiredAt);
  }

  async purgeExpiredRooms(retentionBeforeIso: string): Promise<string[]> {
    return this.repo.purgeExpiredRooms(retentionBeforeIso);
  }

  async sweepRoomGraceTimeouts(
    roomId: string,
    options?: {
      nowIso?: string;
      graceSeconds?: number;
      heartbeatStaleSeconds?: number;
    }
  ): Promise<GraceRoomSweepOutcome> {
    return this.repo.sweepRoomGraceTimeouts(roomId, options);
  }

  async recordVoteWithSession(
    options: RecordVoteSessionOptions
  ): Promise<RecordVoteSessionResult> {
    return this.repo.recordVoteWithTx(
      options.roomId,
      options.roundId,
      options.participantId,
      options.candidateId,
      options.movieId,
      options.vote,
      {
        options: { operationId: options.operationId },
        beforeVoteLocked: async (client, room) => {
          const genRes = await client.query(
            "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
            [room.id, options.participantId]
          );
          const minGeneration =
            genRes.rows.length > 0
              ? Number((genRes.rows[0] as { min_generation: number }).min_generation)
              : 1;
          options.verifyLockedSession?.({ room, minGeneration });
        },
        afterVote: async (client, result) => {
          const partRes = await client.query(
            "SELECT * FROM room_participants WHERE room_id = $1 ORDER BY joined_at ASC, participant_id ASC;",
            [result.room.id]
          );
          const frozenRes = result.room.current_round_id
            ? await client.query(
                "SELECT * FROM round_participants WHERE room_id = $1 AND round_id = $2 ORDER BY joined_at ASC, participant_id ASC;",
                [result.room.id, result.room.current_round_id]
              )
            : { rows: [] };
          const candsRes = result.room.current_round_id
            ? await client.query(
                "SELECT * FROM candidates WHERE room_id = $1 AND round_id = $2 ORDER BY position ASC;",
                [result.room.id, result.room.current_round_id]
              )
            : { rows: [] };
          const votesRes = result.room.current_round_id
            ? await client.query(
                "SELECT * FROM votes WHERE room_id = $1 AND round_id = $2 ORDER BY created_at ASC;",
                [result.room.id, result.room.current_round_id]
              )
            : { rows: [] };

          const sessionResult: RecordVoteSessionResult = {
            ...result,
            participants: partRes.rows.map((row) => normalizeParticipant(row)),
            roundParticipants: frozenRes.rows.map((row) => normalizeRoundParticipant(row)),
            candidates: candsRes.rows.map((row) => normalizeCandidate(row)),
            votes: votesRes.rows.map((row) => normalizeVote(row)),
          };
          if (options.beforeCommit) {
            await options.beforeCommit(sessionResult);
          }
          return sessionResult;
        },
      }
    );
  }

  async getRoundParticipants(roomId: string, roundId: string): Promise<RoundParticipant[]> {
    return this.repo.getRoundParticipants(roomId, roundId);
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    return this.repo.getRoomById(roomId);
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const normalized = code.trim().toUpperCase();
    return this.withClient(async (client) => {
      const res = await client.query("SELECT * FROM rooms WHERE code = $1 LIMIT 1;", [normalized]);
      if (res.rows.length === 0) return null;
      return normalizeRoom(res.rows[0] as Record<string, unknown>);
    });
  }

  async getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null> {
    return this.repo.getParticipant(roomId, participantId);
  }

  async getParticipantsByRoom(roomId: string): Promise<RoomParticipant[]> {
    return this.repo.getParticipantsByRoom(roomId);
  }

  async getMinGeneration(roomId: string, participantId: string): Promise<number> {
    return this.withClient(async (client) => {
      const res = await client.query(
        "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
        [roomId, participantId]
      );
      if (res.rows.length === 0) return 1;
      return Number((res.rows[0] as { min_generation: number }).min_generation);
    });
  }

  async setMinGeneration(
    roomId: string,
    participantId: string,
    minGeneration: number,
    expiresAt: string
  ): Promise<void> {
    const rotatedAt = new Date().toISOString();
    await this.withClient(async (client) => {
      await client.query(
        `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (room_id, participant_id) DO UPDATE SET
           min_generation = GREATEST(guest_capability_sessions.min_generation, EXCLUDED.min_generation),
           rotated_at = EXCLUDED.rotated_at,
           expires_at = EXCLUDED.expires_at;`,
        [roomId, participantId, minGeneration, rotatedAt, expiresAt]
      );
    });
  }

  async rotateGeneration(
    roomId: string,
    participantId: string,
    expectedGeneration: number,
    expiresAt: string
  ): Promise<number | null> {
    if (!Number.isInteger(expectedGeneration) || expectedGeneration < 1) {
      return null;
    }

    const rotatedAt = new Date().toISOString();
    return this.withClient(async (client) => {
      try {
        await client.query("BEGIN;");
        await client.query(
          `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
           VALUES ($1, $2, 1, $3, $4)
           ON CONFLICT (room_id, participant_id) DO NOTHING;`,
          [roomId, participantId, rotatedAt, expiresAt]
        );

        const res = await client.query(
          `UPDATE guest_capability_sessions
           SET min_generation = min_generation + 1,
               rotated_at = $4,
               expires_at = $5
           WHERE room_id = $1
             AND participant_id = $2
             AND min_generation = $3
           RETURNING min_generation;`,
          [roomId, participantId, expectedGeneration, rotatedAt, expiresAt]
        );

        await client.query("COMMIT;");
        if (res.rows.length === 0) {
          return null;
        }
        return Number((res.rows[0] as { min_generation: number }).min_generation);
      } catch (err) {
        await client.query("ROLLBACK;").catch(() => {});
        throw err;
      }
    });
  }
}

export function getRoomAuthorityStore(): RoomAuthorityStore {
  const resolvedPg = resolvePostgresPoolConfig();
  if (resolvedPg) {
    const cachedPg = globalForStore.__cinematchPostgresConnection;
    if (cachedPg && cachedPg.fingerprint === resolvedPg.fingerprint) {
      return cachedPg.store;
    }
    if (cachedPg) {
      void cachedPg.pool.end().catch(() => {});
    }
    const pool = new Pool(resolvedPg.poolConfig);
    const store = new PostgresRoomAuthorityStore(pool);
    globalForStore.__cinematchPostgresConnection = {
      fingerprint: resolvedPg.fingerprint,
      pool,
      store,
    };
    return store;
  }

  // Fail closed in production unless explicit offline test-harness opt-in is set.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.CINEMATCH_ALLOW_LOCAL_SQLITE_IN_PROD !== "true"
  ) {
    throw new CapabilityAuthError(
      500,
      "DURABLE_STORE_UNCONFIGURED",
      "Shared PostgreSQL database configuration is required in production."
    );
  }

  const sqlitePath = process.env.CINEMATCH_SQLITE_PATH || DEFAULT_SQLITE_PATH;
  const cached = globalForStore.__cinematchSqliteConnection;
  if (cached && cached.path === sqlitePath) {
    return cached.store;
  }

  if (cached) {
    try {
      cached.db.close();
    } catch {
      // ignore close errors on rebind
    }
  }

  if (sqlitePath !== ":memory:") {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  }
  const db = new DatabaseSync(sqlitePath);
  if (sqlitePath !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  applySqliteMigrations(db);
  const store = new SqliteRoomAuthorityStore(db);
  globalForStore.__cinematchSqliteConnection = { path: sqlitePath, db, store };
  return store;
}

export function resetRoomAuthorityStoreForTests(): void {
  const cached = globalForStore.__cinematchSqliteConnection;
  if (cached) {
    try {
      cached.db.close();
    } catch {
      // ignore
    }
    globalForStore.__cinematchSqliteConnection = undefined;
  }
  const cachedPg = globalForStore.__cinematchPostgresConnection;
  if (cachedPg) {
    void cachedPg.pool.end().catch(() => {});
    globalForStore.__cinematchPostgresConnection = undefined;
  }
}
