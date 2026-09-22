-- Run after 13_document_governance.sql inside a transaction; always rollback fixtures.
INSERT INTO auth.users(id,aud,role,email,created_at,updated_at) VALUES('10000000-0000-4000-8000-000000000001','authenticated','authenticated','nvmed-transaction-test@example.invalid',now(),now());
INSERT INTO public.organizations(id,name,settings) VALUES('nv-test-a','Transaction test A','{"specialties":[],"requiredDocuments":[{"type":"rg_cnh","name":"RG","required":true}]}'),('nv-test-b','Transaction test B','{"specialties":[],"requiredDocuments":[]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,status,additional_permissions) VALUES('nv-test-user','10000000-0000-4000-8000-000000000001','Test','nvmed-transaction-test@example.invalid','tenant_user','nv-test-a','Jurídico','active','{"medicos":"edit","unidades":"edit","escala":"edit","financeiro":"edit"}');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.organizations)<>1 THEN RAISE EXCEPTION 'FAIL: tenant isolation'; END IF;
 IF (SELECT count(*) FROM public.user_accounts)<>1 THEN RAISE EXCEPTION 'FAIL: profile isolation'; END IF;
 BEGIN INSERT INTO public.units(id,organization_id,name,type,status) VALUES('nv-cross','nv-test-b','Forbidden','hospital','active'); RAISE EXCEPTION 'FAIL: cross-tenant insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.user_accounts SET type='saas_admin' WHERE id='nv-test-user'; RAISE EXCEPTION 'FAIL: privilege escalation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.units(id,organization_id,name,type,status) VALUES('nv-test-unit','nv-test-a','Test unit','hospital','active');
 INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,required_doctors) VALUES('nv-test-sector','nv-test-a','nv-test-unit','UTI',ARRAY['Clínico Geral'],2);
 INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status,linked_units) VALUES('nv-test-doctor','nv-test-a','Test doctor','TEST','SP','Clínico Geral','active',ARRAY['nv-test-unit']);
 IF (SELECT count(*) FROM public.medical_documents WHERE doctor_id='nv-test-doctor')<>1 THEN RAISE EXCEPTION 'FAIL: document creation'; END IF;
 UPDATE public.medical_documents SET status='rejected',review_note='Documento ilegível' WHERE doctor_id='nv-test-doctor';
 IF NOT EXISTS(SELECT 1 FROM public.document_audit_logs WHERE doctor_id='nv-test-doctor' AND action='status_changed' AND note='Documento ilegível') THEN RAISE EXCEPTION 'FAIL: document audit'; END IF;
 INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,date,start_time,end_time,type,status,specialty,employment_type,employer_name,payment_amount,payment_frequency) VALUES('nv-test-shift','nv-test-a','nv-test-doctor','nv-test-unit','nv-test-sector','2099-01-01','19:00','07:00','onsite','confirmed','Clínico Geral','pj','Test company',1500,'monthly');
 PERFORM public.nv_update_shift_financials('nv-test-shift',1750,'monthly','paid');
 IF (SELECT payment_status FROM public.shifts WHERE id='nv-test-shift')<>'paid' THEN RAISE EXCEPTION 'FAIL: finance settlement'; END IF;
 IF (SELECT payment_amount FROM public.shifts WHERE id='nv-test-shift')<>1750 THEN RAISE EXCEPTION 'FAIL: finance amount'; END IF;
 INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,date,start_time,end_time,type,status) VALUES('nv-test-open','nv-test-a',NULL,'nv-test-unit','nv-test-sector','2099-01-01','19:00','07:00','onsite','open');
 IF (SELECT status FROM public.shifts WHERE id='nv-test-open')<>'open' THEN RAISE EXCEPTION 'FAIL: open position'; END IF;
 BEGIN INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,date,start_time,end_time,type,status,employment_type) VALUES('nv-test-conflict','nv-test-a','nv-test-doctor','nv-test-unit','nv-test-sector','2099-01-02','06:00','12:00','onsite','confirmed','clt'); RAISE EXCEPTION 'FAIL: overlap accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%sobreposto%' THEN RAISE; END IF; END;
 INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,date,start_time,end_time,type,status,employment_type) VALUES('nv-test-adjacent','nv-test-a','nv-test-doctor','nv-test-unit','nv-test-sector','2099-01-02','07:00','12:00','onsite','confirmed','concursado');
 DELETE FROM public.shifts WHERE id='nv-test-adjacent';
 IF EXISTS(SELECT 1 FROM public.shifts WHERE id='nv-test-adjacent') THEN RAISE EXCEPTION 'FAIL: delete'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM * FROM public.doctors; RAISE EXCEPTION 'FAIL: anonymous read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: tenant isolation, sectors, finance settlement, additional permissions, document audit, open positions, anonymous blocking, write permissions, profile protection, required documents, night overlap, adjacent shift and deletion' AS verification;
ROLLBACK;
