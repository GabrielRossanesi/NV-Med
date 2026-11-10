-- Read-only. Run in the confirmed homologation project, after the 01-18 baseline.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';

DO $$ BEGIN
  IF to_regclass('public.sectors') IS NULL OR to_regclass('public.document_audit_logs') IS NULL
    OR to_regprocedure('public.nv_can_finance(text)') IS NULL
    OR to_regprocedure('public.nv_validate_adhoc_shift()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.medical_documents'::regclass
      AND tgname = 'nv_document_links' AND tgenabled <> 'D')
    OR (SELECT count(*) FROM storage.buckets WHERE id IN ('medical-documents','profile-avatars') AND public = false) <> 2 THEN
    RAISE EXCEPTION 'Baseline 01-18 incompleta ou bucket divergente.';
  END IF;
  IF to_regclass('public.doctor_enrollments') IS NOT NULL OR to_regclass('public.shift_opportunities') IS NOT NULL
    OR to_regclass('public.shift_attendance') IS NOT NULL OR to_regclass('public.organization_payment_terms') IS NOT NULL
    OR to_regprocedure('public.nv_can_report(text)') IS NOT NULL OR to_regclass('public.nv_staff_shifts') IS NOT NULL
    OR to_regclass('public.portal_notification_preferences') IS NOT NULL THEN
    RAISE EXCEPTION 'Foram encontrados marcadores das migrations 19-25. Reconcile o histórico antes de continuar.';
  END IF;
END $$;

SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies WHERE schemaname = 'public' OR (schemaname = 'storage' AND tablename = 'objects')
ORDER BY schemaname, tablename, policyname;

SELECT 'duplicate_identity_groups' AS check_name, count(*) AS findings FROM (
  SELECT organization_id, kind, normalized
  FROM public.doctors d CROSS JOIN LATERAL (VALUES
    ('cpf', regexp_replace(d.cpf, '[^0-9]', '', 'g')),
    ('crm_uf', upper(btrim(d.crm_uf)) || ':' || ltrim(regexp_replace(d.crm, '[^0-9]', '', 'g'), '0')),
    ('email', lower(btrim(d.email)))
  ) value(kind, normalized)
  WHERE nullif(normalized,'') IS NOT NULL
  GROUP BY organization_id, kind, normalized HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'future_shift_invalid_scope', count(*) FROM public.shifts s
  LEFT JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
  LEFT JOIN public.sectors t ON t.id = s.sector_id AND t.organization_id = s.organization_id AND t.unit_id = s.unit_id
  WHERE s.date >= current_date AND s.status <> 'cancelled'
    AND (u.status IS DISTINCT FROM 'active' OR (s.sector_id IS NOT NULL AND t.status IS DISTINCT FROM 'active')
      OR nullif(btrim(s.specialty),'') IS NULL)
UNION ALL
SELECT 'invalid_shift_time', count(*) FROM public.shifts
  WHERE start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR start_time = end_time
UNION ALL
SELECT 'inconsistent_legacy_payment', count(*) FROM public.shifts
  WHERE payment_status = 'paid' AND (paid_at IS NULL OR doctor_id IS NULL OR status = 'cancelled')
UNION ALL
SELECT 'legacy_url_only', count(*) FROM public.medical_documents
  WHERE nullif(file_url,'') IS NOT NULL AND nullif(file_path,'') IS NULL
UNION ALL
SELECT 'noncanonical_document_path', count(*) FROM public.medical_documents d WHERE nullif(d.file_path,'') IS NOT NULL AND (
  d.file_path !~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(pdf|jpe?g|png)$'
  OR split_part(d.file_path,'/',1) <> d.organization_id OR split_part(d.file_path,'/',2) <> d.doctor_id)
UNION ALL
SELECT 'missing_document_object', count(*) FROM public.medical_documents d WHERE nullif(d.file_path,'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM storage.objects obj WHERE obj.bucket_id = 'medical-documents' AND obj.name = d.file_path)
UNION ALL
SELECT 'duplicate_document_paths', count(*) FROM (
  SELECT file_path FROM public.medical_documents WHERE nullif(file_path,'') IS NOT NULL GROUP BY file_path HAVING count(*) > 1
) duplicates;

ROLLBACK;
