-- Disposable lab only. Test fixtures are rolled back.
BEGIN;
INSERT INTO nvmed_pilot.allowed_signup(email) VALUES ('pilot@example.invalid');
SET LOCAL ROLE supabase_auth_admin;
DO $$ BEGIN
  IF nvmed_pilot.before_user_created('{"user":{"email":"Pilot@example.invalid"}}') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'FAIL: approved pilot address was denied';
  END IF;
  IF nvmed_pilot.before_user_created('{"user":{"email":"outsider@example.invalid"}}')->'error'->>'http_code' IS DISTINCT FROM '403'
    OR nvmed_pilot.before_user_created('{"user":{}}')->'error'->>'http_code' IS DISTINCT FROM '403' THEN
    RAISE EXCEPTION 'FAIL: unapproved Auth account was accepted';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF has_schema_privilege('authenticated','nvmed_pilot','USAGE')
    OR has_schema_privilege('anon','nvmed_pilot','USAGE')
    OR has_table_privilege('authenticated','nvmed_pilot.allowed_signup','SELECT')
    OR has_function_privilege('anon','nvmed_pilot.before_user_created(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: pilot allowlist is visible outside Auth';
  END IF;
END $$;
ROLLBACK;
