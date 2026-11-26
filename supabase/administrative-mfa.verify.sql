-- Disposable database only. The managed Auth tables use synthetic sessions and factors.
BEGIN;

INSERT INTO auth.users(id, email) VALUES ('41000000-0000-4000-8000-000000000001', 'mfa-ceo@example.invalid');
INSERT INTO public.user_accounts(id, auth_user_id, name, email, type, role, status)
VALUES ('nv-mfa-ceo', '41000000-0000-4000-8000-000000000001', 'CEO sintético', 'mfa-ceo@example.invalid', 'saas_admin', 'CEO', 'active');
INSERT INTO public.organizations(id, name) VALUES ('nv-mfa-delete', 'Empresa sintética para exclusão');

INSERT INTO auth.mfa_factors(id, user_id, status) VALUES
  ('41000000-0000-4000-8000-000000000010', '32000000-0000-4000-8000-000000000001', 'verified'),
  ('41000000-0000-4000-8000-000000000011', '32000000-0000-4000-8000-000000000001', 'verified'),
  ('41000000-0000-4000-8000-000000000012', '41000000-0000-4000-8000-000000000001', 'verified');
INSERT INTO auth.sessions(id, user_id, created_at, aal, factor_id) VALUES
  ('41000000-0000-4000-8000-000000000020', '32000000-0000-4000-8000-000000000001', now(), 'aal1', NULL),
  ('41000000-0000-4000-8000-000000000021', '32000000-0000-4000-8000-000000000001', now(), 'aal2', '41000000-0000-4000-8000-000000000010'),
  ('41000000-0000-4000-8000-000000000022', '32000000-0000-4000-8000-000000000001', now(), 'aal2', '41000000-0000-4000-8000-000000000011'),
  ('41000000-0000-4000-8000-000000000023', '41000000-0000-4000-8000-000000000001', now(), 'aal2', '41000000-0000-4000-8000-000000000012');

DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.nv_begin_doctor_access_internal(text,text,text,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.nv_doctor_portal_role_internal(text,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.nv_manage_user_internal(uuid,text,uuid,jsonb,text)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.nv_delete_organization_internal(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.nv_manage_user(uuid,uuid,text,uuid,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: MFA boundary grants';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"41000000-0000-4000-8000-000000000021"}', true);
DO $$ BEGIN
  IF public.nv_admin_mfa_session() IS NOT NULL OR public.nv_doctor_portal_role('nv-bank-doctor') <> 'Médico' THEN
    RAISE EXCEPTION 'FAIL: password session accepted or existing read blocked';
  END IF;
  BEGIN
    PERFORM public.nv_begin_doctor_access('nv-bank-peer', 'invite', NULL, (public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz);
    RAISE EXCEPTION 'FAIL: password session modified physician access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.nv_doctor_portal_role('nv-bank-doctor', 'Coordenador Médico');
    RAISE EXCEPTION 'FAIL: password session changed physician privileges';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"41000000-0000-4000-8000-000000000021"}', true);
DO $$ BEGIN
  IF public.nv_admin_mfa_session() IS DISTINCT FROM '41000000-0000-4000-8000-000000000021'::uuid
    OR public.nv_doctor_portal_role('nv-bank-doctor', 'Coordenador Médico') <> 'Coordenador Médico'
    OR public.nv_begin_doctor_access('nv-bank-peer', 'invite', NULL,
      (public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz)->>'id' IS NULL THEN
    RAISE EXCEPTION 'FAIL: verified administrative session';
  END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  director uuid := '32000000-0000-4000-8000-000000000001';
  director_session uuid := '41000000-0000-4000-8000-000000000021';
  profile public.user_accounts;
BEGIN
  SELECT * INTO profile FROM public.user_accounts WHERE id = 'nv-bank-coordinator';
  BEGIN
    PERFORM public.nv_manage_user(director, '41000000-0000-4000-8000-000000000020', profile.id, NULL, to_jsonb(profile), NULL);
    RAISE EXCEPTION 'FAIL: service bridge accepted password-only session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.nv_delete_organization('nv-mfa-delete', '41000000-0000-4000-8000-000000000001', director_session);
    RAISE EXCEPTION 'FAIL: organization deletion accepted another actor session';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (public.nv_manage_user(director, director_session, profile.id, NULL,
      to_jsonb(profile) || jsonb_build_object('revision', profile.updated_at, 'name', 'Coordenação verificada'), NULL)).name <> 'Coordenação verificada' THEN
    RAISE EXCEPTION 'FAIL: verified administrative session did not save user';
  END IF;
  PERFORM public.nv_delete_organization('nv-mfa-delete', '41000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000023');
END $$;

RESET ROLE;
DELETE FROM auth.mfa_factors WHERE id = '41000000-0000-4000-8000-000000000010';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.nv_admin_mfa_session() IS NOT NULL THEN RAISE EXCEPTION 'FAIL: revoked factor still authorized'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"41000000-0000-4000-8000-000000000022"}', true);
DO $$ BEGIN
  IF public.nv_admin_mfa_session() IS DISTINCT FROM '41000000-0000-4000-8000-000000000022'::uuid THEN
    RAISE EXCEPTION 'FAIL: backup factor could not authorize a new session';
  END IF;
END $$;

ROLLBACK;
