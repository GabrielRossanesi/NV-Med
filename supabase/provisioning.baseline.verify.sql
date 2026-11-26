-- Synthetic lab only. Check the committed base after steps 01, 02 and 04.
BEGIN READ ONLY;
SELECT set_config('nvmed_test.provisioning_step', :'step', true);

DO $$
DECLARE relation text; step text := current_setting('nvmed_test.provisioning_step');
BEGIN
  FOREACH relation IN ARRAY ARRAY['organizations','user_accounts','doctors','units','medical_documents','shifts'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = format('public.%I',relation)::regclass)
      OR EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = relation)
      OR has_table_privilege('anon', format('public.%I',relation), 'SELECT,INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', format('public.%I',relation), 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Falha na etapa %: public.% deve iniciar fechada.', step, relation;
    END IF;
  END LOOP;
  IF step = '4' AND (NOT EXISTS (SELECT FROM storage.buckets WHERE id = 'medical-documents' AND public = false)
    OR EXISTS (SELECT FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE')) THEN
    RAISE EXCEPTION 'Falha na etapa 04: o bucket médico deve iniciar fechado.';
  END IF;
END $$;

ROLLBACK;
