-- CINE-017: Vote Operation Idempotency & Immutability Migration 004
-- Target: PostgreSQL 15+

ALTER TABLE votes
  ADD COLUMN IF NOT EXISTS operation_id VARCHAR(128);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE c.conname = 'chk_votes_operation_id_nonempty'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE votes
      ADD CONSTRAINT chk_votes_operation_id_nonempty
      CHECK (operation_id IS NULL OR LENGTH(TRIM(operation_id)) > 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_round_participant_operation
  ON votes (round_id, participant_id, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_vote_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'VOTE_IMMUTABLE: votes are immutable once recorded'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_votes_immutable_update ON votes;
CREATE TRIGGER trg_votes_immutable_update
  BEFORE UPDATE ON votes
  FOR EACH ROW
  EXECUTE FUNCTION prevent_vote_mutation();

DROP TRIGGER IF EXISTS trg_votes_immutable_delete ON votes;
CREATE OR REPLACE FUNCTION prevent_vote_delete_except_room_purge()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
SET row_security = off
AS $$
DECLARE parent_exists boolean;
BEGIN
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.rooms WHERE id = $1)', TG_TABLE_SCHEMA)
    INTO parent_exists USING OLD.room_id;
  IF parent_exists THEN
    RAISE EXCEPTION 'VOTE_IMMUTABLE: votes are immutable once recorded' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_votes_immutable_delete
  BEFORE DELETE ON votes
  FOR EACH ROW
  EXECUTE FUNCTION prevent_vote_delete_except_room_purge();

CREATE OR REPLACE FUNCTION enforce_room_retention()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.status <> 'EXPIRED' OR OLD.expires_at IS NULL OR OLD.expires_at > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'ROOM_RETENTION: room must be expired before deletion' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS trg_rooms_retention_delete ON rooms;
CREATE TRIGGER trg_rooms_retention_delete BEFORE DELETE ON rooms
  FOR EACH ROW EXECUTE FUNCTION enforce_room_retention();
