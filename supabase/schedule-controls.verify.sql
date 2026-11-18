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
-- Strict profile boundaries cannot be overridden by generic grants or action grants.
DO $$ DECLARE role text;action text;BEGIN
 FOREACH role IN ARRAY ARRAY['Médico','Coordenador Médico','Medico','Unknown'] LOOP
  FOREACH action IN ARRAY ARRAY['view','create','edit','delete','approve','history'] LOOP
   IF public.nv_profile_action('tenant_user',role,'{"escala":"edit","escala.view":"allow","escala.edit":"allow","escala.create":"allow","escala.approve":"allow","escala.history":"allow"}', 'escala',action) THEN RAISE EXCEPTION 'FAIL physician administrative grant: % %',role,action; END IF;
  END LOOP;
 END LOOP;
 IF public.nv_profile_action('tenant_user','Escalista','{"escala.edit":"deny","escala.create":"allow","escala.approve":"allow"}','escala','create') THEN RAISE EXCEPTION 'FAIL write without edit'; END IF;
 IF public.nv_profile_action('tenant_user','Escalista','{}','escala','history') THEN RAISE EXCEPTION 'FAIL implicit audit grant'; END IF;
 IF NOT public.nv_profile_action('tenant_user','Escalista','{"escala.history":"allow"}','escala','history') THEN RAISE EXCEPTION 'FAIL explicit administrative audit grant'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb;BEGIN
 result:=public.nv_master_save_rule('master-org',NULL,pg_temp.master_spec()||jsonb_build_object('end_date',current_date+100),0,current_date+1,1,NULL,false);
 PERFORM set_config('nvtest.control_rule',result->>'id',true);
END $$;
SET CONSTRAINTS zzzz_nv_schedule_audit_flush, zzzz_nv_master_rule_audit_flush, zzzz_nv_absence_audit_flush IMMEDIATE;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.master_schedule_audit WHERE organization_id='master-org' AND action='rule_created')<>1 THEN RAISE EXCEPTION 'FAIL duplicated rule audit'; END IF;
 IF EXISTS(SELECT FROM public.master_schedule_audit WHERE organization_id='master-org' AND action='occurrence_generated') THEN RAISE EXCEPTION 'FAIL duplicate legacy occurrence audit'; END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE organization_id='master-org' AND action='shift_created' AND actor_name='Direção' AND actor_role='Diretor' AND origin='master' AND next->>'doctor'='Fixo') THEN RAISE EXCEPTION 'FAIL actor snapshot / generation origin'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE item jsonb; result jsonb; shift text;BEGIN
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.doctor_id='master-doctor' ORDER BY s.date LIMIT 1;
 shift:=item->>'id';PERFORM set_config('nvtest.control_shift',shift,true);
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item||'{"start_time":"08:00","notes":"SECRET-NOTE-MUST-NOT-BE-AUDITED"}'));
 result:=public.nv_schedule_history('master-org','master-unit',ARRAY['master-sector'],NULL,NULL,NULL,'shift_edited',shift);
 IF jsonb_array_length(result->'items')<>1 OR result->'items'->0->'previous'->>'start_time'<>'07:00' OR result->'items'->0->'next'->>'start_time'<>'08:00' THEN RAISE EXCEPTION 'FAIL old/new shift audit: %',result; END IF;
 IF result::text LIKE '%SECRET-NOTE%' OR result::text LIKE '%payment_agreement%' THEN RAISE EXCEPTION 'FAIL sensitive audit data'; END IF;
 result:=public.nv_schedule_history('master-org','master-unit',ARRAY['master-sector'],page_size=>1);
 IF jsonb_array_length(result->'items')<>1 OR (result->>'has_more')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL pagination'; END IF;
 result:=public.nv_schedule_history('master-org','master-unit',ARRAY['master-sector'],before_id=>(result->'items'->0->>'id')::bigint,page_size=>1);
 IF jsonb_array_length(result->'items')<>1 THEN RAISE EXCEPTION 'FAIL next audit page'; END IF;
 BEGIN PERFORM public.nv_schedule_history('master-other');RAISE EXCEPTION 'FAIL foreign audit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_master_overview_scoped('master-org','master-unit',ARRAY['foreign-sector']);RAISE EXCEPTION 'FAIL scoped sector isolation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 result:=public.nv_master_overview_scoped('master-org','master-unit',ARRAY[]::text[]);
 IF result->'rules'<>'[]'::jsonb OR result->'occurrences'<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL empty scope loads all';END IF;
