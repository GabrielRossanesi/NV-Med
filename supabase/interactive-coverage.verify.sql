BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('55000000-0000-4000-8000-000000000001','coverage-manager@example.invalid'),
 ('55000000-0000-4000-8000-000000000002','coverage-outsider@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('draft-org','Cobertura sintética','{"specialties":["Cirurgia"]}'), ('draft-other','Outra empresa','{}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('draft-manager','55000000-0000-4000-8000-000000000001','Direção','coverage-manager@example.invalid','tenant_user','draft-org','Diretor'),
 ('draft-outsider','55000000-0000-4000-8000-000000000002','Outra direção','coverage-outsider@example.invalid','tenant_user','draft-other','Diretor');
INSERT INTO public.units(id,organization_id,name,type,time_zone) VALUES ('draft-unit','draft-org','Hospital','hospital','America/Manaus');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty)
VALUES ('draft-sector','draft-org','draft-unit','Cirurgia',ARRAY['Cirurgia'],'Cirurgia');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,linked_units)
SELECT 'draft-'||code,'draft-org','Médico '||letter,'551'||code,'AM','Cirurgia',ARRAY['draft-unit']
FROM (VALUES ('1','A'),('2','B'),('3','C')) fixture(code,letter);
INSERT INTO public.doctor_banking(doctor_id,organization_id,pix_key,pix_key_type)
SELECT id,'draft-org',id||'@example.invalid','email' FROM public.doctors WHERE organization_id='draft-org';
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,birth_date,pix_key,submitted_name,submitted_phone,requested_specialties,approved_specialties,status)
SELECT id,'draft-org','1985-01-01',id||'@example.invalid',name,'11999990000',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved'
FROM public.doctors WHERE organization_id='draft-org';
INSERT INTO public.organization_shift_rates(id,organization_id,unit_id,sector_id,specialty,amount_cents,active)
VALUES ('55000000-0000-4000-8000-000000000003','draft-org','draft-unit','draft-sector','Cirurgia',120000,true);
INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,employment_type,employer_name)
VALUES ('draft-root','draft-org','draft-1','draft-unit','draft-sector','Cirurgia',current_date+30,'07:00','19:00','onsite','pending','clt',NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"55000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $test$
DECLARE root jsonb; second jsonb; output jsonb; vacancy jsonb; version integer; plan jsonb; protected_history jsonb;
BEGIN
  SELECT to_jsonb(s) INTO root FROM public.nv_staff_shifts s WHERE id='draft-root';
  plan:=jsonb_build_object('date',root->>'date','start_time','07:00','end_time','19:00','capacity',1);
  second:=root||'{"id":"draft-second","doctor_id":"draft-2","start_time":"13:00","end_time":"19:00"}';
  BEGIN
    PERFORM public.nv_save_coverage_draft(root,jsonb_build_array(root||'{"end_time":"13:00"}',second||'{"start_time":"12:59"}'),plan);
    RAISE EXCEPTION 'FAIL overlap accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT s.end_time FROM public.nv_staff_shifts s WHERE id='draft-root')<>'19:00'
    OR EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='draft-second') THEN RAISE EXCEPTION 'FAIL partial batch'; END IF;

  output:=public.nv_save_coverage_draft(root,jsonb_build_array(root||'{"end_time":"13:00"}',second),plan);
  IF jsonb_array_length(output)<>2 OR EXISTS(SELECT FROM jsonb_array_elements(output) s WHERE s->'coverage_post'->>'id'<>'draft-root')
    OR (output->0->>'end_time')<>'13:00' OR (output->1->>'start_time')<>'13:00' THEN
    RAISE EXCEPTION 'FAIL atomic split and original post';
  END IF;
  version:=(output->0->'coverage_post'->>'revision')::integer;
  output:=public.nv_save_coverage_draft(output->0,jsonb_build_array(output->1||'{"status":"cancelled"}'),plan,version);
  SELECT s INTO vacancy FROM jsonb_array_elements(output) s WHERE s->>'status'='open';
  IF vacancy->>'start_time' IS DISTINCT FROM '13:00' OR vacancy->>'end_time' IS DISTINCT FROM '19:00' THEN
    RAISE EXCEPTION 'FAIL removal did not generate an individual vacancy';
  END IF;
  version:=(vacancy->'coverage_post'->>'revision')::integer;
  output:=public.nv_save_coverage_draft(vacancy,jsonb_build_array(vacancy||'{"doctor_id":"draft-3","employment_type":"clt","start_time":"14:00","end_time":"18:00"}'),plan,version);
  IF (SELECT count(*) FROM jsonb_array_elements(output) s WHERE s->>'status'='open' AND (s->>'start_time',s->>'end_time') IN (('13:00','14:00'),('18:00','19:00')))<>2 THEN
    RAISE EXCEPTION 'FAIL partial vacancy fill';
  END IF;
  BEGIN
    PERFORM public.nv_save_coverage_draft(vacancy,jsonb_build_array(vacancy),plan,version);
    RAISE EXCEPTION 'FAIL stale revision accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  PERFORM public.nv_save_operational_shifts(jsonb_build_array(root||jsonb_build_object(
    'id','draft-night','date',current_date+31,'start_time','19:00','end_time','07:00','employment_type','pj','employer_name','Empresa sintética',
    'agreement',jsonb_build_object('mode','default','rate_id','55000000-0000-4000-8000-000000000003','rate_cents',120000,'frequency','on_delivery'))));
  SELECT to_jsonb(s) INTO root FROM public.nv_staff_shifts s WHERE id='draft-night';
  plan:=jsonb_build_object('date',root->>'date','start_time','19:00','end_time','07:00','capacity',1);
  second:=root||jsonb_build_object('id','draft-night-second','doctor_id','draft-2','date',(root->>'date')::date+1,'start_time','01:00','end_time','07:00');
  output:=public.nv_save_coverage_draft(root,jsonb_build_array(root||'{"end_time":"01:00"}',second),plan);
  IF jsonb_array_length(output)<>2 OR (SELECT sum((s->>'payment_amount')::numeric) FROM jsonb_array_elements(output) s)<>1200
    OR EXISTS(SELECT FROM jsonb_array_elements(output) s WHERE s->>'payment_status'='paid') THEN
    RAISE EXCEPTION 'FAIL overnight split or duplicated financial cost: %',
      (SELECT jsonb_agg(jsonb_build_object('id',s->>'id','amount',s->>'payment_amount','state',s->>'payment_status')) FROM jsonb_array_elements(output) s);
  END IF;

  plan:=jsonb_build_object('date',current_date+35,'start_time','07:00','end_time','19:00','capacity',1);
  PERFORM public.nv_save_fractional_coverage(jsonb_build_object(
    'id','draft-protected','organization_id','draft-org','unit_id','draft-unit','sector_id','draft-sector',
    'doctor_id','draft-1','date',current_date+35,'start_time','10:00','end_time','19:00','specialty','Cirurgia',
    'type','onsite','status','pending','coverage_mode','regular','employment_type','clt','notes','Registro a preservar'),plan,NULL);
  PERFORM public.nv_approve_shift('draft-protected',
    (SELECT s.approval_revision FROM public.nv_staff_shifts s WHERE id='draft-protected'),true,'Aprovação sintética anterior');
  SELECT to_jsonb(s) INTO root FROM public.nv_staff_shifts s WHERE id='draft-protected';
  protected_history:=public.nv_shift_history('draft-protected');
  SELECT to_jsonb(s) INTO vacancy FROM public.nv_staff_shifts s WHERE s.coverage_post->>'id'='draft-protected' AND s.status='open';
  output:=public.nv_save_coverage_draft(root,jsonb_build_array(vacancy||'{"doctor_id":"draft-2","employment_type":"clt","start_time":"08:00","end_time":"10:00"}'),
    plan,(root->'coverage_post'->>'revision')::integer);
  IF (SELECT s-'coverage_post' FROM jsonb_array_elements(output) s WHERE s->>'id'='draft-protected') IS DISTINCT FROM root-'coverage_post'
    OR public.nv_shift_history('draft-protected') IS DISTINCT FROM protected_history THEN
    RAISE EXCEPTION 'FAIL neighboring allocation or history changed after filling vacancy';
  END IF;
  IF jsonb_array_length(output)<>3 OR NOT EXISTS (SELECT FROM jsonb_array_elements(output) s
    WHERE (s->>'status',s->>'start_time',s->>'end_time')=('open','07:00','08:00'))
    OR NOT EXISTS (SELECT FROM jsonb_array_elements(output) s
    WHERE (s->>'id',s->>'doctor_id',s->>'start_time',s->>'end_time')=(vacancy->>'id','draft-2','08:00','10:00')) THEN
    RAISE EXCEPTION 'FAIL allocation and residual vacancy were not saved individually';
  END IF;

  PERFORM set_config('request.jwt.claims','{"sub":"55000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
  BEGIN
    PERFORM public.nv_save_coverage_draft(root,jsonb_build_array(second),plan,1);
    RAISE EXCEPTION 'FAIL unauthorized organization';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END
$test$;
RESET ROLE;
DO $acl$
BEGIN
  IF has_function_privilege('anon','public.nv_save_coverage_draft(jsonb,jsonb,jsonb,integer)','EXECUTE')
    OR has_table_privilege('authenticated','nv_master_private.coverage_batch','INSERT')
    OR EXISTS (SELECT FROM nv_master_private.coverage_batch) THEN RAISE EXCEPTION 'FAIL coverage context ACL or cleanup'; END IF;
END
$acl$;
ROLLBACK;
