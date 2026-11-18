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
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; report jsonb; rule uuid;
BEGIN
 result:=public.nv_master_save_rule('master-org',NULL,pg_temp.master_spec(),0,current_date+1,2,NULL,false);
 rule:=(result->>'id')::uuid;
 PERFORM set_config('nvtest.rule',rule::text,true);
 IF (result->'generation'->>'generated')::integer<>6 THEN RAISE EXCEPTION 'FAIL weekly generation: %',result; END IF;
 report:=public.nv_master_generate('master-org',rule);
 IF (report->>'generated')::integer<>0 OR (report->>'preserved')::integer<>6 THEN RAISE EXCEPTION 'FAIL idempotence: %',report; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.master_schedule_occurrences WHERE rule_id=current_setting('nvtest.rule')::uuid)<>6 THEN RAISE EXCEPTION 'FAIL occurrence uniqueness'; END IF;
 IF EXISTS(SELECT FROM public.shifts WHERE organization_id='master-org' AND payment_amount IS NOT NULL) THEN RAISE EXCEPTION 'FAIL CLT finance'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE spec jsonb; preview jsonb; result jsonb;
BEGIN
 spec:=jsonb_build_object('doctor_id','master-doctor','kind','vacation','start_date',current_date+1,'end_date',current_date+15,'start_time',NULL,'end_time',NULL,'note','Informação privada sintética');
 preview:=public.nv_master_preview_absence('master-org',spec,NULL,false);
 IF jsonb_array_length(preview->'impacts')<>3 THEN RAISE EXCEPTION 'FAIL absence preview: %',preview; END IF;
 result:=public.nv_master_apply_absence('master-org',spec,NULL,0,preview->>'token',false,true);
 PERFORM set_config('nvtest.absence',result->>'id',true);
 IF (result->>'changed')::integer<>3 THEN RAISE EXCEPTION 'FAIL absence application: %',result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.shifts WHERE organization_id='master-org' AND doctor_id IS NULL)<>3 THEN RAISE EXCEPTION 'FAIL vacancies'; END IF;
 IF (SELECT count(*) FROM public.master_schedule_rules WHERE status='active' AND organization_id='master-org')<>1 THEN RAISE EXCEPTION 'FAIL recurrence preserved'; END IF;
 IF EXISTS(SELECT FROM public.shifts WHERE organization_id='master-org' AND notes LIKE '%privada%') THEN RAISE EXCEPTION 'FAIL absence privacy'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ DECLARE shift text; record jsonb; result jsonb; preview jsonb;
BEGIN
 SELECT id INTO shift FROM public.nv_staff_shifts WHERE organization_id='master-org' AND doctor_id IS NULL ORDER BY date LIMIT 1;
 SELECT to_jsonb(s) INTO record FROM public.nv_staff_shifts s WHERE s.id=shift;
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(record||'{"doctor_id":"master-cover","status":"confirmed"}'));
 PERFORM set_config('nvtest.covered',shift,true);
 preview:=public.nv_master_preview_absence('master-org','{}',current_setting('nvtest.absence')::uuid,true);
 result:=public.nv_master_apply_absence('master-org','{}',current_setting('nvtest.absence')::uuid,1,preview->>'token',true,true);
 IF (result->>'changed')::integer<>2 THEN RAISE EXCEPTION 'FAIL cancellation restore: %',result; END IF;
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id=shift AND doctor_id='master-cover') THEN RAISE EXCEPTION 'FAIL substitute overwritten'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE overview jsonb; BEGIN
 overview:=public.nv_master_overview('master-org');
 IF jsonb_array_length(overview->'absences')<>0 THEN RAISE EXCEPTION 'FAIL administrative absence privacy'; END IF;
 BEGIN PERFORM public.nv_master_generate('master-org'); RAISE EXCEPTION 'FAIL viewer write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_master_overview('master-other'); RAISE EXCEPTION 'FAIL foreign company'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_master_generate_scheduled(); RAISE EXCEPTION 'FAIL worker grant'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.doctor_absences; RAISE EXCEPTION 'FAIL direct absence table'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN IF jsonb_array_length(public.nv_master_my_absences())<>1 THEN RAISE EXCEPTION 'FAIL own absence portal'; END IF; END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
 IF public.nv_master_my_absences()<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL another physician privacy'; END IF;
 IF public.nv_master_shift_context(ARRAY[current_setting('nvtest.covered')])<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL foreign shift context'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ DECLARE before_count integer; BEGIN
 SELECT count(*) INTO before_count FROM public.shifts WHERE organization_id='master-org';
 PERFORM public.nv_master_generate_scheduled();
 IF (SELECT count(*) FROM public.shifts WHERE organization_id='master-org')<>before_count THEN RAISE EXCEPTION 'FAIL scheduled duplication'; END IF;
