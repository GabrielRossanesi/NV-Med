-- Banking integration tests after 32, in a disposable PostgreSQL only.
BEGIN;
DO $$ DECLARE v text; invalid record; BEGIN
  IF NOT EXISTS (SELECT FROM public.doctor_banking WHERE doctor_id='nv-bank-doctor' AND pix_key='legacy-key-preserved' AND pix_key_type IS NULL)
    OR EXISTS (SELECT FROM public.doctor_enrollments WHERE pix_key IS NOT NULL) THEN RAISE EXCEPTION 'FAIL: legacy migration'; END IF;
  FOR v IN SELECT unnest(ARRAY['52998224724','11111111111','x52998224725']) LOOP
    BEGIN PERFORM public.nv_normalize_pix('cpf',v); RAISE EXCEPTION 'FAIL: invalid CPF'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  FOR invalid IN SELECT * FROM (VALUES ('cnpj','11222333000180'),('cnpj','00000000000000'),('email','bad@'),
    ('phone','+0123456789'),('phone','119999999'),('evp','550e8400-e29b-11d4-a716-446655440000'),(NULL,'key')) t(kind,value) LOOP
    BEGIN PERFORM public.nv_normalize_pix(invalid.kind,invalid.value); RAISE EXCEPTION 'FAIL: invalid PIX'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  IF public.nv_normalize_pix('cpf','529.982.247-25') <> '52998224725'
    OR public.nv_normalize_pix('cnpj','11.222.333/0001-81') <> '11222333000181'
    OR public.nv_normalize_pix('cnpj','00.000.000/E08G-12') <> '00000000E08G12'
    OR public.nv_normalize_pix('email',' Doctor@Example.COM ') <> 'doctor@example.com'
    OR public.nv_normalize_pix('phone','(11) 99999-9999') <> '+5511999999999'
    OR public.nv_normalize_pix('phone','+44 20 7946 0958') <> '+442079460958'
    OR public.nv_normalize_pix('evp','550E8400-E29B-41D4-A716-446655440000') <> '550e8400-e29b-41d4-a716-446655440000' THEN
    RAISE EXCEPTION 'FAIL: valid PIX normalization'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE snapshot jsonb; BEGIN
  snapshot := public.nv_doctor_banking('nv-bank-doctor');
  IF snapshot->>'complete' <> 'false' OR snapshot->'details'->>'pix_key' = 'legacy-key-preserved' THEN RAISE EXCEPTION 'FAIL: mask/legacy pending'; END IF;
  IF NOT EXISTS (SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date,current_date+10,true)) s WHERE s->>'id'='nv-bank-shift') THEN
    RAISE EXCEPTION 'FAIL: legacy schedule blocked'; END IF;
  PERFORM public.nv_update_doctor_banking('nv-bank-doctor','{"pix_key_type":"cpf","pix_key":"529.982.247-25","agency":"0001-X","account_number":"00001234-0"}');
  snapshot := public.nv_doctor_banking('nv-bank-doctor',true);
  IF snapshot->'details'->>'pix_key' <> '52998224725' OR snapshot->'details'->>'agency' <> '0001-X'
    OR snapshot->'details'->>'account_number' <> '00001234-0' OR snapshot->>'complete' <> 'true' THEN RAISE EXCEPTION 'FAIL: own update'; END IF;
  BEGIN PERFORM public.nv_update_doctor_banking('nv-bank-peer','{"pix_key_type":"cpf","pix_key":"52998224725"}');
    RAISE EXCEPTION 'FAIL: edited peer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nv_doctor_banking('nv-bank-peer',true); RAISE EXCEPTION 'FAIL: read peer'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nv_doctor_banking_history('nv-bank-doctor'); RAISE EXCEPTION 'FAIL: self history escalation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.doctor_banking; RAISE EXCEPTION 'FAIL: direct select'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM public.nv_doctor_banking('nv-bank-doctor',true); RAISE EXCEPTION 'FAIL: coordinator access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nv_update_doctor_banking('nv-bank-doctor','{}'); RAISE EXCEPTION 'FAIL: coordinator edit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM public.nv_create_doctor_with_banking('{"id":"nv-bank-draft","organization_id":"nv-bank-org","name":"Draft Doctor","crm":"3203","crm_uf":"SP","specialty":"Cirurgia","status":"active"}',NULL);
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM public.nv_doctor_banking('nv-bank-doctor',true); RAISE EXCEPTION 'FAIL: cross-tenant read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nv_update_doctor_banking('nv-bank-doctor','{}'); RAISE EXCEPTION 'FAIL: cross-tenant edit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.nv_doctor_banking_history('nv-bank-doctor'); RAISE EXCEPTION 'FAIL: cross-tenant audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ DECLARE history jsonb; BEGIN
  IF public.nv_doctor_banking('nv-bank-doctor',true)->'details'->>'pix_key' <> '52998224725' THEN RAISE EXCEPTION 'FAIL: finance read'; END IF;
  history := public.nv_doctor_banking_history('nv-bank-doctor');
  IF jsonb_array_length(history) <> 1 OR history::text LIKE '%52998224725%' OR history::text LIKE '%00001234-0%' THEN RAISE EXCEPTION 'FAIL: sensitive audit'; END IF;
  IF NOT EXISTS (SELECT FROM public.nv_staff_shifts WHERE id='nv-bank-shift' AND employment_type='pj' AND payment_amount=500 AND payment_frequency='monthly' AND payment_status='pending') THEN
    RAISE EXCEPTION 'FAIL: banking changed financial agreement'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.nv_create_doctor_with_banking('{"id":"nv-bank-admin-created","organization_id":"nv-bank-org","name":"Admin Created","crm":"3205","crm_uf":"SP","specialty":"Cirurgia","status":"active"}',
    '{"pix_key_type":"cnpj","pix_key":"11.222.333/0001-81"}');
  BEGIN
    PERFORM public.nv_create_doctor_with_banking('{"id":"nv-bank-atomic-invalid","organization_id":"nv-bank-org","name":"Invalid Doctor","crm":"3206","crm_uf":"SP","specialty":"Cirurgia","status":"active"}',
      '{"pix_key_type":"cpf","pix_key":"00000000000"}');
    RAISE EXCEPTION 'FAIL: invalid administrative creation';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status)
    VALUES('nv-bank-bypass','nv-bank-org','Direct Insert','3207','SP','Cirurgia','active');
    SET CONSTRAINTS nv_require_new_doctor_banking IMMEDIATE;
    RAISE EXCEPTION 'FAIL: direct insert bypassed completion';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  UPDATE public.doctors SET status='active' WHERE id='nv-bank-peer';
  SET CONSTRAINTS ALL IMMEDIATE;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.doctors WHERE id IN ('nv-bank-atomic-invalid','nv-bank-bypass')) THEN RAISE EXCEPTION 'FAIL: atomic rollback'; END IF;
  IF NOT EXISTS (SELECT FROM public.doctor_banking WHERE doctor_id='nv-bank-admin-created' AND pix_key='11222333000181' AND bank='' AND agency='' AND account_number='') THEN
    RAISE EXCEPTION 'FAIL: administrative optional fields'; END IF;
