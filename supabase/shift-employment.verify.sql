-- Exercise the public RPCs in a disposable database after migration 30.
BEGIN;
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('30000000-0000-4000-8000-000000000001','authenticated','authenticated','contract-admin@example.invalid'),
 ('30000000-0000-4000-8000-000000000002','authenticated','authenticated','contract-coordinator@example.invalid'),
 ('30000000-0000-4000-8000-000000000003','authenticated','authenticated','contract-doctor@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('nv-contract-org','Contratação sintética','{"specialties":["Cirurgia"],"requiredDocuments":[]}'),
 ('nv-contract-other','Outra empresa','{}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('nv-contract-admin','30000000-0000-4000-8000-000000000001','Diretora','contract-admin@example.invalid','tenant_user','nv-contract-org','Diretor'),
 ('nv-contract-coord','30000000-0000-4000-8000-000000000002','Coordenação','contract-coordinator@example.invalid','tenant_user','nv-contract-org','Coordenador de Escalas');
INSERT INTO public.units(id,organization_id,name,type) VALUES ('nv-contract-unit','nv-contract-org','Hospital de teste','hospital');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties) VALUES
 ('nv-contract-sector','nv-contract-org','nv-contract-unit','Cirurgia',ARRAY['Cirurgia']);
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units) VALUES
 ('nv-contract-old','nv-contract-org','Médico original','300001','SP','52998224725','contract-original@example.invalid','Cirurgia','active',ARRAY['nv-contract-unit']),
 ('nv-contract-next','nv-contract-org','Médico candidato','300002','SP','11144477735','contract-doctor@example.invalid','Cirurgia','active',ARRAY['nv-contract-unit']);
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,submitted_name,submitted_phone,
  requested_specialties,approved_specialties,status) VALUES
 ('nv-contract-next','nv-contract-org','30000000-0000-4000-8000-000000000003','1980-01-01','synthetic','Médico candidato','11999999999',
  ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved');

-- Reproduce rows written by the pre-migration contract, including a paid CLT record.
SET LOCAL session_replication_role = replica;
INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,doctor_id,date,start_time,end_time,type,status,
  specialty,employment_type,payment_amount,payment_status,paid_at,paid_amount)