END $$;
-- Additional recurrence, overnight, finance, manual exception and publication cases.
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty,required_doctors,coverage_periods) VALUES
 ('master-test-sector','master-org','master-unit','Testes',ARRAY['Cirurgia'],'Cirurgia',20,
 '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":10},{"kind":"night","startTime":"19:00","endTime":"07:00","requiredDoctors":10}]');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,email,specialty,status,linked_units)
 SELECT 'master-extra-'||n,'master-org','Fixo sintético '||n,'37900'||n,'SP','extra-'||n||'@example.invalid','Cirurgia','active',ARRAY['master-unit'] FROM generate_series(1,8) n;
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,birth_date,pix_key,submitted_name,submitted_phone,requested_specialties,approved_specialties,status)
 SELECT id,organization_id,'1980-01-01','synthetic',name,'11999999999',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved'
 FROM public.doctors WHERE id LIKE 'master-extra-%';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE spec jsonb; result jsonb; rule uuid; overview jsonb; first_day date:=current_date+1;
BEGIN
 -- Every two weeks uses a stable reference across months/years.
 spec:=pg_temp.master_spec()||jsonb_build_object('doctor_id','master-extra-1','sector_id','master-test-sector','interval_weeks',2,'end_date',current_date+100);
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,first_day,4,NULL,false);
 rule:=(result->>'id')::uuid;
 overview:=public.nv_master_overview('master-org');
 IF (SELECT count(*) FROM jsonb_array_elements(overview->'occurrences') o WHERE o->>'rule_id'=rule::text)<>8 THEN RAISE EXCEPTION 'FAIL fortnightly: %',result; END IF;
 -- Multiple weekdays share the same reference-week phase.
 spec:=pg_temp.master_spec()||jsonb_build_object('doctor_id','master-extra-2','sector_id','master-test-sector','weekdays',jsonb_build_array(extract(dow FROM first_day)::integer,extract(dow FROM first_day+2)::integer),'end_date',first_day+13);
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,first_day,2,NULL,false);
 IF (result->'generation'->>'generated')::integer<>4 THEN RAISE EXCEPTION 'FAIL multiple weekdays: %',result; END IF;
 -- Monthly ordinal-weekday occurrences cross years without drifting.
 spec:=pg_temp.master_spec()||jsonb_build_object('doctor_id','master-extra-3','sector_id','master-test-sector','frequency','monthly','end_date',current_date+180);
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,first_day,6,NULL,false);
 IF (result->'generation'->>'generated')::integer<4 THEN RAISE EXCEPTION 'FAIL monthly across years: %',result; END IF;
 -- A compatible manually created vacancy is reused, without converting an occupied legacy post.
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(pg_temp.master_spec()||jsonb_build_object('id','master-reusable','organization_id','master-org','sector_id','master-test-sector',
 'doctor_id',NULL,'date',current_date+4,'start_time','07:00','end_time','19:00','status','open')));
 spec:=pg_temp.master_spec()||jsonb_build_object('doctor_id','master-extra-4','sector_id','master-test-sector','start_date',current_date+4,'anchor_date',current_date+4,'end_date',current_date+4,'weekdays',jsonb_build_array(extract(dow FROM current_date+4)::integer));
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,current_date+4,1,NULL,false);
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='master-reusable' AND doctor_id='master-extra-4') THEN RAISE EXCEPTION 'FAIL compatible vacancy reuse'; END IF;
 PERFORM set_config('nvtest.reused_rule',result->>'id',true);
 -- An absence is registered before the future horizon reaches an overnight shift.
 spec:=pg_temp.master_spec()||jsonb_build_object('doctor_id','master-extra-5','sector_id','master-test-sector','start_date',current_date+90,'anchor_date',current_date+90,'end_date',current_date+90,
 'start_time','19:00','end_time','07:00','weekdays',jsonb_build_array(extract(dow FROM current_date+90)::integer));
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,current_date+90,1,NULL,false);
 PERFORM set_config('nvtest.night_rule',result->>'id',true);
 IF (result->'generation'->>'generated')::integer<>0 THEN RAISE EXCEPTION 'FAIL horizon bound'; END IF;