END $$;
UPDATE public.user_accounts SET additional_permissions='{"dados_bancarios.view":"deny","dados_bancarios.edit":"allow","dados_bancarios.history":"allow"}' WHERE id='nv-bank-finance';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM public.nv_doctor_banking('nv-bank-doctor',true); RAISE EXCEPTION 'FAIL: explicit denial'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$ BEGIN
  PERFORM public.nv_submit_enrollment('nv-bank-org','New Doctor','3204','SP','12345678909','1980-01-01','11999999999','new@example.com',ARRAY['Cirurgia'],'{"pix_key_type":"email"}');
  BEGIN PERFORM public.nv_submit_enrollment('nv-bank-org','New Doctor','3204','SP','12345678909','1980-01-01','11999999999','new@example.com',ARRAY['Cirurgia']);
    RAISE EXCEPTION 'FAIL: old client bypass'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.doctors WHERE id='nv-bank-draft' AND status='pending') THEN RAISE EXCEPTION 'FAIL: unauthorized creation must be draft'; END IF;
  IF NOT EXISTS (SELECT FROM public.portal_notifications WHERE recipient_id='32000000-0000-4000-8000-000000000002' AND event_key LIKE 'banking:%') THEN
    RAISE EXCEPTION 'FAIL: physician notification'; END IF;
  IF EXISTS (SELECT FROM public.doctor_enrollments WHERE pix_key IS NOT NULL) THEN RAISE EXCEPTION 'FAIL: duplicate PIX storage'; END IF;
  IF EXISTS (SELECT FROM public.portal_notifications WHERE message LIKE '%52998224725%') THEN RAISE EXCEPTION 'FAIL: notification contains key'; END IF;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
