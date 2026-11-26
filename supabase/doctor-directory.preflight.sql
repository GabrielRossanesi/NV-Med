-- Read-only dependency check. Does not install the directory or change any record.
BEGIN TRANSACTION READ ONLY;
DO $$ DECLARE signature text; relation text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.nv_can_action(text,text,text)','public.nv_session_actor()',
  'public.nv_admin_mfa_session()','public.nv_set_doctor_status(text,text,timestamp with time zone)',
  'public.nv_required_document_applies(jsonb,text,text[])','nv_doctor_names.clean_spacing(text)',
  'public.nv_account_preferences()','public.nv_save_account_preferences(jsonb)','public.nv_shift_ends(public.shifts)'] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'Dependência ausente: %',signature; END IF;
 END LOOP;
 FOREACH relation IN ARRAY ARRAY['doctors','doctor_enrollments','medical_documents','user_accounts','account_preferences'] LOOP
  IF NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=relation AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'RLS ausente na relação %.',relation;
  END IF;
 END LOOP;
 IF to_regclass('public.doctor_rqes') IS NOT NULL OR to_regclass('public.doctor_directory_operations') IS NOT NULL THEN
  RAISE EXCEPTION 'A extensão da listagem já existe; verifique a versão antes de reaplicar a migration 59.';
 END IF;
END $$;
COMMIT;
