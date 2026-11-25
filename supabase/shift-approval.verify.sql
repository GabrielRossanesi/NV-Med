-- Synthetic verification of approval, timezone, edit protection and the audit trail.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('48000000-0000-4000-8000-000000000001','approval-admin@example.invalid'),
 ('48000000-0000-4000-8000-000000000002','approval-doctor@example.invalid'),
 ('48000000-0000-4000-8000-000000000003','approval-other@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
 ('approval-org','Empresa sintética','{"specialties":["Cirurgia"]}'),
 ('approval-other','Outra empresa','{"specialties":["Cirurgia"]}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('approval-admin','48000000-0000-4000-8000-000000000001','Direção','approval-admin@example.invalid','tenant_user','approval-org','Diretor'),
 ('approval-other-user','48000000-0000-4000-8000-000000000003','Outra direção','approval-other@example.invalid','tenant_user','approval-other','Diretor');
INSERT INTO public.units(id,organization_id,name,type,time_zone)
VALUES ('approval-unit','approval-org','Hospital','hospital','America/Manaus');
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties,primary_specialty)
VALUES ('approval-sector','approval-org','approval-unit','Cirurgia',ARRAY['Cirurgia'],'Cirurgia');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,linked_units)
VALUES ('approval-doctor','approval-org','Médico com acesso','101','AM','Cirurgia',ARRAY['approval-unit']),
 ('approval-offline','approval-org','Médico sem acesso','102','AM','Cirurgia',ARRAY['approval-unit']);
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,
  submitted_name,submitted_phone,requested_specialties,approved_specialties,status)
VALUES ('approval-doctor','approval-org','48000000-0000-4000-8000-000000000002','1985-01-01','test@example.invalid',
 'Médico com acesso','11999990000',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved'),
 ('approval-offline','approval-org',NULL,'1985-01-02','offline@example.invalid',
 'Médico sem acesso','11999990001',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved');

INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,employment_type)
SELECT id,'approval-org',doctor,'approval-unit','approval-sector','Cirurgia',day,'23:00','07:00','onsite',status,'clt'
FROM (VALUES
 ('approval-admin-shift','approval-offline',current_date-5,'pending'),
 ('approval-auto','approval-doctor',current_date-4,'pending'),
 ('approval-cancelled','approval-doctor',current_date-3,'cancelled'),
 ('approval-open',NULL,current_date-3,'open'),
 ('approval-future','approval-doctor',current_date+4,'pending')
) items(id,doctor,day,status);

DO $$ DECLARE item public.shifts; BEGIN
 SELECT * INTO item FROM public.shifts WHERE id='approval-auto';
 IF public.nv_shift_ends(item) <> (item.date+1+time '07:00') AT TIME ZONE 'America/Manaus' THEN
   RAISE EXCEPTION 'FAIL overnight unit deadline';
 END IF;
END $$;

-- Check the boundary with a nested rollback before the remaining scenarios.
DO $$ DECLARE cutoff timestamptz; first_run integer; retry integer; BEGIN
  IF public.nv_auto_approve_expired_shifts() <> 0 THEN
    RAISE EXCEPTION 'FAIL approval before activation';
  END IF;
  SELECT public.nv_shift_ends(s) INTO cutoff FROM public.shifts s WHERE s.id='approval-admin-shift';
  BEGIN
    first_run := nv_master_private.auto_approve_expired_shifts('approval-org', cutoff);
    retry := nv_master_private.auto_approve_expired_shifts('approval-org', cutoff);
    IF first_run <> 1 OR retry <> 0 THEN
      RAISE EXCEPTION 'FAIL cutoff or repeat affected % / % shifts', first_run, retry;
    END IF;
    IF EXISTS (SELECT FROM public.shifts WHERE id='approval-admin-shift' AND approval_source <> 'pending')
      OR NOT EXISTS (SELECT FROM public.shifts WHERE id='approval-auto' AND approval_source = 'automatic') THEN
      RAISE EXCEPTION 'FAIL cutoff must exclude its boundary and protect the old shift';
    END IF;
    RAISE SQLSTATE 'Z5201' USING MESSAGE = 'Restore synthetic data for the next scenarios.';
  EXCEPTION WHEN SQLSTATE 'Z5201' THEN NULL;
  END;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN
   PERFORM public.nv_approve_shift('approval-admin-shift',0,true,'Confirmação externa.');
   RAISE EXCEPTION 'FAIL cross tenant approval';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE item jsonb; BEGIN
 PERFORM public.nv_approve_shift('approval-admin-shift',0,true,'Confirmação externa.');
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.id='approval-admin-shift';
 IF item->>'approval_source' <> 'administrative' THEN RAISE EXCEPTION 'FAIL approval without portal'; END IF;
 BEGIN
   PERFORM public.nv_save_operational_shifts(jsonb_build_array(item || '{"end_time":"06:00"}'));
   RAISE EXCEPTION 'FAIL missing retroactive reason';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item || '{"end_time":"06:00","retro_reason":"Horário corrigido."}'));
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
 IF nv_master_private.auto_approve_expired_shifts('approval-org') <> 1
   OR nv_master_private.auto_approve_expired_shifts('approval-org') <> 0 THEN
   RAISE EXCEPTION 'FAIL automatic approval or rerun';
 END IF;
 IF EXISTS(SELECT FROM public.shifts WHERE id IN ('approval-cancelled','approval-open','approval-future') AND approval_source <> 'pending') THEN
   RAISE EXCEPTION 'FAIL ineligible automatic approval';
 END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT public.nv_approve_shift('approval-auto',0,false);
SELECT public.nv_approve_shift('approval-future',0,false);
DO $$ BEGIN
 IF public.nv_portal_schedule(current_date-4,current_date+4,true)->0->>'approval_source' <> 'doctor' THEN
   RAISE EXCEPTION 'FAIL explicit confirmation in portal';
 END IF;
 BEGIN PERFORM public.nv_auto_approve_expired_shifts(); RAISE EXCEPTION 'FAIL cron grant';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE item jsonb; BEGIN
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.id='approval-auto';
 BEGIN
   PERFORM public.nv_save_operational_shifts(jsonb_build_array(item || '{"status":"pending","approval_source":"pending","end_time":"06:00","retro_reason":"Não altera proteção."}'));
   RAISE EXCEPTION 'FAIL operational lock can be bypassed';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 SELECT to_jsonb(s) INTO item FROM public.nv_staff_shifts s WHERE s.id='approval-future';
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(item || '{"end_time":"06:00"}'));
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='approval-future' AND approval_source='pending' AND approval_revision=1)
 THEN RAISE EXCEPTION 'FAIL reconfirmation'; END IF;
END $$;

RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.master_schedule_audit WHERE shift_id='approval-auto' AND action='shift_approved') <> 2
   OR NOT EXISTS (SELECT FROM public.master_schedule_audit WHERE shift_id='approval-auto' AND action='shift_approved' AND origin='automatic' AND actor_id IS NULL)
   OR NOT EXISTS (SELECT FROM public.master_schedule_audit WHERE shift_id='approval-admin-shift' AND action='shift_retroactively_edited'
     AND previous->>'end_time'='07:00' AND next->>'end_time'='06:00' AND next->>'reason'='Horário corrigido.')
 THEN RAISE EXCEPTION 'FAIL approval history'; END IF;
END $$;
ROLLBACK;
