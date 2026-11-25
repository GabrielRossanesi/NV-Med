-- Synthetic fixtures shared by two sessions in the disposable lab.
DO $$ BEGIN
  IF session_user !~ '^nvmed_[0-9a-f]{32}$' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Execute este teste somente no laboratório descartável.';
  END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('52000000-0000-4000-8000-000000000001','coverage-admin@example.invalid'),
 ('52000000-0000-4000-8000-000000000002','coverage-other@example.invalid'),
 ('52000000-0000-4000-8000-000000000003','coverage-doctor@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('coverage-org','Empresa sintética','{"specialties":["Cirurgia"]}'),
 ('coverage-other','Outra empresa','{"specialties":["Cirurgia"]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('coverage-admin','52000000-0000-4000-8000-000000000001','Direção','coverage-admin@example.invalid','tenant_user','coverage-org','Diretor'),
 ('coverage-other-user','52000000-0000-4000-8000-000000000002','Outra direção','coverage-other@example.invalid','tenant_user','coverage-other','Diretor');
INSERT INTO public.units(id,organization_id,name,type,time_zone)
VALUES ('coverage-unit','coverage-org','Hospital','hospital','America/Manaus');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty)
VALUES ('coverage-sector','coverage-org','coverage-unit','Cirurgia',ARRAY['Cirurgia'],'Cirurgia');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,linked_units) VALUES
 ('coverage-a','coverage-org','Médico A','521','AM','Cirurgia',ARRAY['coverage-unit']),
 ('coverage-b','coverage-org','Médico B','522','AM','Cirurgia',ARRAY['coverage-unit']);
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,
  submitted_name,submitted_phone,requested_specialties,approved_specialties,status)