VALUES
 ('nv-contract-legacy-paid','nv-contract-org','nv-contract-unit','nv-contract-sector','nv-contract-old',current_date-1,'07:00','19:00','onsite','completed',
  'Cirurgia','clt',800,'paid',now(),785),
 ('nv-contract-legacy-unknown','nv-contract-org','nv-contract-unit','nv-contract-sector','nv-contract-old',current_date-2,'07:00','19:00','onsite','completed',
  'Cirurgia',NULL,0,'pending',NULL,NULL);
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.contract_shift(id text, days integer, employment text, doctor text, agreement jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('id',id,'organization_id','nv-contract-org','unit_id','nv-contract-unit','sector_id','nv-contract-sector',
    'doctor_id',doctor,'date',current_date+days,'start_time','07:00','end_time','19:00','type','onsite','specialty','Cirurgia',
    'employment_type',employment,'employer_name',CASE WHEN employment='pj' THEN 'Empresa sintética' END,
    'status',CASE WHEN doctor IS NULL THEN 'open' ELSE 'confirmed' END,'agreement',agreement);
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE
  org text := 'nv-contract-org';
  rate text;
  price jsonb;
  result jsonb;
BEGIN
  PERFORM public.nv_save_payment_terms(org,20,1,'last_day','none',ARRAY[]::date[]);
  rate := public.nv_save_shift_rate(org,NULL,'{"amount_cents":100000,"active":true}')->>'id';
  price := jsonb_build_object('mode','default','frequency','monthly','rate_id',rate,'rate_cents',100000);
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.contract_shift('nv-contract-incomplete',1,'pj','nv-contract-old')));
    RAISE EXCEPTION 'FAIL: PJ without a price';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(
    pg_temp.contract_shift('nv-contract-pj-clt',1,'pj','nv-contract-old',price),
    pg_temp.contract_shift('nv-contract-clt-pj',2,'clt','nv-contract-old'),
    pg_temp.contract_shift('nv-contract-pref',3,'concursado','nv-contract-old'),
    pg_temp.contract_shift('nv-contract-pj-pj',4,'pj','nv-contract-old',price),
    pg_temp.contract_shift('nv-contract-vacancy',5,'pj',NULL,price),
    pg_temp.contract_shift('nv-contract-paid',6,'pj','nv-contract-old',price),
    pg_temp.contract_shift('nv-contract-recurring-a',7,'clt','nv-contract-old'),
    pg_temp.contract_shift('nv-contract-recurring-b',8,'clt','nv-contract-old'),
    pg_temp.contract_shift('nv-contract-convert',9,'pj','nv-contract-old',price)
  ));
  IF (SELECT count(*) FROM public.nv_staff_shifts WHERE organization_id=org AND doctor_id='nv-contract-old'
    AND date BETWEEN current_date+1 AND current_date+3) <> 3 THEN RAISE EXCEPTION 'FAIL: same doctor, three modalities'; END IF;
  IF EXISTS (SELECT FROM public.nv_staff_shifts WHERE id IN ('nv-contract-clt-pj','nv-contract-pref','nv-contract-recurring-a','nv-contract-recurring-b')
    AND (payment_amount IS NOT NULL OR payment_due_date IS NOT NULL)) THEN RAISE EXCEPTION 'FAIL: non-PJ obligation'; END IF;
  IF NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-vacancy' AND employment_type='pj'
    AND doctor_id IS NULL AND payment_amount=1000 AND payment_due_date IS NULL) THEN RAISE EXCEPTION 'FAIL: provisional vacancy'; END IF;
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.contract_shift('nv-contract-convert',9,'clt','nv-contract-old')));
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(public.nv_shift_payment_history('nv-contract-convert')) h
    WHERE h->'previous'->>'amount'='1000.00' AND h->'next'->>'amount' IS NULL) THEN RAISE EXCEPTION 'FAIL: conversion audit'; END IF;
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.contract_shift('nv-contract-legacy-unknown',-2,NULL,'nv-contract-old')
    || '{"status":"completed","notes":"Edição operacional"}'));
  IF NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-legacy-unknown' AND employment_type IS NULL AND payment_amount=0)
    OR NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-legacy-paid' AND employment_type='clt' AND paid_amount=785) THEN
    RAISE EXCEPTION 'FAIL: legacy financial data changed';
  END IF;
  result := public.nv_report_filtered_shifts(org,current_date-3,current_date+10,'{"employment":"clt"}',false);
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(result->'rows') j WHERE j->>'id'='nv-contract-legacy-paid'
    AND j->>'employment'='clt' AND j->>'agreed' IS NULL AND j->>'paid_amount' IS NULL) THEN RAISE EXCEPTION 'FAIL: operational report'; END IF;
  result := public.nv_report_filtered_shifts(org,current_date-3,current_date+10,'{}',true);
  IF EXISTS (SELECT FROM jsonb_array_elements(result->'rows') j WHERE j->>'employment' IS DISTINCT FROM 'pj') THEN
    RAISE EXCEPTION 'FAIL: financial report contains a non-PJ shift';
  END IF;
END $$;

RESET ROLE;
INSERT INTO public.shift_opportunities(id,shift_id,kind,original_doctor_id) VALUES
 ('31000000-0000-4000-8000-000000000001','nv-contract-pj-clt','exchange','nv-contract-old'),
 ('31000000-0000-4000-8000-000000000002','nv-contract-clt-pj','exchange','nv-contract-old'),
 ('31000000-0000-4000-8000-000000000003','nv-contract-pj-pj','exchange','nv-contract-old'),
 ('31000000-0000-4000-8000-000000000004','nv-contract-vacancy','vacancy',NULL),
 ('31000000-0000-4000-8000-000000000005','nv-contract-paid','exchange','nv-contract-old');
