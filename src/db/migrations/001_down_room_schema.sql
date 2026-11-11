-- CINE-012: Authoritative Room Schema Migration 001 (Rollback / Down)
-- Target: PostgreSQL 15+ (Supabase / Managed PostgreSQL)

-- 1. Drop constraints and tables in reverse dependency order
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS fk_rooms_host_participant;
ALTER TABLE rooms DROP CONSTRAINT IF EXISTS fk_rooms_current_round;

DROP TABLE IF EXISTS room_events CASCADE;
DROP TABLE IF EXISTS votes CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS rounds CASCADE;
DROP TABLE IF EXISTS room_participants CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;

-- 2. Drop Enums
DROP TYPE IF EXISTS vote_type;
DROP TYPE IF EXISTS round_status;
DROP TYPE IF EXISTS participant_role;
DROP TYPE IF EXISTS room_status;
