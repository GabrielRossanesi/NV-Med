BEGIN;

CREATE TABLE public.medical_document_scans (
  object_name text PRIMARY KEY,
  object_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('scanning', 'clean', 'blocked', 'failed')),
  claim_id uuid,
  retry_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.medical_document_scans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medical_document_scans FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.nv_medical_scan_status(object_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT coalesce(s.state, 'pending')
    FROM storage.objects o LEFT JOIN public.medical_document_scans s ON s.object_name = o.name
      AND s.object_version = coalesce(o.version, '') || '/' || extract(epoch FROM o.updated_at)::text
    WHERE o.bucket_id = 'medical-documents' AND o.name = nv_medical_scan_status.object_name
  ), 'missing');
$$;

CREATE FUNCTION public.nv_claim_medical_scan()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE job public.medical_document_scans;
BEGIN
  INSERT INTO public.medical_document_scans(object_name, object_version, state, claim_id, retry_at)
  SELECT o.name, coalesce(o.version, '') || '/' || extract(epoch FROM o.updated_at)::text, 'scanning', gen_random_uuid(), now() + interval '5 minutes'
  FROM storage.objects o
  LEFT JOIN public.medical_document_scans s ON s.object_name = o.name
  WHERE o.bucket_id = 'medical-documents'
    AND public.nv_document_path_matches(split_part(o.name, '/', 1), split_part(o.name, '/', 2), o.name)
    AND EXISTS (SELECT FROM public.doctors d WHERE d.organization_id = split_part(o.name, '/', 1) AND d.id = split_part(o.name, '/', 2))
    AND (s.object_name IS NULL OR s.object_version <> coalesce(o.version, '') || '/' || extract(epoch FROM o.updated_at)::text
      OR (s.state IN ('failed','scanning') AND s.retry_at <= now()))
  ORDER BY coalesce(s.retry_at, '-infinity'::timestamptz), o.name LIMIT 1
  ON CONFLICT (object_name) DO UPDATE SET object_version = EXCLUDED.object_version, state = 'scanning',
    claim_id = EXCLUDED.claim_id, retry_at = EXCLUDED.retry_at, updated_at = now()
  WHERE medical_document_scans.object_version <> EXCLUDED.object_version
    OR (medical_document_scans.state IN ('failed','scanning') AND medical_document_scans.retry_at <= now())
  RETURNING * INTO job;
  IF FOUND THEN RETURN jsonb_build_object('path', job.object_name, 'claim_id', job.claim_id); END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.nv_finish_medical_scan(claim uuid, verdict text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF verdict IS NULL OR verdict NOT IN ('clean', 'blocked', 'failed') THEN RAISE EXCEPTION 'Resultado inválido.' USING ERRCODE = '22023'; END IF;
  UPDATE public.medical_document_scans s SET state = verdict, claim_id = NULL,
    retry_at = now() + interval '10 minutes', updated_at = now()
  WHERE s.claim_id = claim AND s.state = 'scanning' AND s.retry_at > now()
    AND EXISTS (SELECT FROM storage.objects o WHERE o.bucket_id = 'medical-documents' AND o.name = s.object_name
      AND s.object_version = coalesce(o.version, '') || '/' || extract(epoch FROM o.updated_at)::text);
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.nv_require_clean_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR (NEW.file_path, NEW.status) IS DISTINCT FROM (OLD.file_path, OLD.status))
    AND public.nv_medical_scan_status(NEW.file_path) <> 'clean' THEN
    RAISE EXCEPTION 'O arquivo precisa ser liberado pela verificação de segurança antes da aprovação.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_require_clean_document BEFORE INSERT OR UPDATE OF status, file_path ON public.medical_documents
  FOR EACH ROW EXECUTE FUNCTION public.nv_require_clean_document();

REVOKE ALL ON FUNCTION public.nv_medical_scan_status(text), public.nv_claim_medical_scan(),
  public.nv_finish_medical_scan(uuid,text), public.nv_require_clean_document() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nv_medical_scan_status(text), public.nv_claim_medical_scan(), public.nv_finish_medical_scan(uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
