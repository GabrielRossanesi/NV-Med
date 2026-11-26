-- Run in the SQL Editor after confirming the project in the dashboard.
-- Reports catalog indicators and bucket flags. No application or Auth records are read.
SELECT jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'migration_history_table_present', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'schema_indicators', jsonb_build_object(
    '19_session', to_regprocedure('public.nv_session_ready()') IS NOT NULL,
    '24_shift_view', to_regclass('public.nv_staff_shifts') IS NOT NULL,
    '25_document_upload_rpc', to_regprocedure('public.nv_reserve_document_upload()') IS NOT NULL,
    '39_schedule_audit', to_regprocedure('nv_master_private.schedule_audit_metadata()') IS NOT NULL,
    '40_credential_column_grants', (
      SELECT count(*) = 2 AND bool_and(CASE attname
        WHEN 'linked_units' THEN NOT has_column_privilege('authenticated', attrelid, attnum, 'INSERT,UPDATE')
        WHEN 'specialty' THEN NOT has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
      END)
      FROM pg_attribute
      WHERE attrelid = to_regclass('public.doctors') AND attname IN ('linked_units','specialty') AND NOT attisdropped
    ),
    '41_administrative_mfa', to_regprocedure('public.nv_admin_mfa_session_valid(uuid,uuid)') IS NOT NULL,
    '42_attendance_review_trigger', EXISTS (
      SELECT FROM pg_trigger WHERE tgrelid = to_regclass('public.shifts')
        AND tgname = 'nv_z_require_attendance_confirmation' AND tgenabled IN ('O','A')
    ),
    '43_doctor_personal_fields', to_regprocedure('public.nv_can_read_doctor_personal(text,text)') IS NOT NULL,
    '44_document_scan_queue', to_regclass('public.medical_document_scans') IS NOT NULL
      AND to_regprocedure('public.nv_claim_medical_scan()') IS NOT NULL,
    '45_resumable_cleanup', to_regclass('public.organization_cleanup_jobs') IS NOT NULL
      AND to_regprocedure('public.nv_reconcile_organization_cleanup(text,uuid,boolean)') IS NOT NULL,
    '46_private_files_policy', EXISTS (
      SELECT FROM pg_policy WHERE polrelid = to_regclass('storage.objects')
        AND polname = 'nv_private_files_require_login' AND NOT polpermissive
    )
  ),
  'storage_buckets', (
    SELECT jsonb_object_agg(bucket, CASE b.public WHEN true THEN 'public' WHEN false THEN 'private' ELSE 'missing' END)
    FROM (VALUES ('medical-documents'), ('profile-avatars')) AS expected(bucket)
    LEFT JOIN storage.buckets b ON b.id = expected.bucket
  ),
  'storage_version_columns_present', (
    SELECT count(*) = 2 FROM pg_attribute WHERE attrelid = to_regclass('storage.objects')
      AND attname IN ('version','updated_at') AND NOT attisdropped
  ),
  'auth_mfa_columns_present', (
    SELECT count(*) = 3 FROM pg_attribute WHERE NOT attisdropped AND (
      (attrelid = to_regclass('auth.sessions') AND attname IN ('aal','factor_id'))
      OR (attrelid = to_regclass('auth.mfa_factors') AND attname = 'status')
    )
  ),
  'legacy_permissive_policy_count', (
    SELECT count(*) FROM pg_policies WHERE permissive = 'PERMISSIVE' AND (
      (schemaname = 'public' AND policyname LIKE 'Allow public %')
      OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'Public % Medical Documents')
    )
  )
) AS release_preflight;
