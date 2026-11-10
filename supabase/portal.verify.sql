-- Run in a disposable database after 25_document_notification_rules.sql.
-- Synthetic fixtures are always rolled back.
BEGIN;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at) VALUES
  ('19000000-0000-4000-8000-000000000001','authenticated','authenticated','nv-coordinator@example.invalid',now()),
  ('19000000-0000-4000-8000-000000000002','authenticated','authenticated','nv-doctor-a@example.invalid',now()),
  ('19000000-0000-4000-8000-000000000003','authenticated','authenticated','nv-doctor-b@example.invalid',now()),
  ('19000000-0000-4000-8000-000000000004','authenticated','authenticated','nv-doctor-c@example.invalid',now()),
  ('19000000-0000-4000-8000-000000000005','authenticated','authenticated','nv-foreign-coordinator@example.invalid',now()),
  ('19000000-0000-4000-8000-000000000006','authenticated','authenticated','nv-scheduler@example.invalid',now()),
  ('19000000-0000-4000-8000-000000000007','authenticated','authenticated','nv-existing-doctor@example.invalid',now());

INSERT INTO public.organizations(id,name,settings) VALUES
  ('nv-portal-a','Portal A','{"specialties":["Cirurgia","Ortopedia"],"requiredDocuments":[{"type":"crm","name":"CRM","required":true}]}'),
  ('nv-portal-b','Portal B','{"specialties":["Cirurgia"],"requiredDocuments":[]}');

INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
  ('nv-portal-admin','19000000-0000-4000-8000-000000000001','Test','nv-coordinator@example.invalid','tenant_user','nv-portal-a','Diretor'),
  ('nv-portal-admin-b','19000000-0000-4000-8000-000000000005','Test','nv-foreign-coordinator@example.invalid','tenant_user','nv-portal-b','Coordenador de Escalas'),
  ('nv-portal-scheduler','19000000-0000-4000-8000-000000000006','Test','nv-scheduler@example.invalid','tenant_user','nv-portal-a','Escalista');

INSERT INTO public.units(id,organization_id,name,type) VALUES
  ('nv-portal-unit','nv-portal-a','Hospital A','hospital'),
  ('nv-portal-foreign','nv-portal-b','Hospital B','hospital');

INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties) VALUES
  ('nv-portal-sector','nv-portal-a','nv-portal-unit','Posto A',ARRAY['Cirurgia','Ortopedia']),
  ('nv-portal-sector-b','nv-portal-b','nv-portal-foreign','Posto B',ARRAY['Cirurgia']);

INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,date,start_time,end_time,specialty,status) VALUES
  ('nv-portal-vacancy','nv-portal-a','nv-portal-unit','nv-portal-sector','2099-03-01','19:00','07:00','Cirurgia','open'),
  ('nv-portal-overlap','nv-portal-a','nv-portal-unit','nv-portal-sector','2099-03-02','06:00','12:00','Cirurgia','open'),
  ('nv-portal-ortho','nv-portal-a','nv-portal-unit','nv-portal-sector','2099-03-03','19:00','07:00','Ortopedia','open'),
  ('nv-portal-foreign-shift','nv-portal-b','nv-portal-foreign','nv-portal-sector-b','2099-03-01','19:00','07:00','Cirurgia','open');

INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status,linked_units)
VALUES ('nv-portal-existing','nv-portal-a','Cadastro Existente','00104','SP','987.654.321-00',
  'nv-existing-doctor@example.invalid','Cirurgia','active',ARRAY['nv-portal-unit']);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$
