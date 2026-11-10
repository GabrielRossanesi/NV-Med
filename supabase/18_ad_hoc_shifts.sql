-- NV Med: temporary coverage, separate from recurring sector demand.
-- Apply after 17_tenant_document_catalog.sql and before deploying the UI.
BEGIN;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS coverage_mode text NOT NULL DEFAULT 'regular';
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS coverage_reason text;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_coverage_mode_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_coverage_mode_check CHECK (coverage_mode IN ('regular', 'adhoc'));
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_adhoc_details_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_adhoc_details_check CHECK (
  coverage_mode <> 'adhoc' OR (
    NULLIF(BTRIM(specialty), '') IS NOT NULL
    AND coverage_reason IS NOT NULL
    AND char_length(BTRIM(coverage_reason)) BETWEEN 3 AND 200
  )
);

CREATE OR REPLACE FUNCTION public.nv_validate_adhoc_shift()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.coverage_mode = 'adhoc' THEN
    NEW.coverage_reason := NULLIF(BTRIM(NEW.coverage_reason), '');
    NEW.specialty := NULLIF(BTRIM(NEW.specialty), '');
    IF NEW.coverage_reason IS NULL OR char_length(NEW.coverage_reason) NOT BETWEEN 3 AND 200 THEN
      RAISE EXCEPTION 'Informe o motivo da cobertura avulsa (3 a 200 caracteres).';
    END IF;
    IF NEW.specialty IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.sectors sector
      WHERE sector.id = NEW.sector_id AND sector.unit_id = NEW.unit_id
        AND sector.organization_id = NEW.organization_id
        AND NEW.specialty = ANY(sector.specialties)
    ) THEN
      RAISE EXCEPTION 'Selecione uma especialidade do setor para o plantão avulso.';
    END IF;
    IF NEW.doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.doctors doctor
      WHERE doctor.id = NEW.doctor_id AND doctor.organization_id = NEW.organization_id
        AND doctor.specialty = NEW.specialty
    ) THEN
      RAISE EXCEPTION 'O médico deve atender à especialidade da cobertura avulsa.';
    END IF;
  ELSE
    NEW.coverage_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.nv_validate_adhoc_shift() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS nv_validate_adhoc_shift ON public.shifts;
CREATE TRIGGER nv_validate_adhoc_shift BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_adhoc_shift();

CREATE INDEX IF NOT EXISTS idx_shifts_adhoc_unit_date
ON public.shifts (organization_id, unit_id, date) WHERE coverage_mode = 'adhoc';

-- Keep the display name in existing folders aligned when a requirement is
-- renamed. File paths, versions and review history are preserved.
CREATE OR REPLACE FUNCTION public.nv_sync_document_requirement_names()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.settings->'requiredDocuments' IS DISTINCT FROM OLD.settings->'requiredDocuments' THEN
    UPDATE public.medical_documents document
    SET name = requirement.value->>'name'
    FROM jsonb_array_elements(COALESCE(NEW.settings->'requiredDocuments', '[]'::jsonb)) requirement(value)
    WHERE document.organization_id = NEW.id
      AND document.type = requirement.value->>'type'
      AND NULLIF(BTRIM(requirement.value->>'name'), '') IS NOT NULL
      AND document.name IS DISTINCT FROM requirement.value->>'name';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.nv_sync_document_requirement_names() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS nv_sync_document_requirement_names ON public.organizations;
CREATE TRIGGER nv_sync_document_requirement_names AFTER UPDATE OF settings ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.nv_sync_document_requirement_names();

COMMIT;
