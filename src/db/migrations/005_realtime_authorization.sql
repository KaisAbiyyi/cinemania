-- CINE-018: Apply only after an owner verifies the target project and disables
-- Realtime public channel access. This migration does not change that setting.
-- Existing public.is_current_user_room_participant derives sub from auth.jwt().
ALTER TABLE public.room_events ADD COLUMN permanent_retry_count INTEGER NOT NULL DEFAULT 0;

CREATE POLICY cinematch_room_select_allow ON realtime.messages
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    realtime.topic() = ('room:' || (auth.jwt() ->> 'room_id'))
    AND public.is_current_user_room_participant((auth.jwt() ->> 'room_id')::uuid)
  );

-- Restrictive policies prevent competing permissive policies from granting
-- another room to anon/authenticated or allowing clients to forge room events.
CREATE POLICY cinematch_room_select_fence ON realtime.messages
  AS RESTRICTIVE FOR SELECT TO anon, authenticated
  USING (
    CASE WHEN realtime.topic() LIKE 'room:%' THEN
      realtime.topic() = ('room:' || (auth.jwt() ->> 'room_id'))
      AND public.is_current_user_room_participant((auth.jwt() ->> 'room_id')::uuid)
    ELSE true END
  );

CREATE POLICY cinematch_room_insert_fence ON realtime.messages
  AS RESTRICTIVE FOR INSERT TO anon, authenticated
  WITH CHECK (realtime.topic() NOT LIKE 'room:%');
