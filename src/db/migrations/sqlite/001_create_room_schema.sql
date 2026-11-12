-- CINE-012: SQLite Mirror Schema Migration 001 (Forward)
-- Used for fast, zero-dependency offline unit & integration test validation
-- Coherent with ADR-003 and hardened PostgreSQL relational schema

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL CHECK(length(code) = 6),
  status TEXT NOT NULL DEFAULT 'LOBBY' CHECK(status IN ('LOBBY', 'ACTIVE', 'MATCHED', 'EXHAUSTED', 'EXPIRED')),
  host_participant_id TEXT,
  current_round_id TEXT,
  state_version INTEGER NOT NULL DEFAULT 1,
  participant_count INTEGER NOT NULL DEFAULT 1 CHECK(participant_count >= 1 AND participant_count <= 5),
  matched_movie_id INTEGER,
  deck_filter TEXT,
  inactivity_ttl_seconds INTEGER NOT NULL DEFAULT 86400 CHECK(inactivity_ttl_seconds > 0),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (current_round_id) REFERENCES rounds(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS room_participants (
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL,
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) > 0),
  role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('HOST', 'MEMBER')),
  is_connected INTEGER NOT NULL DEFAULT 1 CHECK(is_connected IN (0, 1)),
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, participant_id)
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL DEFAULT 1 CHECK(round_number >= 1),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  CONSTRAINT uq_room_round_number UNIQUE (room_id, round_number),
  CONSTRAINT uq_rounds_composite UNIQUE (room_id, id)
);

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL,
  movie_id INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK(position >= 0 AND position < 20),
  title TEXT NOT NULL,
  poster_path TEXT,
  overview TEXT,
  release_date TEXT,
  vote_average REAL,
  FOREIGN KEY (room_id, round_id) REFERENCES rounds(room_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_round_movie UNIQUE (round_id, movie_id),
  CONSTRAINT uq_round_position UNIQUE (round_id, position),
  CONSTRAINT uq_candidates_composite UNIQUE (room_id, round_id, id, movie_id)
);

CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  movie_id INTEGER NOT NULL,
  vote TEXT NOT NULL CHECK(vote IN ('LIKE', 'SKIP')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (room_id, participant_id) REFERENCES room_participants(room_id, participant_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, round_id, candidate_id, movie_id) REFERENCES candidates(room_id, round_id, id, movie_id) ON DELETE CASCADE,
  CONSTRAINT uq_vote_candidate UNIQUE (round_id, participant_id, candidate_id),
  CONSTRAINT uq_vote_movie UNIQUE (round_id, participant_id, movie_id)
);

CREATE TABLE IF NOT EXISTS room_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  dispatched INTEGER NOT NULL DEFAULT 0 CHECK(dispatched IN (0, 1)),
  dispatched_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  poison INTEGER NOT NULL DEFAULT 0 CHECK(poison IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_room_event_version UNIQUE (room_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_expires_at ON rooms(expires_at);
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_participants_room ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_rounds_room ON rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_candidates_round ON candidates(round_id, position);
CREATE INDEX IF NOT EXISTS idx_votes_round_movie ON votes(round_id, movie_id, vote);
CREATE INDEX IF NOT EXISTS idx_votes_participant ON votes(round_id, participant_id);
CREATE INDEX IF NOT EXISTS idx_room_events_lookup ON room_events(room_id, version);

-- SQLite triggers to enforce composite host reference semantics without global participant_id uniqueness:
-- 1. When a participant is deleted, if they are the host of that room, set rooms.host_participant_id = NULL
CREATE TRIGGER IF NOT EXISTS trg_room_participants_host_delete
AFTER DELETE ON room_participants
FOR EACH ROW
WHEN OLD.participant_id = (SELECT host_participant_id FROM rooms WHERE id = OLD.room_id)
BEGIN
  UPDATE rooms SET host_participant_id = NULL WHERE id = OLD.room_id;
END;

-- 2. When rooms.host_participant_id is inserted as non-NULL, verify that participant exists in this room
CREATE TRIGGER IF NOT EXISTS trg_rooms_host_check_insert
BEFORE INSERT ON rooms
FOR EACH ROW
WHEN NEW.host_participant_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed')
  WHERE NOT EXISTS (
    SELECT 1 FROM room_participants
    WHERE room_id = NEW.id AND participant_id = NEW.host_participant_id
  );
END;

-- 3. When rooms.host_participant_id is updated to non-NULL, verify that participant exists in this room
CREATE TRIGGER IF NOT EXISTS trg_rooms_host_check_update
BEFORE UPDATE OF host_participant_id ON rooms
FOR EACH ROW
WHEN NEW.host_participant_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed')
  WHERE NOT EXISTS (
    SELECT 1 FROM room_participants
    WHERE room_id = NEW.id AND participant_id = NEW.host_participant_id
  );
END;