BEGIN
  BEGIN
    PERFORM public.nv_submit_enrollment('nv-portal-a','Pessoa Sintética','101','SP','00000000000','1990-01-01','11955550000','chave-teste',ARRAY['Cirurgia']);
    RAISE EXCEPTION 'FAIL: invalid CPF accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.nv_submit_enrollment('nv-portal-a','Pessoa Sintética','101','SP','52998224725','1990-01-01','11955550000','chave-teste',ARRAY['Cirurgia']);
  IF (SELECT count(*) FROM public.doctors) <> 0 OR (SELECT count(*) FROM public.shifts) <> 0 THEN
    RAISE EXCEPTION 'FAIL: physician received staff access';
  END IF;
  IF jsonb_array_length(public.nv_portal_schedule('2099-03-01','2099-03-31',false)) <> 0 THEN
    RAISE EXCEPTION 'FAIL: pending physician can view schedule';
  END IF;
  BEGIN
    PERFORM public.nv_apply_for_shift('nv-portal-vacancy');
    RAISE EXCEPTION 'FAIL: pending physician can apply';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF jsonb_array_length(public.nv_portal_documents(public.nv_portal_enrollments()->0->>'doctor_id')) <> 1 THEN
    RAISE EXCEPTION 'FAIL: required document missing';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT public.nv_submit_enrollment('nv-portal-a','Pessoa Dois','102','SP','11144477735','1990-01-01','11955550000','chave-teste',ARRAY['Cirurgia']);
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT public.nv_submit_enrollment('nv-portal-a','Pessoa Três','103','SP','12345678909','1990-01-01','11955550000','chave-teste',ARRAY['Cirurgia']);
RESET ROLE;

SELECT set_config('nv.test.doctor_a',(SELECT doctor_id FROM public.doctor_enrollments WHERE auth_user_id='19000000-0000-4000-8000-000000000002'),true);
SELECT set_config('nv.test.doctor_b',(SELECT doctor_id FROM public.doctor_enrollments WHERE auth_user_id='19000000-0000-4000-8000-000000000003'),true);
SELECT set_config('nv.test.doctor_c',(SELECT doctor_id FROM public.doctor_enrollments WHERE auth_user_id='19000000-0000-4000-8000-000000000004'),true);
SELECT set_config('nv.test.document',(SELECT id FROM public.medical_documents WHERE doctor_id=current_setting('nv.test.doctor_a')),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000005","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.nv_pending_enrollments('nv-portal-a') <> 0 THEN RAISE EXCEPTION 'FAIL: foreign coordinator sees queue'; END IF;
  BEGIN
    PERFORM public.nv_review_enrollment(current_setting('nv.test.doctor_a'),'approved',NULL,ARRAY['Cirurgia'],ARRAY['nv-portal-unit']);
    RAISE EXCEPTION 'FAIL: foreign coordinator can approve';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.nv_pending_enrollments('nv-portal-a') <> 3 THEN RAISE EXCEPTION 'FAIL: count of pending registrations'; END IF;
  PERFORM public.nv_review_enrollment(current_setting('nv.test.doctor_a'),'approved',NULL,ARRAY['Cirurgia'],ARRAY['nv-portal-unit']);
  PERFORM public.nv_review_enrollment(current_setting('nv.test.doctor_b'),'approved',NULL,ARRAY['Cirurgia'],ARRAY['nv-portal-unit']);
  PERFORM public.nv_review_enrollment(current_setting('nv.test.doctor_c'),'approved',NULL,ARRAY['Cirurgia'],ARRAY['nv-portal-unit']);
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF jsonb_array_length(public.nv_portal_schedule('2099-03-01','2099-03-31',false)) <> 2 THEN
    RAISE EXCEPTION 'FAIL: cross-tenant or cross-specialty schedule';
  END IF;
  PERFORM public.nv_apply_for_shift('nv-portal-vacancy');
  PERFORM public.nv_apply_for_shift('nv-portal-vacancy');
  BEGIN
    PERFORM public.nv_apply_for_shift('nv-portal-ortho');
    RAISE EXCEPTION 'FAIL: unauthorized specialty application';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_apply_for_shift('nv-portal-foreign-shift');
    RAISE EXCEPTION 'FAIL: foreign vacancy application';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF jsonb_array_length(public.nv_portal_applications()) <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate application'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document'))) THEN
    RAISE EXCEPTION 'FAIL: another physician document exposed';
  END IF;
  PERFORM public.nv_apply_for_shift('nv-portal-vacancy');
  PERFORM public.nv_apply_for_shift('nv-portal-vacancy',true);
  IF public.nv_portal_applications()->0->>'status' <> 'cancelled' THEN RAISE EXCEPTION 'FAIL: cancellation'; END IF;
  PERFORM public.nv_apply_for_shift('nv-portal-vacancy');
  PERFORM public.nv_apply_for_shift('nv-portal-overlap');
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE target uuid; overlap uuid;
BEGIN
  IF jsonb_array_length(public.nv_shift_selection_queue('nv-portal-a','nv-portal-vacancy')->0->'candidates') <> 2 THEN
    RAISE EXCEPTION 'FAIL: multiple candidates';
  END IF;
  target := (public.nv_shift_selection_queue('nv-portal-a','nv-portal-vacancy')->0->>'id')::uuid;
  overlap := (public.nv_shift_selection_queue('nv-portal-a','nv-portal-overlap')->0->>'id')::uuid;
  PERFORM public.nv_select_shift_candidate(target,current_setting('nv.test.doctor_b'),'clt',NULL);
  BEGIN
    PERFORM public.nv_select_shift_candidate(target,current_setting('nv.test.doctor_a'),'clt',NULL);
    RAISE EXCEPTION 'FAIL: second decision accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.nv_select_shift_candidate(overlap,current_setting('nv.test.doctor_b'),'clt',NULL);
    RAISE EXCEPTION 'FAIL: night overlap approved';
  EXCEPTION WHEN invalid_parameter_value OR raise_exception THEN
    IF SQLERRM NOT LIKE '%sobreposto%' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.shifts WHERE id='nv-portal-overlap') <> 'open' THEN RAISE EXCEPTION 'FAIL: partial decision'; END IF;
  PERFORM public.nv_cancel_shift_opportunity(overlap);
  IF (SELECT status FROM public.shifts WHERE id='nv-portal-overlap') <> 'open'
    OR jsonb_array_length(public.nv_shift_selection_queue('nv-portal-a','nv-portal-overlap')) <> 0 THEN
    RAISE EXCEPTION 'FAIL: closing vacancy round must preserve vacancy';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT public.nv_request_exchange('nv-portal-vacancy');
