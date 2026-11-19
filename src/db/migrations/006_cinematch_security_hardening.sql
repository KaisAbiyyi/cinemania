-- Keep the RLS dependency by OID while removing the public RPC surface.
CREATE SCHEMA cinematch_private;
REVOKE ALL ON SCHEMA cinematch_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA cinematch_private TO service_role;

ALTER FUNCTION public.is_current_user_room_participant(UUID) SET SCHEMA cinematch_private;
CREATE OR REPLACE FUNCTION cinematch_private.is_current_user_room_participant(target_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_participants AS member
    WHERE member.room_id = target_room_id
      AND member.participant_id::text = auth.jwt() ->> 'sub'
      AND (auth.jwt() ->> 'iss' IS DISTINCT FROM 'cinematch'
           OR auth.jwt() ->> 'room_id' = target_room_id::text)
  );
$$;
REVOKE ALL ON FUNCTION cinematch_private.is_current_user_room_participant(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION cinematch_private.is_current_user_room_participant(UUID) TO authenticated;

ALTER POLICY participants_self_read_policy ON public.room_participants
  USING (
    participant_id::text = auth.jwt() ->> 'sub'
    AND (auth.jwt() ->> 'iss' IS DISTINCT FROM 'cinematch'
         OR auth.jwt() ->> 'room_id' = room_id::text)
  );

-- Security-only counters. The app stores a keyed pseudonym and discards
-- expired buckets in bounded batches. No API role can access this table.
CREATE TABLE cinematch_private.room_request_limits (
  bucket_key text PRIMARY KEY CHECK (length(bucket_key) = 64),
  hit_count integer NOT NULL CHECK (hit_count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX room_request_limits_expiry ON cinematch_private.room_request_limits (expires_at);
ALTER TABLE cinematch_private.room_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cinematch_private.room_request_limits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cinematch_private.room_request_limits TO service_role;

-- Existing pending rows are immediately eligible. Only publishable heads
-- may be retried, preserving event order across worker and app processes.
ALTER TABLE public.room_events
  ADD COLUMN retry_not_before timestamptz NOT NULL DEFAULT '-infinity'::timestamptz;
