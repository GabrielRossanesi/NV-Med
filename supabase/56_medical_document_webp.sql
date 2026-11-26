BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM storage.buckets WHERE id = 'medical-documents' AND public = false) THEN
    RAISE EXCEPTION 'O bucket privado medical-documents é obrigatório.';
  END IF;
END $$;

UPDATE storage.buckets SET allowed_mime_types = array_append(allowed_mime_types, 'image/webp')
WHERE id = 'medical-documents' AND allowed_mime_types IS NOT NULL AND NOT ('image/webp' = ANY(allowed_mime_types));

CREATE OR REPLACE FUNCTION public.nv_document_path_matches(org text, doctor text, path text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT coalesce(org ~ '^[A-Za-z0-9_-]+$' AND doctor ~ '^[A-Za-z0-9_-]+$'
  AND split_part(path,'/',1)=org AND split_part(path,'/',2)=doctor
  AND path ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(pdf|jpe?g|png|webp|docx?|heif|pages|mht)$',false);
$$;

COMMIT;
