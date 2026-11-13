-- CINE-013: Persistent guest capability session generation tracking
-- Zero raw IP / user-agent / PII columns retained.

CREATE TABLE IF NOT EXISTS guest_capability_sessions (
  room_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  min_generation INTEGER NOT NULL DEFAULT 1 CHECK (min_generation >= 1),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (room_id, participant_id),
  FOREIGN KEY (room_id, participant_id)
    REFERENCES room_participants(room_id, participant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guest_capability_expires_at
  ON guest_capability_sessions(expires_at);

ALTER TABLE guest_capability_sessions ENABLE ROW LEVEL SECURITY;

-- Server authority only: anonymous and authenticated clients cannot directly query or mutate capability generations.
REVOKE ALL ON TABLE guest_capability_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE guest_capability_sessions TO service_role;
