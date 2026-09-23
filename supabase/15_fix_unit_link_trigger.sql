-- Fix nv_validate_links when the same trigger function runs for units,
-- doctors and medical_documents. Table-specific NEW fields must only be
-- referenced after PostgreSQL has selected the matching table branch.

CREATE OR REPLACE FUNCTION public.nv_validate_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'units' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'doctors' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(NEW.linked_units) AS links(unit_id)
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.units AS unit_record
        WHERE unit_record.id = links.unit_id
          AND unit_record.organization_id = NEW.organization_id
      )
    ) THEN
      RAISE EXCEPTION 'Unidade vinculada inválida.';
    END IF;

  ELSIF TG_TABLE_NAME = 'medical_documents' THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.';
      END IF;
    END IF;

    IF NEW.file_path IS NOT NULL THEN
      IF split_part(NEW.file_path, '/', 1) <> NEW.organization_id
        OR split_part(NEW.file_path, '/', 2) <> NEW.doctor_id
        OR NEW.file_path LIKE '%..%'
      THEN
        RAISE EXCEPTION 'Caminho de documento inválido.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Recreate all bindings so older environments converge to the same state.
DROP TRIGGER IF EXISTS nv_doctor_links ON public.doctors;
CREATE TRIGGER nv_doctor_links
BEFORE INSERT OR UPDATE ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_links();

DROP TRIGGER IF EXISTS nv_document_links ON public.medical_documents;
CREATE TRIGGER nv_document_links
BEFORE INSERT OR UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_links();

DROP TRIGGER IF EXISTS nv_unit_links ON public.units;
CREATE TRIGGER nv_unit_links
BEFORE UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_links();
