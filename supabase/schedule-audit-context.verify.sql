-- Synthetic transactional integration tests. Never run against production.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('37000000-0000-4000-8000-000000000001','master-admin@example.invalid'),
 ('37000000-0000-4000-8000-000000000002','master-reader@example.invalid'),
 ('37000000-0000-4000-8000-000000000003','master-doctor@example.invalid'),
 ('37000000-0000-4000-8000-000000000004','master-other@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('master-org','Master sintética','{"specialties":["Cirurgia"],"requiredDocuments":[]}'),
 ('master-other','Outra empresa','{"specialties":["Cirurgia"]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('master-admin','37000000-0000-4000-8000-000000000001','Direção','master-admin@example.invalid','tenant_user','master-org','Diretor'),
 ('master-reader','37000000-0000-4000-8000-000000000002','Leitura','master-reader@example.invalid','tenant_user','master-org','Financeiro'),
 ('master-other-user','37000000-0000-4000-8000-000000000004','Outra direção','master-other@example.invalid','tenant_user','master-other','Diretor');
INSERT INTO public.units(id,organization_id,name,type) VALUES('master-unit','master-org','Hospital','hospital');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty,required_doctors,coverage_periods) VALUES
 ('master-sector','master-org','master-unit','Cirurgia',ARRAY['Cirurgia'],'Cirurgia',4,
 '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":3},{"kind":"night","startTime":"19:00","endTime":"07:00","requiredDoctors":1}]');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units) VALUES
 ('master-doctor','master-org','Fixo','370001','SP','52998224725','master-doctor@example.invalid','Cirurgia','active',ARRAY['master-unit']),
 ('master-cover','master-org','Substituto','370002','SP','11144477735','master-cover@example.invalid','Cirurgia','active',ARRAY['master-unit']);
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,submitted_name,submitted_phone,requested_specialties,approved_specialties,status)
 SELECT id,organization_id,CASE WHEN id='master-doctor' THEN '37000000-0000-4000-8000-000000000003'::uuid END,
 '1980-01-01','synthetic',name,'11999999999',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved' FROM public.doctors WHERE id IN('master-doctor','master-cover');
CREATE FUNCTION pg_temp.master_spec() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('doctor_id','master-doctor','unit_id','master-unit','sector_id','master-sector','specialty','Cirurgia',
  'start_time','07:00','end_time','19:00','employment_type','clt','type','onsite','frequency','weeks','interval_weeks',1,
  'weekdays',jsonb_build_array(extract(dow FROM current_date+1)::integer),'start_date',current_date+1,'anchor_date',current_date+1,'end_date',current_date+40);
$$;
-- Exercise the real Master/shift RPCs and the existing canonical audit.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb;BEGIN
 result:=public.nv_master_save_rule('master-org',NULL,pg_temp.master_spec()||jsonb_build_object('end_date',current_date+100),0,current_date+1,1,NULL,false);
 PERFORM set_config('nvtest.context_rule',result->>'id',true);
END $$;
SET CONSTRAINTS zzzz_nv_schedule_audit_flush, zzzz_nv_master_rule_audit_flush, zzzz_nv_absence_audit_flush IMMEDIATE;
DO $$ DECLARE item jsonb;BEGIN
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.doctor_id='master-doctor' ORDER BY s.date LIMIT 1;
 PERFORM set_config('nvtest.context_shift',item->>'id',true);
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item||'{"start_time":"08:00"}'));
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.master_schedule_audit WHERE organization_id='master-org' AND details->>'correlation_id' IS DISTINCT FROM txid_current()::text) THEN RAISE EXCEPTION 'FAIL server transaction correlation';END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE shift_id=current_setting('nvtest.context_shift') AND details->>'organization'='Master sintética' AND details->>'unit'='Hospital' AND details->>'sector'='Cirurgia') THEN RAISE EXCEPTION 'FAIL immutable display scope';END IF;
END $$;
-- Current permissions, not grants cached at form opening, govern the write.
UPDATE public.user_accounts SET additional_permissions='{"escala.edit":"deny"}' WHERE id='master-admin';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_save_operational_shifts(jsonb_build_array(jsonb_build_object('id',current_setting('nvtest.context_shift'),'organization_id','master-org','notes','DENIED')));RAISE EXCEPTION 'FAIL revoked permission write';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET additional_permissions='{}',name='Direção atualizada' WHERE id='master-admin';
UPDATE public.units SET name='Hospital renomeado' WHERE id='master-unit';
SET LOCAL ROLE authenticated;
DO $$ DECLARE item jsonb;result jsonb;BEGIN
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.id=current_setting('nvtest.context_shift');
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item||'{"start_time":"09:00"}'));
 result:=public.nv_schedule_history('master-org','master-unit',ARRAY['master-sector']);
 IF jsonb_array_length(result->'actors')<>1 OR result->'actors'->0->>'name'<>'Direção atualizada' THEN RAISE EXCEPTION 'FAIL actor dropdown deduplication';END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(result->'items') entry WHERE entry->>'actor_name'='Direção' AND entry->>'unit'='Hospital') THEN RAISE EXCEPTION 'FAIL old actor/unit snapshot changed';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(result->'items') entry WHERE entry->>'organization_id'<>'master-org' OR entry->>'correlation_id' IS NULL) THEN RAISE EXCEPTION 'FAIL returned correlation/company';END IF;
 result:=public.nv_schedule_history('master-org',shift_filter=>current_setting('nvtest.context_shift'),page_size=>1);
 IF jsonb_array_length(result->'items')<>1 OR NOT (result->>'has_more')::boolean THEN RAISE EXCEPTION 'FAIL correlated history pagination';END IF;
