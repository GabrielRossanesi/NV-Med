-- Synthetic, disposable PostgreSQL only. Roll back every fixture/change.
BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- Reproduce the original cause: activation is rejected at COMMIT if PIX is incomplete.
DO $$ BEGIN
 UPDATE public.doctors SET status='pending' WHERE id='nv-bank-peer';
 BEGIN
  PERFORM public.nv_set_doctor_status('nv-bank-peer','active',(SELECT updated_at FROM public.doctors WHERE id='nv-bank-peer'));
  SET CONSTRAINTS nv_require_new_doctor_banking IMMEDIATE;
  RAISE EXCEPTION 'FAIL: activation bypassed banking';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>'Preencha a chave PIX e seu tipo antes de concluir o cadastro.' THEN RAISE; END IF;
 END;
 IF (SELECT status FROM public.doctors WHERE id='nv-bank-peer')<>'pending' THEN RAISE EXCEPTION 'FAIL: failed activation persisted'; END IF;
 PERFORM public.nv_update_doctor_banking('nv-bank-peer','{"pix_key_type":"cpf","pix_key":"11144477735"}');
 PERFORM public.nv_prepare_doctor_credential('nv-bank-peer');
END $$;
RESET ROLE;
CREATE TEMP TABLE nv_status_preserve AS SELECT
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.shifts x) shifts,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.medical_documents x) documents,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY doctor_id)::text) FROM public.doctor_enrollments x) enrollments,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY doctor_id)::text) FROM public.doctor_banking x) banking,
 (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM auth.users x) auth,
 (SELECT to_jsonb(x)-'status'-'updated_at' FROM public.doctors x WHERE id='nv-bank-peer') doctor;
CREATE TEMP TABLE nv_status_audit_baseline AS SELECT count(*) n FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-peer';
SET LOCAL ROLE authenticated;
DO $$ DECLARE requested text; result jsonb; BEGIN
 FOREACH requested IN ARRAY ARRAY['active','inactive','active','pending'] LOOP
  result:=public.nv_set_doctor_status('nv-bank-peer',requested,(SELECT updated_at FROM public.doctors WHERE id='nv-bank-peer'));
  SET CONSTRAINTS nv_require_new_doctor_banking IMMEDIATE;
  IF result->>'status'<>requested OR (SELECT status FROM public.doctors WHERE id='nv-bank-peer')<>requested THEN RAISE EXCEPTION 'FAIL: status not persisted'; END IF;
  IF result ?| ARRAY['cpf','phone','email','address'] THEN RAISE EXCEPTION 'FAIL: personal data leaked'; END IF;
 END LOOP;
 PERFORM public.nv_set_doctor_status('nv-bank-peer','pending',(SELECT updated_at FROM public.doctors WHERE id='nv-bank-peer'));
 BEGIN PERFORM public.nv_set_doctor_status('nv-bank-peer','active',now()-interval '1 day'); RAISE EXCEPTION 'FAIL: stale revision'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN PERFORM public.nv_set_doctor_status('nv-bank-peer','bogus',(SELECT updated_at FROM public.doctors WHERE id='nv-bank-peer')); RAISE EXCEPTION 'FAIL: invalid status'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-peer')<>(SELECT n+4 FROM nv_status_audit_baseline) THEN RAISE EXCEPTION 'FAIL: missing or duplicate status audits'; END IF;
 IF (SELECT count(*) FROM public.doctor_profile_audit WHERE doctor_id='nv-bank-peer' AND details ? 'previous_status' AND details ? 'status'
  AND actor_id='32000000-0000-4000-8000-000000000001')<4 THEN RAISE EXCEPTION 'FAIL: status audit metadata'; END IF;
 IF EXISTS(SELECT FROM nv_status_preserve p WHERE p.shifts IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.shifts x)
  OR p.documents IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM public.medical_documents x)
  OR p.enrollments IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY doctor_id)::text) FROM public.doctor_enrollments x)
  OR p.banking IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY doctor_id)::text) FROM public.doctor_banking x)
  OR p.auth IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(x) ORDER BY id)::text) FROM auth.users x)
  OR p.doctor IS DISTINCT FROM (SELECT to_jsonb(x)-'status'-'updated_at' FROM public.doctors x WHERE id='nv-bank-peer')) THEN RAISE EXCEPTION 'FAIL: unrelated data changed'; END IF;
 IF EXISTS(SELECT FROM public.doctor_access_operations) THEN RAISE EXCEPTION 'FAIL: status released access'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN BEGIN PERFORM public.nv_set_doctor_status('nv-bank-peer','active',now()); RAISE EXCEPTION 'FAIL: cross tenant write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN BEGIN PERFORM public.nv_set_doctor_status('nv-bank-doctor','inactive',now()); RAISE EXCEPTION 'FAIL: self status escalation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN BEGIN PERFORM public.nv_set_doctor_status('nv-bank-peer','active',now()); RAISE EXCEPTION 'FAIL: unauthenticated write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
RESET ROLE;
ROLLBACK;