END $$;
-- A change of absence kind is audited once, without its temporary cancellation
-- or the private note used while restoring assignments inside the same RPC.
DO $$ DECLARE spec jsonb;preview jsonb;result jsonb;BEGIN
 spec:=jsonb_build_object('doctor_id','master-doctor','kind','vacation','start_date',current_date+500,'end_date',current_date+501,'note','PRIVATE-ABSENCE-NOTE');
 preview:=public.nv_master_preview_absence('master-org',spec,NULL,false);
 result:=public.nv_master_apply_absence('master-org',spec,NULL,0,preview->>'token',false,true);
 PERFORM set_config('nvtest.control_absence',result->>'id',true);
END $$;
SET CONSTRAINTS zzzz_nv_schedule_audit_flush, zzzz_nv_master_rule_audit_flush, zzzz_nv_absence_audit_flush DEFERRED;
DO $$ DECLARE spec jsonb;preview jsonb;BEGIN
 spec:=jsonb_build_object('doctor_id','master-doctor','kind','leave','start_date',current_date+500,'end_date',current_date+501,'note','PRIVATE-ABSENCE-NOTE');
 preview:=public.nv_master_preview_absence('master-org',spec,current_setting('nvtest.control_absence')::uuid,false);
 PERFORM public.nv_master_apply_absence('master-org',spec,current_setting('nvtest.control_absence')::uuid,1,preview->>'token',false,true);
END $$;
SET CONSTRAINTS zzzz_nv_schedule_audit_flush, zzzz_nv_master_rule_audit_flush, zzzz_nv_absence_audit_flush IMMEDIATE;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.master_schedule_audit WHERE entity_id=current_setting('nvtest.control_absence') AND action='absence_edited' AND previous->>'kind'='vacation' AND next->>'kind'='leave')<>1 THEN RAISE EXCEPTION 'FAIL coalesced absence change';END IF;
 IF EXISTS(SELECT FROM public.master_schedule_audit WHERE entity_id=current_setting('nvtest.control_absence') AND action='absence_cancelled') THEN RAISE EXCEPTION 'FAIL temporary cancellation logged';END IF;
 IF EXISTS(SELECT FROM public.master_schedule_audit WHERE entity_id=current_setting('nvtest.control_absence') AND (previous::text LIKE '%PRIVATE-ABSENCE-NOTE%' OR next::text LIKE '%PRIVATE-ABSENCE-NOTE%')) THEN RAISE EXCEPTION 'FAIL private absence content';END IF;
END $$;
-- Portal doctors and their medical coordinator role have no administrative write/audit path.
RESET ROLE;
UPDATE public.doctor_enrollments SET portal_role='Coordenador Médico' WHERE doctor_id='master-doctor';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_master_save_rule('master-org',NULL,pg_temp.master_spec(),0,current_date+1,1,NULL,false);RAISE EXCEPTION 'FAIL medical coordinator rule write';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.master_spec()||jsonb_build_object('id','forbidden','organization_id','master-org','date',current_date+1)));RAISE EXCEPTION 'FAIL physician operational RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.nv_schedule_history('master-org');RAISE EXCEPTION 'FAIL physician audit';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.shifts SET start_time='06:00' WHERE id=current_setting('nvtest.control_shift');RAISE EXCEPTION 'FAIL physician direct update';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF public.nv_shift_history(current_setting('nvtest.control_shift'))<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL old audit bypass';END IF;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET role='Escalista' WHERE id='master-reader';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_schedule_history('master-org');RAISE EXCEPTION 'FAIL missing specific audit permission';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 IF public.nv_master_overview('master-org')->'audit'<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL Master administrative audit bypass';END IF;
 IF public.nv_master_shift_context(ARRAY[current_setting('nvtest.control_shift')])->0->'history'<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL origin administrative audit bypass';END IF;
 BEGIN DELETE FROM public.master_schedule_audit;RAISE EXCEPTION 'FAIL audit mutation';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