DO $$ BEGIN
  IF public.nv_portal_schedule('2099-03-01','2099-03-01',true)->0->>'status' <> 'exchange' THEN
    RAISE EXCEPTION 'FAIL: exchange absent from original physician agenda';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SELECT public.nv_apply_for_shift('nv-portal-vacancy');
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE target uuid;
BEGIN
  IF (SELECT doctor_id FROM public.shifts WHERE id='nv-portal-vacancy') <> current_setting('nv.test.doctor_b') THEN
    RAISE EXCEPTION 'FAIL: original physician lost assignment before approval';
  END IF;
  target := (public.nv_shift_selection_queue('nv-portal-a','nv-portal-vacancy')->0->>'id')::uuid;
  PERFORM public.nv_select_shift_candidate(target,current_setting('nv.test.doctor_c'),'clt',NULL);
  IF (SELECT doctor_id FROM public.shifts WHERE id='nv-portal-vacancy') <> current_setting('nv.test.doctor_c')
    OR jsonb_array_length(public.nv_shift_history('nv-portal-vacancy')) <> 2 THEN
    RAISE EXCEPTION 'FAIL: exchange assignment and history';
  END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000007","role":"authenticated"}',true);
DO $$ BEGIN
  PERFORM public.nv_submit_enrollment('nv-portal-a','Pessoa Existente','104','SP','98765432100','1990-01-01','11955550000','chave-teste',ARRAY['Cirurgia']);
  IF public.nv_portal_enrollments()->0->>'doctor_id' <> 'nv-portal-existing' THEN RAISE EXCEPTION 'FAIL: legacy linkage created duplicate'; END IF;
  BEGIN
    PERFORM public.nv_portal_documents('nv-portal-existing');
    RAISE EXCEPTION 'FAIL: legacy folder exposed before review';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT public.nv_review_enrollment('nv-portal-existing','approved',NULL,ARRAY['Cirurgia'],ARRAY['nv-portal-unit']);
