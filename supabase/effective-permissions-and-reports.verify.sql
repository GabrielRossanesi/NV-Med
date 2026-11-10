-- Synthetic functional suite for migrations 27 and 28. Run only in the disposable lab.
BEGIN;

INSERT INTO auth.users(id,aud,role,email) VALUES
  ('27000000-0000-4000-8000-000000000001','authenticated','authenticated','nv-evo-saas@example.invalid'),
  ('27000000-0000-4000-8000-000000000002','authenticated','authenticated','nv-evo-director@example.invalid'),
  ('27000000-0000-4000-8000-000000000003','authenticated','authenticated','nv-evo-manager@example.invalid'),
  ('27000000-0000-4000-8000-000000000004','authenticated','authenticated','nv-evo-operator@example.invalid'),
  ('27000000-0000-4000-8000-000000000005','authenticated','authenticated','nv-evo-other@example.invalid'),
  ('27000000-0000-4000-8000-000000000006','authenticated','authenticated','nv-evo-doctor@example.invalid');

INSERT INTO public.organizations(id,name,settings) VALUES
  ('nv-evo-a','Clínica São José','{"specialties":["Cirurgia","Pediatria"],"requiredDocuments":[]}'),
  ('nv-evo-b','Empresa B','{"specialties":["Cirurgia"],"requiredDocuments":[]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,additional_permissions,permission_locks,delegated_permissions) VALUES
  ('nv-evo-saas','27000000-0000-4000-8000-000000000001','Operadora SaaS','nv-evo-saas@example.invalid','saas_admin',NULL,'CEO','{}','{}','{}'),
  ('nv-evo-director','27000000-0000-4000-8000-000000000002','Diretora','nv-evo-director@example.invalid','tenant_user','nv-evo-a','Diretor','{}','{}','{escala.edit}'),
  ('nv-evo-manager','27000000-0000-4000-8000-000000000003','Gerente','nv-evo-manager@example.invalid','tenant_user','nv-evo-a','Gerente','{}','{}','{escala.edit,escala.approve}'),
  ('nv-evo-operator','27000000-0000-4000-8000-000000000004','Operador','nv-evo-operator@example.invalid','tenant_user','nv-evo-a','Coordenador de Escalas','{"financeiro.view":"deny","escala.delete":"deny"}','{financeiro.view,escala.delete}','{}'),
  ('nv-evo-other','27000000-0000-4000-8000-000000000005','Outro diretor','nv-evo-other@example.invalid','tenant_user','nv-evo-b','Diretor','{}','{}','{}');
INSERT INTO public.units(id,organization_id,name,type,specialties) VALUES
  ('nv-evo-unit','nv-evo-a','Hospital A','hospital',ARRAY['Cirurgia','Pediatria']),
  ('nv-evo-unit2','nv-evo-a','Hospital B','hospital',ARRAY['Cirurgia']),
  ('nv-evo-foreign','nv-evo-b','Hospital estrangeiro','hospital',ARRAY['Cirurgia']);
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,coverage_periods) VALUES
  ('nv-evo-ped','nv-evo-a','nv-evo-unit','Pediatria noturna',ARRAY['Pediatria'],
    '[{"kind":"night","startTime":"19:00","endTime":"07:00","requiredDoctors":1}]'),
  ('nv-evo-general','nv-evo-a','nv-evo-unit','Cirurgia geral',ARRAY['Cirurgia'],
    '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1}]'),
  ('nv-evo-foreign-post','nv-evo-b','nv-evo-foreign','Setor externo',ARRAY['Cirurgia'],
    '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1}]');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units)
VALUES ('nv-evo-doctor','nv-evo-a','Médica fictícia','270001','SP','52998224725','nv-evo-doctor@example.invalid','Pediatria','active',ARRAY['nv-evo-unit']);
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,submitted_name,submitted_phone,
  requested_specialties,approved_specialties,status)
VALUES('nv-evo-doctor','nv-evo-a','27000000-0000-4000-8000-000000000006','1985-01-01','chave fictícia','Médica fictícia','11900000000',
  ARRAY['Pediatria','Cirurgia'],ARRAY['Pediatria','Cirurgia'],'approved');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  IF NOT public.nv_can_action('nv-evo-a','escala','edit') OR NOT public.nv_coordinator('nv-evo-a') THEN
    RAISE EXCEPTION 'FAIL: permissions were absent before the live revocation';
  END IF;
END $$;

SET LOCAL ROLE service_role;
DO $$
DECLARE
  director uuid := '27000000-0000-4000-8000-000000000002';
  manager uuid := '27000000-0000-4000-8000-000000000003';
  saas uuid := '27000000-0000-4000-8000-000000000001';
  target text := 'nv-evo-operator';
  current_profile public.user_accounts;
  payload jsonb;
  permissions jsonb;
