-- CINE-015 SQLite migration: Frozen round voter roster persistence (Rollback)

DROP INDEX IF EXISTS idx_round_participants_room_round;
DROP TABLE IF EXISTS round_participants;
