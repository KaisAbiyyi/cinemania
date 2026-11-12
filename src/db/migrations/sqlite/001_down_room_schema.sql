-- CINE-012: SQLite Mirror Schema Migration 001 (Rollback)

PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS trg_rooms_host_check_update;
DROP TRIGGER IF EXISTS trg_rooms_host_check_insert;
DROP TRIGGER IF EXISTS trg_room_participants_host_delete;

DROP TABLE IF EXISTS room_events;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS candidates;
DROP TABLE IF EXISTS rounds;
DROP TABLE IF EXISTS room_participants;
DROP TABLE IF EXISTS rooms;

PRAGMA foreign_keys = ON;
