-- Remove residual grants from the original installation without replaying its schema.
BEGIN;

DO $$
DECLARE relation text; columns text; routine record;
BEGIN
  FOREACH relation IN ARRAY ARRAY['organizations','user_accounts','doctors','units',
    'medical_documents','shifts','sectors','document_audit_logs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow public read access on ' || relation, relation);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow public write access on ' || relation, relation);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', relation);
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO columns
    FROM pg_attribute WHERE attrelid = format('public.%I', relation)::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE ALL (%s) ON public.%I FROM PUBLIC, anon', columns, relation);
  END LOOP;

  FOR routine IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS signature,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_access,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_access
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
      AND (left(p.proname, 3) = 'nv_' OR p.proname = 'update_updated_at_column')
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', routine.signature);
    -- Some legacy functions relied on the default PUBLIC grant for their existing callers.
    IF routine.authenticated_access THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', routine.signature);
    END IF;
    IF routine.service_access THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', routine.signature);
    END IF;
  END LOOP;
END $$;

UPDATE storage.buckets SET public = false WHERE id IN ('medical-documents', 'profile-avatars') AND public IS DISTINCT FROM false;
DROP POLICY IF EXISTS "Public Read Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete Medical Documents" ON storage.objects;
CREATE POLICY nv_private_files_require_login ON storage.objects AS RESTRICTIVE FOR ALL TO anon
  USING (bucket_id NOT IN ('medical-documents','profile-avatars'))
  WITH CHECK (bucket_id NOT IN ('medical-documents','profile-avatars'));

-- Migration 44 can be deferred. Once installed, its verdict always governs document access.
CREATE FUNCTION public.nv_document_delivery_status(object_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF to_regclass('public.medical_document_scans') IS NULL
    AND to_regprocedure('public.nv_medical_scan_status(text)') IS NULL
    AND NOT EXISTS (SELECT FROM pg_trigger WHERE tgrelid = to_regclass('public.medical_documents')
      AND tgname = 'nv_require_clean_document') THEN
    RETURN 'not_configured';
  END IF;
  RETURN public.nv_medical_scan_status(object_name);
END;
$$;
REVOKE ALL ON FUNCTION public.nv_document_delivery_status(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nv_document_delivery_status(text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