END $$;
DO $$ DECLARE spec jsonb; preview jsonb; result jsonb; rule public.master_schedule_rules;
BEGIN
 spec:=jsonb_build_object('doctor_id','master-extra-5','kind','unavailable','start_date',current_date+91,'end_date',current_date+91);
 preview:=public.nv_master_preview_absence('master-org',spec);
 IF jsonb_array_length(preview->'impacts')<>1 OR preview->'impacts'->0->>'action'<>'planned' THEN RAISE EXCEPTION 'FAIL planned overnight absence: %',preview; END IF;
 result:=public.nv_master_apply_absence('master-org',spec,NULL,0,preview->>'token',false,true);
 PERFORM set_config('nvtest.night_absence',result->>'id',true);
END $$;
RESET ROLE;
UPDATE public.master_schedule_rules SET horizon_months=6 WHERE id=current_setting('nvtest.night_rule')::uuid;
SELECT set_config('request.jwt.claims','{}',true);
SELECT public.nv_master_generate_scheduled();
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.master_schedule_occurrences o JOIN public.shifts s ON s.id=o.shift_id WHERE o.rule_id=current_setting('nvtest.night_rule')::uuid AND o.state='coverage' AND s.doctor_id IS NULL) THEN RAISE EXCEPTION 'FAIL absence before generation / overnight'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE spec jsonb; preview jsonb; result jsonb; record jsonb; shift text;
BEGIN
 -- A partial absence outside the shift does not vacate it.
 spec:=jsonb_build_object('doctor_id','master-extra-4','kind','leave','start_date',current_date+4,'end_date',current_date+4,'start_time','20:00','end_time','21:00');
 preview:=public.nv_master_preview_absence('master-org',spec);
 IF jsonb_array_length(preview->'impacts')<>0 THEN RAISE EXCEPTION 'FAIL partial non-overlap'; END IF;
 -- A partial absence inside the shift is identified and applied.
 spec:=spec||'{"start_time":"11:00","end_time":"12:00"}';
 preview:=public.nv_master_preview_absence('master-org',spec);
 IF jsonb_array_length(preview->'impacts')<>1 THEN RAISE EXCEPTION 'FAIL partial overlap'; END IF;
 result:=public.nv_master_apply_absence('master-org',spec,NULL,0,preview->>'token',false,true);
 PERFORM set_config('nvtest.partial_absence',result->>'id',true);
 -- Pending coverage is not offered, and a direct application cannot bypass that rule.
 PERFORM set_config('nvtest.pending_shift','master-reusable',true);
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date+1,current_date+30,false)) s WHERE s->>'id'='master-reusable') THEN RAISE EXCEPTION 'FAIL pending coverage exposed'; END IF;
 BEGIN PERFORM public.nv_apply_for_shift('master-reusable'); RAISE EXCEPTION 'FAIL direct application bypass'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_master_publish_coverage('master-reusable',true);
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date+1,current_date+30,false)) s WHERE s->>'id'='master-reusable') THEN RAISE EXCEPTION 'FAIL published offer missing'; END IF;
 PERFORM public.nv_apply_for_shift('master-reusable');
