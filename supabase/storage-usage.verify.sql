-- Run only in the disposable database. The test leaves no documents or notifications.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
  ('58000000-0000-4000-8000-000000000001', 'storage-saas@example.invalid'),
  ('58000000-0000-4000-8000-000000000002', 'storage-tenant@example.invalid');
INSERT INTO public.organizations(id,name,settings) VALUES
  ('nv-storage-a','Empresa de teste A','{"specialties":["Cirurgia"],"requiredDocuments":[{"type":"crm","name":"CRM","required":true}]}'),
  ('nv-storage-b','Empresa de teste B','{}');
INSERT INTO public.user_accounts(id,auth_user_id,name,email,type,organization_id,role,status) VALUES
  ('nv-storage-saas','58000000-0000-4000-8000-000000000001','SaaS','storage-saas@example.invalid','saas_admin',NULL,'CEO','active'),
  ('nv-storage-tenant','58000000-0000-4000-8000-000000000002','Tenant','storage-tenant@example.invalid','tenant_user','nv-storage-b','Diretor','active');
INSERT INTO public.doctors(id,organization_id,name,crm,crm_uf,specialty,status)
  VALUES ('nv-storage-doctor','nv-storage-a','Médico Sintético','5801','SP','Cirurgia','pending');
INSERT INTO storage.objects(bucket_id,name,metadata,user_metadata) VALUES
  ('medical-documents','nv-storage-a/nv-storage-doctor/source.png','{"size":220}',NULL),
  ('medical-documents','nv-storage-a/nv-storage-doctor/optimized.webp','{"size":100}',NULL),
  ('medical-documents','nv-storage-a/nv-storage-doctor/upload.webp','{"size":600}',
    '{"nvOptimization":"webp-v1","nvOriginalBytes":800,"nvOriginalFormat":"png"}'),
  ('medical-documents','nv-storage-a/nv-storage-doctor/.emptyFolderPlaceholder','{"size":0}',NULL);
UPDATE public.medical_documents SET file_path='nv-storage-a/nv-storage-doctor/source.png',file_name='source.png',status='sent'
  WHERE doctor_id='nv-storage-doctor' AND type='crm';
SELECT set_config('nv.test.storage_document',(SELECT id FROM public.medical_documents WHERE doctor_id='nv-storage-doctor' AND type='crm'),true);
SELECT set_config('nv.test.storage_version',(SELECT version::text FROM public.medical_documents WHERE id=current_setting('nv.test.storage_document')),true);
INSERT INTO public.medical_storage_replacements(source_path,stored_path,organization_id,doctor_id,original_bytes,stored_bytes,original_sha256,stored_sha256,strategy)
  VALUES ('nv-storage-a/nv-storage-doctor/source.png','nv-storage-a/nv-storage-doctor/optimized.webp','nv-storage-a','nv-storage-doctor',220,100,repeat('a',64),repeat('b',64),'legacy-webp-v1');

DO $$ BEGIN
  IF NOT public.nv_document_path_matches('nv-storage-a','nv-storage-doctor','nv-storage-a/nv-storage-doctor/upload.webp')
    OR NOT EXISTS (SELECT FROM storage.buckets WHERE id='medical-documents' AND NOT public AND 'image/webp' = ANY(allowed_mime_types)) THEN
    RAISE EXCEPTION 'FAIL: safe WebP storage';
  END IF;
  IF (SELECT array_agg(public.nv_storage_alert_level(n,1000) ORDER BY n) FROM unnest(ARRAY[699,700,849,850,949,950,999,1000]) n)
    IS DISTINCT FROM ARRAY[0,1,1,2,2,3,3,4] THEN RAISE EXCEPTION 'FAIL: capacity thresholds'; END IF;
END $$;

UPDATE public.storage_usage_snapshot SET limit_bytes=1000;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"58000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE snapshot jsonb := public.nv_storage_usage(); BEGIN
  IF (snapshot->>'used_bytes')::bigint <> 920 OR (snapshot->>'level')::int <> 2
    OR (snapshot->>'reported_savings')::bigint <> 200 OR (snapshot->>'confirmed_savings')::bigint <> 0 THEN
    RAISE EXCEPTION 'FAIL: usage aggregation %', snapshot;
  END IF;
  IF public.nv_storage_usage(true) IS DISTINCT FROM snapshot THEN RAISE EXCEPTION 'FAIL: refresh deduplication'; END IF;
  IF (SELECT file_path FROM public.nv_portal_document_target(current_setting('nv.test.storage_document'),'read'))
    IS DISTINCT FROM 'nv-storage-a/nv-storage-doctor/optimized.webp' THEN RAISE EXCEPTION 'FAIL: aliases are not resolved'; END IF;
  IF (SELECT file_path FROM public.nv_portal_document_target(current_setting('nv.test.storage_document'),'write'))
    IS DISTINCT FROM 'nv-storage-a/nv-storage-doctor/source.png' THEN RAISE EXCEPTION 'FAIL: stale-write comparison path changed'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"58000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN
    PERFORM public.nv_storage_usage(true);
    RAISE EXCEPTION 'FAIL: tenant can query platform storage';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT FROM public.nv_portal_document_target(current_setting('nv.test.storage_document'),'read'))
    OR EXISTS (SELECT FROM public.nv_portal_document_target(current_setting('nv.test.storage_document'),'write')) THEN
    RAISE EXCEPTION 'FAIL: tenant can read or update a foreign document';
  END IF;
END $$;
RESET ROLE;

DELETE FROM storage.objects WHERE bucket_id='medical-documents' AND name='nv-storage-a/nv-storage-doctor/source.png';
UPDATE public.storage_usage_snapshot SET refreshed_at=now()-interval '31 minutes';
DO $$ DECLARE snapshot jsonb := public.nv_refresh_storage_usage(); BEGIN
  IF (snapshot->>'used_bytes')::bigint <> 700 OR (snapshot->>'level')::int <> 1
    OR (snapshot->>'confirmed_savings')::bigint <> 120 THEN RAISE EXCEPTION 'FAIL: confirmed physical savings'; END IF;
  IF (SELECT version::text FROM public.medical_documents WHERE id=current_setting('nv.test.storage_document'))
    IS DISTINCT FROM current_setting('nv.test.storage_version') THEN RAISE EXCEPTION 'FAIL: document version changed'; END IF;
  IF (SELECT count(*) FROM public.portal_notifications WHERE event_key LIKE 'storage-capacity:%') <> 1
    OR NOT EXISTS (SELECT FROM public.portal_notifications WHERE event_key LIKE 'storage-capacity:%'
      AND recipient_id='58000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL: alert recipients or transition deduplication'; END IF;
END $$;

ROLLBACK;