INSERT INTO public.shift_applications(opportunity_id,doctor_id)
SELECT id,'nv-contract-next' FROM public.shift_opportunities WHERE shift_id LIKE 'nv-contract-%';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000001','nv-contract-next','clt',NULL);
    RAISE EXCEPTION 'FAIL: finance permission required to clear an existing price';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-pj-clt' AND payment_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'FAIL: coordinator can read the price';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE
  rate text := public.nv_shift_rates('nv-contract-org')->0->>'id';
  discounted jsonb;
BEGIN
  discounted := jsonb_build_object('mode','override','frequency','on_delivery','rate_id',rate,'rate_cents',100000,
    'amount_cents',145000,'override_reason','Acordo com o substituto');
  BEGIN
    PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000002','nv-contract-next','pj','Empresa sintética');
    RAISE EXCEPTION 'FAIL: approved a PJ candidate without the terms';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000001','nv-contract-next','clt',NULL);
  PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000002','nv-contract-next','pj','Empresa sintética',discounted);
  PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000003','nv-contract-next','pj','Empresa sintética',discounted || '{"amount_cents":155000}');
  PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000004','nv-contract-next','pj','Empresa sintética',discounted || '{"amount_cents":165000}');
  IF NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-pj-clt' AND doctor_id='nv-contract-next'
    AND employment_type='clt' AND payment_amount IS NULL AND payment_due_date IS NULL)
    OR NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-clt-pj' AND employment_type='pj'
      AND payment_amount=1450 AND payment_due_date=current_date+2 AND payment_frequency='on_delivery')
    OR NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-pj-pj' AND payment_amount=1550)
    OR NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-contract-vacancy' AND payment_amount=1650 AND doctor_id='nv-contract-next') THEN
    RAISE EXCEPTION 'FAIL: reassignment did not persist its own terms';
  END IF;
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(public.nv_shift_history('nv-contract-pj-clt')) h
    WHERE h->>'previous_employment'='pj' AND h->>'next_employment'='clt')
    OR NOT EXISTS (SELECT FROM jsonb_array_elements(public.nv_shift_payment_history('nv-contract-pj-pj')) h
    WHERE (h->'previous'->>'amount')::numeric=1000 AND (h->'next'->>'amount')::numeric=1550) THEN
    RAISE EXCEPTION 'FAIL: history lost the original employment or price';
  END IF;
  PERFORM public.nv_save_shift_payment('nv-contract-paid',1000,'monthly','paid',990,current_date,'Pagamento sintético');
  BEGIN
    PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000005','nv-contract-next','clt',NULL);
    RAISE EXCEPTION 'FAIL: approved paid exchange';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.contract_shift('nv-contract-paid',6,'concursado','nv-contract-old')));
    RAISE EXCEPTION 'FAIL: reclassified paid shift';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"30000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date,current_date+8,true)) j
    WHERE j->>'id'='nv-contract-pj-pj' AND j->>'employment'='pj' AND NOT (j ? 'payment_amount')) THEN
    RAISE EXCEPTION 'FAIL: physician agenda missing employment or exposing payment';
  END IF;
  BEGIN
    PERFORM public.nv_select_shift_candidate('31000000-0000-4000-8000-000000000005','nv-contract-next','clt',NULL);
    RAISE EXCEPTION 'FAIL: physician approved own exchange';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.shift_opportunities WHERE shift_id='nv-contract-paid' AND status='open')
    OR NOT EXISTS (SELECT FROM public.shifts WHERE id='nv-contract-paid' AND doctor_id='nv-contract-old' AND paid_amount=990) THEN
    RAISE EXCEPTION 'FAIL: blocked approval changed state';
  END IF;
END $$;
ROLLBACK;
