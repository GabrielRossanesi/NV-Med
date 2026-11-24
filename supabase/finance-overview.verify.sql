-- Synthetic verification of enterprise overview, cash accounting and export authorization.
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
DO $$
DECLARE client uuid; contract uuid; rule uuid; scope jsonb; invoice uuid; monthly date; result jsonb; spec jsonb;
BEGIN
 monthly:=(date_trunc('month',current_date::timestamp)-interval '1 month')::date;
 client:=public.nv_save_billing_client('approval-org',NULL,'OSS de teste');
 contract:=public.nv_save_billing_client('approval-org',NULL,'Contrato de teste',client);
 scope:=jsonb_build_object('contract_id',contract,'valid_from',monthly,'revenue_rate',155.335,'medical_rate',100,'unit_id','approval-unit');
 rule:=public.nv_save_billing_rate('approval-org',NULL,scope,'Vigência original.');
 BEGIN
  PERFORM public.nv_save_billing_rate('approval-org',NULL,scope,'Regra duplicada.');
  RAISE EXCEPTION 'FAIL rate ambiguity';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.nv_save_billing_rate('approval-org',NULL,
   scope || jsonb_build_object('unit_id',NULL,'revenue_rate',120,'medical_rate',80),'Regra geral.');
 spec:=jsonb_build_object('id','billing-shift','organization_id','approval-org','doctor_id','approval-offline',
   'unit_id','approval-unit','sector_id','approval-sector','specialty','Cirurgia','date',monthly+3,
   'start_time','07:00','end_time','13:00','type','onsite','status','pending','employment_type','clt');
 PERFORM public.nv_save_operational_shifts(jsonb_build_array(spec));
 result:=public.nv_billing_period_work('approval-org',monthly);
 IF (result->'shifts'->0->>'expected_revenue')::numeric <> 932.01 OR result->'shifts'->0->'worked_minutes'<>'null' THEN
  RAISE EXCEPTION 'FAIL planned rate or hours: %',result;
 END IF;
 PERFORM public.nv_save_billing_rate('approval-org',rule,scope||'{"revenue_rate":200}'::jsonb,'Atualização do contrato.');
 PERFORM public.nv_assess_shift_billing('billing-shift',310,240,270,'Planilha assinada pela unidade.');
 IF public.nv_consolidate_billing('approval-org',monthly,ARRAY['billing-shift'],current_date+3)<>1 THEN RAISE EXCEPTION 'FAIL consolidation'; END IF;
 BEGIN
  PERFORM public.nv_consolidate_billing('approval-org',monthly,ARRAY['billing-shift'],current_date+3);
  RAISE EXCEPTION 'FAIL duplicate invoice line';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 invoice:=(public.nv_billing_period_work('approval-org',monthly)->'invoices'->0->>'id')::uuid;
 PERFORM set_config('nvtest.invoice',invoice::text,true);
 PERFORM public.nv_issue_billing_invoice(invoice,current_date-1,'NFS-e registrada externamente');
 PERFORM public.nv_post_billing_movement(invoice,'50000000-0000-4000-8000-000000000001','receipt',250,current_date-1);
 PERFORM public.nv_post_billing_movement(invoice,'50000000-0000-4000-8000-000000000001','receipt',250,current_date-1);
 PERFORM public.nv_post_billing_movement(invoice,'50000000-0000-4000-8000-000000000002','deduction',50,current_date-1,'Glosa contratual.');
 result:=public.nv_billing_invoice_detail(invoice);
 IF (result->'totals'->>'billed')::numeric<>699.01 OR (result->'totals'->>'medical_cost')::numeric<>400
   OR (result->'totals'->>'balance')::numeric<>399.01 OR jsonb_array_length(result->'movements')<>2 THEN
  RAISE EXCEPTION 'FAIL calculation, preserved snapshot, partial receipt or deductions: %',result;
 END IF;

 result:=public.nv_finance_company_report('approval-org',monthly,(monthly+interval '1 month'-interval '1 day')::date,'competence','{}',true);
 IF (result->>'expected_revenue')::numeric<>932.01 OR (result->>'gross_result')::numeric<>299.01
   OR (result->>'received')::numeric<>250 OR jsonb_array_length(result->'invoices')<>1
   OR result->'invoices'->0->>'balance'<>'399.01' THEN
  RAISE EXCEPTION 'FAIL competence report: %',result;
 END IF;
 result:=public.nv_finance_company_report('approval-org',current_date-1,current_date-1,'cash','{}',true);
 IF (result->>'net_cash')::numeric<>250 OR result->'expected_revenue'<>'null'::jsonb OR jsonb_array_length(result->'receipts')<>2 THEN
  RAISE EXCEPTION 'FAIL cash report: %',result;
 END IF;
 result:=public.nv_finance_company_report('approval-org',monthly,(monthly+interval '1 month'-interval '1 day')::date,
  'competence','{"doctor":"approval-offline"}',true);
 IF result->'received'<>'null'::jsonb OR result->'invoice_scope_limited'<>'true'::jsonb OR jsonb_array_length(result->'shifts')<>1 THEN
  RAISE EXCEPTION 'FAIL physician filter attribution: %',result;
 END IF;
 PERFORM public.nv_close_billing_period('approval-org',monthly,false,'Conferência mensal concluída.');
 BEGIN
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(spec||'{"end_time":"14:00","retro_reason":"Conferência posterior."}'));
  RAISE EXCEPTION 'FAIL settled period edit';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.nv_close_billing_period('approval-org',monthly,true,'Revisão autorizada.');
 IF public.nv_billing_period_work('approval-org',monthly)->'closed_at'<>'null'::jsonb THEN RAISE EXCEPTION 'FAIL audited reopen'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_billing_invoice_detail(current_setting('nvtest.invoice')::uuid); RAISE EXCEPTION 'FAIL cross-tenant invoice';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"48000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.nv_billing_catalog('approval-org'); RAISE EXCEPTION 'FAIL physician commercial catalog';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

RESET ROLE;
INSERT INTO auth.users(id,email) VALUES('51000000-0000-4000-8000-000000000001','no-export@example.invalid');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,additional_permissions) VALUES
 ('no-export-user','51000000-0000-4000-8000-000000000001','Consulta','no-export@example.invalid','tenant_user','approval-org','Financeiro',
  '{"financeiro.export":"deny"}');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
 PERFORM public.nv_finance_company_report('approval-org',current_date,current_date,'cash');
 BEGIN
  PERFORM public.nv_finance_company_report('approval-org',current_date,current_date,'cash','{}',true);
  RAISE EXCEPTION 'FAIL export denial';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
