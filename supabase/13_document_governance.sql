-- NV Med: document governance, review notes, versioning and immutable audit history.
-- Apply after 12_user_additional_permissions.sql.
BEGIN;

ALTER TABLE public.medical_documents
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE public.medical_documents DROP CONSTRAINT IF EXISTS medical_documents_review_note_length;
ALTER TABLE public.medical_documents ADD CONSTRAINT medical_documents_review_note_length
  CHECK (review_note IS NULL OR char_length(review_note) <= 1000);

CREATE OR REPLACE FUNCTION public.nv_create_required_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE doc jsonb;
BEGIN
  FOR doc IN SELECT jsonb_array_elements(COALESCE(settings->'requiredDocuments','[]'::jsonb))
    FROM public.organizations WHERE id = NEW.organization_id
  LOOP
    IF COALESCE((doc->>'required')::boolean, true)
      AND (
        jsonb_array_length(COALESCE(doc->'specialties','[]'::jsonb)) = 0
        OR doc->'specialties' ? NEW.specialty
      )
      AND (
        jsonb_array_length(COALESCE(doc->'unitIds','[]'::jsonb)) = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(doc->'unitIds') unit_id
          WHERE unit_id = ANY(COALESCE(NEW.linked_units, ARRAY[]::text[]))
        )
      )
    THEN
      INSERT INTO public.medical_documents(id,organization_id,doctor_id,name,type,status)
      VALUES(gen_random_uuid()::text,NEW.organization_id,NEW.id,doc->>'name',doc->>'type','not_sent');
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.document_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doctor_id text NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES public.medical_documents(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES public.user_accounts(id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT 'Sistema',
  action text NOT NULL CHECK (action IN ('created','file_uploaded','file_replaced','status_changed','expiry_changed','note_changed','updated')),
  from_status text,
  to_status text,
  note text,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_audit_org ON public.document_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_audit_doctor ON public.document_audit_logs(doctor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_audit_document ON public.document_audit_logs(document_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.nv_document_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.file_path IS DISTINCT FROM OLD.file_path AND NEW.file_path IS NOT NULL THEN
    NEW.version := COALESCE(OLD.version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nv_document_version ON public.medical_documents;
CREATE TRIGGER nv_document_version
BEFORE UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_document_version();

CREATE OR REPLACE FUNCTION public.nv_document_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  profile public.user_accounts%ROWTYPE;
  audit_action text := 'updated';
  change_set jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO profile FROM public.user_accounts WHERE auth_user_id = (SELECT auth.uid()) LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    audit_action := 'created';
    change_set := jsonb_build_object('status', NEW.status, 'version', NEW.version, 'filePath', NEW.file_path);
  ELSE
    IF NEW.file_path IS DISTINCT FROM OLD.file_path THEN
      audit_action := CASE WHEN OLD.file_path IS NULL THEN 'file_uploaded' ELSE 'file_replaced' END;
      change_set := change_set || jsonb_build_object(
        'previousFilePath', OLD.file_path,
        'filePath', NEW.file_path,
        'previousFileName', OLD.file_name,
        'fileName', NEW.file_name,
        'version', NEW.version
      );
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF audit_action = 'updated' THEN audit_action := 'status_changed'; END IF;
      change_set := change_set || jsonb_build_object('fromStatus', OLD.status, 'toStatus', NEW.status);
    END IF;
    IF NEW.expiry_date IS DISTINCT FROM OLD.expiry_date THEN
      IF audit_action = 'updated' THEN audit_action := 'expiry_changed'; END IF;
      change_set := change_set || jsonb_build_object('previousExpiryDate', OLD.expiry_date, 'expiryDate', NEW.expiry_date);
    END IF;
    IF NEW.review_note IS DISTINCT FROM OLD.review_note THEN
      IF audit_action = 'updated' THEN audit_action := 'note_changed'; END IF;
      change_set := change_set || jsonb_build_object('reviewNoteChanged', true);
    END IF;
    IF change_set = '{}'::jsonb THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO public.document_audit_logs(
    organization_id, doctor_id, document_id, actor_user_id, actor_name,
    action, from_status, to_status, note, changes
  ) VALUES (
    NEW.organization_id, NEW.doctor_id, NEW.id, profile.id,
    COALESCE(profile.name, 'Sistema'), audit_action,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
    NEW.status, NULLIF(BTRIM(NEW.review_note), ''), change_set
  );

  IF TG_OP = 'UPDATE' AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.review_note IS DISTINCT FROM OLD.review_note
  ) THEN
    UPDATE public.medical_documents
      SET reviewed_by = profile.id, reviewed_at = now()
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS nv_document_audit ON public.medical_documents;
CREATE TRIGGER nv_document_audit
AFTER INSERT OR UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_document_audit();

ALTER TABLE public.document_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nv_read ON public.document_audit_logs;
CREATE POLICY nv_read ON public.document_audit_logs
  FOR SELECT TO authenticated
  USING (public.nv_org_access(organization_id));

REVOKE INSERT, UPDATE, DELETE ON public.document_audit_logs FROM anon, authenticated;
GRANT SELECT ON public.document_audit_logs TO authenticated;

COMMIT;