SELECT public.nv_save_unit_attendance('nv-portal-unit',-23.55,-46.63,150,75,60,true);
SELECT public.nv_save_payment_terms('nv-portal-a',20,1,'last_day','none',ARRAY[]::date[]);
DO $$
DECLARE local_now timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(
    jsonb_build_object('id','nv-presence','organization_id','nv-portal-a','unit_id','nv-portal-unit','sector_id','nv-portal-sector',
      'doctor_id',current_setting('nv.test.doctor_c'),'date',(local_now - interval '10 minutes')::date,
      'start_time',to_char(local_now - interval '10 minutes','HH24:MI'),'end_time',to_char(local_now + interval '30 minutes','HH24:MI'),
      'type','onsite','status','confirmed','specialty','Cirurgia','employment_type','clt','payment_amount',100,'payment_frequency','on_delivery'),
    jsonb_build_object('id','nv-manual','organization_id','nv-portal-a','unit_id','nv-portal-unit','sector_id','nv-portal-sector',
      'doctor_id',current_setting('nv.test.doctor_a'),'date',local_now::date - 1,'start_time','10:00','end_time','12:00',
      'type','onsite','status','confirmed','specialty','Cirurgia','employment_type','clt'),
    jsonb_build_object('id','nv-december','organization_id','nv-portal-a','unit_id','nv-portal-unit','sector_id','nv-portal-sector',
      'doctor_id',current_setting('nv.test.doctor_a'),'date','2099-12-10','start_time','10:00','end_time','12:00',
      'type','onsite','status','confirmed','specialty','Cirurgia','employment_type','clt','payment_amount',1800,'payment_frequency','monthly')
  ));
  IF (SELECT payment_due_date FROM public.nv_staff_shifts WHERE id='nv-december') <> date '2100-01-20' THEN
    RAISE EXCEPTION 'FAIL: next-month payment across year';
  END IF;
  IF (SELECT payment_due_date FROM public.nv_staff_shifts WHERE id='nv-presence') <>
    (local_now + interval '30 minutes')::date THEN RAISE EXCEPTION 'FAIL: on-delivery due date'; END IF;
  PERFORM public.nv_save_payment_terms('nv-portal-a',31,0,'last_day','next',ARRAY[date '2099-03-02']);
  IF (SELECT payment_due_date FROM public.nv_staff_shifts WHERE id='nv-december') <> date '2100-01-20' THEN
    RAISE EXCEPTION 'FAIL: changing rules altered prior due date';
  END IF;
  IF public.nv_save_operational_shifts(jsonb_build_array(
    jsonb_build_object('id','nv-february','organization_id','nv-portal-a','unit_id','nv-portal-unit','sector_id','nv-portal-sector',
      'doctor_id',current_setting('nv.test.doctor_a'),'date','2099-02-14','start_time','10:00','end_time','12:00',
      'type','onsite','status','confirmed','specialty','Cirurgia','employment_type','clt','payment_frequency','monthly')
  ))->0->>'payment_due_date' <> '2099-03-03' THEN RAISE EXCEPTION 'FAIL: short month, weekend or holiday adjustment'; END IF;
  PERFORM public.nv_save_shift_payment('nv-december',1800,'monthly','paid',1750,local_now::date,'Teste de conciliação');
  IF NOT EXISTS (SELECT 1 FROM public.nv_staff_shifts WHERE id='nv-december' AND paid_amount=1750 AND payment_amount=1800) THEN
    RAISE EXCEPTION 'FAIL: settlement changed agreed amount';
  END IF;
  BEGIN
    PERFORM public.nv_save_shift_payment('nv-december',1900,'monthly','paid',1750,local_now::date,NULL);
    RAISE EXCEPTION 'FAIL: settled agreed amount changed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_record_attendance('nv-presence','check_out',-23.55,-46.63,10);
    RAISE EXCEPTION 'FAIL: check-out without check-in';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%antes%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.nv_record_attendance('nv-presence','check_in',-22,-46.63,10);
    RAISE EXCEPTION 'FAIL: attendance outside perimeter';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%perímetro%' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.nv_record_attendance('nv-presence','check_in',-23.55,-46.63,1000);
    RAISE EXCEPTION 'FAIL: inaccurate location';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%precisão%' THEN RAISE; END IF; END;
  PERFORM public.nv_record_attendance('nv-presence','check_in',-23.55,-46.63,12);
  BEGIN
    PERFORM public.nv_record_attendance('nv-presence','check_in',-23.55,-46.63,12);
    RAISE EXCEPTION 'FAIL: duplicate check-in';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE '%já foi%' THEN RAISE; END IF; END;
  PERFORM public.nv_record_attendance('nv-presence','check_out',-23.55,-46.63,12);
  IF jsonb_array_length(public.nv_presence_summary('nv-presence')->'events') <> 2 THEN RAISE EXCEPTION 'FAIL: attendance not recorded'; END IF;
  BEGIN
    PERFORM latitude FROM public.shift_attendance;
    RAISE EXCEPTION 'FAIL: raw coordinates exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT public.nv_request_attendance_exception('nv-manual','check_out','GPS indisponível no local.');
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE target uuid := (public.nv_attendance_queue('nv-portal-a')->0->>'id')::uuid;
BEGIN
  PERFORM public.nv_review_attendance(target,true,'Presença confirmada pela supervisão.');
  IF public.nv_presence_summary('nv-manual')->'events'->0->>'result' <> 'manual_approved'
    OR (SELECT status FROM public.shifts WHERE id='nv-manual') <> 'completed' THEN RAISE EXCEPTION 'FAIL: manual exception'; END IF;
  IF public.nv_report_shifts('nv-portal-a','2099-12-01','2099-12-31',payment=>'paid')->'rows'->0->>'paid_amount' <> '1750.00'
    THEN RAISE EXCEPTION 'FAIL: finance report'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT payment_amount FROM public.nv_staff_shifts WHERE id='nv-december') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: financial mask'; END IF;
  IF public.nv_report_shifts('nv-portal-a','2099-12-01','2099-12-31')->'rows'->0->>'agreed' IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: finance report exposed amounts';
  END IF;
  BEGIN
    PERFORM payment_amount FROM public.shifts;
    RAISE EXCEPTION 'FAIL: direct financial access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.shifts WHERE id='nv-december';
    RAISE EXCEPTION 'FAIL: unauthorized deletion of paid shift';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM LIKE '%pagamento%' OR SQLERRM LIKE '%financeir%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(
      (SELECT to_jsonb(s) FROM public.nv_staff_shifts s WHERE id = 'nv-december') || '{"status":"cancelled"}'::jsonb
    ));
    RAISE EXCEPTION 'FAIL: unauthorized cancellation of paid shift';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE 'Alteração indisponível%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.nv_report_shifts('nv-portal-b','2099-03-01','2099-03-31');
    RAISE EXCEPTION 'FAIL: foreign company report';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

