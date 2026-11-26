-- Disposable PostgreSQL only; all fixtures and changes roll back.
BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status)
 SELECT 'directory-'||n,'nv-bank-org','Álvaro Fictício', (900000+n)::text,'SP','Cirurgia','pending' FROM generate_series(1,123) n;
UPDATE public.doctors SET rqe='654321' WHERE id='directory-1';
INSERT INTO public.doctor_rqes(doctor_id,organization_id,number,specialty) VALUES
 ('directory-1','nv-bank-org','11111','Cirurgia'),('directory-1','nv-bank-org','22222',NULL);
CREATE TEMP TABLE directory_preserve AS SELECT
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.shifts x) shifts,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM auth.users x) auth,
 (SELECT count(*) FROM public.doctor_access_operations) access;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; first_page jsonb; second_page jsonb; BEGIN
 result:=public.nv_doctor_directory('nv-bank-org');
 IF jsonb_array_length(result->'rows')<>25 OR (result->>'total')::int<123 THEN RAISE EXCEPTION 'FAIL: pagination'; END IF;
 first_page:=result; second_page:=public.nv_doctor_directory('nv-bank-org','{}',2);
 IF EXISTS(SELECT FROM jsonb_array_elements(first_page->'rows') a JOIN jsonb_array_elements(second_page->'rows') b ON a->>'id'=b->>'id') THEN RAISE EXCEPTION 'FAIL: duplicate across pages'; END IF;
 result:=public.nv_doctor_directory('nv-bank-org','{"q":"alvaro ficticio"}',1,100);
 IF (result->>'total')::int<>123 OR jsonb_array_length(result->'rows')<>100 OR (result->'indicators'->>'total')::int=(result->>'total')::int THEN RAISE EXCEPTION 'FAIL: search or global indicators: found %, rows %, company %',result->>'total',jsonb_array_length(result->'rows'),result->'indicators'; END IF;
 result:=public.nv_doctor_directory('nv-bank-org','{"q":"654321"}');
 IF (result->>'total')::int<>1 OR jsonb_array_length(result->'rows'->0->'rqes')<>3 THEN RAISE EXCEPTION 'FAIL: multi RQE'; END IF;
 IF (public.nv_doctor_directory('nv-bank-org','{"q":"654321","rqe":"with","specialty":"Cirurgia"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'FAIL: associated RQE'; END IF;
 IF (public.nv_doctor_directory('nv-bank-org','{"rqe":"without","specialty":"Cirurgia","q":"654321"}')->>'total')::int<>0 THEN RAISE EXCEPTION 'FAIL: linked RQE negative'; END IF;
 IF (public.nv_doctor_directory('nv-bank-org','{"q":"22222"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'FAIL: secondary RQE search'; END IF;
 IF result->'rows'->0 ?| ARRAY['cpf','email','phone','address','auth_user_id','file_path'] THEN RAISE EXCEPTION 'FAIL: sensitive data'; END IF;
 BEGIN PERFORM public.nv_directory_rows('nv-bank-org'); RAISE EXCEPTION 'FAIL: private helper'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_directory('nv-bank-other'); RAISE EXCEPTION 'FAIL: IDOR'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_directory('nv-bank-org','{"status":"bad"}'); RAISE EXCEPTION 'FAIL: tampered filters'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_directory('nv-bank-org','{}',1,10000); RAISE EXCEPTION 'FAIL: unbounded page'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.nv_export_doctor_directory('nv-bank-org','{}',NULL,gen_random_uuid()); RAISE EXCEPTION 'FAIL: export without MFA'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_directory_bulk('nv-bank-org',gen_random_uuid(),'status','[{"id":"directory-1","revision":"2020-01-01"}]','inactive'); RAISE EXCEPTION 'FAIL: bulk without MFA'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- An unassociated legacy RQE must not become a specialty qualification.
DELETE FROM public.doctor_rqes WHERE doctor_id='directory-1' AND specialty IS NOT NULL;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF (public.nv_doctor_directory('nv-bank-org','{"q":"654321","rqe":"with","specialty":"Cirurgia"}')->>'total')::int<>0 THEN RAISE EXCEPTION 'FAIL: invented legacy association'; END IF;
 IF (public.nv_doctor_directory('nv-bank-org','{"q":"654321","rqe":"without","specialty":"Cirurgia"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'FAIL: unassociated qualification'; END IF;
END $$;
RESET ROLE;
-- Only applicable document metadata contributes to the aggregates.
UPDATE public.organizations SET settings=jsonb_set(jsonb_set(settings,'{specialties}','["Cirurgia","Pediatria"]'),'{requiredDocuments}',
 '[{"type":"directory_credential","name":"Credencial fictícia","required":true},{"type":"directory_secondary","name":"Qualificação pediátrica","required":true,"specialties":["Pediatria"]}]') WHERE id='nv-bank-org';
INSERT INTO storage.objects(bucket_id,name) VALUES('medical-documents','nv-bank-org/directory-1/directory-test.pdf'),('medical-documents','nv-bank-org/directory-2/directory-test.pdf');
INSERT INTO public.medical_document_scans(object_name,object_version,state,retry_at)
 SELECT name,coalesce(version,'')||'/'||extract(epoch FROM updated_at)::text,'clean',now() FROM storage.objects WHERE name IN('nv-bank-org/directory-1/directory-test.pdf','nv-bank-org/directory-2/directory-test.pdf');
UPDATE public.medical_documents SET file_path='nv-bank-org/'||doctor_id||'/directory-test.pdf',file_name='directory-test.pdf' WHERE doctor_id IN('directory-1','directory-2') AND type='directory_credential';
UPDATE public.medical_documents SET status='expired',expiry_date=(current_date-1)::text WHERE doctor_id='directory-1' AND type='directory_credential';
UPDATE public.medical_documents SET status='approved',expiry_date=(current_date+5)::text WHERE doctor_id='directory-2' AND type='directory_credential';
UPDATE public.doctor_enrollments SET approved_specialties=ARRAY['Cirurgia','Pediatria'] WHERE doctor_id='nv-bank-doctor';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.nv_doctor_directory('nv-bank-org','{"q":"654321","documents":"expired"}');
 IF (result->>'total')::int<>1 OR (result->'rows'->0->'documents'->>'expired')::int<>1 THEN RAISE EXCEPTION 'FAIL: expiry metadata'; END IF;
 IF (public.nv_doctor_directory('nv-bank-org','{"q":"900002","documents":"near"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'FAIL: near expiry'; END IF;
 IF (public.nv_doctor_directory('nv-bank-org','{"q":"3201","specialty":"Pediatria"}')->>'total')::int<>1 THEN RAISE EXCEPTION 'FAIL: approved secondary specialty'; END IF;
END $$;
RESET ROLE;
INSERT INTO auth.mfa_factors(id,user_id,status,factor_type) VALUES('59000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','verified','totp');
INSERT INTO auth.sessions(id,user_id,created_at,not_after,aal,factor_id) VALUES('59000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001',now(),now()+interval '1 hour','aal2','59000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"59000000-0000-4000-8000-000000000002"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE targets jsonb; result jsonb; request uuid:=gen_random_uuid(); exported jsonb; snapshot jsonb; BEGIN
 targets:=jsonb_build_array(jsonb_build_object('id','directory-1','revision',(SELECT updated_at FROM public.doctors WHERE id='directory-1')),
  jsonb_build_object('id','directory-2','revision','2020-01-01'));
 result:=public.nv_doctor_directory_bulk('nv-bank-org',request,'status',targets,'inactive');
 IF result->0->>'result'<>'success' OR result->1->>'result'<>'stale' THEN RAISE EXCEPTION 'FAIL: partial bulk %',result; END IF;
 IF public.nv_doctor_directory_bulk('nv-bank-org',request,'status',targets,'inactive')<>result THEN RAISE EXCEPTION 'FAIL: idempotency'; END IF;
 BEGIN PERFORM public.nv_doctor_directory_bulk('nv-bank-org',request,'status',targets,'active'); RAISE EXCEPTION 'FAIL: reused payload'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 exported:=public.nv_export_doctor_directory('nv-bank-org','{"q":"654321"}',NULL,gen_random_uuid());
 IF jsonb_array_length(exported)<>1 THEN RAISE EXCEPTION 'FAIL: filtered export'; END IF;
 BEGIN PERFORM public.nv_export_doctor_directory('nv-bank-org','{}',ARRAY['foreign-doctor'],gen_random_uuid()); RAISE EXCEPTION 'FAIL: foreign export'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 snapshot:=public.nv_doctor_rqes('directory-1');
 PERFORM public.nv_doctor_rqes('directory-1','[{"number":"33333","specialty":"Pediatria"},{"number":"22222","specialty":null}]',snapshot->>'revision');
 IF jsonb_array_length(public.nv_doctor_rqes('directory-1')->'entries')<>2 OR (SELECT rqe FROM public.doctors WHERE id='directory-1')<>'654321' THEN RAISE EXCEPTION 'FAIL: structured RQEs or legacy retention'; END IF;
 BEGIN PERFORM public.nv_doctor_rqes('directory-1','[]',snapshot->>'revision'); RAISE EXCEPTION 'FAIL: stale RQE write'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 targets:=jsonb_build_array(jsonb_build_object('id','nv-bank-doctor','revision',(SELECT updated_at FROM public.doctors WHERE id='nv-bank-doctor')),
  jsonb_build_object('id','directory-4','revision',(SELECT updated_at FROM public.doctors WHERE id='directory-4')));
 result:=public.nv_doctor_directory_bulk('nv-bank-org',gen_random_uuid(),'request_documents',targets);
 IF result->0->>'result'<>'success' OR result->1->>'result'<>'no_portal_account' THEN RAISE EXCEPTION 'FAIL: internal document requests %',result; END IF;
 PERFORM public.nv_save_account_preferences('{"doctorListing":{"pageSize":50,"sort":"crm","descending":true,"columns":["crm","status"]}}');
 IF public.nv_account_preferences()->'doctorListing'->>'pageSize'<>'50' THEN RAISE EXCEPTION 'FAIL: preferences'; END IF;
 BEGIN PERFORM public.nv_save_account_preferences('{"doctorListing":{"pageSize":1000,"sort":"name","descending":false,"columns":[]}}'); RAISE EXCEPTION 'FAIL: preference validation'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
-- A thousand extra synthetic doctors exercise the metadata aggregates without file reads.
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status)
 SELECT 'directory-scale-'||n,'nv-bank-org','Médico Fictício', (910000+n)::text,'SP','Cirurgia','pending' FROM generate_series(1,1000) n;
ANALYZE public.doctors;
ANALYZE public.medical_documents;
ANALYZE public.doctor_rqes;
SET LOCAL client_min_messages=notice;
SET LOCAL ROLE authenticated;
DO $$ DECLARE started timestamptz:=clock_timestamp(); result jsonb; elapsed numeric; BEGIN
 result:=public.nv_doctor_directory('nv-bank-org','{}',1,25);
 elapsed:=round((extract(epoch FROM clock_timestamp()-started)*1000)::numeric,1);
 IF jsonb_array_length(result->'rows')<>25 OR (result->>'total')::int<1123 THEN RAISE EXCEPTION 'FAIL: large directory'; END IF;
 IF elapsed>5000 THEN RAISE EXCEPTION 'FAIL: directory performance regression: % ms',elapsed; END IF;
 RAISE NOTICE 'PASS: directory benchmark: % doctors, 25 rows, % ms, % bytes JSON.',result->>'total',elapsed,octet_length(result::text);
 started:=clock_timestamp();
 result:=public.nv_doctor_directory('nv-bank-org','{"q":"medico","specialty":"Cirurgia","rqe":"without","documents":"pending"}',1,25,'pending',true);
 elapsed:=round((extract(epoch FROM clock_timestamp()-started)*1000)::numeric,1);
 IF (result->>'total')::int<1000 OR elapsed>5000 THEN RAISE EXCEPTION 'FAIL: filtered performance regression: % ms',elapsed; END IF;
 RAISE NOTICE 'PASS: filtered directory benchmark: % matches, % ms.',result->>'total',elapsed;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET additional_permissions='{"documentos.view":"deny","escala.view":"deny","portal_medico.view":"deny"}' WHERE id='nv-bank-admin';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.nv_doctor_directory('nv-bank-org');
 IF EXISTS(SELECT FROM jsonb_array_elements(result->'rows') r WHERE r->'documents'<>'null' OR r->'portalStatus'<>'null' OR r->'units'<>'[]') THEN RAISE EXCEPTION 'FAIL: granular redaction'; END IF;
 BEGIN PERFORM public.nv_doctor_directory('nv-bank-org','{"documents":"pending"}'); RAISE EXCEPTION 'FAIL: denied document filter'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.doctor_profile_audit WHERE doctor_id='directory-1' AND details->>'status'='inactive')<>1 THEN RAISE EXCEPTION 'FAIL: duplicate or missing audit'; END IF;
 IF EXISTS(SELECT FROM directory_preserve p WHERE p.shifts IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.shifts x)
  OR p.auth IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM auth.users x)
  OR p.access IS DISTINCT FROM (SELECT count(*) FROM public.doctor_access_operations)) THEN RAISE EXCEPTION 'FAIL: historical links or access changed'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_doctor_rqes('directory-1','[]','invalid'); RAISE EXCEPTION 'FAIL: RQE write without MFA'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_doctor_directory('nv-bank-org'); RAISE EXCEPTION 'FAIL: physician accessed staff directory'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_rqes('directory-1'); RAISE EXCEPTION 'FAIL: physician accessed peer qualifications'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_doctor_directory('nv-bank-org'); RAISE EXCEPTION 'FAIL: other tenant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
