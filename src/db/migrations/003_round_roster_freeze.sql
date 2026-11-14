-- CINE-015: Frozen Round Voter Roster Migration 003 (Forward)
-- Persists the immutable server-authorized voter roster frozen at round start.

CREATE TABLE IF NOT EXISTS round_participants (
  room_id UUID NOT NULL,
  round_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  frozen_role participant_role NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (round_id, participant_id),
  CONSTRAINT fk_round_participants_round FOREIGN KEY (room_id, round_id)
    REFERENCES rounds(room_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_round_participants_participant FOREIGN KEY (room_id, participant_id)
    REFERENCES room_participants(room_id, participant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_round_participants_room_round
  ON round_participants(room_id, round_id);

ALTER TABLE round_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS round_participants_self_read_policy ON round_participants;
CREATE POLICY round_participants_self_read_policy ON round_participants
  FOR SELECT TO authenticated
  USING (participant_id = (auth.jwt() ->> 'sub')::uuid);

REVOKE ALL ON TABLE round_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE round_participants TO authenticated;
GRANT ALL ON TABLE round_participants TO service_role;
