-- CINE-017 SQLite migration: Vote operation idempotency & DB immutability triggers (Rollback)

DROP TRIGGER IF EXISTS trg_votes_immutable_delete;
DROP TRIGGER IF EXISTS trg_votes_immutable_update;
DROP TRIGGER IF EXISTS trg_votes_operation_id_nonempty;
DROP INDEX IF EXISTS idx_votes_round_participant_operation;
ALTER TABLE votes DROP COLUMN operation_id;
DROP TRIGGER IF EXISTS trg_rooms_retention_delete;
