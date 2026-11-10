-- Confirm the project outside SQL before connecting. Outputs only counts and schema metadata.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';

SELECT 'organizations' AS entity, count(*) AS total FROM public.organizations
UNION ALL SELECT 'user_accounts', count(*) FROM public.user_accounts
UNION ALL SELECT 'doctors', count(*) FROM public.doctors
UNION ALL SELECT 'units', count(*) FROM public.units
UNION ALL SELECT 'sectors', count(*) FROM public.sectors
UNION ALL SELECT 'shifts', count(*) FROM public.shifts
UNION ALL SELECT 'medical_documents', count(*) FROM public.medical_documents
UNION ALL SELECT 'document_audit_logs', count(*) FROM public.document_audit_logs
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
UNION ALL SELECT 'auth.identities', count(*) FROM auth.identities
UNION ALL SELECT 'auth.users_without_profile', count(*) FROM auth.users a
  WHERE NOT EXISTS (SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = a.id)
UNION ALL SELECT 'user_accounts_without_auth', count(*) FROM public.user_accounts WHERE auth_user_id IS NULL
ORDER BY entity;

SELECT bucket.id, bucket.public, count(object.name) AS object_count
FROM storage.buckets bucket LEFT JOIN storage.objects object ON object.bucket_id = bucket.id
GROUP BY bucket.id, bucket.public ORDER BY bucket.id;

SELECT pg_get_functiondef(to_regprocedure('public.nv_validate_links()')) AS deployed_definition;
SELECT tgrelid::regclass AS table_name, tgname, tgenabled, pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE NOT tgisinternal AND tgfoid = to_regprocedure('public.nv_validate_links()')
ORDER BY tgrelid::regclass::text, tgname;
SELECT extname, extversion FROM pg_extension ORDER BY extname;

ROLLBACK;
