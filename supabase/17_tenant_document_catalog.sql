-- NV Med: tenant-owned document catalogs and corrected document storage policy.
-- Apply after 16_sector_coverage_periods.sql.
BEGIN;

-- Document types are tenant-defined. Keep a stable, machine-safe key while
-- allowing each organization to choose the labels and rules shown in the UI.
ALTER TABLE public.medical_documents
  DROP CONSTRAINT IF EXISTS medical_documents_type_check;

ALTER TABLE public.medical_documents
  DROP CONSTRAINT IF EXISTS medical_documents_type_format;

ALTER TABLE public.medical_documents
  ADD CONSTRAINT medical_documents_type_format
  CHECK (
    char_length(type) BETWEEN 1 AND 100
    AND type ~ '^[a-z0-9_]+$'
  );

CREATE OR REPLACE FUNCTION public.nv_required_document_applies(
  requirement jsonb,
  doctor_specialty text,
  doctor_units text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE((requirement->>'required')::boolean, true)
    AND jsonb_typeof(requirement) = 'object'
    AND NULLIF(BTRIM(requirement->>'type'), '') IS NOT NULL
    AND NULLIF(BTRIM(requirement->>'name'), '') IS NOT NULL
    AND (
      jsonb_array_length(COALESCE(requirement->'specialties', '[]'::jsonb)) = 0
      OR requirement->'specialties' ? doctor_specialty
    )
    AND (
      jsonb_array_length(COALESCE(requirement->'unitIds', '[]'::jsonb)) = 0
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(requirement->'unitIds') AS required_unit(unit_id)
        WHERE required_unit.unit_id = ANY(COALESCE(doctor_units, ARRAY[]::text[]))
      )
    );
$$;

REVOKE ALL ON FUNCTION public.nv_required_document_applies(jsonb,text,text[]) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.nv_create_required_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requirement jsonb;
BEGIN
  FOR requirement IN
    SELECT jsonb_array_elements(COALESCE(settings->'requiredDocuments', '[]'::jsonb))
    FROM public.organizations
    WHERE id = NEW.organization_id
  LOOP
    IF public.nv_required_document_applies(requirement, NEW.specialty, NEW.linked_units)
      AND NOT EXISTS (
        SELECT 1
        FROM public.medical_documents existing
        WHERE existing.doctor_id = NEW.id
          AND existing.organization_id = NEW.organization_id
          AND existing.type = requirement->>'type'
      )
    THEN
      INSERT INTO public.medical_documents(id, organization_id, doctor_id, name, type, status)
      VALUES (
        gen_random_uuid()::text,
        NEW.organization_id,
        NEW.id,
        requirement->>'name',
        requirement->>'type',
        'not_sent'
      );
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_create_required_documents() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.nv_sync_required_documents(target_organization_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  doctor_record public.doctors%ROWTYPE;
  requirement jsonb;
BEGIN
  FOR doctor_record IN
    SELECT *
    FROM public.doctors
    WHERE organization_id = target_organization_id
  LOOP
    FOR requirement IN
      SELECT jsonb_array_elements(COALESCE(settings->'requiredDocuments', '[]'::jsonb))
      FROM public.organizations
      WHERE id = target_organization_id
    LOOP
      IF public.nv_required_document_applies(
        requirement,
        doctor_record.specialty,
        doctor_record.linked_units
      ) AND NOT EXISTS (
        SELECT 1
        FROM public.medical_documents existing
        WHERE existing.doctor_id = doctor_record.id
          AND existing.organization_id = target_organization_id
          AND existing.type = requirement->>'type'
      )
      THEN
        INSERT INTO public.medical_documents(id, organization_id, doctor_id, name, type, status)
        VALUES (
          gen_random_uuid()::text,
          target_organization_id,
          doctor_record.id,
          requirement->>'name',
          requirement->>'type',
          'not_sent'
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_sync_required_documents(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.nv_sync_documents_after_settings_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.settings->'requiredDocuments' IS DISTINCT FROM OLD.settings->'requiredDocuments' THEN
    PERFORM public.nv_sync_required_documents(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_sync_documents_after_settings_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS nv_sync_documents_after_settings_change ON public.organizations;
CREATE TRIGGER nv_sync_documents_after_settings_change
AFTER UPDATE OF settings ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.nv_sync_documents_after_settings_change();

-- The previous policy resolved the unqualified `name` inside the doctor
-- subquery as doctors.name. Passing the object path into a helper keeps the
-- storage row reference unambiguous and preserves tenant isolation.
CREATE OR REPLACE FUNCTION public.nv_document_storage_target_exists(object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.doctors doctor
    WHERE doctor.organization_id = (storage.foldername(object_name))[1]
      AND doctor.id = (storage.foldername(object_name))[2]
  );
$$;

REVOKE ALL ON FUNCTION public.nv_document_storage_target_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_document_storage_target_exists(text) TO authenticated;

DROP POLICY IF EXISTS nv_files_insert ON storage.objects;
CREATE POLICY nv_files_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'medical-documents'
  AND public.nv_can_write((storage.foldername(name))[1], 'medical_documents')
  AND public.nv_document_storage_target_exists(name)
);

-- Backfill document placeholders for requirements already configured before
-- this migration. Existing uploads and review history are never deleted.
DO $$
DECLARE
  organization_record record;
BEGIN
  FOR organization_record IN SELECT id FROM public.organizations LOOP
    PERFORM public.nv_sync_required_documents(organization_record.id);
  END LOOP;
END;
$$;

COMMIT;
