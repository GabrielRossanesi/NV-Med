-- Create the medical bucket private. Preserve existing limits and MIME types.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('medical-documents', 'medical-documents', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Public Read Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Update Medical Documents" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete Medical Documents" ON storage.objects;

COMMIT;