INSERT INTO storage.objects(bucket_id,name) VALUES ('medical-documents','nv-portal-a/' || current_setting('nv.test.doctor_a') || '/teste.pdf');
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF NOT public.nv_save_portal_document('19000000-0000-4000-8000-000000000002',current_setting('nv.test.document'),
    'nv-portal-a/' || current_setting('nv.test.doctor_a') || '/teste.pdf','teste.pdf',NULL) THEN
    RAISE EXCEPTION 'FAIL: authorized document upload';
  END IF;
  IF public.nv_save_portal_document('19000000-0000-4000-8000-000000000003',current_setting('nv.test.document'),
    'nv-portal-a/' || current_setting('nv.test.doctor_a') || '/teste.pdf','teste.pdf',
    'nv-portal-a/' || current_setting('nv.test.doctor_a') || '/teste.pdf') THEN RAISE EXCEPTION 'FAIL: foreign document write'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  UPDATE public.medical_documents SET status='approved' WHERE id=current_setting('nv.test.document');
  BEGIN
    UPDATE public.medical_documents SET expiry_date='2000-01-01' WHERE id=current_setting('nv.test.document');
    RAISE EXCEPTION 'FAIL: expired approved document allowed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    UPDATE public.medical_documents SET status='rejected', review_note=NULL WHERE id=current_setting('nv.test.document');
    RAISE EXCEPTION 'FAIL: rejection with no reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM public.document_audit_logs WHERE document_id=current_setting('nv.test.document')
    AND actor_auth_id='19000000-0000-4000-8000-000000000002' AND action='file_uploaded') THEN RAISE EXCEPTION 'FAIL: upload audit actor'; END IF;
  UPDATE public.organizations SET settings = settings || '{"documentGovernance":{"blockSchedulingOnCritical":true}}'::jsonb
  WHERE id='nv-portal-a';
  UPDATE public.sectors SET status='inactive' WHERE id='nv-portal-sector';
  BEGIN
    PERFORM public.nv_save_operational_shifts(jsonb_build_array(
      jsonb_build_object('id','nv-inactive-post','organization_id','nv-portal-a','unit_id','nv-portal-unit','sector_id','nv-portal-sector',
        'date','2099-03-04','start_time','10:00','end_time','12:00','type','onsite','status','open','specialty','Cirurgia')
    ));
    RAISE EXCEPTION 'FAIL: shift created on disabled post';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    DELETE FROM public.sectors WHERE id='nv-portal-sector';
    RAISE EXCEPTION 'FAIL: post with shift history deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  UPDATE public.sectors SET status='active' WHERE id='nv-portal-sector';
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_apply_for_shift('nv-portal-overlap');
    RAISE EXCEPTION 'FAIL: mandatory missing document did not block application';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.nv_portal_notifications()) n WHERE n->>'message' LIKE '%documento médico foi aprovado%') THEN
    RAISE EXCEPTION 'FAIL: approved document notification';
  END IF;
  PERFORM public.nv_save_notification_preferences(false,true,true);
  IF public.nv_notification_preferences()->>'offers' <> 'false' THEN RAISE EXCEPTION 'FAIL: saved preferences'; END IF;
