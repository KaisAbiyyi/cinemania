import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool, type PoolConfig } from "pg";
import type { Room, RoomParticipant } from "@/db/schema";
import { CapabilityAuthError } from "@/lib/server/auth/guestCapability";
import { PostgresRoomRepository, assertValidPgSchema } from "./postgresRoomRepository";
import { SqliteRoomRepository, type CreateRoomOptions } from "./roomRepository";

export interface RoomAuthorityStore {
  createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }>;
  joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant>;
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

function loadSqliteMigrations(): string[] {
  const baseDir = path.join(process.cwd(), "src", "db", "migrations", "sqlite");
  return [
    fs.readFileSync(path.join(baseDir, "001_create_room_schema.sql"), "utf8"),
    fs.readFileSync(path.join(baseDir, "002_guest_capability_sessions.sql"), "utf8"),
  ];
}

export function applySqliteMigrations(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  for (const sql of loadSqliteMigrations()) {
    db.exec(sql);
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

  constructor(db: DatabaseSync) {
    this.db = db;
    this.repo = new SqliteRoomRepository(db);
  }

  async createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }> {
    return this.repo.createRoom(options);
  }

  async joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant> {
    return this.repo.joinRoom(roomId, participantId, displayName);
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    return this.repo.getRoomById(roomId);
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const normalized = code.trim().toUpperCase();
    const row = this.db.prepare("SELECT * FROM rooms WHERE code = ? LIMIT 1;").get(normalized);
    return (row as unknown as Room) || null;
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

  constructor(pool: Pool, options?: { schema?: string }) {
    try {
      this.schema = assertValidPgSchema(options?.schema);
    } catch {
      throw new CapabilityAuthError(500, "DATABASE_CONFIG_INVALID", "Invalid PostgreSQL schema identifier.");
    }
    this.pool = pool;
    this.repo = new PostgresRoomRepository(pool, options);
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

  async createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }> {
    return this.repo.createRoom(options);
  }

  async joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant> {
    return this.repo.joinRoom(roomId, participantId, displayName);
  }

  async getRoomById(roomId: string): Promise<Room | null> {
    return this.repo.getRoomById(roomId);
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const normalized = code.trim().toUpperCase();
    return this.withClient(async (client) => {
      const res = await client.query("SELECT * FROM rooms WHERE code = $1 LIMIT 1;", [normalized]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0] as Room;
      return {
        ...row,
        state_version: Number(row.state_version),
        participant_count: Number(row.participant_count),
        inactivity_ttl_seconds: Number(row.inactivity_ttl_seconds),
        last_activity_at: new Date(row.last_activity_at).toISOString(),
        expires_at: new Date(row.expires_at).toISOString(),
        created_at: new Date(row.created_at).toISOString(),
        updated_at: new Date(row.updated_at).toISOString(),
      };
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
