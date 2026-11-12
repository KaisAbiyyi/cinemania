-- CINE-012: Authoritative Room Schema Migration 001 (Rollback)
-- Target: PostgreSQL 15+

DROP FUNCTION IF EXISTS get_room_by_code(VARCHAR(6)) CASCADE;
DROP FUNCTION IF EXISTS is_current_user_room_participant(UUID) CASCADE;

DROP TABLE IF EXISTS room_events CASCADE;
DROP SEQUENCE IF EXISTS room_events_id_seq CASCADE;
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;

ALTER TABLE rooms DROP CONSTRAINT IF EXISTS fk_rooms_current_round;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS fk_rooms_host_participant;

DROP TABLE IF EXISTS rounds CASCADE;
DROP TABLE IF EXISTS room_participants CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;

DROP TYPE IF EXISTS vote_type;
DROP TYPE IF EXISTS round_status;
DROP TYPE IF EXISTS participant_role;
DROP TYPE IF EXISTS room_status;
