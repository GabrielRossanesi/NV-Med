-- Synthetic verification of cash settlement and reversal.
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

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE spec jsonb; item jsonb; BEGIN
 spec := jsonb_build_object('id','cash-shift','organization_id','approval-org','doctor_id','approval-offline',
   'unit_id','approval-unit','sector_id','approval-sector','specialty','Cirurgia','date',current_date+4,
   'start_time','07:00','end_time','19:00','type','onsite','status','pending','employment_type','pj','employer_name','PJ',
   'agreement','{"mode":"manual","amount_cents":90000,"frequency":"on_delivery","override_reason":"Contrato demonstrativo."}'::jsonb,
   'cash_payment',jsonb_build_object('id','49000000-0000-4000-8000-000000000001','amount',125.25,'paid_on',current_date-1,'method','pix','note','Sinal'));
 item := public.nv_save_operational_shifts(jsonb_build_array(spec))->0;
 IF (item->>'paid_amount')::numeric <> 125.25 OR (item->>'payment_amount')::numeric <> 900 THEN
   RAISE EXCEPTION 'FAIL atomic settlement'; END IF;
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(spec));
 IF jsonb_array_length(public.nv_shift_payment_movements('cash-shift')) <> 1 THEN RAISE EXCEPTION 'FAIL retry'; END IF;
 item := public.nv_register_shift_payment('cash-shift','49000000-0000-4000-8000-000000000002',500,current_date-1,'cash');
 IF (item->>'paid_amount')::numeric <> 625.25 THEN RAISE EXCEPTION 'FAIL cumulative partial payments'; END IF;
 BEGIN
  PERFORM public.nv_register_shift_payment('cash-shift','49000000-0000-4000-8000-000000000003',300,current_date-1,'pix');
  RAISE EXCEPTION 'FAIL overpayment';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 item := public.nv_register_shift_payment('cash-shift','49000000-0000-4000-8000-000000000004',NULL,current_date-1,NULL,'Transferência cancelada.',NULL,
   '49000000-0000-4000-8000-000000000001');
 IF (item->>'paid_amount')::numeric <> 500 THEN RAISE EXCEPTION 'FAIL reversal'; END IF;
 PERFORM public.nv_register_shift_payment('cash-shift','49000000-0000-4000-8000-000000000004',NULL,current_date-1,NULL,'Transferência cancelada.',NULL,
   '49000000-0000-4000-8000-000000000001');
 IF jsonb_array_length(public.nv_shift_payment_movements('cash-shift')) <> 3 THEN RAISE EXCEPTION 'FAIL reversal retry'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
 IF public.nv_shift_payment_movements('cash-shift') <> '[]' THEN RAISE EXCEPTION 'FAIL medical access'; END IF;
 BEGIN
  PERFORM public.nv_register_shift_payment('cash-shift','49000000-0000-4000-8000-000000000003',10,current_date-1,'pix');
  RAISE EXCEPTION 'FAIL unauthorized payment';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
