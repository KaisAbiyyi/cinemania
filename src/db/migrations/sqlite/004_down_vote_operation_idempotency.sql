-- CINE-017 SQLite migration: Vote operation idempotency & DB immutability trigger (Rollback)

DROP TRIGGER IF EXISTS trg_votes_immutable_update;
DROP INDEX IF EXISTS idx_votes_round_participant_operation;
