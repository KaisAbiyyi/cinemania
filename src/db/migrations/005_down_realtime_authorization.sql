-- Owner-reviewed rollback only: removes project-wide CINE-018 Realtime policies.
-- Deliberately retain least-privilege function ACL/search_path hardening; rollback
-- must not restore unsafe inherited EXECUTE defaults. Full 001..005 replay recreates functions.
DROP POLICY IF EXISTS cinematch_room_select_allow ON realtime.messages;
DROP POLICY IF EXISTS cinematch_room_select_fence ON realtime.messages;
DROP POLICY IF EXISTS cinematch_room_insert_fence ON realtime.messages;
ALTER TABLE public.room_events DROP COLUMN IF EXISTS permanent_retry_count;
