-- Synthetic data, disposable local database only, after migration 31.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('31000000-0000-4000-8000-000000000001','principal-admin@example.invalid'),
 ('31000000-0000-4000-8000-000000000002','principal-ortho@example.invalid'),
 ('31000000-0000-4000-8000-000000000003','principal-multi@example.invalid'),
 ('31000000-0000-4000-8000-000000000004','principal-foreign@example.invalid'),
 ('31000000-0000-4000-8000-000000000005','principal-reader@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('nv-primary-a','Empresa A','{"specialties":["Cirurgia","Ortopedia"],"requiredDocuments":[]}'),
 ('nv-primary-b','Empresa B','{"specialties":["Pediatria"],"requiredDocuments":[]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,additional_permissions) VALUES
 ('nv-primary-admin','31000000-0000-4000-8000-000000000001','Direção','principal-admin@example.invalid','tenant_user','nv-primary-a','Diretor','{}'),
 ('nv-primary-foreign','31000000-0000-4000-8000-000000000004','Outra direção','principal-foreign@example.invalid','tenant_user','nv-primary-b','Diretor','{}'),
 ('nv-primary-reader','31000000-0000-4000-8000-000000000005','Leitura','principal-reader@example.invalid','tenant_user','nv-primary-a','Diretor','{"unidades.edit":"deny","unidades.create":"deny","unidades.delete":"deny"}');
INSERT INTO public.units(id,organization_id,name,type) VALUES
 ('nv-primary-u','nv-primary-a','Hospital A','hospital'),('nv-primary-v','nv-primary-b','Hospital B','hospital');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units) VALUES
 ('nv-primary-single','nv-primary-a','Uma especialidade','310001','SP','52998224725','single@example.invalid','Texto sem valor probatório','active',ARRAY['nv-primary-u']),
 ('nv-primary-multi','nv-primary-a','Duas especialidades','310002','SP','11144477735','multi@example.invalid','Cirurgia','active',ARRAY['nv-primary-u']),
 ('nv-primary-ortho','nv-primary-a','Ortopedista','310003','SP','12345678909','ortho@example.invalid','Cirurgia','active',ARRAY['nv-primary-u']),
 ('nv-primary-pending','nv-primary-a','Pendente','310004','SP','00000000191','pending@example.invalid','Cirurgia','active',ARRAY['nv-primary-u']),
 ('nv-primary-inactive','nv-primary-a','Inativo','310005','SP','00000000272','inactive@example.invalid','Cirurgia','inactive',ARRAY['nv-primary-u']),
 ('nv-primary-legacy','nv-primary-a','Sem credenciamento','310006','SP','00000000353','legacy@example.invalid','Cirurgia','active',ARRAY['nv-primary-u']),
 ('nv-primary-unlinked','nv-primary-a','Sem unidade','310007','SP','00000000434','unlinked@example.invalid','Cirurgia','active','{}'),
 ('nv-primary-other','nv-primary-b','Outra empresa','310008','SP','00000000515','other@example.invalid','Cirurgia','active',ARRAY['nv-primary-v']);
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,submitted_name,submitted_phone,requested_specialties,approved_specialties,status)
SELECT id,organization_id,CASE id WHEN 'nv-primary-multi' THEN '31000000-0000-4000-8000-000000000003'::uuid
  WHEN 'nv-primary-ortho' THEN '31000000-0000-4000-8000-000000000002'::uuid END,
 '1980-01-01','synthetic',name,'11999999999',ARRAY['Cirurgia','Ortopedia'],
 CASE id WHEN 'nv-primary-ortho' THEN ARRAY['Ortopedia'] WHEN 'nv-primary-multi' THEN ARRAY['Cirurgia','Ortopedia'] ELSE ARRAY['Cirurgia'] END,
 CASE id WHEN 'nv-primary-pending' THEN 'pending' ELSE 'approved' END
FROM public.doctors WHERE id LIKE 'nv-primary-%' AND id<>'nv-primary-legacy';