-- Cron runs under process identity, even if a human session invokes the owner-only function.
UPDATE public.master_schedule_rules SET horizon_months=3 WHERE id=current_setting('nvtest.control_rule')::uuid;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_master_generate_scheduled();
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.master_schedule_audit WHERE organization_id='master-org' AND action='generation_scheduled' AND actor_id IS NOT NULL) THEN RAISE EXCEPTION 'FAIL Cron attributed to human';END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE organization_id='master-org' AND action='generation_scheduled' AND origin='cron' AND actor_id IS NULL) THEN RAISE EXCEPTION 'FAIL process audit';END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE organization_id='master-org' AND action='shift_created' AND origin='cron' AND actor_id IS NULL) THEN RAISE EXCEPTION 'FAIL generated shift process identity';END IF;
 IF EXISTS(SELECT FROM nv_master_private.audit_pending WHERE transaction_id=txid_current()) THEN RAISE EXCEPTION 'FAIL pending audit not consumed';END IF;
END $$;
-- Portal applications and exchange requests still use their own validated flows.
INSERT INTO auth.users(id,email) VALUES('37000000-0000-4000-8000-000000000005','master-cover@example.invalid');
UPDATE public.doctor_enrollments SET auth_user_id='37000000-0000-4000-8000-000000000005' WHERE doctor_id='master-cover';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_save_operational_shifts(jsonb_build_array(pg_temp.master_spec()||jsonb_build_object('id','control-portal-vacancy','organization_id','master-org','doctor_id',NULL,'date',current_date+2,'status','open')));
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT public.nv_apply_for_shift('control-portal-vacancy');
RESET ROLE;
SELECT set_config('nvtest.control_opportunity',(SELECT id::text FROM public.shift_opportunities WHERE shift_id='control-portal-vacancy' AND status='open'),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_select_shift_candidate(current_setting('nvtest.control_opportunity')::uuid,'master-doctor','clt','',NULL);
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT public.nv_request_exchange('control-portal-vacancy');
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
SELECT public.nv_apply_for_shift('control-portal-vacancy');
RESET ROLE;
SELECT set_config('nvtest.control_opportunity',(SELECT id::text FROM public.shift_opportunities WHERE shift_id='control-portal-vacancy' AND status='open'),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_select_shift_candidate(current_setting('nvtest.control_opportunity')::uuid,'master-cover','clt','',NULL);
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.shifts WHERE id='control-portal-vacancy' AND doctor_id='master-cover' AND status='confirmed') THEN RAISE EXCEPTION 'FAIL portal exchange compatibility';END IF;
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE shift_id='control-portal-vacancy' AND action='doctor_replaced' AND origin='approval') THEN RAISE EXCEPTION 'FAIL approval audit';END IF;
END $$;
-- Batch availability uses real application conditions, including unpublished
-- Master coverage. Unoccupied alone is insufficient; no business data is changed.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_save_operational_shifts(jsonb_build_array(
 pg_temp.master_spec()||jsonb_build_object('id','control-available','organization_id','master-org','doctor_id',NULL,'date',current_date+4,'status','open'),
 pg_temp.master_spec()||jsonb_build_object('id','control-unpublished','organization_id','master-org','doctor_id',NULL,'date',current_date+4,'status','open'),
 pg_temp.master_spec()||jsonb_build_object('id','control-expired','organization_id','master-org','doctor_id',NULL,'date',current_date-1,'status','open'),
 pg_temp.master_spec()||jsonb_build_object('id','control-cancelled','organization_id','master-org','doctor_id',NULL,'date',current_date+4,'status','cancelled')
));
RESET ROLE;
INSERT INTO public.master_coverage_publication(shift_id,enabled) VALUES('control-unpublished',false);
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;BEGIN
 result:=public.nv_schedule_available_vacancies('master-org');
 IF NOT result ? 'control-available' OR result ?| ARRAY['control-unpublished','control-expired','control-cancelled','control-portal-vacancy'] THEN RAISE EXCEPTION 'FAIL availability projection: %',result;END IF;
 BEGIN PERFORM public.nv_schedule_available_vacancies('master-other');RAISE EXCEPTION 'FAIL foreign availability';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_schedule_available_vacancies('master-org');RAISE EXCEPTION 'FAIL physician administrative availability';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
UPDATE public.master_coverage_publication SET enabled=true WHERE shift_id='control-unpublished';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
 IF NOT public.nv_schedule_available_vacancies('master-org') ? 'control-unpublished' THEN RAISE EXCEPTION 'FAIL published availability refresh';END IF;
END $$;
ROLLBACK;
