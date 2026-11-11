-- CINE-012: SQLite Mirror Schema Migration 001 (Rollback / Down)

DROP INDEX IF EXISTS idx_room_events_lookup;
DROP INDEX IF EXISTS idx_votes_participant;
DROP INDEX IF EXISTS idx_votes_round_movie;
DROP INDEX IF EXISTS idx_candidates_round;
DROP INDEX IF EXISTS idx_rounds_room;
DROP INDEX IF EXISTS idx_participants_room;
DROP INDEX IF EXISTS idx_rooms_last_activity;
DROP INDEX IF EXISTS idx_rooms_expires_at;
DROP INDEX IF EXISTS idx_rooms_status;
DROP INDEX IF EXISTS idx_rooms_code;

DROP TABLE IF EXISTS room_events;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS room_participants;
DROP TABLE IF EXISTS rooms;