-- Reproduce genuine legacy data without inferring a principal from names/arrays.
SET LOCAL session_replication_role=replica;
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties) VALUES
 ('nv-primary-legacy-sector','nv-primary-a','nv-primary-u','Legado',ARRAY['Cirurgia','Ortopedia']);
INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,date,start_time,end_time,type,status,specialty,employment_type)
VALUES('nv-primary-history','nv-primary-a','nv-primary-u','nv-primary-legacy-sector',current_date-2,'07:00','19:00','onsite','completed','Cirurgia','clt');
SET LOCAL session_replication_role=origin;
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty) VALUES
 ('nv-primary-foreign-sector','nv-primary-b','nv-primary-v','Pediatria',ARRAY['Pediatria'],'Pediatria');

CREATE FUNCTION pg_temp.primary_shift(id text, days integer DEFAULT 5, sector text DEFAULT 'nv-primary-sector', specialty text DEFAULT NULL, doctor text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('id',id,'organization_id','nv-primary-a','unit_id','nv-primary-u','sector_id',sector,'specialty',specialty,
   'doctor_id',doctor,'date',current_date+days,'start_time','07:00','end_time','19:00','type','onsite','employment_type','clt',
   'status',CASE WHEN doctor IS NULL THEN 'open' ELSE 'confirmed' END);
$$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE sector jsonb := '{"id":"nv-primary-sector","organization_id":"nv-primary-a","unit_id":"nv-primary-u","name":"Cirurgia PS","specialties":["Ortopedia"],"primary_specialty":"Cirurgia","status":"active","default_start_time":"07:00","default_end_time":"19:00","required_doctors":1,"coverage_periods":[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1}]}';
  result jsonb;
  rate jsonb;
BEGIN
  PERFORM public.nv_save_payment_terms('nv-primary-a',20,1,'last_day','none',ARRAY[]::date[]);
  PERFORM public.nv_save_sector_with_finance(sector,true,'{}');
  IF NOT EXISTS (SELECT FROM public.sectors WHERE id='nv-primary-sector' AND primary_specialty='Cirurgia'
    AND specialties @> ARRAY['Ortopedia','Cirurgia']) THEN RAISE EXCEPTION 'FAIL: principal or legacy links'; END IF;
  PERFORM public.nv_save_sector_with_finance(sector || '{"description":"Descrição editada","status":"inactive"}',false,'{}');
  PERFORM public.nv_save_sector_with_finance(sector,false,'{}');
  BEGIN
    PERFORM public.nv_save_sector_with_finance(sector || '{"id":"nv-primary-invalid","primary_specialty":null}',true,'{}');
    RAISE EXCEPTION 'FAIL: sector without principal';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_sector_with_finance(sector || '{"id":"nv-primary-invalid","primary_specialty":"Pediatria"}',true,'{}');
    RAISE EXCEPTION 'FAIL: unauthorized company specialty';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_sector_with_finance(sector || '{"id":"nv-primary-invalid","unit_id":"nv-primary-v"}',true,'{}');
    RAISE EXCEPTION 'FAIL: foreign unit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-invalid',5,'nv-primary-legacy-sector','Cirurgia')));
    RAISE EXCEPTION 'FAIL: unconfigured legacy sector';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-invalid',5,'nv-primary-sector','Ortopedia')));
    RAISE EXCEPTION 'FAIL: manual mismatch';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-invalid',5,'nv-primary-foreign-sector','Pediatria')));
    RAISE EXCEPTION 'FAIL: foreign company sector';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  result := public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-vacancy')));
  IF result->0->>'specialty' IS DISTINCT FROM 'Cirurgia' OR result->0->>'doctor_id' IS NOT NULL THEN RAISE EXCEPTION 'FAIL: autofill/open vacancy'; END IF;
  result := public.nv_eligible_shift_doctors(pg_temp.primary_shift('nv-primary-vacancy',5,'nv-primary-sector','Cirurgia'));
  IF result <> '["nv-primary-single","nv-primary-multi"]'::jsonb AND result <> '["nv-primary-multi","nv-primary-single"]'::jsonb THEN
    RAISE EXCEPTION 'FAIL: structured credentials, status, company, unit or multi-specialty: %', result;
  END IF;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-invalid',6,'nv-primary-sector','Cirurgia','nv-primary-legacy')));
    RAISE EXCEPTION 'FAIL: text-only legacy attribution';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.sectors SET primary_specialty='Ortopedia' WHERE id='nv-primary-sector';
    RAISE EXCEPTION 'FAIL: future shift silently changed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE public.sectors SET primary_specialty='Ortopedia' WHERE id='nv-primary-legacy-sector';
  IF (SELECT specialty FROM public.nv_staff_shifts WHERE id='nv-primary-history') IS DISTINCT FROM 'Cirurgia' THEN RAISE EXCEPTION 'FAIL: history rewritten'; END IF;
  IF NOT EXISTS (SELECT FROM public.sector_specialty_history WHERE sector_id='nv-primary-legacy-sector'
    AND previous_specialty IS NULL AND next_specialty='Ortopedia' AND actor_id=auth.uid()) THEN RAISE EXCEPTION 'FAIL: audit'; END IF;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-history',-2,'nv-primary-legacy-sector','Ortopedia')));
    RAISE EXCEPTION 'FAIL: historical snapshot editable';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  result := public.nv_eligible_shift_doctors(pg_temp.primary_shift('draft',6,'nv-primary-legacy-sector','Ortopedia'));
  IF NOT result ? 'nv-primary-multi' OR NOT result ? 'nv-primary-ortho' OR result ? 'nv-primary-single' THEN RAISE EXCEPTION 'FAIL: multiple specialties'; END IF;
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-adhoc',7,NULL,'Cirurgia')
    || '{"coverage_mode":"adhoc","coverage_reason":"Cobertura excepcional"}'));
  result := public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-pj',10,'nv-primary-sector','Cirurgia','nv-primary-single')
    || '{"employment_type":"pj","employer_name":"Empresa PJ","agreement":{"mode":"manual","amount_cents":123456,"frequency":"monthly"}}'));
  IF (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1234.56 OR result->0->>'employment_type'<>'pj'
    OR result->0->>'payment_frequency'<>'monthly' THEN RAISE EXCEPTION 'FAIL: per-shift PJ agreement'; END IF;
  rate := public.nv_save_shift_rate('nv-primary-a',NULL,'{"amount_cents":99000,"specialty":"Cirurgia","active":true}');
  result := public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-pj-default',11,'nv-primary-sector',NULL,'nv-primary-single')
    || jsonb_build_object('employment_type','pj','employer_name','Empresa PJ','agreement',jsonb_build_object(
      'mode','default','frequency','monthly','rate_id',rate->>'id','rate_cents',99000))));
  IF (result->0->>'payment_amount')::numeric IS DISTINCT FROM 990 OR result->0->>'specialty'<>'Cirurgia' THEN
    RAISE EXCEPTION 'FAIL: sector specialty resolved after pricing'; END IF;
