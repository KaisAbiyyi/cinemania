-- Roll back application binaries before removing their required schema.
ALTER TABLE public.room_events DROP COLUMN retry_not_before;
DROP TABLE cinematch_private.room_request_limits;
ALTER POLICY participants_self_read_policy ON public.room_participants
  USING (participant_id = (auth.jwt() ->> 'sub')::uuid);
ALTER FUNCTION cinematch_private.is_current_user_room_participant(UUID) SET SCHEMA public;
CREATE OR REPLACE FUNCTION public.is_current_user_room_participant(target_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = target_room_id
      AND participant_id = (auth.jwt() ->> 'sub')::uuid
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_current_user_room_participant(UUID) TO service_role;
DROP SCHEMA cinematch_private;
