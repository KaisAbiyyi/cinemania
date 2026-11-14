-- CINE-015 SQLite migration: Frozen round voter roster persistence (Forward)

CREATE TABLE IF NOT EXISTS round_participants (
  room_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  frozen_role TEXT NOT NULL CHECK(frozen_role IN ('HOST', 'MEMBER')),
  joined_at TEXT NOT NULL,
  frozen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (round_id, participant_id),
  FOREIGN KEY (room_id, round_id) REFERENCES rounds(room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, participant_id) REFERENCES room_participants(room_id, participant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_round_participants_room_round
  ON round_participants(room_id, round_id);
