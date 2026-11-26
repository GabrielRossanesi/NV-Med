-- Disposable database only, after migration 46, with or without migration 44.
BEGIN;

UPDATE public.doctors SET phone = '11987654321', address = 'Endereço sintético' WHERE id = 'nv-bank-doctor';
UPDATE public.user_accounts SET role = 'Escalista' WHERE id = 'nv-bank-coordinator';
INSERT INTO auth.users(id, email) VALUES
  ('45000000-0000-4000-8000-000000000001', 'ceo-cleanup@example.invalid'),
  ('45000000-0000-4000-8000-000000000002', 'exclusive-cleanup@example.invalid'),
  ('45000000-0000-4000-8000-000000000003', 'shared-cleanup@example.invalid'),
  ('45000000-0000-4000-8000-000000000004', 'saas-operator@example.invalid');
INSERT INTO public.user_accounts(id, auth_user_id, name, email, type, role, status) VALUES
  ('nv-clean-ceo', '45000000-0000-4000-8000-000000000001', 'CEO sintético', 'ceo-cleanup@example.invalid', 'saas_admin', 'CEO', 'active'),
  ('nv-clean-operator', '45000000-0000-4000-8000-000000000004', 'Operador SaaS', 'saas-operator@example.invalid', 'saas_admin', 'Administrativo', 'active');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
DO $$ DECLARE snapshot jsonb := public.nv_doctor_profile('nv-bank-doctor'); BEGIN
  IF snapshot ? 'birth_date' OR (snapshot->'profile') ?| ARRAY['cpf','address','phone','email']
    OR public.nv_doctor_access('nv-bank-doctor') ? 'email'
    OR has_column_privilege('authenticated', 'public.doctors', 'cpf', 'SELECT')
    OR has_column_privilege('authenticated', 'public.doctors', 'phone', 'UPDATE') THEN
    RAISE EXCEPTION 'FAIL: operational access exposes personal data';
  END IF;
  IF (SELECT name FROM public.doctors WHERE id = 'nv-bank-doctor') IS NULL THEN RAISE EXCEPTION 'FAIL: operational read'; END IF;
  BEGIN
    PERFORM public.nv_update_doctor_profile('nv-bank-doctor', '{"phone":"11955555555"}', (snapshot->'profile'->>'updated_at')::timestamptz);
    RAISE EXCEPTION 'FAIL: operational access writes protected contact';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"45000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
DO $$ BEGIN
  IF (public.nv_doctor_profile('nv-bank-doctor')->'profile') ? 'cpf' THEN RAISE EXCEPTION 'FAIL: SaaS operational read exposes CPF'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $$ BEGIN
  IF public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'phone' IS DISTINCT FROM '11987654321' THEN RAISE EXCEPTION 'FAIL: owner personal read'; END IF;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$ BEGIN
  IF public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'address' IS DISTINCT FROM 'Endereço sintético'
    OR NOT (public.nv_doctor_profile('nv-bank-doctor') ? 'birth_date') THEN RAISE EXCEPTION 'FAIL: credential reviewer personal read'; END IF;
END $$;
RESET ROLE;

INSERT INTO storage.objects(bucket_id, name) VALUES
  ('medical-documents', 'nv-bank-org/nv-bank-doctor/a-current.pdf'),
  ('medical-documents', 'nv-bank-org/nv-bank-doctor/b-original.docx'),
  ('medical-documents', 'nv-bank-org/nv-bank-doctor/c-previous.pdf');
