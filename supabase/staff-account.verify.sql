-- Run only in the disposable database. Supabase Auth is represented by managed-schema fixtures.
BEGIN;
INSERT INTO public.organizations(id, name) VALUES ('account-lab-a','Conta A'), ('account-lab-b','Conta B');
INSERT INTO auth.users(id, email) VALUES
  ('47000000-0000-4000-8000-000000000001','account-a@example.invalid'),
  ('47000000-0000-4000-8000-000000000002','account-b@example.invalid'),
  ('47000000-0000-4000-8000-000000000003','account-portal@example.invalid');
INSERT INTO public.user_accounts(id, auth_user_id, name, email, type, role, organization_id, status) VALUES
  ('account-lab-staff-a','47000000-0000-4000-8000-000000000001','Perfil A','account-a@example.invalid','tenant_user','Diretor','account-lab-a','active'),
  ('account-lab-staff-b','47000000-0000-4000-8000-000000000002','Perfil B','account-b@example.invalid','tenant_user','Escalista','account-lab-b','active');
INSERT INTO auth.sessions(id, user_id, created_at, not_after, aal, user_agent) VALUES
  ('47000000-0000-4000-8000-000000000011','47000000-0000-4000-8000-000000000001',now(),NULL,'aal1','Mozilla Windows Edg/123'),
  ('47000000-0000-4000-8000-000000000012','47000000-0000-4000-8000-000000000001',now()-interval '1 day',NULL,'aal1','Mozilla Android Chrome/123'),
  ('47000000-0000-4000-8000-000000000013','47000000-0000-4000-8000-000000000001',now()-interval '2 days',now()-interval '1 day','aal1',NULL),
  ('47000000-0000-4000-8000-000000000014','47000000-0000-4000-8000-000000000002',now(),NULL,'aal1','Mozilla Linux Firefox/123'),
  ('47000000-0000-4000-8000-000000000015','47000000-0000-4000-8000-000000000003',now(),NULL,'aal1',NULL);

CREATE FUNCTION pg_temp.use_account(actor int, session_num int, level text, method text, age_seconds int)
RETURNS text LANGUAGE sql AS $fn$
 SELECT set_config('request.jwt.claims', jsonb_build_object(
   'sub', '47000000-0000-4000-8000-' || lpad(actor::text,12,'0'),
   'session_id', '47000000-0000-4000-8000-' || lpad(session_num::text,12,'0'),
   'aal', level, 'amr', jsonb_build_array(jsonb_build_object(
     'method', method, 'timestamp', floor(extract(epoch FROM now())) - age_seconds)))::text, true)
$fn$;

DO $$ BEGIN
  IF has_table_privilege('authenticated','public.account_preferences','INSERT')
    OR has_table_privilege('authenticated','public.account_activity','SELECT')
    OR has_sequence_privilege('authenticated','public.account_activity_id_seq','USAGE')
    OR has_function_privilege('anon','public.nv_account_sessions()','EXECUTE')
    OR has_function_privilege('anon','public.nv_save_account_preferences(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: account grants';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT pg_temp.use_account(1, 11, 'aal1', 'password', 20);
DO $$
DECLARE prefs jsonb; sessions jsonb;
BEGIN
  IF public.nv_account_preferences() IS NOT NULL OR NOT public.nv_account_security_ready(false)
    OR public.nv_account_security_ready(true) THEN RAISE EXCEPTION 'FAIL: primary session defaults'; END IF;
  prefs := public.nv_save_account_preferences('{"theme":"system","sidebarCollapsed":false,"density":"compact","homePage":"/dashboard","scheduleView":"list","documentAlerts":false,"applicationAlerts":false}');
  IF prefs->>'homePage' <> '/dashboard' OR prefs->>'theme' <> 'system' OR prefs->>'documentAlerts' <> 'false'
    OR prefs->>'density' <> 'compact' OR prefs->>'scheduleView' <> 'list' OR prefs->>'sidebarCollapsed' <> 'false' OR prefs->>'applicationAlerts' <> 'false'
    OR public.nv_account_preferences() IS DISTINCT FROM prefs THEN RAISE EXCEPTION 'FAIL: preferences persistence'; END IF;
  IF public.nv_save_account_preferences('{"theme":"dark"}')->>'scheduleView' <> 'list' THEN
    RAISE EXCEPTION 'FAIL: preference patch overwrote other settings'; END IF;
  sessions := public.nv_account_sessions();
  IF jsonb_array_length(sessions) <> 2 OR sessions->0->>'browser' <> 'Edge'
    OR sessions->0->>'current' <> 'true' OR sessions->1->>'system' <> 'Android' THEN
    RAISE EXCEPTION 'FAIL: current, other or expired sessions';
  END IF;
END $$;

SELECT pg_temp.use_account(2, 14, 'aal1', 'password', 700);
DO $$ BEGIN
  IF public.nv_account_security_ready(false) OR public.nv_account_preferences() IS NOT NULL
    OR jsonb_array_length(public.nv_account_sessions()) <> 1 THEN RAISE EXCEPTION 'FAIL: account isolation or stale authentication'; END IF;
  BEGIN
    PERFORM public.nv_save_account_preferences('{"homePage":"/documentos"}');
    RAISE EXCEPTION 'FAIL: unauthorized home';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_account_preferences('{"documentAlerts":false}');
    RAISE EXCEPTION 'FAIL: unauthorized document notification preference';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_account_preferences('{"applicationAlerts":true}');
    RAISE EXCEPTION 'FAIL: unauthorized application preference';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_account_preferences('{"auth_user_id":"47000000-0000-4000-8000-000000000001"}');
    RAISE EXCEPTION 'FAIL: unexpected preference fields';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

SELECT pg_temp.use_account(3, 15, 'aal1', 'password', 20);
DO $$ BEGIN
  IF public.nv_account_security_ready(false) OR public.nv_account_preferences() IS NOT NULL
    OR public.nv_account_sessions() <> '[]'::jsonb THEN RAISE EXCEPTION 'FAIL: portal account scope'; END IF;
END $$;

RESET ROLE;
INSERT INTO public.portal_notifications(recipient_id,event_key,message)
VALUES ('47000000-0000-4000-8000-000000000001','application:muted','Candidatura sintética'),
       ('47000000-0000-4000-8000-000000000002','application:unassigned','Candidatura sintética'),
       ('47000000-0000-4000-8000-000000000001','banking:critical','Aviso sintético fora da categoria');
UPDATE public.account_preferences SET application_alerts = true
WHERE auth_user_id = '47000000-0000-4000-8000-000000000001';
INSERT INTO public.portal_notifications(recipient_id,event_key,message)
VALUES ('47000000-0000-4000-8000-000000000001','application:enabled','Candidatura sintética');
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.portal_notifications WHERE event_key IN ('application:muted','application:unassigned'))
    OR (SELECT count(*) FROM public.portal_notifications WHERE event_key IN ('application:enabled','banking:critical')) <> 2
  THEN RAISE EXCEPTION 'FAIL: staff application notification preferences'; END IF;
