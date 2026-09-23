-- NV Med: day/night coverage periods per sector.
-- Apply after 15_fix_unit_link_trigger.sql.
BEGIN;

ALTER TABLE public.sectors ADD COLUMN IF NOT EXISTS coverage_periods jsonb;

UPDATE public.sectors
SET coverage_periods = jsonb_build_array(jsonb_build_object(
  'kind', CASE WHEN default_end_time < default_start_time THEN 'night' ELSE 'day' END,
  'startTime', default_start_time,
  'endTime', default_end_time,
  'requiredDoctors', required_doctors
))
WHERE coverage_periods IS NULL OR jsonb_typeof(coverage_periods) <> 'array' OR jsonb_array_length(coverage_periods) = 0;

ALTER TABLE public.sectors ALTER COLUMN coverage_periods SET DEFAULT '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1}]'::jsonb;
ALTER TABLE public.sectors ALTER COLUMN coverage_periods SET NOT NULL;

CREATE OR REPLACE FUNCTION public.nv_validate_sector() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE period jsonb; first_period jsonb;
BEGIN
 NEW.name := trim(NEW.name);
 IF length(NEW.name)=0 OR length(NEW.name)>100 THEN RAISE EXCEPTION 'Informe o nome do setor (até 100 caracteres).'; END IF;
 IF jsonb_typeof(NEW.coverage_periods)<>'array' OR jsonb_array_length(NEW.coverage_periods) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Selecione um ou dois períodos de cobertura.'; END IF;
 IF (SELECT count(*) FROM (SELECT value->>'kind' FROM jsonb_array_elements(NEW.coverage_periods) GROUP BY value->>'kind' HAVING count(*)>1) duplicated)>0 THEN RAISE EXCEPTION 'Cada período pode ser informado somente uma vez.'; END IF;
 FOR period IN SELECT value FROM jsonb_array_elements(NEW.coverage_periods) LOOP
   IF period->>'kind' NOT IN ('day','night') THEN RAISE EXCEPTION 'Período de cobertura inválido.'; END IF;
   IF coalesce(period->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(period->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR period->>'startTime'=period->>'endTime' THEN RAISE EXCEPTION 'Informe horários válidos e diferentes para cada período.'; END IF;
   IF coalesce(period->>'requiredDoctors','') !~ '^[0-9]+$' OR (period->>'requiredDoctors')::integer NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'Informe de 1 a 99 médicos esperados por período.'; END IF;
 END LOOP;
 first_period := NEW.coverage_periods->0;
 NEW.default_start_time := first_period->>'startTime';
 NEW.default_end_time := first_period->>'endTime';
 NEW.required_doctors := (first_period->>'requiredDoctors')::integer;
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.units u WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Selecione uma unidade válida da mesma empresa.'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS nv_validate_sector ON public.sectors;
CREATE TRIGGER nv_validate_sector BEFORE INSERT OR UPDATE ON public.sectors FOR EACH ROW EXECUTE FUNCTION public.nv_validate_sector();

COMMIT;
