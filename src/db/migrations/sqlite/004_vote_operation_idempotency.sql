-- CINE-017 SQLite migration: Vote operation idempotency & DB immutability triggers

ALTER TABLE votes ADD COLUMN operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_round_participant_operation
  ON votes (round_id, participant_id, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_votes_operation_id_nonempty
BEFORE INSERT ON votes
FOR EACH ROW
WHEN NEW.operation_id IS NOT NULL AND LENGTH(TRIM(NEW.operation_id)) = 0
BEGIN
  SELECT RAISE(ABORT, 'INVALID_VOTE_PAYLOAD: operation_id cannot be empty');
END;

CREATE TRIGGER IF NOT EXISTS trg_votes_immutable_update
BEFORE UPDATE ON votes
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'VOTE_IMMUTABLE: votes are immutable once recorded');
END;

DROP TRIGGER IF EXISTS trg_votes_immutable_delete;
CREATE TRIGGER trg_votes_immutable_delete
BEFORE DELETE ON votes
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM rooms WHERE id = OLD.room_id)
BEGIN
  SELECT RAISE(ABORT, 'VOTE_IMMUTABLE: votes are immutable once recorded');
END;

DROP TRIGGER IF EXISTS trg_rooms_retention_delete;
CREATE TRIGGER trg_rooms_retention_delete
BEFORE DELETE ON rooms
FOR EACH ROW
WHEN OLD.status <> 'EXPIRED' OR julianday(OLD.expires_at) IS NULL OR julianday(OLD.expires_at) > julianday('now')
BEGIN
  SELECT RAISE(ABORT, 'ROOM_RETENTION: room must be expired before deletion');
END;