END $$;

INSERT INTO auth.mfa_factors(id, user_id, status) VALUES
  ('47000000-0000-4000-8000-000000000021','47000000-0000-4000-8000-000000000001','verified'),
  ('47000000-0000-4000-8000-000000000022','47000000-0000-4000-8000-000000000001','unverified');
DO $$ BEGIN
  BEGIN
    DELETE FROM auth.mfa_factors WHERE id='47000000-0000-4000-8000-000000000021';
    RAISE EXCEPTION 'FAIL: unverified backup allowed deleting last TOTP';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE auth.mfa_factors SET status='verified' WHERE id='47000000-0000-4000-8000-000000000022';
DO $$ BEGIN
  BEGIN
    DELETE FROM auth.mfa_factors WHERE user_id='47000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'FAIL: deleting factors in a batch left no TOTP';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
UPDATE auth.sessions SET aal='aal2', factor_id='47000000-0000-4000-8000-000000000022'
WHERE id='47000000-0000-4000-8000-000000000011';
DELETE FROM auth.mfa_factors WHERE id='47000000-0000-4000-8000-000000000021';
UPDATE public.user_accounts SET name='Perfil atualizado',avatar='synthetic-avatar' WHERE id='account-lab-staff-a';
INSERT INTO auth.audit_log_entries(payload)
  SELECT jsonb_build_object('action',action,'actor_id','47000000-0000-4000-8000-000000000001','actor_name','never in feed')::json
  FROM unnest(ARRAY['login','logout','verification_attempted','user_updated_password','user_recovery_requested','token_refreshed']) action;
INSERT INTO auth.audit_log_entries(payload, created_at)
  SELECT '{"actor_id":"47000000-0000-4000-8000-000000000001","action":"login"}'::json,
    now() - i * interval '1 minute' FROM generate_series(1,30) i;
INSERT INTO auth.audit_log_entries(payload)
  VALUES ('{"actor_id":"47000000-0000-4000-8000-000000000002","action":"login"}');

SET LOCAL ROLE authenticated;
SELECT pg_temp.use_account(1, 11, 'aal1', 'password', 20);
DO $$ BEGIN
  IF public.nv_account_security_ready(false) THEN RAISE EXCEPTION 'FAIL: MFA configured but JWT AAL1'; END IF;
END $$;
SELECT pg_temp.use_account(1, 11, 'aal2', 'totp', 700);
DO $$ BEGIN
  IF public.nv_account_security_ready(false) THEN RAISE EXCEPTION 'FAIL: old MFA'; END IF;
END $$;
SELECT pg_temp.use_account(1, 11, 'aal2', 'totp', 20);
DO $$
DECLARE page_size int; cursor_id bigint;
BEGIN
  IF NOT public.nv_account_security_ready(true) THEN RAISE EXCEPTION 'FAIL: verified recent MFA'; END IF;
  SELECT count(*) INTO page_size FROM public.nv_account_activity();
  SELECT id::bigint INTO cursor_id FROM public.nv_account_activity() OFFSET 19 LIMIT 1;
  IF page_size <> 21 OR (SELECT count(*) FROM public.nv_account_activity(cursor_id)) <> 19 THEN
    RAISE EXCEPTION 'FAIL: keyset pagination';
  END IF;
  IF (SELECT count(DISTINCT event_key) FROM public.nv_account_activity()) <> 9 THEN
    RAISE EXCEPTION 'FAIL: audit event coverage';
  END IF;
  PERFORM set_config('nv.test.account_cursor',cursor_id::text,true);
END $$;
SELECT pg_temp.use_account(2, 14, 'aal1', 'password', 20);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.nv_account_activity()) <> 1
    OR EXISTS (SELECT FROM public.nv_account_activity(current_setting('nv.test.account_cursor')::bigint)) THEN
    RAISE EXCEPTION 'FAIL: account history isolation';
  END IF;
END $$;

RESET ROLE;
DELETE FROM auth.sessions WHERE id='47000000-0000-4000-8000-000000000011';
SET LOCAL ROLE authenticated;
SELECT pg_temp.use_account(1, 11, 'aal2', 'totp', 20);
DO $$ BEGIN
  IF public.nv_account_session_ready() OR public.nv_account_security_ready(true) OR public.nv_account_sessions() <> '[]'::jsonb
    OR EXISTS(SELECT FROM public.nv_account_activity()) THEN RAISE EXCEPTION 'FAIL: revoked session'; END IF;
END $$;
ROLLBACK;
