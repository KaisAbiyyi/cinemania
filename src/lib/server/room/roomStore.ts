import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import type { Room, RoomParticipant } from "@/db/schema";
import { PostgresRoomRepository } from "./postgresRoomRepository";
import { SqliteRoomRepository, type CreateRoomOptions } from "./roomRepository";

export interface RoomAuthorityStore {
  createRoom(options: CreateRoomOptions): Promise<{ room: Room; host: RoomParticipant }>;
  joinRoom(roomId: string, participantId: string, displayName: string): Promise<RoomParticipant>;
  getRoomById(roomId: string): Promise<Room | null>;
  getRoomByCode(code: string): Promise<Room | null>;
  getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null>;
  getMinGeneration(roomId: string, participantId: string): Promise<number>;
  setMinGeneration(
    roomId: string,
    participantId: string,
    minGeneration: number,
    expiresAt: string
  ): Promise<void>;
}

const DEFAULT_SQLITE_PATH = path.join(os.tmpdir(), "cinematch-rooms.sqlite");

const globalForStore = globalThis as typeof globalThis & {
  __cinematchSqliteConnection?: { path: string; db: DatabaseSync; store: SqliteRoomAuthorityStore };
  __cinematchPostgresStore?: PostgresRoomAuthorityStore;
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
}

export class PostgresRoomAuthorityStore implements RoomAuthorityStore {
  private readonly pool: Pool;
  private readonly repo: PostgresRoomRepository;

  constructor(pool: Pool) {
    this.pool = pool;
    this.repo = new PostgresRoomRepository(pool);
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
    const res = await this.pool.query("SELECT * FROM rooms WHERE code = $1 LIMIT 1;", [normalized]);
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
  }

  async getParticipant(roomId: string, participantId: string): Promise<RoomParticipant | null> {
    return this.repo.getParticipant(roomId, participantId);
  }

  async getMinGeneration(roomId: string, participantId: string): Promise<number> {
    const res = await this.pool.query(
      "SELECT min_generation FROM guest_capability_sessions WHERE room_id = $1 AND participant_id = $2 LIMIT 1;",
      [roomId, participantId]
    );
    if (res.rows.length === 0) return 1;
    return Number((res.rows[0] as { min_generation: number }).min_generation);
  }

  async setMinGeneration(
    roomId: string,
    participantId: string,
    minGeneration: number,
    expiresAt: string
  ): Promise<void> {
    const rotatedAt = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO guest_capability_sessions (room_id, participant_id, min_generation, rotated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (room_id, participant_id) DO UPDATE SET
         min_generation = GREATEST(guest_capability_sessions.min_generation, EXCLUDED.min_generation),
         rotated_at = EXCLUDED.rotated_at,
         expires_at = EXCLUDED.expires_at;`,
      [roomId, participantId, minGeneration, rotatedAt, expiresAt]
    );
  }
}

export function getRoomAuthorityStore(): RoomAuthorityStore {
  if (process.env.DATABASE_URL || process.env.SUPABASE_PG_HOST) {
    if (!globalForStore.__cinematchPostgresStore) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
      });
      globalForStore.__cinematchPostgresStore = new PostgresRoomAuthorityStore(pool);
    }
    return globalForStore.__cinematchPostgresStore;
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
}
