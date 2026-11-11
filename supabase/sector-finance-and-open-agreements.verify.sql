-- Run only in a disposable Supabase/PostgreSQL laboratory after 29.
BEGIN;
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('29000000-0000-4000-8000-000000000001','authenticated','authenticated','post-director@example.invalid'),
 ('29000000-0000-4000-8000-000000000002','authenticated','authenticated','post-operator@example.invalid'),
 ('29000000-0000-4000-8000-000000000003','authenticated','authenticated','post-foreign@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('nv-post-a','Referências A','{"specialties":["Cirurgia"],"requiredDocuments":[]}'),('nv-post-b','Referências B','{}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('nv-post-admin','29000000-0000-4000-8000-000000000001','Diretora','post-director@example.invalid','tenant_user','nv-post-a','Diretor'),
 ('nv-post-oper','29000000-0000-4000-8000-000000000002','Operação','post-operator@example.invalid','tenant_user','nv-post-a','Escalista'),
 ('nv-post-foreign','29000000-0000-4000-8000-000000000003','Diretor externo','post-foreign@example.invalid','tenant_user','nv-post-b','Diretor');
INSERT INTO public.units(id,organization_id,name,type) VALUES ('nv-post-unit','nv-post-a','Hospital A','hospital');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units) VALUES
 ('nv-post-doctor','nv-post-a','Médico sintético','290001','SP','52998224725','post-doctor@example.invalid','Cirurgia','active',ARRAY['nv-post-unit']);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"29000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE
  org text := 'nv-post-a';
  sector jsonb := '{"id":"nv-post-sector","organization_id":"nv-post-a","unit_id":"nv-post-unit","name":"Posto sintético","specialties":["Cirurgia"],"status":"active",
    "default_start_time":"07:00","default_end_time":"19:00","required_doctors":1,
    "coverage_periods":[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1},{"kind":"night","startTime":"19:00","endTime":"07:00","requiredDoctors":1}]}';
  base jsonb := '{"organization_id":"nv-post-a","unit_id":"nv-post-unit","sector_id":"nv-post-sector","specialty":"Cirurgia","date":"2099-04-01",
    "start_time":"19:00","end_time":"07:00","type":"onsite","status":"open"}';
  selection jsonb;
  entry jsonb;
  result jsonb;
  r jsonb;