END $$;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_master_publish_coverage('master-reusable',false);
DO $$ DECLARE spec jsonb; preview jsonb; record jsonb; shift text;
BEGIN
 -- Any intervening edit invalidates the administrative preview.
 spec:=jsonb_build_object('doctor_id','master-extra-1','kind','vacation','start_date',current_date+1,'end_date',current_date+1);
 preview:=public.nv_master_preview_absence('master-org',spec);
 SELECT to_jsonb(s) INTO record FROM public.nv_staff_shifts s WHERE s.doctor_id='master-extra-1' AND s.date=current_date+1;
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(record||'{"notes":"Alteração manual após a prévia"}'));
 BEGIN PERFORM public.nv_master_apply_absence('master-org',spec,NULL,0,preview->>'token',false,true); RAISE EXCEPTION 'FAIL stale preview'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 -- A direct assignment of an unavailable physician is blocked by the shared shift trigger.
 SELECT to_jsonb(s) INTO record FROM public.nv_staff_shifts s WHERE id='master-reusable';
 BEGIN PERFORM public.nv_save_operational_shifts(jsonb_build_array(record||'{"doctor_id":"master-extra-4","status":"confirmed"}')); RAISE EXCEPTION 'FAIL absent direct assignment'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 -- Suspend/end decisions preserve manually adjusted or substituted occurrences.
 PERFORM public.nv_master_rule_status(current_setting('nvtest.reused_rule')::uuid,'suspended',1,'keep',true);
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='master-reusable') THEN RAISE EXCEPTION 'FAIL suspend removed post'; END IF;
END $$;
-- Approved financial templates work without impersonating a user in the daily worker.
DO $$ DECLARE spec jsonb; rate jsonb; agreement jsonb; result jsonb;
BEGIN
 PERFORM public.nv_save_payment_terms('master-org',20,1,'last_day','none',ARRAY[]::date[]);
 rate:=public.nv_save_shift_rate('master-org',NULL,'{"amount_cents":150000,"active":true}');
 agreement:=jsonb_build_object('mode','default','frequency','monthly','rate_id',rate->>'id','rate_cents',150000);
 spec:=pg_temp.master_spec()||jsonb_build_object('doctor_id','master-extra-6','sector_id','master-test-sector','start_date',current_date+90,'anchor_date',current_date+90,'end_date',current_date+90,
 'employment_type','pj','employer_name','Empresa sintética','weekdays',jsonb_build_array(extract(dow FROM current_date+90)::integer));
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,current_date+90,1,agreement,false);
 PERFORM set_config('nvtest.pj_rule',result->>'id',true);
END $$;
RESET ROLE;
UPDATE public.master_schedule_rules SET horizon_months=6 WHERE id=current_setting('nvtest.pj_rule')::uuid;
SELECT set_config('request.jwt.claims','{}',true);
SELECT public.nv_master_generate_scheduled();
DO $$ DECLARE item public.shifts; before_count integer;
BEGIN
 SELECT s.* INTO item FROM public.shifts s JOIN public.master_schedule_occurrences o ON o.shift_id=s.id WHERE o.rule_id=current_setting('nvtest.pj_rule')::uuid;
 IF item.doctor_id IS DISTINCT FROM 'master-extra-6' OR item.payment_amount IS DISTINCT FROM 1500 OR item.payment_agreement IS NULL OR item.payment_due_date IS NULL THEN RAISE EXCEPTION 'FAIL scheduled PJ snapshot: %',to_jsonb(item); END IF;
 SELECT count(*) INTO before_count FROM public.shifts WHERE organization_id='master-org';
 PERFORM public.nv_master_generate_scheduled();
 IF (SELECT count(*) FROM public.shifts WHERE organization_id='master-org')<>before_count THEN RAISE EXCEPTION 'FAIL duplicate financial obligation'; END IF;
