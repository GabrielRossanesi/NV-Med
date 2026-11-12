-- Synthetic legacy records. Only for the disposable database, BEFORE migration 32.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('32000000-0000-4000-8000-000000000001','authenticated','authenticated','bank-admin@example.invalid',now()),
 ('32000000-0000-4000-8000-000000000002','authenticated','authenticated','bank-doctor@example.invalid',now()),
 ('32000000-0000-4000-8000-000000000003','authenticated','authenticated','bank-coordinator@example.invalid',now()),
 ('32000000-0000-4000-8000-000000000004','authenticated','authenticated','bank-foreign@example.invalid',now()),
 ('32000000-0000-4000-8000-000000000005','authenticated','authenticated','bank-finance@example.invalid',now()),
 ('32000000-0000-4000-8000-000000000006','authenticated','authenticated','bank-new@example.invalid',now());
INSERT INTO public.organizations(id,name,settings) VALUES
 ('nv-bank-org','Banking synthetic','{"specialties":["Cirurgia"],"requiredDocuments":[]}'),('nv-bank-other','Other banking','{}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role) VALUES
 ('nv-bank-admin','32000000-0000-4000-8000-000000000001','Admin','bank-admin@example.invalid','tenant_user','nv-bank-org','Diretor'),
 ('nv-bank-coordinator','32000000-0000-4000-8000-000000000003','Coordinator','bank-coordinator@example.invalid','tenant_user','nv-bank-org','Coordenador de Escalas'),
 ('nv-bank-foreign','32000000-0000-4000-8000-000000000004','Foreign','bank-foreign@example.invalid','tenant_user','nv-bank-other','Diretor'),
 ('nv-bank-finance','32000000-0000-4000-8000-000000000005','Finance','bank-finance@example.invalid','tenant_user','nv-bank-org','Financeiro');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,cpf,email,specialty,status) VALUES
 ('nv-bank-doctor','nv-bank-org','Legacy Doctor','3201','SP','52998224725','bank-doctor@example.invalid','Cirurgia','active'),
 ('nv-bank-peer','nv-bank-org','Other Doctor','3202','SP','11144477735','bank-peer@example.invalid','Cirurgia','active');
INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,pix_key,submitted_name,submitted_phone,requested_specialties,approved_specialties,status) VALUES
 ('nv-bank-doctor','nv-bank-org','32000000-0000-4000-8000-000000000002','1980-01-01','legacy-key-preserved','Legacy Doctor','11999999999',ARRAY['Cirurgia'],ARRAY['Cirurgia'],'approved');
INSERT INTO public.units(id,organization_id,name,type) VALUES ('nv-bank-unit','nv-bank-org','Banking hospital','hospital');
UPDATE public.doctors SET linked_units=ARRAY['nv-bank-unit'] WHERE id='nv-bank-doctor';
INSERT INTO public.sectors(id,organization_id,unit_id,name,primary_specialty,specialties)
VALUES ('nv-bank-sector','nv-bank-org','nv-bank-unit','Banking sector','Cirurgia',ARRAY['Cirurgia']);
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',false);
INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,doctor_id,date,start_time,end_time,type,status,specialty,employment_type,employer_name,payment_amount,payment_frequency)
VALUES ('nv-bank-shift','nv-bank-org','nv-bank-unit','nv-bank-sector','nv-bank-doctor',current_date+2,'07:00','19:00','onsite','confirmed','Cirurgia','pj','Synthetic PJ',500,'monthly');