VALUES ('coverage-a','coverage-org',NULL,'1985-01-01','test-a@example.invalid',
  'Médico A','11999990001',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved'),
 ('coverage-b','coverage-org','52000000-0000-4000-8000-000000000003','1985-01-01','test@example.invalid',
  'Médico B','11999990000',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved');
INSERT INTO public.doctor_banking(doctor_id,organization_id,pix_key,pix_key_type) VALUES
 ('coverage-a','coverage-org','coverage-a@example.invalid','email'),
 ('coverage-b','coverage-org','coverage-b@example.invalid','email');
INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,employment_type)
VALUES ('coverage-original','coverage-org','coverage-unit','coverage-sector','Cirurgia',current_date+30,'07:00','19:00','onsite','open','clt');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE source jsonb; changes jsonb; vacancy jsonb; version integer; first_gap text; queued jsonb; offers jsonb;
BEGIN
 SELECT to_jsonb(s) INTO source FROM public.nv_staff_shifts s WHERE s.id='coverage-original';
 changes:=public.nv_save_fractional_coverage(source||'{"doctor_id":"coverage-a","start_time":"08:00","end_time":"18:00"}','{"capacity":1}');
 IF jsonb_array_length(changes)<>3 OR NOT EXISTS(
  SELECT FROM jsonb_array_elements(changes) s WHERE s->>'id'='coverage-original'
    AND s->'coverage_post'->>'startTime'='07:00' AND s->'coverage_post'->>'endTime'='19:00') THEN
   RAISE EXCEPTION 'FAIL original and two vacancies';
 END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(changes) s WHERE s->>'doctor_id' IS NULL
   AND s->'coverage_post'->>'published'='false'
   AND (s->>'start_time',s->>'end_time') IN (('07:00','08:00'),('18:00','19:00')))<>2 THEN
   RAISE EXCEPTION 'FAIL unpublished boundary gaps';
 END IF;
 SELECT to_jsonb(s) INTO vacancy FROM public.nv_staff_shifts s
 WHERE s.coverage_post->>'id'='coverage-original' AND s.start_time='07:00';
 first_gap := vacancy->>'id';
 version := (vacancy->'coverage_post'->>'revision')::integer;
 BEGIN
   PERFORM public.nv_save_fractional_coverage(vacancy||'{"doctor_id":"coverage-b","end_time":"08:01","employment_type":"clt"}',NULL,version);
   RAISE EXCEPTION 'FAIL capacity overflow accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.nv_master_publish_coverage(first_gap,true);
 PERFORM set_config('request.jwt.claims','{"sub":"52000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 offers:=public.nv_portal_schedule(current_date+30,current_date+30,false);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(offers) s WHERE s->>'id'=first_gap AND s->>'duration_minutes'='60')
  OR EXISTS(SELECT FROM jsonb_array_elements(offers) s WHERE s->>'start_time'='18:00') THEN
   RAISE EXCEPTION 'FAIL vacancy publication or duration';
 END IF;
 PERFORM public.nv_apply_for_shift(first_gap);
 PERFORM set_config('request.jwt.claims','{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 queued:=public.nv_shift_selection_queue('coverage-org',first_gap,NULL)->0;
 PERFORM public.nv_select_shift_candidate((queued->>'id')::uuid,'coverage-b','clt',NULL);
 SELECT jsonb_agg(to_jsonb(s)) INTO changes FROM public.nv_staff_shifts s WHERE s.coverage_post->>'id'='coverage-original';
 IF (SELECT count(*) FROM jsonb_array_elements(changes) s WHERE s->>'doctor_id' IS NULL AND s->>'status'='open')<>1 THEN
   RAISE EXCEPTION 'FAIL published vacancy remained open after assignment';
 END IF;
 BEGIN
   PERFORM public.nv_save_fractional_coverage(vacancy||'{"doctor_id":"coverage-b","employment_type":"clt"}',NULL,version);
   RAISE EXCEPTION 'FAIL stale revision';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 SELECT to_jsonb(s) INTO source FROM public.nv_staff_shifts s WHERE s.id=first_gap;
 changes:=public.nv_save_fractional_coverage(source||'{"doctor_id":null}',NULL,(source->'coverage_post'->>'revision')::integer);
 IF (SELECT count(*) FROM jsonb_array_elements(changes) s WHERE s->>'status'='open' AND s->>'doctor_id' IS NULL)<>2 THEN
   RAISE EXCEPTION 'FAIL vacancy reopening';
 END IF;
 PERFORM set_config('request.jwt.claims','{"sub":"52000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 BEGIN
   PERFORM public.nv_save_fractional_coverage(source,NULL,version);
   RAISE EXCEPTION 'FAIL cross-organization mutation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT FROM public.nv_staff_shifts WHERE coverage_post->>'id'='coverage-original') THEN
   RAISE EXCEPTION 'FAIL cross-organization read';
 END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE template jsonb; changes jsonb; rule jsonb; day date:=current_date+4; gap jsonb; reported jsonb;
BEGIN
 template:=jsonb_build_object('organization_id','coverage-org','unit_id','coverage-unit','sector_id','coverage-sector',
   'specialty','Cirurgia','type','onsite','coverage_mode','regular','payment_frequency','on_delivery');
 changes:=public.nv_save_fractional_coverage(template||jsonb_build_object('id','coverage-overnight','date',day,
   'doctor_id','coverage-a','status','pending','employment_type','pj','employer_name','PJ de teste','start_time','23:15',
   'end_time','05:45','hourly_rate_cents',12000),jsonb_build_object('date',day,'start_time','19:00','end_time','07:00','capacity',1));
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(changes) s WHERE s->>'id'='coverage-overnight'
   AND (s->>'payment_amount')::numeric=780 AND s->'payment_agreement'->>'hourly_rate_cents'='12000') THEN
   RAISE EXCEPTION 'FAIL minute-based hourly agreement';
 END IF;
 SELECT s INTO gap FROM jsonb_array_elements(changes) s WHERE s->>'date'=(day+1)::text;
 IF gap->>'start_time'<>'05:45' OR gap->>'end_time'<>'07:00' OR gap->'coverage_post'->>'date'<>day::text THEN
   RAISE EXCEPTION 'FAIL overnight vacancy operational date';
 END IF;
 reported:=public.nv_report_filtered_shifts('coverage-org',day,day,jsonb_build_object('shift_id',gap->>'id'),false);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(reported->'rows') s WHERE s->>'coverage_post_id'='coverage-overnight'
   AND s->>'coverage_date'=day::text AND s->>'segment_minutes'='75') THEN
   RAISE EXCEPTION 'FAIL overnight report grouping';
 END IF;
 changes:=public.nv_save_fractional_coverage(template||jsonb_build_object('id','coverage-full-day','date',day+3,
   'status','open','employment_type','clt','start_time','07:15','end_time','07:15'),
   jsonb_build_object('date',day+3,'start_time','07:15','end_time','07:15','capacity',2));
 IF jsonb_array_length(changes)<>2 OR EXISTS(SELECT FROM jsonb_array_elements(changes) s WHERE
   (s->'coverage_post'->>'segmentEndsAt')::timestamptz-(s->'coverage_post'->>'segmentStartsAt')::timestamptz <> interval '24 hours') THEN
   RAISE EXCEPTION 'FAIL 24-hour capacity';
 END IF;
 rule:=public.nv_master_save_rule('coverage-org',NULL,template||jsonb_build_object('doctor_id','coverage-a',
   'employment_type','clt','start_time','07:00','end_time','13:00','weekdays',jsonb_build_array(extract(dow FROM day+1)::integer),
   'frequency','weeks','interval_weeks',1,'start_date',day+1,'anchor_date',day+1,'end_date',day+1,
   'coverage_plan','{"start_time":"07:00","end_time":"19:00","capacity":1}'::jsonb),0,day+1,1);
 IF (rule->'generation'->>'generated')::integer<>1 THEN RAISE EXCEPTION 'FAIL Master fractional generation: %',rule; END IF;
 PERFORM public.nv_master_generate('coverage-org',(rule->>'id')::uuid);
 IF (SELECT count(*) FROM public.nv_staff_shifts WHERE date=day+1 AND start_time='13:00' AND end_time='19:00'
    AND coverage_post->>'date'=(day+1)::text AND status='open')<>1 THEN
   RAISE EXCEPTION 'FAIL Master generation gap or idempotency';
 END IF;
END $$;
RESET ROLE;

DO $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.master_schedule_audit WHERE entity_id='coverage-original' AND action='coverage_gap_created') THEN
   RAISE EXCEPTION 'FAIL missing coverage audit';
 END IF;