BEGIN
  SELECT * INTO current_profile FROM public.user_accounts WHERE id = target;
  permissions := current_profile.additional_permissions;
  payload := to_jsonb(current_profile) || jsonb_build_object('revision',current_profile.updated_at);
  PERFORM public.nv_manage_user(director,target,NULL,payload || '{"name":"Operador atualizado"}',NULL);
  SELECT * INTO current_profile FROM public.user_accounts WHERE id = target;
  payload := to_jsonb(current_profile) || jsonb_build_object('revision',current_profile.updated_at);
  PERFORM public.nv_manage_user(manager,target,NULL,
    payload || jsonb_build_object('additional_permissions',permissions || '{"escala.edit":"deny","escala.approve":"deny"}'),'Delegação sintética');
  IF NOT EXISTS (SELECT FROM public.user_permission_audit WHERE target_id=target AND actor_id='nv-evo-manager'
    AND reason='Delegação sintética' AND next->'permissions'->>'escala.approve'='deny') THEN
    RAISE EXCEPTION 'FAIL: missing permission audit';
  END IF;
  SELECT * INTO current_profile FROM public.user_accounts WHERE id = target;
  payload := to_jsonb(current_profile) || jsonb_build_object('revision',current_profile.updated_at);
  BEGIN
    PERFORM public.nv_manage_user(manager,target,NULL,payload || jsonb_build_object('additional_permissions',
      current_profile.additional_permissions || '{"financeiro.view":"allow"}'),NULL);
    RAISE EXCEPTION 'FAIL: SaaS lock bypass';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_manage_user(manager,target,NULL,payload || jsonb_build_object('additional_permissions',
      current_profile.additional_permissions || '{"unidades.delete":"deny"}'),NULL);
    RAISE EXCEPTION 'FAIL: out-of-scope delegation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_manage_user(saas,target,NULL,payload || jsonb_build_object('additional_permissions',
      current_profile.additional_permissions || '{"financeiro.edit":"allow"}'),NULL);
    RAISE EXCEPTION 'FAIL: contradictory permission grant';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_manage_user(manager,target,NULL,payload || '{"revision":"2000-01-01"}',NULL);
    RAISE EXCEPTION 'FAIL: stale revision accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN
    SELECT * INTO current_profile FROM public.user_accounts WHERE id='nv-evo-manager';
    PERFORM public.nv_manage_user(manager,current_profile.id,NULL,to_jsonb(current_profile) ||
      jsonb_build_object('revision',current_profile.updated_at,'role','Diretor'),NULL);
    RAISE EXCEPTION 'FAIL: self elevation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT * INTO current_profile FROM public.user_accounts WHERE id='nv-evo-other';
  payload := to_jsonb(current_profile) || jsonb_build_object('revision',current_profile.updated_at);
  BEGIN
    PERFORM public.nv_manage_user(manager,current_profile.id,NULL,payload,NULL);
    RAISE EXCEPTION 'FAIL: foreign account edit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_manage_user(saas,current_profile.id,NULL,payload || '{"status":"inactive"}',NULL);
    RAISE EXCEPTION 'FAIL: last manager was removed';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE
  records jsonb := '[{"id":"nv-evo-paid","organization_id":"nv-evo-a","unit_id":"nv-evo-unit","sector_id":"nv-evo-ped","doctor_id":"nv-evo-doctor",
    "date":"2099-03-01","start_time":"19:00","end_time":"07:00","type":"onsite","status":"confirmed","specialty":"Pediatria","employment_type":"clt",
    "agreement":{"mode":"manual","frequency":"monthly","amount_cents":123456}}]';
  results jsonb;
BEGIN
  IF public.nv_doctor_portal_role('nv-evo-doctor') <> 'Médico'
    OR public.nv_doctor_portal_role('nv-evo-doctor','Coordenador Médico') <> 'Coordenador Médico' THEN
    RAISE EXCEPTION 'FAIL: physician role transition';
  END IF;
  PERFORM public.nv_save_operational_shifts(records);
  PERFORM public.nv_save_shift_payment('nv-evo-paid',1234.56,'monthly','paid',1200.34,current_date,'Baixa sintética');
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(records->0 || '{"id":"nv-evo-due","date":"2099-03-10",
    "agreement":{"mode":"manual","frequency":"on_delivery","amount_cents":50000}}'));
  results := public.nv_report_filtered_shifts('nv-evo-a','2099-03-01','2099-03-31',
    '{"unit":"nv-evo-unit","sector":"nv-evo-ped","doctor":"nv-evo-doctor","specialty":"Pediatria","start_hour":"19:00","end_hour":"07:00",
      "period":"night","payment":"paid","frequency":"monthly"}'::jsonb || jsonb_build_object('paid_from',current_date,'paid_to',current_date),true);
  IF jsonb_array_length(results->'rows') <> 1 OR results->'rows'->0->>'id' <> 'nv-evo-paid'
    OR (results->'rows'->0->>'agreed')::numeric <> 1234.56 OR (results->'rows'->0->>'paid_amount')::numeric <> 1200.34
    OR (results->'rows'->0->>'balance')::numeric <> 0 THEN RAISE EXCEPTION 'FAIL: filtered financial report'; END IF;
  results := public.nv_report_filtered_shifts('nv-evo-a','2099-03-01','2099-03-31',
    '{"payment":"unpaid","frequency":"on_delivery","due_from":"2099-03-11","due_to":"2099-03-11"}',true);
  IF jsonb_array_length(results->'rows') <> 1 OR (results->'rows'->0->>'balance')::numeric <> 500 THEN
    RAISE EXCEPTION 'FAIL: due date or outstanding amount';
  END IF;
  IF jsonb_array_length(public.nv_report_filtered_shifts('nv-evo-a','2099-03-01','2099-03-31',
      '{"start_hour":"07:00","end_hour":"19:00"}')->'rows') <> 0 THEN RAISE EXCEPTION 'FAIL: report crossed the requested hour window'; END IF;
