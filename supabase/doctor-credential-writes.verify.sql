-- Disposable database only, after 40. All changes are rolled back.
BEGIN;

INSERT INTO public.units(id, organization_id, name, type)
VALUES ('nv-credential-unit', 'nv-bank-org', 'Unidade sintética de credenciamento', 'hospital');

UPDATE public.organizations
SET settings = jsonb_set(settings, '{specialties}', '["Cirurgia", "Cardiologia"]')
WHERE id = 'nv-bank-org';

UPDATE public.user_accounts SET role = 'Escalista' WHERE id = 'nv-bank-coordinator';

DO $$ BEGIN
  IF EXISTS (
    SELECT FROM unnest(ARRAY['anon', 'authenticated']) AS role_name
    WHERE has_column_privilege(role_name, 'public.doctors', 'linked_units', 'INSERT')
       OR has_column_privilege(role_name, 'public.doctors', 'linked_units', 'UPDATE')
       OR has_column_privilege(role_name, 'public.doctors', 'specialty', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'FAIL: direct credential column is writable';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}', true);

DO $$ DECLARE profile_revision timestamptz; BEGIN
  IF NOT public.nv_can_action('nv-bank-org', 'medicos', 'edit')
     OR public.nv_can_action('nv-bank-org', 'medicos', 'approve') THEN
    RAISE EXCEPTION 'FAIL: credential permission fixture';
  END IF;

  UPDATE public.doctors SET contract_signed = true WHERE id = 'nv-bank-doctor';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: editor could not save the contract'; END IF;

  profile_revision := (public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'updated_at')::timestamptz;
  PERFORM public.nv_update_doctor_profile('nv-bank-doctor', '{"phone":"11988887777"}', profile_revision);

  BEGIN
    PERFORM public.nv_update_doctor_profile('nv-bank-doctor', '{"specialty":"Cardiologia"}', profile_revision);
    RAISE EXCEPTION 'FAIL: a primary specialty outside the approved list was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.nv_prepare_doctor_credential('nv-bank-peer');
SELECT public.nv_update_doctor_banking('nv-bank-peer', '{"pix_key_type":"cpf","pix_key":"11144477735"}');

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_review_enrollment('nv-bank-peer', 'approved', NULL, ARRAY['Cirurgia'], ARRAY['nv-credential-unit']);
    RAISE EXCEPTION 'FAIL: an editor approved enrollment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.nv_review_enrollment('nv-bank-peer', 'approved', NULL, ARRAY['Cirurgia'], ARRAY['nv-credential-unit']);

RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.doctors WHERE id = 'nv-bank-doctor' AND contract_signed
    AND phone = '11988887777' AND specialty = 'Cirurgia' AND linked_units = ARRAY['nv-bank-unit']) THEN
    RAISE EXCEPTION 'FAIL: ordinary edit or existing credentials were not preserved';
  END IF;
  IF NOT EXISTS (SELECT FROM public.doctors WHERE id = 'nv-bank-peer' AND linked_units = ARRAY['nv-credential-unit'])
     OR NOT EXISTS (SELECT FROM public.doctor_enrollments WHERE doctor_id = 'nv-bank-peer'
       AND status = 'approved' AND approved_specialties = ARRAY['Cirurgia'])
     OR NOT EXISTS (SELECT FROM public.doctor_enrollment_decisions WHERE doctor_id = 'nv-bank-peer'
       AND status = 'approved' AND unit_ids = ARRAY['nv-credential-unit']
       AND actor_id = '32000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'FAIL: approval did not persist both credentials and decision';
  END IF;
END $$;

ROLLBACK;
