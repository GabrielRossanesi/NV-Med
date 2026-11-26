BEGIN READ ONLY;
DO $$ DECLARE signature text; BEGIN
 FOREACH signature IN ARRAY ARRAY['public.nv_session_ready()','public.nv_can_read_documents(text)','public.nv_can_action(text,text,text)','public.nv_admin()'] LOOP
  IF to_regprocedure(signature) IS NULL THEN RAISE EXCEPTION 'Dependência ausente: %',signature; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM pg_class WHERE oid='public.medical_documents'::regclass AND relrowsecurity) OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.document_audit_logs'::regclass AND relrowsecurity) THEN RAISE EXCEPTION 'RLS documental ausente.'; END IF;
 IF to_regprocedure('public.nv_workspace_documents(text,text,text,integer)') IS NOT NULL THEN RAISE EXCEPTION 'Migration 60 já instalada; conferir versão.'; END IF;
END $$;
COMMIT;
