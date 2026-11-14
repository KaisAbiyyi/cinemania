-- CINE-017: Vote Operation Idempotency & Immutability Migration 004 (Rollback)
-- Target: PostgreSQL 15+

DROP TRIGGER IF EXISTS trg_votes_immutable_update ON votes;
DROP FUNCTION IF EXISTS prevent_vote_mutation();
DROP INDEX IF EXISTS idx_votes_round_participant_operation;
ALTER TABLE votes DROP CONSTRAINT IF EXISTS chk_votes_operation_id_nonempty;
ALTER TABLE votes DROP COLUMN IF EXISTS operation_id;