END $$;
RESET ROLE;

-- The restrictive policies must still win if the target has a permissive policy.
CREATE POLICY nv_test_loose_storage ON storage.objects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY nv_test_loose_documents ON public.medical_documents FOR SELECT TO authenticated USING (true);
INSERT INTO auth.users(id, aud, role, email, email_confirmed_at)
VALUES ('19000000-0000-4000-8000-000000000008','authenticated','authenticated','nv-viewer@example.invalid',now());
INSERT INTO public.user_accounts(id, auth_user_id, name, email, type, organization_id, role, additional_permissions)
VALUES ('nv-portal-viewer','19000000-0000-4000-8000-000000000008','Test','nv-viewer@example.invalid','tenant_user',
  'nv-portal-a','Escalista','{"documentos":"view","financeiro":"view"}');
INSERT INTO storage.objects(bucket_id,name) VALUES
  ('medical-documents','nv-portal-a/' || current_setting('nv.test.doctor_a') || '/substituto.png'),
  ('medical-documents','nv-portal-a/' || current_setting('nv.test.doctor_b') || '/outro.pdf'),
  ('profile-avatars','19000000-0000-4000-8000-000000000001/avatar.png');
SET LOCAL ROLE service_role;
DO $$ DECLARE doc text := current_setting('nv.test.document'); folder text := 'nv-portal-a/' || current_setting('nv.test.doctor_a'); BEGIN
  IF public.nv_save_portal_document('19000000-0000-4000-8000-000000000002',doc,
    'nv-portal-a/' || current_setting('nv.test.doctor_b') || '/outro.pdf','outro.pdf',folder || '/teste.pdf') THEN
    RAISE EXCEPTION 'FAIL: foreign storage key accepted';
  END IF;
  IF NOT public.nv_save_portal_document('19000000-0000-4000-8000-000000000002',doc,
    folder || '/substituto.png','substituto.png',folder || '/teste.pdf') THEN RAISE EXCEPTION 'FAIL: upload replacement'; END IF;
  IF public.nv_save_portal_document('19000000-0000-4000-8000-000000000002',doc,
    folder || '/teste.pdf','teste.pdf',folder || '/teste.pdf') THEN RAISE EXCEPTION 'FAIL: stale update overwrote replacement'; END IF;
