\set pgpass `echo "$POSTGRES_PASSWORD"`

SELECT set_config('local.pgpass', :'pgpass', false);

DO $$
DECLARE
  r text;
  pw text := current_setting('local.pgpass');
BEGIN
  FOREACH r IN ARRAY ARRAY['authenticator', 'pgbouncer', 'supabase_auth_admin', 'supabase_functions_admin', 'supabase_storage_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('ALTER USER %I WITH PASSWORD %L', r, pw);
    END IF;
  END LOOP;
END $$;