END $$;

-- Compatible and incompatible portal applications use the same structured relationship.
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_apply_for_shift('nv-primary-vacancy');
    RAISE EXCEPTION 'FAIL: incompatible application';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE public.sectors SET primary_specialty='Ortopedia' WHERE id='nv-primary-sector';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: physician edited sector'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT public.nv_apply_for_shift('nv-primary-vacancy');
RESET ROLE;
-- Revoke approval after application to verify approval rechecks live credentials.
UPDATE public.doctor_enrollments SET approved_specialties=ARRAY['Ortopedia'] WHERE doctor_id='nv-primary-multi';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE target uuid;
BEGIN
  target := (public.nv_shift_selection_queue('nv-primary-a','nv-primary-vacancy')->0->>'id')::uuid;
  BEGIN
    PERFORM public.nv_select_shift_candidate(target,'nv-primary-multi','clt',NULL);
    RAISE EXCEPTION 'FAIL: approval without revalidation';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT doctor_id FROM public.nv_staff_shifts WHERE id='nv-primary-vacancy') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: partial approval'; END IF;
END $$;
RESET ROLE;
UPDATE public.doctor_enrollments SET approved_specialties=ARRAY['Cirurgia','Ortopedia'] WHERE doctor_id='nv-primary-multi';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE target uuid; result jsonb;
BEGIN
  target := (public.nv_shift_selection_queue('nv-primary-a','nv-primary-vacancy')->0->>'id')::uuid;
  PERFORM public.nv_select_shift_candidate(target,'nv-primary-multi','clt',NULL);
  result := public.nv_eligible_shift_doctors(pg_temp.primary_shift('other',5,'nv-primary-sector','Cirurgia'));
  IF result ? 'nv-primary-multi' THEN RAISE EXCEPTION 'FAIL: overlapping physician offered'; END IF;
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-exchange',8,'nv-primary-sector','Cirurgia','nv-primary-multi')));
END $$;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT public.nv_request_exchange('nv-primary-exchange');
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_apply_for_shift('nv-primary-exchange');
    RAISE EXCEPTION 'FAIL: incompatible exchange application';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.doctor_enrollments SET approved_specialties=ARRAY['Cirurgia','Ortopedia'] WHERE doctor_id='nv-primary-ortho';
