-- CINE-015: Frozen Round Voter Roster Migration 003 (Rollback)

DROP POLICY IF EXISTS round_participants_self_read_policy ON round_participants;
DROP INDEX IF EXISTS idx_round_participants_room_round;
DROP TABLE IF EXISTS round_participants CASCADE;
