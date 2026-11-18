-- Preserve original Office, HEIF and Pages documents in the existing private
-- bucket. These formats are downloaded as attachments, never rendered as HTML.
BEGIN;
CREATE OR REPLACE FUNCTION public.nv_document_path_matches(org text, doctor text, path text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT coalesce(org ~ '^[A-Za-z0-9_-]+$' AND doctor ~ '^[A-Za-z0-9_-]+$'
  AND split_part(path,'/',1)=org AND split_part(path,'/',2)=doctor
  AND path ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(pdf|jpe?g|png|docx?|heif|pages|mht)$',false);
$$;

UPDATE storage.buckets
SET file_size_limit=greatest(coalesce(file_size_limit,0),25000000),
 allowed_mime_types=ARRAY(SELECT DISTINCT mime FROM unnest(coalesce(allowed_mime_types,ARRAY[]::text[])||ARRAY[
  'application/pdf','image/jpeg','image/png','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/heif','application/vnd.apple.pages','application/x-mimearchive'
 ])mime ORDER BY mime)
WHERE id='medical-documents'AND public=false;
COMMIT;