END $$;
-- Manual edits and deletion tombstones survive regeneration; paid occurrences cannot be rewritten.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE record jsonb; shift text; result jsonb;
BEGIN
 SELECT to_jsonb(s) INTO record FROM public.nv_staff_shifts s WHERE s.doctor_id='master-extra-1' AND s.date=current_date+1;
 shift:=record->>'id';
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(record||'{"start_time":"08:00"}'));
 PERFORM public.nv_master_generate('master-org');
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id=shift AND start_time='08:00') THEN RAISE EXCEPTION 'FAIL manual time overwritten'; END IF;
 SELECT id INTO shift FROM public.nv_staff_shifts WHERE doctor_id='master-extra-1' AND date>current_date+10 ORDER BY date LIMIT 1;
 DELETE FROM public.shifts WHERE id=shift;
 PERFORM public.nv_master_generate('master-org');
 IF EXISTS(SELECT FROM public.nv_staff_shifts WHERE id=shift) THEN RAISE EXCEPTION 'FAIL deleted occurrence regenerated'; END IF;
 SELECT id INTO shift FROM public.nv_staff_shifts WHERE doctor_id='master-extra-6';
 PERFORM public.nv_update_shift_payment(shift,'paid');
 SELECT to_jsonb(s) INTO record FROM public.nv_staff_shifts s WHERE id=shift;
 BEGIN PERFORM public.nv_save_operational_shifts(jsonb_build_array(record||'{"start_time":"08:00"}')); RAISE EXCEPTION 'FAIL consolidated occurrence changed'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 result:=public.nv_edit_shift_agreement(shift,jsonb_build_object('mode','override','amount_cents',160000,'frequency','monthly',
  'rate_id',record->'payment_agreement'->'rate'->>'id','rate_cents',150000,'override_reason','Valor diferenciado sintético',
  'reason','Correção administrativa sintética','expected_amount_cents',150000,'expected_frequency','monthly',
  'expected_changed_at',record->'payment_agreement'->>'changed_at'),true);
 IF (result->>'payment_amount')::numeric IS DISTINCT FROM 1600 OR (result->>'paid_amount')::numeric IS DISTINCT FROM 1500
  OR result->>'payment_status'<>'paid' THEN RAISE EXCEPTION 'FAIL existing paid adjustment workflow'; END IF;
