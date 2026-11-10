-- Apply 26_shift_payment_agreements.sql in a disposable laboratory before this test.
BEGIN;
INSERT INTO auth.users(id, aud, role, email) VALUES
  ('26000000-0000-4000-8000-000000000001','authenticated','authenticated','agreement-admin@example.invalid'),
  ('26000000-0000-4000-8000-000000000002','authenticated','authenticated','agreement-scheduler@example.invalid'),
  ('26000000-0000-4000-8000-000000000003','authenticated','authenticated','agreement-reader@example.invalid'),
  ('26000000-0000-4000-8000-000000000004','authenticated','authenticated','agreement-other@example.invalid'),
  ('26000000-0000-4000-8000-000000000005','authenticated','authenticated','agreement-finance@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
  ('nv-agreement-a','Acordos A','{"specialties":["Cirurgia"],"requiredDocuments":[]}'),
  ('nv-agreement-b','Acordos B','{"specialties":["Cirurgia"],"requiredDocuments":[]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,additional_permissions) VALUES
  ('nv-agreement-admin','26000000-0000-4000-8000-000000000001','Diretora','agreement-admin@example.invalid','tenant_user','nv-agreement-a','Diretor','{}'),
  ('nv-agreement-scheduler','26000000-0000-4000-8000-000000000002','Escalista','agreement-scheduler@example.invalid','tenant_user','nv-agreement-a','Escalista','{}'),
  ('nv-agreement-reader','26000000-0000-4000-8000-000000000003','Leitura','agreement-reader@example.invalid','tenant_user','nv-agreement-a','Escalista','{"financeiro":"view"}'),
  ('nv-agreement-other','26000000-0000-4000-8000-000000000004','Outra empresa','agreement-other@example.invalid','tenant_user','nv-agreement-b','Diretor','{}'),
  ('nv-agreement-finance','26000000-0000-4000-8000-000000000005','Financeiro','agreement-finance@example.invalid','tenant_user','nv-agreement-a','Financeiro','{}');
INSERT INTO public.units(id,organization_id,name,type) VALUES
  ('nv-agreement-unit','nv-agreement-a','Hospital A','hospital'),
  ('nv-agreement-foreign','nv-agreement-b','Hospital B','hospital');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,coverage_periods) VALUES
  ('nv-agreement-sector','nv-agreement-a','nv-agreement-unit','Cirurgia',ARRAY['Cirurgia'],
    '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1},{"kind":"night","startTime":"19:00","endTime":"07:00","requiredDoctors":1}]');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units)
VALUES ('nv-agreement-doctor','nv-agreement-a','Médico sintético','260001','SP','52998224725',
  'agreement-doctor@example.invalid','Cirurgia','active',ARRAY['nv-agreement-unit']);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE
  organization text := 'nv-agreement-a';
  payload jsonb := '{"organization_id":"nv-agreement-a","unit_id":"nv-agreement-unit","sector_id":"nv-agreement-sector","doctor_id":"nv-agreement-doctor",
    "date":"2099-03-01","start_time":"19:00","end_time":"07:00","type":"onsite","status":"confirmed","specialty":"Cirurgia","employment_type":"clt"}';
  rule jsonb := '{"unit_id":"nv-agreement-unit","sector_id":"nv-agreement-sector","specialty":"Cirurgia","turn":"night","duration_minutes":720,"shift_type":"onsite","amount_cents":120000,"active":true}';
  rate_id uuid;
  selection jsonb;
  result jsonb;
  revision text;
  history jsonb;