SET LOCAL ROLE authenticated;
SELECT public.nv_apply_for_shift('nv-primary-exchange');
RESET ROLE;
UPDATE public.doctor_enrollments SET status='pending' WHERE doctor_id='nv-primary-ortho';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE target uuid;
BEGIN
  target := (public.nv_shift_selection_queue('nv-primary-a','nv-primary-exchange')->0->>'id')::uuid;
  BEGIN
    PERFORM public.nv_select_shift_candidate(target,'nv-primary-ortho','clt',NULL);
    RAISE EXCEPTION 'FAIL: substitution without approval revalidation';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (public.nv_shift_selection_queue('nv-primary-a','nv-primary-exchange')->0->>'id')::uuid IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'FAIL: failed revalidation silently closed exchange'; END IF;
END $$;
RESET ROLE;
UPDATE public.doctor_enrollments SET status='approved' WHERE doctor_id='nv-primary-ortho';
SET LOCAL ROLE authenticated;
DO $$ DECLARE target uuid;
BEGIN
  target := (public.nv_shift_selection_queue('nv-primary-a','nv-primary-exchange')->0->>'id')::uuid;
  PERFORM public.nv_select_shift_candidate(target,'nv-primary-ortho','concursado',NULL);
  IF NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-primary-exchange' AND doctor_id='nv-primary-ortho'
    AND specialty='Cirurgia' AND employment_type='concursado' AND payment_amount IS NULL) THEN
    RAISE EXCEPTION 'FAIL: compatible substitution or PREFEITURA contract'; END IF;
END $$;
RESET ROLE;

-- The document policy applies at the proposed shift end, without exposing documents.
UPDATE public.organizations SET settings=settings || '{"documentGovernance":{"blockSchedulingOnCritical":true},"requiredDocuments":[{"type":"license","name":"Licença","required":true,"blocking":true}]}' WHERE id='nv-primary-a';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.nv_eligible_shift_doctors(pg_temp.primary_shift('draft',9,'nv-primary-sector','Cirurgia')) <> '[]' THEN RAISE EXCEPTION 'FAIL: documentary block'; END IF;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.primary_shift('nv-primary-doc-block',9,'nv-primary-sector','Cirurgia','nv-primary-single')));
    RAISE EXCEPTION 'FAIL: documentary assignment bypass';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_eligible_shift_doctors(pg_temp.primary_shift('draft',9,'nv-primary-sector','Cirurgia'));
    RAISE EXCEPTION 'FAIL: foreign company eligibility';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.sectors SET primary_specialty='Ortopedia' WHERE id='nv-primary-sector';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: foreign company edit'; END IF;
  IF EXISTS (SELECT FROM public.sector_specialty_history WHERE organization_id='nv-primary-a') THEN RAISE EXCEPTION 'FAIL: audit leaked'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ BEGIN
  UPDATE public.sectors SET primary_specialty='Ortopedia' WHERE id='nv-primary-sector';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: reader edit'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