END $$;
RESET ROLE;
-- Future versions replace only clean future occurrences, retaining old source history.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE result jsonb; spec jsonb; old_shift text; rule uuid;
BEGIN
 spec:=pg_temp.master_spec()||'{"doctor_id":"master-extra-7","sector_id":"master-test-sector"}';
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,current_date+1,2,NULL,false);
 rule:=(result->>'id')::uuid;
 SELECT id INTO old_shift FROM public.nv_staff_shifts WHERE doctor_id='master-extra-7' AND date=current_date+15;
 result:=public.nv_master_save_rule('master-org',rule,spec||'{"start_time":"08:00"}',1,current_date+15,2,NULL,true);
 IF EXISTS(SELECT FROM public.nv_staff_shifts WHERE doctor_id='master-extra-7' AND status<>'cancelled'
  AND ((date<current_date+15 AND start_time<>'07:00') OR (date>=current_date+15 AND start_time<>'08:00'))) THEN RAISE EXCEPTION 'FAIL future rule boundary'; END IF;
 IF public.nv_master_shift_context(ARRAY[old_shift])->0->>'rule_id' IS DISTINCT FROM rule::text THEN RAISE EXCEPTION 'FAIL retired source history'; END IF;
 BEGIN PERFORM public.nv_master_save_rule('master-org',rule,spec,1,current_date+15,2,NULL,true); RAISE EXCEPTION 'FAIL stale rule revision'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 -- Explicit administrative confirmation is mandatory, even with a valid preview.
 spec:=jsonb_build_object('doctor_id','master-extra-7','kind','vacation','start_date',current_date+1,'end_date',current_date+8);
 result:=public.nv_master_preview_absence('master-org',spec);
 BEGIN PERFORM public.nv_master_apply_absence('master-org',spec,NULL,0,result->>'token',false,false); RAISE EXCEPTION 'FAIL missing confirmation'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 result:=public.nv_master_apply_absence('master-org',spec,NULL,0,result->>'token',false,true);
 PERFORM set_config('nvtest.edited_absence',result->>'id',true);
 spec:=spec||jsonb_build_object('start_date',current_date+8,'end_date',current_date+15);
 result:=public.nv_master_preview_absence('master-org',spec,current_setting('nvtest.edited_absence')::uuid);
 IF jsonb_array_length(result->'impacts')<>3 THEN RAISE EXCEPTION 'FAIL duplicate revised absence impacts: %',result; END IF;
 PERFORM public.nv_master_apply_absence('master-org',spec,current_setting('nvtest.edited_absence')::uuid,1,result->>'token',false,true);
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE doctor_id='master-extra-7' AND date=current_date+1 AND status<>'cancelled') THEN RAISE EXCEPTION 'FAIL revised absence did not restore old date'; END IF;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET role='Escalista' WHERE id='master-reader';
SET LOCAL ROLE authenticated;
DO $$ DECLARE spec jsonb; result jsonb; rule uuid; BEGIN
 -- A fixed recurrence must never adopt or displace an occupied ordinary assignment.
 spec:=pg_temp.master_spec()||'{"doctor_id":"master-extra-8","sector_id":"master-sector"}';
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(spec||jsonb_build_object('id','master-existing-occupied','organization_id','master-org','date',current_date+1,'status','confirmed')));
 spec:=spec||jsonb_build_object('end_date',current_date+1);
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,current_date+1,2,NULL,false);
 IF (result->'generation'->>'generated')::integer<>0 OR (result->'generation'->>'coverage')::integer<>0
  OR (result->'generation'->>'blocked')::integer<>1 THEN RAISE EXCEPTION 'FAIL identical legacy assignment duplicated'; END IF;
 spec:=spec||'{"sector_id":"master-test-sector"}';
 result:=public.nv_master_save_rule('master-org',NULL,spec,0,current_date+1,2,NULL,false);
 rule:=(result->>'id')::uuid;
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='master-existing-occupied' AND doctor_id='master-extra-8' AND status='confirmed') THEN RAISE EXCEPTION 'FAIL occupied legacy post displaced'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_master_overview('master-org')->'occurrences') o WHERE o->>'rule_id'=rule::text AND o->>'state'='coverage' AND o->>'shift_id'<>'master-existing-occupied') THEN RAISE EXCEPTION 'FAIL fixed conflict not signaled'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"37000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE overview jsonb; BEGIN
 overview:=public.nv_master_overview('master-org');
 IF EXISTS(SELECT FROM jsonb_array_elements(overview->'rules') r WHERE r->'finance'<>'null'::jsonb) THEN RAISE EXCEPTION 'FAIL financial template disclosure'; END IF;
 BEGIN PERFORM nv_master_private.internal_write('master-reusable'); RAISE EXCEPTION 'FAIL private capability access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_master_preview_absence('master-org','{}'); RAISE EXCEPTION 'FAIL unapproved absence'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Revoking a template author's permissions prevents unattended future assignments.
UPDATE auth.users SET raw_app_meta_data='{"must_change_password":true}' WHERE id='37000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF nv_master_private.actor_allowed('37000000-0000-4000-8000-000000000001','master-org',false) THEN RAISE EXCEPTION 'FAIL reset author permission'; END IF;
END $$;
UPDATE auth.users SET raw_app_meta_data='{}' WHERE id='37000000-0000-4000-8000-000000000001';
UPDATE public.user_accounts SET additional_permissions='{"escala.create":"deny"}' WHERE id='master-admin';
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
 IF nv_master_private.actor_allowed('37000000-0000-4000-8000-000000000001','master-org',false) THEN RAISE EXCEPTION 'FAIL revoked author permission'; END IF;
END $$;
ROLLBACK;
