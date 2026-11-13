-- CINE-013 SQLite migration: persistent guest capability session generation tracking
-- Zero raw IP / user-agent / PII columns retained.

CREATE TABLE IF NOT EXISTS guest_capability_sessions (
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  min_generation INTEGER NOT NULL DEFAULT 1 CHECK (min_generation >= 1),
  rotated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (room_id, participant_id),
  FOREIGN KEY (room_id, participant_id)
    REFERENCES room_participants(room_id, participant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guest_capability_expires_at
  ON guest_capability_sessions(expires_at);
