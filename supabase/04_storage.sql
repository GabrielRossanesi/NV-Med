-- ==============================================================================
-- NV MED - SUPABASE STORAGE SETUP (medical-documents)
-- ==============================================================================

-- 1. CRIAÇÃO DO BUCKET DE DOCUMENTOS MÉDICOS
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-documents',
  'medical-documents',
  true,
  20971520, -- 20MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. POLÍTICAS DE ACESSO AO BUCKET (RLS no schema storage)
DROP POLICY IF EXISTS "Public Read Medical Documents" ON storage.objects;
CREATE POLICY "Public Read Medical Documents"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'medical-documents');

DROP POLICY IF EXISTS "Public Upload Medical Documents" ON storage.objects;
CREATE POLICY "Public Upload Medical Documents"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'medical-documents');

DROP POLICY IF EXISTS "Public Update Medical Documents" ON storage.objects;
CREATE POLICY "Public Update Medical Documents"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'medical-documents');

DROP POLICY IF EXISTS "Public Delete Medical Documents" ON storage.objects;
CREATE POLICY "Public Delete Medical Documents"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'medical-documents');
