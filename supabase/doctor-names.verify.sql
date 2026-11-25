-- Synthetic data. Existing records are emulated before running the explicit correction.
DO $$ BEGIN
  IF session_user !~ '^nvmed_[0-9a-f]{32}$' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Execute este teste somente no laboratório descartável.';
  END IF;
END $$;
BEGIN;
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE sample record;
BEGIN
  FOR sample IN SELECT * FROM (VALUES
    ('GABRIEL COSTA ROSSANESI', 'Gabriel Costa Rossanesi'),
    ('ana maria oliveira rossanesi', 'Ana Maria Oliveira Rossanesi'),
    ('  JOÃO    DA SILVA  ', 'João da Silva'),
    ('Mauricio Minoru Doi 82561', 'Mauricio Minoru Doi'),
    ('MARIA DOS SANTOS', 'Maria dos Santos'),
    ('DELCIO TORRES AMORIM JUNIOR', 'Delcio Torres Amorim Junior'),
    ('E ANA DE CASTRO E SOUSA', 'E Ana de Castro e Sousa'),
    ('ANA-MARIA D’ÁVILA O''CONNOR', 'Ana-Maria D’Ávila O''Connor'),
    ('李 小龍', '李 小龍'),
    ('ΑΛΈΞΙΟΣ ΔΗΜΗΤΡΊΟΥ', 'Αλέξιος Δημητρίου'),
    (U&'JOA\0303O\00A0DA\0009SILVA \0661\FF12', 'João da Silva'),
    ('AMINA ²', 'Amina')
  ) v(original, expected) LOOP
    IF nv_doctor_names.normalize_name(sample.original) IS DISTINCT FROM sample.expected
      OR nv_doctor_names.normalize_name(sample.expected) IS DISTINCT FROM sample.expected
      OR NOT nv_doctor_names.is_valid(sample.expected) THEN
      RAISE EXCEPTION 'Falha na normalização ou na repetição: %', sample.original;
    END IF;
  END LOOP;
  IF EXISTS (SELECT FROM unnest(ARRAY['', '   ', '---', 'Ana--Maria', 'Ana ! Lima', 'Ana_Clara']) v
    WHERE nv_doctor_names.is_valid(v)) THEN RAISE EXCEPTION 'Nomes inválidos aceitos.'; END IF;
  IF nv_doctor_names.validate_name('  Siobhán McDonald  ', true) <> 'Siobhán McDonald'
     OR has_schema_privilege('authenticated', 'nv_doctor_names', 'USAGE')
     OR has_schema_privilege('service_role', 'nv_doctor_names', 'USAGE')
     OR has_function_privilege('authenticated', 'nv_doctor_names.apply_reviewed_names(text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'nv_doctor_names.correction_audit', 'SELECT') THEN
    RAISE EXCEPTION 'Falha na exceção de capitalização ou nas permissões.';
  END IF;
END $$;

INSERT INTO public.organizations(id, name, settings) VALUES
  ('name-lab-a', 'Empresa sintética A', '{"specialties":["Cardiologia"],"requiredDocuments":[]}'),
  ('name-lab-b', 'Empresa sintética B', '{"specialties":["Cardiologia"],"requiredDocuments":[]}');
INSERT INTO auth.users(id, email, email_confirmed_at) VALUES
  ('54000000-0000-4000-8000-000000000001', 'name-admin@example.invalid', now()),
  ('54000000-0000-4000-8000-000000000002', 'name-portal@example.invalid', now()),
  ('54000000-0000-4000-8000-000000000003', 'name-enroll@example.invalid', now());
INSERT INTO public.user_accounts(id, auth_user_id, name, email, organization_id, role) VALUES
  ('name-lab-admin', '54000000-0000-4000-8000-000000000001', 'Direção', 'name-admin@example.invalid', 'name-lab-a', 'Diretor');

ALTER TABLE public.doctors DISABLE TRIGGER nv_a0_doctor_name;
INSERT INTO public.doctors(id, organization_id, name, crm, crm_uf, cpf, specialty, status) VALUES
  ('name-lab-fix', 'name-lab-a', '  ANA   DAS DORES ١٢ ', '457', 'SP', '52998224725', 'Cardiologia', 'pending'),
  ('name-lab-case', 'name-lab-a', 'linha de campos', '458', 'SP', NULL, 'Cardiologia', 'pending'),
  ('name-lab-collision', 'name-lab-a', 'JOAO DA SILVA', '459', 'SP', NULL, 'Cardiologia', 'pending'),
  ('name-lab-match', 'name-lab-a', 'João da Silva', '460', 'SP', NULL, 'Cardiologia', 'pending'),
  ('name-lab-other', 'name-lab-b', 'ANA DAS DORES', '461', 'SP', NULL, 'Cardiologia', 'pending'),
  ('name-lab-invalid', 'name-lab-a', '12345', '462', 'SP', NULL, 'Cardiologia', 'pending');
ALTER TABLE public.doctors ENABLE TRIGGER nv_a0_doctor_name;
ALTER TABLE public.doctor_enrollments DISABLE TRIGGER nv_a0_submitted_name;
INSERT INTO public.doctor_enrollments(doctor_id, organization_id, auth_user_id, pix_key, submitted_name, submitted_phone, requested_specialties, approved_specialties, status)
VALUES ('name-lab-fix', 'name-lab-a', '54000000-0000-4000-8000-000000000002', 'fake@example.invalid', 'ANA DAS DORES', '11923456789', ARRAY['Cardiologia'], ARRAY['Cardiologia'], 'approved'),
       ('name-lab-case', 'name-lab-a', NULL, 'fake2@example.invalid', 'linha de campos', '11923456788', ARRAY['Cardiologia'], '{}', 'pending');
ALTER TABLE public.doctor_enrollments ENABLE TRIGGER nv_a0_submitted_name;
INSERT INTO public.doctor_banking(doctor_id, organization_id, pix_key, pix_key_type)
VALUES ('name-lab-fix', 'name-lab-a', 'name-portal@example.invalid', 'email');
INSERT INTO public.units(id, organization_id, name, type) VALUES ('name-lab-unit', 'name-lab-a', 'Unidade sintética', 'hospital');
UPDATE public.doctors SET status = 'active', linked_units = ARRAY['name-lab-unit'] WHERE id = 'name-lab-fix';
INSERT INTO public.sectors(id, organization_id, unit_id, name, specialties, primary_specialty)
VALUES ('name-lab-sector', 'name-lab-a', 'name-lab-unit', 'Cardiologia', ARRAY['Cardiologia'], 'Cardiologia');
INSERT INTO public.shifts(id, organization_id, unit_id, sector_id, doctor_id, specialty, date, start_time, end_time, type, status, employment_type)
VALUES ('name-lab-shift', 'name-lab-a', 'name-lab-unit', 'name-lab-sector', 'name-lab-fix', 'Cardiologia',
  current_date - 30, '07:00', '19:00', 'onsite', 'completed', 'clt');

INSERT INTO public.doctors(id, organization_id, name, crm, crm_uf, specialty, status)
VALUES ('name-lab-new', 'name-lab-a', '  MAEVE O''CONNOR  ', '463', 'SP', 'Cardiologia', 'pending');
DO $$
DECLARE comparison jsonb; token text; result record; original_fields jsonb; expected_doctors bigint; expected_enrollments bigint;
BEGIN
  IF (SELECT name FROM public.doctors WHERE id = 'name-lab-new') <> 'Maeve O''Connor' THEN
    RAISE EXCEPTION 'Gravação direta sem normalização.';
  END IF;
  BEGIN
    UPDATE public.doctors SET name = 'Ana ١٢' WHERE id = 'name-lab-new';
    RAISE EXCEPTION 'Gravação direta aceitou números.';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'O nome do médico não pode conter números. Utilize o campo de CRM para informações de registro profissional.' THEN
      RAISE EXCEPTION 'Mensagem incorreta: %', SQLERRM;
    END IF;
  END;
  SELECT to_jsonb(d) - ARRAY['name', 'updated_at'] INTO original_fields FROM public.doctors d WHERE d.id = 'name-lab-fix';
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.source, p.organization_id, p.doctor_id) INTO comparison FROM nv_doctor_names.preview() p;
  SELECT count(*) FILTER (WHERE p.source = 'doctors'), count(*) FILTER (WHERE p.source = 'doctor_enrollments')
    INTO expected_doctors, expected_enrollments
    FROM nv_doctor_names.preview() p WHERE p.valid AND p.duplicate_doctors <= 1;
  token := nv_doctor_names.preview_token(comparison);
  BEGIN
    PERFORM nv_doctor_names.apply_reviewed_names('invalid-token');
    RAISE EXCEPTION 'Prévia divergente foi aplicada.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  SELECT * INTO result FROM nv_doctor_names.apply_reviewed_names(token);
  IF result.doctors_updated <> expected_doctors OR result.enrollments_updated <> expected_enrollments THEN
    RAISE EXCEPTION 'Contagem inesperada da correção: %', result;
  END IF;
  IF NOT EXISTS (SELECT FROM public.doctors d WHERE d.id = 'name-lab-fix' AND d.name = 'Ana das Dores'
      AND to_jsonb(d) - ARRAY['name', 'updated_at'] = original_fields)
    OR NOT EXISTS (SELECT FROM public.doctor_banking WHERE doctor_id = 'name-lab-fix' AND pix_key = 'name-portal@example.invalid')
    OR NOT EXISTS (SELECT FROM public.shifts WHERE id = 'name-lab-shift' AND doctor_id = 'name-lab-fix')
    OR NOT EXISTS (SELECT FROM public.doctor_enrollments WHERE doctor_id = 'name-lab-fix' AND submitted_name = 'ANA DAS DORES' AND status = 'approved')
    OR NOT EXISTS (SELECT FROM public.doctor_enrollments WHERE doctor_id = 'name-lab-case' AND submitted_name = 'Linha de Campos' AND status = 'pending')
    OR NOT EXISTS (SELECT FROM public.doctors WHERE id = 'name-lab-other' AND name = 'Ana das Dores')
    OR NOT EXISTS (SELECT FROM public.doctors WHERE id = 'name-lab-collision' AND name = 'JOAO DA SILVA')
    OR NOT EXISTS (SELECT FROM public.doctors WHERE id = 'name-lab-invalid' AND name = '12345') THEN
    RAISE EXCEPTION 'Correção alterou relacionamento, dado protegido ou item pendente de revisão.';
  END IF;
  IF NOT EXISTS (SELECT FROM nv_doctor_names.correction_audit a WHERE a.run_id = result.run_id AND a.doctor_id = 'name-lab-fix'
    AND a.original_name = '  ANA   DAS DORES ١٢ ' AND a.numbers_found = ARRAY['١٢']) THEN
    RAISE EXCEPTION 'Auditoria sem o valor original.';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.source, p.organization_id, p.doctor_id) INTO comparison FROM nv_doctor_names.preview() p;
  IF (SELECT doctors_updated + enrollments_updated FROM nv_doctor_names.apply_reviewed_names(nv_doctor_names.preview_token(comparison))) <> 0 THEN
    RAISE EXCEPTION 'Rotina não idempotente.';
  END IF;
  SELECT r.* INTO result FROM nv_doctor_names.restore_names(result.run_id) r;
  IF result.doctors_restored <> expected_doctors OR result.enrollments_restored <> expected_enrollments OR result.pending_review <> 0
    OR (SELECT name FROM public.doctors WHERE id = 'name-lab-fix') <> '  ANA   DAS DORES ١٢ ' THEN
    RAISE EXCEPTION 'Rollback incompleto.';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  snapshot := public.nv_doctor_profile('name-lab-fix');
  PERFORM public.nv_update_doctor_profile('name-lab-fix', '{"name":"Siobhán McDonald","name_capitalization_override":true}',
    (snapshot->'profile'->>'updated_at')::timestamptz);
  IF NOT (public.nv_doctor_profile('name-lab-fix')->'profile' @> '{"name":"Siobhán McDonald","name_capitalization_override":true}') THEN
    RAISE EXCEPTION 'Exceção autorizada não foi persistida.';
  END IF;
  BEGIN
    PERFORM public.nv_update_doctor_profile('name-lab-other', '{"name":"Outro Nome"}', now());
    RAISE EXCEPTION 'Edição em outra empresa aceita.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
