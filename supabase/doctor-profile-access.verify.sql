-- Disposable database only, after 36. Every synthetic mutation is rolled back.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE p jsonb; BEGIN
 IF public.nv_doctor_access('nv-bank-peer')->>'status'<>'not_released' THEN RAISE EXCEPTION 'FAIL: imported access auto released'; END IF;
 p:=public.nv_doctor_profile('nv-bank-doctor');
 PERFORM public.nv_update_doctor_profile('nv-bank-doctor','{"name":"Updated Doctor","phone":"11988887777","address":"Rua sintética"}',(p->'profile'->>'updated_at')::timestamptz);
 BEGIN
  PERFORM public.nv_update_doctor_profile('nv-bank-doctor','{"cpf":"11111111111"}',(public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: invalid CPF accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  PERFORM public.nv_update_doctor_profile('nv-bank-doctor','{"email":"bypass@example.invalid"}',(public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: email bypass'; EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 BEGIN
  PERFORM public.nv_update_doctor_profile('nv-bank-doctor','{"name":"Stale Doctor"}',now()-interval '1 day');
  RAISE EXCEPTION 'FAIL: stale update'; EXCEPTION WHEN invalid_parameter_value THEN NULL;
 END;
 PERFORM public.nv_prepare_doctor_credential('nv-bank-peer');
 PERFORM public.nv_update_doctor_banking('nv-bank-peer','{"pix_key_type":"cpf","pix_key":"11144477735"}');
 PERFORM public.nv_review_enrollment('nv-bank-peer','approved',NULL,ARRAY['Cirurgia'],ARRAY['nv-bank-unit']);
 IF public.nv_doctor_access('nv-bank-peer')->>'status'<>'not_released' THEN RAISE EXCEPTION 'FAIL: approval created access'; END IF;
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(jsonb_build_object('id','nv36-offline-shift','organization_id','nv-bank-org','unit_id','nv-bank-unit','sector_id','nv-bank-sector',
  'doctor_id','nv-bank-peer','date',current_date+3,'start_time','07:00','end_time','19:00','type','onsite','status','confirmed','specialty','Cirurgia','employment_type','clt','employer_name','Synthetic')));
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(jsonb_build_object('id','nv36-vacancy','organization_id','nv-bank-org','unit_id','nv-bank-unit','sector_id','nv-bank-sector',
  'date',current_date+4,'start_time','07:00','end_time','19:00','type','onsite','status','open','specialty','Cirurgia','employment_type','clt')));
 IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='nv36-offline-shift' AND doctor_id='nv-bank-peer') THEN RAISE EXCEPTION 'FAIL: offline scheduling'; END IF;
 PERFORM public.nv_create_doctor_with_banking('{"id":"nv36-new-doctor","organization_id":"nv-bank-org","name":"New Administrative","crm":"3636","crm_uf":"SP","email":"nv36-new@example.invalid","specialty":"Cirurgia","status":"pending"}','{"pix_key_type":"cpf","pix_key":"11144477735"}');
 IF public.nv_doctor_access('nv36-new-doctor')->>'status'<>'not_released' THEN RAISE EXCEPTION 'FAIL: new doctor automatically released'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT FROM auth.users WHERE email='nv36-new@example.invalid') OR EXISTS(SELECT FROM public.doctor_access_operations WHERE doctor_id='nv36-new-doctor') THEN RAISE EXCEPTION 'FAIL: administrative creation dispatched access'; END IF;
 IF NOT EXISTS(SELECT FROM public.doctor_enrollments WHERE doctor_id='nv-bank-peer' AND auth_user_id IS NULL AND status='approved') THEN RAISE EXCEPTION 'FAIL: independent credential'; END IF;
 IF NOT EXISTS(SELECT FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-doctor' AND action='profile_updated' AND actor_id='32000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: profile audit'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_begin_doctor_access('nv-bank-peer','invite',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: coordinator managed access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.doctors SET email='coordinator-bypass@example.invalid' WHERE id='nv-bank-peer';
  RAISE EXCEPTION 'FAIL: direct unlinked email bypass'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_finish_doctor_access(gen_random_uuid(),'sent'); RAISE EXCEPTION 'FAIL: caller completed privileged operation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.doctor_access_operations; RAISE EXCEPTION 'FAIL: direct operations read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_doctor_profile('nv-bank-peer'); RAISE EXCEPTION 'FAIL: cross tenant profile'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_access('nv-bank-peer'); RAISE EXCEPTION 'FAIL: cross tenant access'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_history('nv-bank-peer'); RAISE EXCEPTION 'FAIL: cross tenant audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ DECLARE p jsonb; BEGIN
 p:=public.nv_doctor_profile('nv-bank-doctor');
 PERFORM public.nv_update_doctor_profile('nv-bank-doctor','{"phone":"11977776666"}',(p->'profile'->>'updated_at')::timestamptz);
 IF public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'phone'<>'11977776666' THEN RAISE EXCEPTION 'FAIL: own profile update'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date,current_date+10,true)) s WHERE s->>'id'='nv-bank-shift') THEN RAISE EXCEPTION 'FAIL: own schedule'; END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date,current_date+10,false)) s WHERE s->>'id'='nv36-vacancy') THEN RAISE EXCEPTION 'FAIL: compatible vacancy'; END IF;
 PERFORM public.nv_apply_for_shift('nv36-vacancy');
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_applications()) a WHERE a->>'shift_id'='nv36-vacancy' AND a->>'status'='pending') THEN RAISE EXCEPTION 'FAIL: application tracking'; END IF;
 PERFORM public.nv_apply_for_shift('nv36-vacancy',true);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_applications()) a WHERE a->>'shift_id'='nv36-vacancy' AND a->>'status'='cancelled') THEN RAISE EXCEPTION 'FAIL: application cancellation'; END IF;
 PERFORM public.nv_request_exchange('nv-bank-shift');
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(public.nv_portal_schedule(current_date,current_date+10,true)) s WHERE s->>'id'='nv-bank-shift' AND s->>'status'='exchange') THEN RAISE EXCEPTION 'FAIL: exchange tracking'; END IF;
 PERFORM public.nv_request_exchange('nv-bank-shift',true);
 BEGIN PERFORM public.nv_doctor_profile('nv-bank-peer'); RAISE EXCEPTION 'FAIL: peer profile read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_doctor_history('nv-bank-doctor'); RAISE EXCEPTION 'FAIL: physician audit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_update_doctor_profile('nv-bank-doctor','{"status":"inactive"}',(public.nv_doctor_profile('nv-bank-doctor')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: self status escalation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Self-signup cannot claim an administrative record without a release.
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000006","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_submit_enrollment('nv-bank-org','Imported Claim','3202','SP','11144477735','1980-01-01','11999999999','52998224725',ARRAY['Cirurgia'],'{"pix_key_type":"cpf","pix_key":"52998224725"}');
  RAISE EXCEPTION 'FAIL: imported record claimed without release'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('nv.test_operation',(public.nv_begin_doctor_access('nv-bank-peer','invite',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz)->>'id'),true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_begin_doctor_access('nv-bank-peer','invite',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: duplicate concurrent invitation'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
-- Simulate GoTrue's native invite insert. The link must already be durable before mail.
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('36000000-0000-4000-8000-000000000001','bank-peer@example.invalid',jsonb_build_object('nv_med_access_operation',current_setting('nv.test_operation')));
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.doctor_enrollments WHERE doctor_id='nv-bank-peer' AND auth_user_id='36000000-0000-4000-8000-000000000001' AND status='approved') THEN RAISE EXCEPTION 'FAIL: invite changed credential or did not link'; END IF;
 IF (SELECT count(*) FROM public.doctors WHERE id='nv-bank-peer')<>1 OR NOT EXISTS(SELECT FROM public.shifts WHERE id='nv36-offline-shift' AND doctor_id='nv-bank-peer') THEN RAISE EXCEPTION 'FAIL: identity/shift lost'; END IF;
END $$;
SELECT public.nv_finish_doctor_access(current_setting('nv.test_operation')::uuid,'sent');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.nv_doctor_access('nv-bank-peer')->>'status'<>'pending' THEN RAISE EXCEPTION 'FAIL: invitation status'; END IF; END $$;
RESET ROLE;
-- A retry uses the same Auth identity, never creates another physician.
UPDATE public.doctor_access_operations SET created_at=created_at-interval '2 minutes';
SET LOCAL ROLE authenticated;
DO $$ DECLARE op jsonb; BEGIN
 op:=public.nv_begin_doctor_access('nv-bank-peer','invite',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz);
 IF op->>'auth_user_id'<>'36000000-0000-4000-8000-000000000001' THEN RAISE EXCEPTION 'FAIL: resend identity'; END IF;
END $$;
RESET ROLE;
UPDATE public.doctor_access_operations SET status='failed' WHERE status='pending';
UPDATE auth.users SET email_confirmed_at=now(),last_sign_in_at=now(),raw_app_meta_data='{}' WHERE id='36000000-0000-4000-8000-000000000001';
UPDATE public.doctor_access_operations SET created_at=created_at-interval '2 minutes';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.nv_doctor_access('nv-bank-peer')->>'status'<>'active' THEN RAISE EXCEPTION 'FAIL: active status'; END IF; END $$;
SELECT set_config('nv.test_operation',(public.nv_begin_doctor_access('nv-bank-peer','email','new-peer@example.invalid',(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz)->>'id'),true);
RESET ROLE;
-- Simulates Auth Admin update; linked public email must commit in the same transaction.
UPDATE auth.users SET email='new-peer@example.invalid' WHERE id='36000000-0000-4000-8000-000000000001';
SELECT public.nv_finish_doctor_access(current_setting('nv.test_operation')::uuid,'sent');
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.doctors WHERE id='nv-bank-peer' AND email='new-peer@example.invalid') THEN RAISE EXCEPTION 'FAIL: Auth/profile divergence'; END IF;
 IF NOT EXISTS(SELECT FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-peer' AND action='email_changed' AND actor_id='32000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: email audit attribution'; END IF;
 BEGIN
  UPDATE auth.users SET email='bank-doctor@example.invalid' WHERE id='36000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'FAIL: duplicate email committed'; EXCEPTION WHEN unique_violation THEN NULL;
 END;
 IF (SELECT email FROM auth.users WHERE id='36000000-0000-4000-8000-000000000001')<>'new-peer@example.invalid' THEN RAISE EXCEPTION 'FAIL: duplicate Auth update did not roll back'; END IF;
END $$;
UPDATE public.doctor_access_operations SET created_at=created_at-interval '2 minutes';
SET LOCAL ROLE authenticated;
SELECT set_config('nv.test_operation',(public.nv_begin_doctor_access('nv-bank-peer','block',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz)->>'id'),true);
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '100 years' WHERE id='36000000-0000-4000-8000-000000000001';
SELECT public.nv_finish_doctor_access(current_setting('nv.test_operation')::uuid,'sent');
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.nv_doctor_access('nv-bank-peer')->>'status'<>'blocked' THEN RAISE EXCEPTION 'FAIL: blocked status'; END IF; END $$;
SELECT set_config('request.jwt.claims','{"sub":"36000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
 IF public.nv_session_ready() OR public.nv_portal_enrollments()<>'[]'::jsonb THEN RAISE EXCEPTION 'FAIL: old JWT bypassed block'; END IF;
 BEGIN PERFORM public.nv_doctor_profile('nv-bank-peer'); RAISE EXCEPTION 'FAIL: blocked read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.shifts WHERE id='nv36-offline-shift' AND doctor_id='nv-bank-peer') OR NOT EXISTS(SELECT FROM public.doctors WHERE id='nv-bank-peer' AND status='active') THEN RAISE EXCEPTION 'FAIL: block altered schedules/registry'; END IF;
END $$;
UPDATE public.doctor_access_operations SET created_at=created_at-interval '2 minutes';
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT set_config('nv.test_operation',(public.nv_begin_doctor_access('nv-bank-peer','unblock',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz)->>'id'),true);
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='36000000-0000-4000-8000-000000000001';
SELECT public.nv_finish_doctor_access(current_setting('nv.test_operation')::uuid,'sent');
UPDATE public.doctor_access_operations SET created_at=created_at-interval '2 minutes';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.nv_doctor_access('nv-bank-peer')->>'status'<>'active' THEN RAISE EXCEPTION 'FAIL: unblock did not restore access'; END IF; END $$;
SELECT set_config('nv.test_operation',(public.nv_begin_doctor_access('nv-bank-peer','reset',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz)->>'id'),true);
RESET ROLE;
SELECT public.nv_finish_doctor_access(current_setting('nv.test_operation')::uuid,'failed');
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-peer' AND action='reset_failed' AND actor_id='32000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: reset failure audit'; END IF;
 IF NOT EXISTS(SELECT FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-peer' AND action='access_unblocked' AND actor_id='32000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: unblock attribution'; END IF;
END $$;
-- A shared identity cannot be globally changed by a manager of only one tenant.
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,email,specialty,status)
 VALUES('nv36-shared','nv-bank-other','Shared Synthetic','3699','SP','new-peer@example.invalid','Cirurgia','pending');
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,submitted_name,submitted_phone,requested_specialties)
 VALUES('nv36-shared','nv-bank-other','36000000-0000-4000-8000-000000000001',NULL,'Shared Synthetic','',ARRAY['Cirurgia']);
UPDATE public.doctor_access_operations SET created_at=created_at-interval '2 minutes';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.nv_begin_doctor_access('nv-bank-peer','block',NULL,(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: cross-tenant shared block'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.nv_begin_doctor_access('nv-bank-peer','email','shared-change@example.invalid',(public.nv_doctor_profile('nv-bank-peer')->'profile'->>'updated_at')::timestamptz);
  RAISE EXCEPTION 'FAIL: cross-tenant shared email'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- Effective grants and explicit denials must agree with the client permission matrix.
UPDATE public.user_accounts SET additional_permissions='{"portal_medico.view":"allow","portal_medico.edit":"allow"}' WHERE id='nv-bank-coordinator';
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT public.nv_can_action('nv-bank-org','portal_medico','edit') THEN RAISE EXCEPTION 'FAIL: explicit access grant ignored'; END IF; END $$;
RESET ROLE;
UPDATE public.user_accounts SET additional_permissions='{"portal_medico.view":"deny","portal_medico.edit":"allow"}' WHERE id='nv-bank-coordinator';
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.nv_can_action('nv-bank-org','portal_medico','edit') THEN RAISE EXCEPTION 'FAIL: view denial bypassed'; END IF; END $$;
RESET ROLE;
ROLLBACK;
