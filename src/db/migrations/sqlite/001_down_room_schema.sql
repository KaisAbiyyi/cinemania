-- CINE-012: SQLite Mirror Schema Migration 001 (Rollback)

DROP TABLE IF EXISTS room_events;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS room_participants;
DROP TABLE IF EXISTS rooms;
