DO $$ BEGIN
  IF session_user !~ '^nvmed_[0-9a-f]{32}$' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet THEN
    RAISE EXCEPTION 'Execute este teste somente no laboratório descartável.';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS dblink;
-- Two-session test. This script requires the disposable, loopback-only PostgreSQL lab.
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

INSERT INTO public.doctor_banking(doctor_id,organization_id,pix_key,pix_key_type) VALUES
 ('approval-doctor','approval-org','doctor@example.invalid','email'),
 ('approval-offline','approval-org','offline@example.invalid','email');
INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,employment_type)
VALUES ('concurrent-approval','approval-org','approval-doctor','approval-unit','approval-sector','Cirurgia',current_date-2,'07:00','19:00',
 'onsite','pending','clt');
INSERT INTO nv_master_private.shift_approval_schedule(activated_at)
VALUES (statement_timestamp() - interval '3 days');
COMMIT;

SELECT public.dblink_connect('approval_competing_connection',format('host=127.0.0.1 port=%s dbname=%s user=%s',
 current_setting('port'),current_database(),session_user));
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT public.nv_approve_shift('concurrent-approval',0,false);
RESET ROLE;
DO $$ DECLARE count integer; BEGIN
 SELECT result INTO count FROM public.dblink('approval_competing_connection','SELECT public.nv_auto_approve_expired_shifts()') AS row(result integer);
 IF count<>0 THEN RAISE EXCEPTION 'FAIL worker skipped a row locked by the physician'; END IF;
END $$;
COMMIT;
DO $$ DECLARE count integer; BEGIN
 SELECT result INTO count FROM public.dblink('approval_competing_connection','SELECT public.nv_auto_approve_expired_shifts()') AS row(result integer);
 IF count<>0 OR (SELECT approval_source FROM public.shifts WHERE id='concurrent-approval')<>'doctor'
   OR (SELECT count(*) FROM public.master_schedule_audit WHERE shift_id='concurrent-approval' AND action='shift_approved')<>1 THEN
  RAISE EXCEPTION 'FAIL concurrent routine overwrote explicit approval';
 END IF;
END $$;
SELECT public.dblink_disconnect('approval_competing_connection');
