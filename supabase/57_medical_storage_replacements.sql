BEGIN;

-- Keep the document row and historical evidence intact while resolving the physical object.
CREATE TABLE public.medical_storage_replacements (
  source_path text PRIMARY KEY,
  stored_path text NOT NULL UNIQUE,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doctor_id text NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  original_bytes bigint NOT NULL CHECK (original_bytes > 0),
  stored_bytes bigint NOT NULL CHECK (stored_bytes > 0 AND stored_bytes < original_bytes),
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),
  stored_sha256 text NOT NULL CHECK (stored_sha256 ~ '^[0-9a-f]{64}$'),
  strategy text NOT NULL,
  switched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (public.nv_document_path_matches(organization_id, doctor_id, source_path) AND source_path ~ '\.(jpe?g|png)$'),
  CHECK (public.nv_document_path_matches(organization_id, doctor_id, stored_path) AND stored_path ~ '\.webp$')
);
ALTER TABLE public.medical_storage_replacements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medical_storage_replacements FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.nv_medical_object_path(path text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT r.stored_path FROM public.medical_storage_replacements r WHERE r.source_path = path), path);
$$;
REVOKE ALL ON FUNCTION public.nv_medical_object_path(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nv_portal_document_target(target text, operation text DEFAULT 'read', revision uuid DEFAULT NULL)
RETURNS TABLE(doctor_id text, organization_id text, file_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.doctor_id, d.organization_id, candidate.path
  FROM public.medical_documents d
  JOIN public.doctors doctor ON doctor.id = d.doctor_id AND doctor.organization_id = d.organization_id
  LEFT JOIN public.document_audit_logs history ON history.id = revision
    AND history.document_id = d.id AND history.organization_id = d.organization_id AND history.doctor_id = d.doctor_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN revision IS NULL THEN d.file_path ELSE history.changes->>'previousFilePath' END AS path
  ) reference
  CROSS JOIN LATERAL (
    SELECT CASE WHEN operation = 'read' THEN public.nv_medical_object_path(reference.path) ELSE reference.path END AS path
  ) candidate
  WHERE d.id = target AND (
    (operation = 'write' AND revision IS NULL
      AND public.nv_document_upload_allowed(public.nv_session_actor(), d.organization_id, d.doctor_id))
    OR
    (operation = 'read' AND (public.nv_can_read_documents(d.organization_id) OR
      (revision IS NULL AND public.nv_owns_doctor(d.organization_id, d.doctor_id)))
      AND public.nv_document_path_matches(d.organization_id, d.doctor_id, reference.path)
      AND public.nv_document_path_matches(d.organization_id, d.doctor_id, candidate.path)
      AND EXISTS (
        SELECT 1 FROM storage.objects obj JOIN storage.buckets b ON b.id = obj.bucket_id
        WHERE b.id = 'medical-documents' AND b.public = false AND obj.name = candidate.path
      ))
  );
$$;

CREATE OR REPLACE FUNCTION public.nv_validate_document_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  requirement jsonb;
  expiry date := public.nv_date_or_null(NEW.expiry_date);
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.status, NEW.file_path, NEW.expiry_date, NEW.review_note)
    IS NOT DISTINCT FROM (OLD.status, OLD.file_path, OLD.expiry_date, OLD.review_note) THEN RETURN NEW; END IF;
  IF NEW.expiry_date IS NOT NULL AND expiry IS NULL THEN RAISE EXCEPTION 'Informe uma validade válida.' USING ERRCODE = '22023'; END IF;
  IF NEW.status = 'rejected' AND coalesce(length(btrim(NEW.review_note)),0) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'approved' THEN
    SELECT req INTO requirement FROM public.organizations o
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.settings->'requiredDocuments','[]')) req
    WHERE o.id = NEW.organization_id AND req->>'type' = NEW.type LIMIT 1;
    IF NEW.file_path IS NULL OR NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE bucket_id = 'medical-documents' AND name = public.nv_medical_object_path(NEW.file_path)
    ) THEN RAISE EXCEPTION 'Envie o arquivo antes de aprovar o documento.' USING ERRCODE = '22023'; END IF;
    IF expiry < today OR (expiry IS NULL AND (requirement->>'expiryRequired' = 'true' OR requirement->>'annualRenewal' = 'true')) THEN
      RAISE EXCEPTION 'Informe a data de validade antes de aprovar o documento.' USING ERRCODE = '22023';
    END IF;
    IF requirement->>'annualRenewal' = 'true' AND extract(year FROM expiry) <> extract(year FROM today) THEN
      RAISE EXCEPTION 'Informe uma validade dentro do ano da renovação.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.nv_require_clean_document()') IS NOT NULL THEN
    EXECUTE $definition$
      CREATE OR REPLACE FUNCTION public.nv_require_clean_document()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
      BEGIN
        IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR (NEW.file_path, NEW.status) IS DISTINCT FROM (OLD.file_path, OLD.status))
          AND public.nv_medical_scan_status(public.nv_medical_object_path(NEW.file_path)) <> 'clean' THEN
          RAISE EXCEPTION 'O arquivo precisa ser liberado pela verificação de segurança antes da aprovação.' USING ERRCODE = '22023';
        END IF;
        RETURN NEW;
      END;
      $body$;
    $definition$;
  END IF;
END $$;

COMMIT;
