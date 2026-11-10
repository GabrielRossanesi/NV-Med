-- Read-only. Run after 25 and before serving the matching application build.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';

DO $$ DECLARE exposed_role text; relation text; BEGIN
  IF to_regclass('public.doctor_enrollments') IS NULL OR to_regclass('public.shift_opportunities') IS NULL
    OR to_regclass('public.shift_attendance') IS NULL OR to_regclass('public.organization_payment_terms') IS NULL
    OR to_regprocedure('public.nv_report_shifts(text,date,date,text,text,text,text,text,text,text)') IS NULL
    OR to_regclass('public.nv_staff_shifts') IS NULL OR to_regclass('public.portal_notification_preferences') IS NULL
    OR to_regprocedure('public.nv_portal_document_target(text,text,uuid)') IS NULL
    OR to_regprocedure('public.nv_reserve_document_upload()') IS NULL THEN
    RAISE EXCEPTION 'Sequência 19-25 incompleta.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.nv_staff_shifts'::regclass
    AND 'security_barrier=true' = ANY(reloptions)) OR NOT has_table_privilege('authenticated','public.nv_staff_shifts','SELECT') THEN
    RAISE EXCEPTION 'View da escala divergente.';
  END IF;
  FOREACH exposed_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = exposed_role AND (rolsuper OR rolbypassrls))
      OR has_any_column_privilege(exposed_role,'public.shifts','INSERT, UPDATE')
      OR has_function_privilege(exposed_role,'public.nv_session_actor()','EXECUTE')
      OR has_function_privilege(exposed_role,'public.nv_save_portal_document(uuid,text,text,text,text,uuid)','EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_attribute WHERE attrelid = 'public.shifts'::regclass AND attnum > 0 AND NOT attisdropped
          AND (exposed_role = 'anon' OR attname NOT IN ('id','organization_id','doctor_id','unit_id','sector_id','sector',
            'specialty','date','start_time','end_time','type','status','notes','employment_type','employer_name','coverage_mode','coverage_reason'))
          AND has_column_privilege(exposed_role,'public.shifts',attnum,'SELECT')
      ) THEN
      RAISE EXCEPTION 'ACL efetiva divergente para %.', exposed_role;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('medical-documents','profile-avatars') AND public = false) <> 2
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'nv_medical_server_only' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
      AND roles @> ARRAY['anon','authenticated']::name[])
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'storage.objects'::regclass AND relrowsecurity)
    OR NOT has_function_privilege('service_role','public.nv_save_portal_document(uuid,text,text,text,text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Fronteira do Storage divergente.';
  END IF;
  FOREACH relation IN ARRAY ARRAY['organizations','user_accounts','doctors','units','sectors','shifts',
    'medical_documents','document_audit_logs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = format('public.%I',relation)::regclass AND relrowsecurity)
      OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = relation
        AND policyname = 'nv_session_required' AND permissive = 'RESTRICTIVE') THEN
      RAISE EXCEPTION 'RLS divergente em %.', relation;
    END IF;
  END LOOP;
END $$;

SELECT 'PASS: marcadores 19-25, RLS, ACL de plantões e bucket privado' AS verification;
ROLLBACK;