BEGIN
  PERFORM public.nv_save_payment_terms(org,20,1,'last_day','none',ARRAY[]::date[]);
  BEGIN
    PERFORM public.nv_save_sector_with_finance(sector,true,'{"night_cents":-1}');
    RAISE EXCEPTION 'FAIL: accepted an invalid price';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF EXISTS (SELECT FROM public.sectors WHERE id='nv-post-sector') THEN RAISE EXCEPTION 'FAIL: partial sector save'; END IF;
  PERFORM public.nv_save_sector_with_finance(sector,true,'{"amount_cents":100000,"day_cents":110000,"night_cents":120000,"frequency":"monthly","notes":"Referência interna"}');
  PERFORM public.nv_save_sector_with_finance(sector || '{"id":"nv-post-unpriced","name":"Posto sem referência"}',true,'{}');
  SELECT value INTO r FROM jsonb_array_elements(public.nv_shift_rates(org)) WHERE value->>'turn'='night';
  IF (r->>'amount_cents')::bigint IS DISTINCT FROM 120000 OR NOT EXISTS (
    SELECT FROM jsonb_array_elements(public.nv_shift_rates(org)) rr WHERE rr->>'payment_frequency'='monthly' AND rr->>'financial_notes'='Referência interna'
  ) THEN RAISE EXCEPTION 'FAIL: sector defaults not stored'; END IF;
  selection := jsonb_build_object('mode','default','frequency','monthly','rate_id',r->>'id','rate_cents',120000);
  result := public.nv_save_operational_shifts(jsonb_build_array(
    base || jsonb_build_object('id','nv-post-open1','agreement',selection),
    base || jsonb_build_object('id','nv-post-open2','date','2099-04-02','agreement',selection)));
  IF jsonb_array_length(result) <> 2 OR EXISTS (SELECT FROM jsonb_array_elements(result) s WHERE
    (s->>'payment_amount')::numeric IS DISTINCT FROM 1200 OR s->>'doctor_id' IS NOT NULL OR s->>'payment_due_date' IS NOT NULL
    OR s->'payment_agreement'->'rate' ? 'financial_notes') THEN RAISE EXCEPTION 'FAIL: recurring open agreement'; END IF;
  SELECT value INTO r FROM jsonb_array_elements(public.nv_shift_rates(org)) WHERE value->>'turn'='day';
  entry := base || jsonb_build_object('id','nv-post-override','start_time','07:00','end_time','19:00','agreement',
    jsonb_build_object('mode','override','frequency','on_delivery','amount_cents',145000,'rate_id',r->>'id','rate_cents',110000,
      'override_reason','Cobertura especial'));
  result := public.nv_save_operational_shifts(jsonb_build_array(entry));
  IF result->0->>'payment_frequency' <> 'on_delivery' OR (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1450
    OR result->0->'payment_agreement'->>'override_reason' <> 'Cobertura especial' THEN RAISE EXCEPTION 'FAIL: override'; END IF;
  result := public.nv_save_operational_shifts(jsonb_build_array(
    base || '{"id":"nv-post-manual","sector_id":"nv-post-unpriced","agreement":{"mode":"manual","frequency":"on_delivery","amount_cents":98550}}',
    base || '{"id":"nv-post-unset","sector_id":"nv-post-unpriced"}'));
  IF (SELECT payment_amount FROM public.nv_staff_shifts WHERE id='nv-post-manual') IS DISTINCT FROM 985.50
    OR (SELECT payment_amount FROM public.nv_staff_shifts WHERE id='nv-post-unset') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: manual vs unset';
  END IF;
  PERFORM public.nv_save_sector_with_finance(sector,false,'{"amount_cents":150000,"night_cents":160000,"frequency":"on_delivery"}');
  IF (SELECT payment_amount FROM public.nv_staff_shifts WHERE id='nv-post-open1') IS DISTINCT FROM 1200 THEN
    RAISE EXCEPTION 'FAIL: changed a previously saved amount';
  END IF;
  entry := (SELECT to_jsonb(s) FROM public.nv_staff_shifts s WHERE id='nv-post-open1');
  BEGIN
    PERFORM public.nv_edit_shift_agreement('nv-post-open1','{"mode":"keep","frequency":"on_delivery","expected_amount_cents":120000,"expected_frequency":"monthly"}');
    RAISE EXCEPTION 'FAIL: edited vacancy without an audit reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.nv_edit_shift_agreement('nv-post-open1',jsonb_build_object('mode','keep','frequency','on_delivery',
    'expected_amount_cents',120000,'expected_frequency','monthly','expected_changed_at',entry->'payment_agreement'->>'changed_at','reason','Modalidade negociada'));
  result := public.nv_report_filtered_shifts(org,'2099-04-01','2099-04-03','{"payment":"unassigned"}',true);
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(result->'rows') s WHERE s->>'id'='nv-post-open1'
    AND s->>'payment'='unassigned' AND s->>'frequency'='on_delivery' AND (s->>'agreed')::numeric=1200
    AND s->>'balance' IS NULL AND s->>'due' IS NULL) THEN RAISE EXCEPTION 'FAIL: vacancy financial report'; END IF;
  result := public.nv_save_operational_shifts(jsonb_build_array(base || '{"id":"nv-post-open1","doctor_id":"nv-post-doctor","status":"confirmed","employment_type":"clt"}'));
  IF (result->0->>'payment_amount')::numeric IS DISTINCT FROM 1200 OR result->0->>'payment_due_date' IS DISTINCT FROM '2099-04-02' THEN
    RAISE EXCEPTION 'FAIL: assignment lost price or did not set due date';
  END IF;
  PERFORM public.nv_save_shift_payment('nv-post-open1',1200,'on_delivery','paid',1180,current_date,'Baixa sintética');
  BEGIN
    PERFORM public.nv_edit_shift_agreement('nv-post-open1','{"mode":"keep","frequency":"on_delivery"}');
    RAISE EXCEPTION 'FAIL: modified paid agreement without adjustment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(public.nv_shift_payment_history('nv-post-open1')) h
    WHERE h->'next'->'agreement'->>'reason'='Modalidade negociada') THEN RAISE EXCEPTION 'FAIL: audit reason missing'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"29000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_shift_rates('nv-post-a');
    RAISE EXCEPTION 'FAIL: disclosed defaults';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_sector_with_finance('{"id":"nv-post-sector","organization_id":"nv-post-a","unit_id":"nv-post-unit"}',false,'{}');
    RAISE EXCEPTION 'FAIL: operational staff updated sector finance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-post-open2' AND (payment_amount IS NOT NULL OR payment_agreement IS NOT NULL))
    OR (public.nv_report_filtered_shifts('nv-post-a','2099-04-01','2099-04-03','{}',false)->'rows'->0 ? 'agreed') THEN
    RAISE EXCEPTION 'FAIL: disclosed financial details';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"29000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_save_sector_with_finance('{"id":"nv-post-sector","organization_id":"nv-post-a","unit_id":"nv-post-unit"}',false,'{}');
    RAISE EXCEPTION 'FAIL: foreign account updated sector finance';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