BEGIN
  PERFORM public.nv_save_payment_terms(organization,20,1,'last_day','none',ARRAY[]::date[]);
  result := public.nv_save_operational_shifts(jsonb_build_array(payload || '{"id":"nv-agreement-manual","date":"2099-03-03",
    "agreement":{"mode":"manual","frequency":"on_delivery","amount_cents":112345}}'));
  IF (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1123.45
    OR result->0->'payment_agreement'->>'mode' IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'FAIL: manual amount without reference'; END IF;

  PERFORM public.nv_save_shift_rate(organization,NULL,'{"amount_cents":90000,"active":true}');
  PERFORM public.nv_save_shift_rate(organization,NULL,'{"specialty":"Cirurgia","amount_cents":100000,"active":true}');
  PERFORM public.nv_save_shift_rate(organization,NULL,'{"unit_id":"nv-agreement-unit","specialty":"Cirurgia","amount_cents":110000,"active":true}');
  rate_id := (public.nv_save_shift_rate(organization,NULL,rule)->>'id')::uuid;
  BEGIN
    PERFORM public.nv_save_shift_rate(organization,NULL,rule);
    RAISE EXCEPTION 'FAIL: duplicate financial rule';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_shift_rate(organization,NULL,'{"unit_id":"nv-agreement-foreign","amount_cents":1,"active":true}');
    RAISE EXCEPTION 'FAIL: rule accepted foreign unit';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  selection := jsonb_build_object('mode','default','frequency','on_delivery','rate_id',rate_id,'rate_cents',120000);
  result := public.nv_save_operational_shifts(jsonb_build_array(payload || jsonb_build_object('id','nv-agreement-default','agreement',selection)));
  IF (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1200
    OR result->0->>'payment_due_date' IS DISTINCT FROM '2099-03-02'
    OR result->0->'payment_agreement'->'rate'->>'id' IS DISTINCT FROM rate_id::text THEN RAISE EXCEPTION 'FAIL: most-specific overnight default'; END IF;
  revision := result->0->'payment_agreement'->>'changed_at';
  result := public.nv_save_operational_shifts(jsonb_build_array(payload || jsonb_build_object('id','nv-agreement-monthly','date','2099-03-05',
    'agreement',selection || '{"mode":"override","frequency":"monthly","amount_cents":145000,"override_reason":"Plantão especial"}')));
  IF (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1450
    OR result->0->>'payment_due_date' IS DISTINCT FROM '2099-04-20'
    OR result->0->'payment_agreement'->>'override_reason' IS DISTINCT FROM 'Plantão especial' THEN RAISE EXCEPTION 'FAIL: monthly override and due date'; END IF;

  result := public.nv_save_operational_shifts(jsonb_build_array(payload || jsonb_build_object('id','nv-agreement-monthly','date','2099-03-05',
    'notes','Observação com edição financeira', 'agreement', jsonb_build_object('mode','keep','frequency','on_delivery',
      'reason','Mudança de modalidade','expected_amount_cents',145000,'expected_frequency','monthly',
      'expected_changed_at',result->0->'payment_agreement'->>'changed_at'))));
  IF result->0->>'notes' IS DISTINCT FROM 'Observação com edição financeira'
    OR (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1450
    OR result->0->>'payment_due_date' IS DISTINCT FROM '2099-03-06' THEN RAISE EXCEPTION 'FAIL: atomic financial edit from schedule'; END IF;

  PERFORM public.nv_save_shift_rate(organization,rate_id,rule || '{"amount_cents":130000}');
  IF (SELECT payment_amount FROM public.nv_staff_shifts WHERE id='nv-agreement-default') IS DISTINCT FROM 1200 THEN
    RAISE EXCEPTION 'FAIL: rates were applied retroactively';
  END IF;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(payload || jsonb_build_object('id','nv-agreement-stale','date','2099-03-07','agreement',selection)));
    RAISE EXCEPTION 'FAIL: stale rate accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;

  selection := selection || jsonb_build_object('mode','override','frequency','monthly','rate_cents',130000,'amount_cents',105000,
    'reason','Renegociação autorizada','override_reason','Redução acordada','expected_amount_cents',120000,
    'expected_frequency','on_delivery','expected_changed_at',revision);
  result := public.nv_edit_shift_agreement('nv-agreement-default',selection);
  IF (result->>'payment_amount')::numeric IS DISTINCT FROM 1050 OR result->>'payment_due_date' IS DISTINCT FROM '2099-04-20' THEN
    RAISE EXCEPTION 'FAIL: lower override or recalculated due date';
  END IF;
  revision := result->'payment_agreement'->>'changed_at';
  BEGIN
    PERFORM public.nv_edit_shift_agreement('nv-agreement-default',selection);
    RAISE EXCEPTION 'FAIL: lost-update protection';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM public.nv_save_shift_payment('nv-agreement-default',1050,'monthly','paid',1025,current_date,'Baixa registrada');
  BEGIN
    PERFORM public.nv_update_shift_payment('nv-agreement-default','pending');
    RAISE EXCEPTION 'FAIL: paid shift reopened by legacy RPC';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_update_shift_financials('nv-agreement-default',1100,'monthly','paid');
    RAISE EXCEPTION 'FAIL: paid shift edited by legacy RPC';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  selection := selection || jsonb_build_object('amount_cents',110000,'reason','Correção administrativa',
    'expected_amount_cents',105000,'expected_frequency','monthly','expected_changed_at',revision);
  BEGIN
    PERFORM public.nv_edit_shift_agreement('nv-agreement-default',selection);
    RAISE EXCEPTION 'FAIL: paid shift edited without adjustment workflow';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  result := public.nv_edit_shift_agreement('nv-agreement-default',selection,true);
  IF (result->>'payment_amount')::numeric IS DISTINCT FROM 1100
    OR (result->>'paid_amount')::numeric IS DISTINCT FROM 1025
    OR result->>'payment_status' IS DISTINCT FROM 'paid'
    OR result->>'payment_due_date' IS DISTINCT FROM '2099-04-20' THEN RAISE EXCEPTION 'FAIL: correction changed settlement'; END IF;
  history := public.nv_shift_payment_history('nv-agreement-default');
  IF jsonb_array_length(history) <> 4 OR history->0->>'actor_name' IS DISTINCT FROM 'Diretora'
    OR history->0->'next'->'agreement'->>'reason' IS DISTINCT FROM 'Correção administrativa'
    OR (history->0->'previous'->>'amount')::numeric IS DISTINCT FROM 1050
    OR (history->0->'next'->>'amount')::numeric IS DISTINCT FROM 1100
    OR jsonb_array_length(public.nv_shift_payment_history('nv-agreement-default',(history->0->>'id')::bigint)) <> 3 THEN
    RAISE EXCEPTION 'FAIL: financial audit actor, reason, old/new values or pagination';
  END IF;
  result := public.nv_report_shifts(organization,'2099-03-01','2099-03-01',payment=>'paid');
  IF (result->'rows'->0->>'agreed')::numeric IS DISTINCT FROM 1100
    OR (result->'rows'->0->>'paid_amount')::numeric IS DISTINCT FROM 1025 THEN RAISE EXCEPTION 'FAIL: reporting uses agreement and actual settlement'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
DECLARE result jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.nv_staff_shifts WHERE payment_agreement IS NOT NULL OR payment_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: finance fields exposed in staff view';
  END IF;
  BEGIN
    PERFORM payment_agreement FROM public.shifts;
    RAISE EXCEPTION 'FAIL: finance metadata exposed by base table';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM amount_cents FROM public.organization_shift_rates;
    RAISE EXCEPTION 'FAIL: private price table readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_shift_rates('nv-agreement-a');
    RAISE EXCEPTION 'FAIL: unprivileged price RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_shift_payment_history('nv-agreement-default');
    RAISE EXCEPTION 'FAIL: unprivileged history RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_edit_shift_agreement('nv-agreement-monthly','{"mode":"keep","frequency":"on_delivery"}');
    RAISE EXCEPTION 'FAIL: unprivileged agreement RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(
      (SELECT to_jsonb(s) FROM public.nv_staff_shifts s WHERE id = 'nv-agreement-monthly')
      || '{"agreement":{"mode":"keep","frequency":"on_delivery"}}'));
    RAISE EXCEPTION 'FAIL: unprivileged schedule writer changed agreement';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  result := public.nv_save_operational_shifts(jsonb_build_array(
    (SELECT to_jsonb(s) FROM public.nv_staff_shifts s WHERE id = 'nv-agreement-monthly')
    || '{"notes":"Observação operacional"}'));
  IF result->0->>'notes' IS DISTINCT FROM 'Observação operacional' OR result->0->>'payment_agreement' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: operational edits or masked write response';
  END IF;
  result := public.nv_report_shifts('nv-agreement-a','2099-03-01','2099-03-06');
  IF result->>'finance' IS DISTINCT FROM 'false'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(result->'rows') AS row
      WHERE row->>'agreed' IS NOT NULL OR row->>'paid_amount' IS NOT NULL OR row->>'due' IS NOT NULL OR row->>'payment' IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: financial reporting data exposed';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  IF jsonb_array_length(public.nv_shift_rates('nv-agreement-a')) <> 4
    OR jsonb_array_length(public.nv_shift_payment_history('nv-agreement-default')) <> 4 THEN
    RAISE EXCEPTION 'FAIL: read-only finance lost permitted access';
  END IF;
  BEGIN
    PERFORM public.nv_save_shift_rate('nv-agreement-a',NULL,'{"amount_cents":42,"active":true}');
    RAISE EXCEPTION 'FAIL: finance reader wrote a rule';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.nv_staff_shifts WHERE organization_id='nv-agreement-a') THEN RAISE EXCEPTION 'FAIL: foreign shifts visible'; END IF;
  BEGIN
    PERFORM public.nv_shift_rates('nv-agreement-a');
    RAISE EXCEPTION 'FAIL: cross-tenant prices';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_shift_payment_history('nv-agreement-default');
    RAISE EXCEPTION 'FAIL: cross-tenant payment history';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"26000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_edit_shift_agreement('nv-agreement-default','{"mode":"keep","frequency":"monthly"}',true);
    RAISE EXCEPTION 'FAIL: finance-only role made administrative adjustment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

ROLLBACK;