END $$;
RESET ROLE;
SELECT set_config('nv.test.revision',(SELECT id::text FROM public.document_audit_logs
  WHERE document_id = current_setting('nv.test.document') AND action = 'file_replaced' LIMIT 1),true);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000008","role":"authenticated"}',true);
DO $$ DECLARE doc text := current_setting('nv.test.document'); revision uuid := current_setting('nv.test.revision')::uuid;
  folder text := 'nv-portal-a/' || current_setting('nv.test.doctor_a'); BEGIN
  IF (SELECT file_path FROM public.nv_portal_document_target(doc)) IS DISTINCT FROM folder || '/substituto.png'
    OR (SELECT file_path FROM public.nv_portal_document_target(doc,'read',revision)) IS DISTINCT FROM folder || '/teste.pdf'
    OR EXISTS (SELECT 1 FROM public.nv_portal_document_target(doc,'read',gen_random_uuid())) THEN
    RAISE EXCEPTION 'FAIL: current or historical document binding';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nv_portal_document_target(doc,'write')) THEN
    RAISE EXCEPTION 'FAIL: read-only document role can upload';
  END IF;
  UPDATE public.medical_documents SET status = 'analyzing' WHERE id = doc;
  IF FOUND THEN RAISE EXCEPTION 'FAIL: read-only document role can review'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nv_portal_document_target(doc))
    OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'medical-documents') THEN
    RAISE EXCEPTION 'FAIL: direct storage read or missing authorized read';
  END IF;
  BEGIN
    INSERT INTO storage.objects VALUES ('medical-documents','nv-portal-a/unlinked/direct.pdf');
    RAISE EXCEPTION 'FAIL: direct storage write';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT payment_amount FROM public.nv_staff_shifts WHERE id = 'nv-december') IS NULL
    OR public.nv_report_shifts('nv-portal-a','2099-12-01','2099-12-31')->>'finance' <> 'true' THEN
    RAISE EXCEPTION 'FAIL: finance read-only projection';
  END IF;
  BEGIN
    PERFORM public.nv_update_shift_payment('nv-december','pending');
    RAISE EXCEPTION 'FAIL: finance read-only can settle';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    UPDATE public.medical_documents SET file_path = 'nv-portal-a/' || current_setting('nv.test.doctor_a') || '/teste.pdf'
      WHERE id = current_setting('nv.test.document');
    RAISE EXCEPTION 'FAIL: staff reattached file outside the upload route';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.medical_documents) OR EXISTS (
    SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document'))
  ) THEN RAISE EXCEPTION 'FAIL: scheduler can read documents'; END IF;
  BEGIN
    PERFORM public.nv_report_shifts('nv-portal-a','2099-12-01','2099-12-31',payment=>'paid');
    RAISE EXCEPTION 'FAIL: scheduler can filter by hidden payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- A token with old claims stays blocked while the live Auth flag is set.
INSERT INTO auth.sessions(id, user_id, created_at) VALUES
  ('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001',now() - interval '3 minutes'),
  ('29000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000001',now() - interval '1 minute'),
  ('29000000-0000-4000-8000-000000000003','19000000-0000-4000-8000-000000000001',now());
UPDATE auth.users SET raw_app_meta_data = jsonb_build_object(
  'must_change_password',true,'temporary_password_set_at',now() - interval '2 minutes')
  WHERE id IN ('19000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"29000000-0000-4000-8000-000000000001","app_metadata":{"must_change_password":false}}',true);
