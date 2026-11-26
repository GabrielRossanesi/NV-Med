-- Read-only catalog check. Run after migration 46 and before loading data or opening the application.
-- For an intentional deferral of 44, set nvmed.verify_deferred_document_scan = 'on' in the verification session.
DO $$
DECLARE exposed text; anonymous_role oid := 'anon'::regrole;
  scan_deferred boolean := coalesce(current_setting('nvmed.verify_deferred_document_scan', true) = 'on', false);
BEGIN
  IF to_regprocedure('public.nv_org_access(text)') IS NULL
    OR to_regprocedure('public.nv_session_ready()') IS NULL
    OR to_regclass('public.nv_staff_shifts') IS NULL
    OR to_regprocedure('public.nv_save_portal_document(uuid,text,text,text,text,uuid)') IS NULL
    OR to_regprocedure('public.nv_import_assignment_matches(public.shifts)') IS NULL
    OR to_regprocedure('public.nv_admin_mfa_session_valid(uuid,uuid)') IS NULL
    OR to_regprocedure('public.nv_require_attendance_confirmation()') IS NULL
    OR to_regprocedure('public.nv_can_read_doctor_personal(text,text)') IS NULL
    OR to_regprocedure('public.nv_reconcile_organization_cleanup(text,uuid,boolean)') IS NULL
    OR to_regprocedure('public.nv_document_delivery_status(text)') IS NULL
    OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgenabled IN ('O','A')
      AND tgrelid = to_regclass('public.shifts') AND tgname = 'nv_z_require_attendance_confirmation')
    OR (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relrowsecurity
        AND c.relname IN ('organizations','user_accounts','doctors','units','sectors','shifts','medical_documents','document_audit_logs')
        AND p.polname = 'nv_session_required' AND NOT p.polpermissive) <> 8
    OR NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'nv_private_files_require_login' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
      AND roles = ARRAY['anon']::name[]
      AND qual = '(bucket_id <> ALL (ARRAY[''medical-documents''::text, ''profile-avatars''::text]))'
      AND with_check = qual) THEN
    RAISE EXCEPTION 'NV-09: faltam etapas de endurecimento do banco.';
  END IF;

  IF scan_deferred THEN
    IF public.nv_document_delivery_status('preflight') IS DISTINCT FROM 'not_configured' THEN
      RAISE EXCEPTION 'NV-06: o banco não está no estado esperado de adiamento da verificação antimalware.';
    END IF;
  ELSIF to_regprocedure('public.nv_claim_medical_scan()') IS NULL
    OR NOT EXISTS (SELECT FROM pg_trigger WHERE tgenabled IN ('O','A')
      AND tgrelid = to_regclass('public.medical_documents') AND tgname = 'nv_require_clean_document') THEN
    RAISE EXCEPTION 'NV-06: faltam os controles de quarentena documental.';
  END IF;
  IF has_function_privilege('authenticated', 'public.nv_document_delivery_status(text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.nv_document_delivery_status(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'NV-06: permissões divergentes no estado de entrega de documentos.';
  END IF;

  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('medical-documents','profile-avatars') AND public = false) <> 2
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'storage.objects'::regclass)
    OR NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'nv_medical_server_only' AND permissive = 'RESTRICTIVE' AND cmd = 'ALL'
      AND roles @> ARRAY['anon','authenticated']::name[]
      AND qual = '(bucket_id <> ''medical-documents''::text)' AND with_check = qual) THEN
    RAISE EXCEPTION 'NV-09: buckets privados ou proteção do Storage ausentes.';
  END IF;

  IF EXISTS (SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'NV-09: papel de cliente pode ignorar RLS.';
  END IF;

  IF has_column_privilege('authenticated','public.doctors','linked_units','INSERT,UPDATE')
    OR has_column_privilege('authenticated','public.doctors','specialty','UPDATE')
    OR has_column_privilege('authenticated','public.doctors','cpf','SELECT,UPDATE')
    OR has_any_column_privilege('authenticated','public.shifts','INSERT,UPDATE') THEN
    RAISE EXCEPTION 'NV-09: permissões de credenciamento ou escala divergentes.';
  END IF;

  SELECT c.relname INTO exposed FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
    AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
  ORDER BY c.relname LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'NV-09: permissão anônima em public.%.', exposed; END IF;

  SELECT p.proname INTO exposed FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
    AND (left(p.proname, 3) = 'nv_' OR p.proname = 'update_updated_at_column')
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ORDER BY p.proname LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'NV-09: função acessível a anon em public.%.', exposed; END IF;

  SELECT c.relname INTO exposed FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
    AND (has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      OR has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE'))
  ORDER BY c.relname LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'NV-09: RLS desativado em public.%.', exposed; END IF;

  SELECT p.polname INTO exposed FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
  WHERE (c.relnamespace = 'public'::regnamespace OR c.oid = 'storage.objects'::regclass)
    AND p.polpermissive AND (p.polname LIKE 'Allow public %' OR p.polname LIKE 'Public % Medical Documents'
      OR EXISTS (SELECT FROM unnest(p.polroles) AS policy_role(role_oid)
        WHERE CASE WHEN role_oid = 0 THEN true ELSE pg_has_role(anonymous_role, role_oid, 'USAGE') END))
  ORDER BY p.polname LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'NV-09: política permissiva legada ou anônima encontrada (%).', exposed; END IF;
END $$;

SELECT 'PASS: endurecimento do NV Med, privilégios anônimos e buckets privados' AS verification,
  CASE WHEN current_setting('nvmed.verify_deferred_document_scan', true) = 'on'
    THEN 'quarentena adiada' ELSE 'controles de quarentena presentes' END AS document_scan;