DO $$ DECLARE job jsonb; path text; BEGIN
  IF public.nv_document_delivery_status('nv-bank-org/nv-bank-doctor/a-current.pdf') = 'not_configured' THEN
    IF to_regclass('public.medical_document_scans') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: inactive delivery with scan table'; END IF;
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    job := public.nv_claim_medical_scan(); path := job->>'path';
    IF public.nv_document_delivery_status(path) <> 'scanning' THEN RAISE EXCEPTION 'FAIL: quarantine before verdict'; END IF;
    IF NOT public.nv_finish_medical_scan((job->>'claim_id')::uuid,
      CASE WHEN path LIKE '%current.pdf' THEN 'clean' WHEN path LIKE '%.docx' THEN 'blocked' ELSE 'failed' END) THEN
      RAISE EXCEPTION 'FAIL: scanner verdict';
    END IF;
  END LOOP;
  IF public.nv_document_delivery_status('nv-bank-org/nv-bank-doctor/a-current.pdf') <> 'clean'
    OR public.nv_document_delivery_status('nv-bank-org/nv-bank-doctor/b-original.docx') <> 'blocked'
    OR public.nv_document_delivery_status('nv-bank-org/nv-bank-doctor/c-previous.pdf') <> 'failed' THEN RAISE EXCEPTION 'FAIL: scan status'; END IF;
  UPDATE storage.objects SET version = 'replacement' WHERE name = 'nv-bank-org/nv-bank-doctor/a-current.pdf';
  IF public.nv_document_delivery_status('nv-bank-org/nv-bank-doctor/a-current.pdf') <> 'pending' THEN RAISE EXCEPTION 'FAIL: replacement reused approval'; END IF;
  IF has_function_privilege('authenticated', 'public.nv_finish_medical_scan(uuid,text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: user can release quarantine'; END IF;
END $$;

INSERT INTO public.organizations(id, name, settings) VALUES
  ('nv-clean-one', 'Empresa sintética', '{}'), ('nv-clean-other', 'Empresa preservada', '{}'), ('nv-clean-held', 'Empresa em retenção', '{"retention_hold":true}');
INSERT INTO public.user_accounts(id, auth_user_id, name, email, type, organization_id, role, status, avatar)
VALUES ('nv-clean-exclusive', '45000000-0000-4000-8000-000000000002', 'Diretor sintético', 'exclusive-cleanup@example.invalid', 'tenant_user',
  'nv-clean-one', 'Diretor', 'active', '45000000-0000-4000-8000-000000000002/active.png');
INSERT INTO public.doctors(id, organization_id, name, crm, crm_uf, specialty) VALUES
  ('nv-clean-doctor-one', 'nv-clean-one', 'Médico sintético', '4501', 'SP', 'Cirurgia'),
  ('nv-clean-doctor-other', 'nv-clean-other', 'Médico sintético', '4501', 'SP', 'Cirurgia');
INSERT INTO public.doctor_enrollments(doctor_id, organization_id, auth_user_id, submitted_name, submitted_phone, requested_specialties) VALUES
  ('nv-clean-doctor-one', 'nv-clean-one', '45000000-0000-4000-8000-000000000003', 'Médico sintético', '', ARRAY['Cirurgia']),
  ('nv-clean-doctor-other', 'nv-clean-other', '45000000-0000-4000-8000-000000000003', 'Médico sintético', '', ARRAY['Cirurgia']);
INSERT INTO storage.objects(bucket_id, name) VALUES
  ('medical-documents', 'nv-clean-one/nv-clean-doctor-one/current.pdf'), ('medical-documents', 'nv-clean-one/nv-clean-doctor-one/previous.pdf'),
  ('medical-documents', 'nv-clean-other/nv-clean-doctor-other/current.pdf'),
  ('profile-avatars', '45000000-0000-4000-8000-000000000002/active.png');
INSERT INTO auth.mfa_factors(id, user_id, status) VALUES ('45000000-0000-4000-8000-000000000011', '45000000-0000-4000-8000-000000000001', 'verified');
INSERT INTO auth.sessions(id, user_id, created_at, aal, factor_id) VALUES
  ('45000000-0000-4000-8000-000000000012', '45000000-0000-4000-8000-000000000001', now(), 'aal2', '45000000-0000-4000-8000-000000000011');

DO $$
DECLARE actor uuid := '45000000-0000-4000-8000-000000000001';
  session_key uuid := '45000000-0000-4000-8000-000000000012'; lease uuid; batch jsonb;
BEGIN
  BEGIN
    PERFORM public.nv_delete_organization('nv-clean-held', actor, session_key, 'Empresa em retenção');
    RAISE EXCEPTION 'FAIL: expunged an organization on hold';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  lease := (public.nv_delete_organization('nv-clean-one', actor, session_key, 'Empresa sintética')->>'lease')::uuid;
  batch := public.nv_reconcile_organization_cleanup('nv-clean-one', lease);
  IF jsonb_array_length(batch->'document_paths') <> 2 OR jsonb_array_length(batch->'avatar_paths') <> 1
    OR batch->'auth_user_ids' IS DISTINCT FROM '["45000000-0000-4000-8000-000000000002"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: incomplete inventory or shared identity selected';
  END IF;
  DELETE FROM storage.objects WHERE name = 'nv-clean-one/nv-clean-doctor-one/current.pdf';
  IF (public.nv_reconcile_organization_cleanup('nv-clean-one', lease, true)->>'complete')::boolean
    OR jsonb_array_length(public.nv_pending_organization_cleanups(actor, session_key)) <> 1 THEN
    RAISE EXCEPTION 'FAIL: partial failure marked successful';
  END IF;
  lease := (public.nv_delete_organization('nv-clean-one', actor, session_key, 'Empresa sintética')->>'lease')::uuid;
  batch := public.nv_reconcile_organization_cleanup('nv-clean-one', lease);
  IF batch->'document_paths' IS DISTINCT FROM '["nv-clean-one/nv-clean-doctor-one/previous.pdf"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: resume did not preserve prior successful work';
  END IF;
  DELETE FROM storage.objects WHERE name IN ('nv-clean-one/nv-clean-doctor-one/previous.pdf', '45000000-0000-4000-8000-000000000002/active.png');
  DELETE FROM auth.users WHERE id = '45000000-0000-4000-8000-000000000002';
  IF to_regclass('public.medical_document_scans') IS NOT NULL THEN
    INSERT INTO public.medical_document_scans(object_name, object_version, state, retry_at)
    VALUES ('nv-clean-one/nv-clean-doctor-one/previous.pdf', 'past', 'clean', now());
  END IF;
  batch := public.nv_reconcile_organization_cleanup('nv-clean-one', lease, true);
  IF NOT (batch->>'complete')::boolean THEN RAISE EXCEPTION 'FAIL: cleanup did not complete'; END IF;
  IF NOT EXISTS (SELECT FROM auth.users WHERE id = '45000000-0000-4000-8000-000000000003')
    OR NOT EXISTS (SELECT FROM storage.objects WHERE name = 'nv-clean-other/nv-clean-doctor-other/current.pdf') THEN
    RAISE EXCEPTION 'FAIL: final cleanup or tenant isolation';
  END IF;
  IF to_regclass('public.medical_document_scans') IS NOT NULL THEN
    IF EXISTS (SELECT FROM public.medical_document_scans WHERE starts_with(object_name, 'nv-clean-one/')) THEN
      RAISE EXCEPTION 'FAIL: scan metadata survived cleanup';
    END IF;
  END IF;
END $$;

ROLLBACK;