DO $$ BEGIN
  IF public.nv_session_ready() OR public.nv_password_change_allowed() OR EXISTS (SELECT 1 FROM public.user_accounts)
    OR EXISTS (SELECT 1 FROM public.nv_staff_shifts) OR EXISTS (SELECT 1 FROM public.medical_documents)
    OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'profile-avatars')
    OR EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document')))
    OR public.nv_reserve_document_upload() THEN RAISE EXCEPTION 'FAIL: stale staff JWT bypassed password change'; END IF;
  BEGIN
    PERFORM public.nv_report_shifts('nv-portal-a','2099-12-01','2099-12-31');
    RAISE EXCEPTION 'FAIL: stale JWT can export';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.nv_update_shift_payment('nv-december','pending');
    RAISE EXCEPTION 'FAIL: stale JWT can settle';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"29000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
  IF NOT public.nv_password_change_allowed() OR public.nv_session_ready() THEN
    RAISE EXCEPTION 'FAIL: fresh temporary session cannot complete only the password change';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.nv_session_ready() OR jsonb_array_length(public.nv_portal_enrollments()) <> 0
    OR jsonb_array_length(public.nv_portal_notifications()) <> 0 OR public.nv_notification_preferences() IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document'),'write')) THEN
    RAISE EXCEPTION 'FAIL: stale physician JWT bypassed password change';
  END IF;
END $$;
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data = '{"must_change_password":false}'
  WHERE id = '19000000-0000-4000-8000-000000000002';
UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('must_change_password',false,'password_changed_at',now() - interval '30 seconds')
  WHERE id = '19000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"29000000-0000-4000-8000-000000000002"}',true);
DO $$ BEGIN
  IF public.nv_session_ready() OR public.nv_password_change_allowed() THEN RAISE EXCEPTION 'FAIL: old session regained access after password change'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"29000000-0000-4000-8000-000000000003"}',true);
DO $$ BEGIN
  IF NOT public.nv_session_ready() OR NOT EXISTS (SELECT 1 FROM public.nv_staff_shifts) THEN
    RAISE EXCEPTION 'FAIL: new session lost staff access after password change';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF NOT public.nv_session_ready() OR NOT EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document')))
    OR EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document'),'read',current_setting('nv.test.revision')::uuid))
    THEN RAISE EXCEPTION 'FAIL: physician permissions after password change'; END IF;
  FOR i IN 1..12 LOOP
    IF NOT public.nv_reserve_document_upload() THEN RAISE EXCEPTION 'FAIL: upload quota too low'; END IF;
  END LOOP;
  IF public.nv_reserve_document_upload() THEN RAISE EXCEPTION 'FAIL: upload quota exceeded'; END IF;
END $$;
RESET ROLE;
UPDATE public.doctors SET status = 'inactive' WHERE id = current_setting('nv.test.doctor_a');
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document')))
    THEN RAISE EXCEPTION 'FAIL: inactive physician can sign'; END IF;
END $$;
RESET ROLE;
UPDATE public.doctors SET status = 'active' WHERE id = current_setting('nv.test.doctor_a');
UPDATE public.organizations SET status = 'suspended' WHERE id = 'nv-portal-a';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.nv_portal_document_target(current_setting('nv.test.document'),'write'))
    THEN RAISE EXCEPTION 'FAIL: suspended tenant permits physician upload'; END IF;
END $$;
RESET ROLE;
UPDATE public.user_accounts SET status = 'inactive' WHERE id = 'nv-portal-admin';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.nv_session_ready() OR EXISTS (SELECT 1 FROM public.user_accounts) THEN
    RAISE EXCEPTION 'FAIL: inactive account retained access';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'medical-documents') THEN
    RAISE EXCEPTION 'FAIL: anonymous storage read';
  END IF;
END $$;
RESET ROLE;
SELECT 'PASS: portal, finance, reports, live sessions, restrictive storage, document revisions and upload quota' AS verification;
ROLLBACK;