DO $$
DECLARE snapshot jsonb;
BEGIN
  IF public.nv_portal_enrollments()->0->>'name' <> 'Siobhán McDonald' OR public.nv_portal_enrollments()->0->>'portal_role' IS NULL THEN
    RAISE EXCEPTION 'Portal não publicou o nome atual ou perdeu o perfil.';
  END IF;
  snapshot := public.nv_doctor_profile('name-lab-fix');
  BEGIN
    PERFORM public.nv_update_doctor_profile('name-lab-fix', '{"name_capitalization_override":true}',
      (snapshot->'profile'->>'updated_at')::timestamptz);
    RAISE EXCEPTION 'Portal aceitou exceção administrativa.';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.nv_update_doctor_profile('name-lab-fix', '{"name":"ANA-MARIA DOS SANTOS"}',
    (snapshot->'profile'->>'updated_at')::timestamptz);
  IF NOT (public.nv_doctor_profile('name-lab-fix')->'profile' @> '{"name":"Ana-Maria dos Santos","name_capitalization_override":false}') THEN
    RAISE EXCEPTION 'Edição pelo Portal não foi normalizada.';
  END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"54000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.nv_submit_enrollment('name-lab-a', 'Érica １２', '464', 'SP', '11144477735', '1990-02-03',
      '11923456780', 'name-enroll@example.invalid', ARRAY['Cardiologia'], '{"pix_key_type":"email"}');
    RAISE EXCEPTION 'Credenciamento aceitou números no nome.';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE 'O nome do médico não pode conter números.%' THEN RAISE; END IF;
  END;
  PERFORM public.nv_submit_enrollment('name-lab-a', '  ÉRICA    DE ASSIS ', '464', 'SP', '11144477735', '1990-02-03',
    '11923456780', 'name-enroll@example.invalid', ARRAY['Cardiologia'], '{"pix_key_type":"email"}');
  IF public.nv_portal_enrollments()->0->>'name' IS DISTINCT FROM 'Érica de Assis' THEN
    RAISE EXCEPTION 'Credenciamento não persistiu o nome normalizado.';
  END IF;
END $$;
ROLLBACK;