END $$;
-- The owner-only import marker is audit context, never Master write capability.
RESET ROLE;
SELECT nv_master_private.begin_schedule_import('master-org');
UPDATE public.shifts SET notes='PRIVATE-IMPORT-NOTE' WHERE id=current_setting('nvtest.context_shift');
DO $$ BEGIN
 IF EXISTS(SELECT FROM nv_master_private.write_context WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'FAIL import added a write capability';END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE shift_id=current_setting('nvtest.context_shift') AND origin='import' AND next->>'private_note_updated'='true') THEN RAISE EXCEPTION 'FAIL import attribution';END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_occurrences WHERE shift_id=current_setting('nvtest.context_shift') AND state='manual') THEN RAISE EXCEPTION 'FAIL import bypassed manual exception handling';END IF;
 IF EXISTS(SELECT FROM public.master_schedule_audit WHERE previous::text LIKE '%PRIVATE-IMPORT-NOTE%' OR next::text LIKE '%PRIVATE-IMPORT-NOTE%') THEN RAISE EXCEPTION 'FAIL import private content';END IF;
END $$;
SET CONSTRAINTS nv_master_private.zzzz_nv_import_audit_cleanup IMMEDIATE;
DO $$ BEGIN IF EXISTS(SELECT FROM nv_master_private.audit_pending WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'FAIL import context not consumed';END IF;END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('nv.schedule_origin','import',true);
DO $$ DECLARE item jsonb;BEGIN
 BEGIN PERFORM nv_master_private.begin_schedule_import('master-org');RAISE EXCEPTION 'FAIL public import context';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.id=current_setting('nvtest.context_shift');
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item||'{"notes":"NORMAL-PRIVATE-NOTE"}'));
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT origin FROM public.master_schedule_audit WHERE shift_id=current_setting('nvtest.context_shift') ORDER BY id DESC LIMIT 1)<>'manual' THEN RAISE EXCEPTION 'FAIL forged import source';END IF;
END $$;
-- Absence scope is a snapshot; later movement of the doctor's recurrence cannot
-- make an earlier absence disappear from its original unit's history.
SET LOCAL ROLE authenticated;
DO $$ DECLARE spec jsonb;preview jsonb;result jsonb;BEGIN
 spec:=jsonb_build_object('doctor_id','master-doctor','kind','vacation','start_date',current_date+500,'end_date',current_date+501);
 preview:=public.nv_master_preview_absence('master-org',spec,NULL,false);
 result:=public.nv_master_apply_absence('master-org',spec,NULL,0,preview->>'token',false,true);
 PERFORM set_config('nvtest.context_absence',result->>'id',true);
END $$;
RESET ROLE;
INSERT INTO public.units(id,organization_id,name,type) VALUES('context-new-unit','master-org','Outra unidade','hospital');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty,required_doctors,default_start_time,default_end_time)
 VALUES('context-new-sector','master-org','context-new-unit','Novo setor',ARRAY['Cirurgia'],'Cirurgia',3,'07:00','19:00');
UPDATE public.doctors SET linked_units=ARRAY['master-unit','context-new-unit'] WHERE id='master-doctor';
SET LOCAL ROLE authenticated;
SELECT public.nv_master_save_rule('master-org',current_setting('nvtest.context_rule')::uuid,pg_temp.master_spec()||jsonb_build_object('unit_id','context-new-unit','sector_id','context-new-sector'),1,current_date+50,1,NULL,true);
DO $$ DECLARE result jsonb;BEGIN
 result:=public.nv_schedule_history('master-org','master-unit',ARRAY['master-sector'],action_filter=>'absence_created');
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(result->'items') entry WHERE entry->>'entity_id'=current_setting('nvtest.context_absence')) THEN RAISE EXCEPTION 'FAIL historical absence scope';END IF;
END $$;
-- Cron keeps its process identity and the same operation correlation, without
-- changing the worker or its grants in this migration.
RESET ROLE;
SELECT public.nv_master_generate_scheduled();
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE action='generation_scheduled' AND origin='cron' AND actor_id IS NULL AND actor_name IS NULL AND details->>'correlation_id'=txid_current()::text) THEN RAISE EXCEPTION 'FAIL automatic correlation/identity';END IF;
 IF has_function_privilege('authenticated','public.nv_master_generate_scheduled()','EXECUTE') OR NOT has_function_privilege('service_role','public.nv_master_generate_scheduled()','EXECUTE') THEN RAISE EXCEPTION 'FAIL worker grants changed';END IF;
END $$;
-- Audit insertion and the business change roll back together.
SELECT set_config('nvtest.context_audit_count',(SELECT count(*)::text FROM public.master_schedule_audit),true);
SAVEPOINT audit_atomicity;
UPDATE public.shifts SET notes='ROLLBACK-PRIVATE-NOTE' WHERE id=current_setting('nvtest.context_shift');
ROLLBACK TO SAVEPOINT audit_atomicity;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.master_schedule_audit)<>current_setting('nvtest.context_audit_count')::integer OR EXISTS(SELECT FROM public.shifts WHERE notes='ROLLBACK-PRIVATE-NOTE') THEN RAISE EXCEPTION 'FAIL transactional audit rollback';END IF;
END $$;
-- The history read model never grants access to Portal profiles or other tenants.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_schedule_history('master-org');RAISE EXCEPTION 'FAIL medical history';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_schedule_history('master-org');RAISE EXCEPTION 'FAIL other company history';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
ROLLBACK;