END $$;
COMMIT;

SELECT public.dblink_connect('coverage_competing',format('host=127.0.0.1 port=%s dbname=%s user=%s',
 current_setting('port'),current_database(),session_user));
SELECT public.dblink_exec('coverage_competing','SET ROLE authenticated');
SELECT public.dblink_exec('coverage_competing',$remote$SET request.jwt.claims = '{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}'$remote$);

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"52000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Capture the competing request before the first transaction starts editing.
CREATE TEMP TABLE coverage_concurrency_request ON COMMIT DROP AS
SELECT to_jsonb(s) AS item FROM public.nv_staff_shifts s WHERE coverage_post->>'id'='coverage-full-day' AND id<>'coverage-full-day';
DO $$ DECLARE item jsonb; BEGIN
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE id='coverage-full-day';
 PERFORM public.nv_save_fractional_coverage(item||'{"doctor_id":"coverage-a","employment_type":"clt"}',NULL,
  (item->'coverage_post'->>'revision')::integer);
END $$;
RESET ROLE;
DO $$ DECLARE item jsonb; BEGIN
 SELECT request.item INTO STRICT item FROM coverage_concurrency_request request;
 PERFORM result FROM public.dblink('coverage_competing',format('SELECT public.nv_save_fractional_coverage(%L::jsonb,NULL,%s)',
  item||'{"doctor_id":"coverage-b","employment_type":"clt"}',(item->'coverage_post'->>'revision')::integer),false) AS row(result jsonb);
 IF public.dblink_error_message('coverage_competing') NOT LIKE '%Este posto está sendo atualizado%' THEN
  RAISE EXCEPTION 'FAIL serialization across two vacancy rows';
 END IF;
END $$;
COMMIT;
DO $$ DECLARE item jsonb; BEGIN
 SELECT to_jsonb(s) INTO STRICT item FROM public.shifts s WHERE s.coverage_post_id='coverage-full-day' AND s.doctor_id IS NULL AND s.status='open';
 PERFORM result FROM public.dblink('coverage_competing',format('SELECT public.nv_save_fractional_coverage(%L::jsonb,NULL,%s)',
  item||'{"doctor_id":"coverage-b","employment_type":"clt"}',(SELECT revision FROM public.shift_coverage_posts WHERE id='coverage-full-day')) ) AS row(result jsonb);
 IF (SELECT count(*) FROM public.shifts WHERE coverage_post_id='coverage-full-day' AND doctor_id IS NOT NULL AND status<>'cancelled')<>2
   OR EXISTS(SELECT FROM public.shifts WHERE coverage_post_id='coverage-full-day' AND doctor_id IS NULL AND status='open') THEN
  RAISE EXCEPTION 'FAIL concurrent vacancy split';
 END IF;
END $$;
DO $$ DECLARE expected_revision integer; BEGIN
 SELECT revision INTO STRICT expected_revision FROM public.shift_coverage_posts WHERE id='coverage-full-day';
 PERFORM result FROM public.dblink('coverage_competing',format('SELECT public.nv_cancel_fractional_coverage(%L,%s)',
   'coverage-full-day',expected_revision)) AS row(result jsonb);
 IF EXISTS(SELECT FROM public.shifts WHERE coverage_post_id='coverage-full-day' AND status<>'cancelled')
   OR NOT EXISTS(SELECT FROM public.shift_coverage_posts WHERE id='coverage-full-day' AND cancelled_at IS NOT NULL) THEN
  RAISE EXCEPTION 'FAIL post cancellation reopened vacancies';
 END IF;
END $$;
SELECT public.dblink_disconnect('coverage_competing');
