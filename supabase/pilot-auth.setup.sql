-- Optional production pilot gate. Apply only after the verified backup and approval.
-- Add the approved test addresses separately, then enable the Before User Created hook.
BEGIN;

CREATE SCHEMA nvmed_pilot;
REVOKE ALL ON SCHEMA nvmed_pilot FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA nvmed_pilot TO supabase_auth_admin;

CREATE TABLE nvmed_pilot.allowed_signup (
  email text PRIMARY KEY CHECK (email = lower(btrim(email)) AND position('@' in email) > 1)
);
ALTER TABLE nvmed_pilot.allowed_signup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nvmed_pilot.allowed_signup FROM PUBLIC, anon, authenticated;
GRANT SELECT ON nvmed_pilot.allowed_signup TO supabase_auth_admin;
CREATE POLICY pilot_auth_read ON nvmed_pilot.allowed_signup FOR SELECT TO supabase_auth_admin USING (true);

CREATE FUNCTION nvmed_pilot.before_user_created(event jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM nvmed_pilot.allowed_signup
    WHERE email = lower(btrim(event->'user'->>'email'))
  ) THEN '{}'::jsonb
  ELSE jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Cadastro indisponível.'))
  END;
$$;
REVOKE ALL ON FUNCTION nvmed_pilot.before_user_created(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION nvmed_pilot.before_user_created(jsonb) TO supabase_auth_admin;

COMMIT;