END;
$$;

SELECT set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$
DECLARE
  records jsonb := '[{"id":"nv-evo-open","organization_id":"nv-evo-a","unit_id":"nv-evo-unit","sector_id":"nv-evo-ped","date":"2099-03-02",
    "start_time":"19:00","end_time":"07:00","type":"onsite","status":"open","specialty":"Pediatria"}]';
  result jsonb;
BEGIN
  IF public.nv_coordinator('nv-evo-a') OR public.nv_can_finance('nv-evo-a') OR public.nv_can_read_finance('nv-evo-a')
    OR public.nv_can_action('nv-evo-a','escala','edit') OR NOT public.nv_can_action('nv-evo-a','escala','create') THEN
    RAISE EXCEPTION 'FAIL: effective permission precedence';
  END IF;
  PERFORM public.nv_save_operational_shifts(records);
  BEGIN
    PERFORM public.nv_save_operational_shifts(records);
    RAISE EXCEPTION 'FAIL: creation permission bypassed editing denial';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  DELETE FROM public.shifts WHERE id='nv-evo-open';
  IF FOUND THEN RAISE EXCEPTION 'FAIL: denied deletion succeeded'; END IF;
  BEGIN
    INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties) VALUES ('nv-evo-invalid','nv-evo-a','nv-evo-unit2','Inválido',ARRAY['Pediatria']);
    RAISE EXCEPTION 'FAIL: foreign specialty at sector';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties) VALUES ('nv-evo-created','nv-evo-a','nv-evo-unit','Novo setor',ARRAY['Pediatria']);
  IF NOT EXISTS (SELECT FROM public.sectors WHERE id='nv-evo-created') THEN RAISE EXCEPTION 'FAIL: authorized sector creation'; END IF;
  BEGIN
    INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties) VALUES ('nv-evo-duplicate','nv-evo-a','nv-evo-unit','Novo setor',ARRAY['Pediatria']);
    RAISE EXCEPTION 'FAIL: duplicate sector name';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  result := public.nv_report_filtered_shifts('nv-evo-a','2099-03-01','2099-03-31','{}');
  IF result->>'finance' <> 'false' OR EXISTS (SELECT FROM jsonb_array_elements(result->'rows') item WHERE item ?| ARRAY['agreed','balance','frequency']) THEN
    RAISE EXCEPTION 'FAIL: financial report projection leaked';
  END IF;
  BEGIN
    PERFORM public.nv_report_filtered_shifts('nv-evo-a','2099-03-01','2099-03-31','{"due_from":"2099-03-01"}');
    RAISE EXCEPTION 'FAIL: unauthorized financial filter';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_report_catalog('nv-evo-b',false);
    RAISE EXCEPTION 'FAIL: foreign report catalog';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_report_filtered_shifts('nv-evo-b','2099-03-01','2099-03-31','{}');
    RAISE EXCEPTION 'FAIL: cross-tenant report';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

SELECT set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$
BEGIN
  IF public.nv_portal_enrollments()->0->>'portal_role' <> 'Coordenador Médico'
    OR public.nv_coordinator('nv-evo-a') OR public.nv_can_finance('nv-evo-a')
    OR public.nv_can_action('nv-evo-a','usuarios','view') OR public.nv_can_action('nv-evo-a','escala','create') THEN
    RAISE EXCEPTION 'FAIL: physician role received administrative rights';
  END IF;
  IF EXISTS (SELECT FROM public.nv_staff_shifts WHERE organization_id='nv-evo-a') THEN
    RAISE EXCEPTION 'FAIL: physician read administrative shifts';
  END IF;
END;
$$;

ROLLBACK;
