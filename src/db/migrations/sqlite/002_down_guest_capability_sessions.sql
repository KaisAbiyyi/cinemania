-- Down SQLite migration for CINE-013 guest_capability_sessions

DROP INDEX IF EXISTS idx_guest_capability_expires_at;
DROP TABLE IF EXISTS guest_capability_sessions;
