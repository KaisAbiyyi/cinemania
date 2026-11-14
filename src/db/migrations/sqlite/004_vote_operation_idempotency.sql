-- CINE-017 SQLite migration: Vote operation idempotency & DB immutability trigger
-- Note: operation_id column addition is guarded idempotently in applySqliteMigrations()
-- because SQLite lacks ADD COLUMN IF NOT EXISTS syntax.

CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_round_participant_operation
  ON votes (round_id, participant_id, operation_id)
  WHERE operation_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS trg_votes_immutable_update
BEFORE UPDATE ON votes
BEGIN
  SELECT RAISE(ABORT, 'VOTE_IMMUTABLE: votes are immutable once recorded');
END;
