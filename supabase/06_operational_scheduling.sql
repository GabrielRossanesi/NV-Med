-- NV Med: canonical sectors, open staffing positions and weekly coverage.
-- Apply after 05_production.sql. Existing shifts are preserved and linked.
BEGIN;

CREATE TABLE IF NOT EXISTS public.sectors (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  name text NOT NULL,
  specialties text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  default_start_time text NOT NULL DEFAULT '07:00',
  default_end_time text NOT NULL DEFAULT '19:00',
  required_doctors integer NOT NULL DEFAULT 1 CHECK (required_doctors BETWEEN 1 AND 99),
  coverage_periods jsonb NOT NULL DEFAULT '[{"kind":"day","startTime":"07:00","endTime":"19:00","requiredDoctors":1}]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sectors_id_org_unique ON public.sectors(id,organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS sectors_unit_name_unique ON public.sectors(unit_id,lower(name));
CREATE INDEX IF NOT EXISTS idx_sectors_org_unit ON public.sectors(organization_id,unit_id);
DROP TRIGGER IF EXISTS set_sectors_updated_at ON public.sectors;
CREATE TRIGGER set_sectors_updated_at BEFORE UPDATE ON public.sectors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The previous validator rejects updates to historic rows that predate sectors.
-- Recreate it at the end after all legacy rows have been normalized.
DROP TRIGGER IF EXISTS nv_validate_shift ON public.shifts;

-- Turn the historic free-text sector names into canonical records.
INSERT INTO public.sectors(id,organization_id,unit_id,name,specialties)
SELECT gen_random_uuid()::text,s.organization_id,s.unit_id,coalesce(nullif(trim(s.sector),''),'Geral'),
       CASE WHEN count(DISTINCT d.specialty)=0 THEN '{}'::text[] ELSE array_agg(DISTINCT d.specialty) FILTER (WHERE d.specialty IS NOT NULL AND trim(d.specialty)<>'') END
FROM public.shifts s
LEFT JOIN public.doctors d ON d.id=s.doctor_id AND d.organization_id=s.organization_id
GROUP BY s.organization_id,s.unit_id,coalesce(nullif(trim(s.sector),''),'Geral')
ON CONFLICT DO NOTHING;

ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS sector_id text;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS specialty text;
ALTER TABLE public.shifts ALTER COLUMN doctor_id DROP NOT NULL;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_status_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_status_check CHECK (status IN ('open','confirmed','pending','cancelled','completed'));
UPDATE public.shifts s SET sector_id=sec.id,sector=sec.name
FROM public.sectors sec
WHERE s.sector_id IS NULL AND sec.organization_id=s.organization_id AND sec.unit_id=s.unit_id AND lower(sec.name)=lower(coalesce(nullif(trim(s.sector),''),'Geral'));
UPDATE public.shifts s SET specialty=d.specialty
FROM public.doctors d
WHERE s.specialty IS NULL AND s.doctor_id=d.id AND s.organization_id=d.organization_id;
ALTER TABLE public.shifts ALTER COLUMN sector_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shifts_sector_date ON public.shifts(sector_id,date);

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sectors_unit_tenant_fk') THEN
   ALTER TABLE public.sectors ADD CONSTRAINT sectors_unit_tenant_fk FOREIGN KEY(unit_id,organization_id) REFERENCES public.units(id,organization_id) ON DELETE CASCADE;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='shifts_sector_tenant_fk') THEN
   ALTER TABLE public.shifts ADD CONSTRAINT shifts_sector_tenant_fk FOREIGN KEY(sector_id,organization_id) REFERENCES public.sectors(id,organization_id) ON DELETE RESTRICT;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.nv_can_write(org text, resource text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id=(SELECT auth.uid()) AND u.status='active' AND (
   (u.type='saas_admin' AND (
      u.role IN ('CEO','Gerente') OR
      (u.role IN ('Coordenador','Administrativo') AND resource IN ('doctors','units','sectors','shifts')) OR
      (u.role='Jurídico' AND resource='medical_documents')
   )) OR (u.type='tenant_user' AND u.organization_id=org AND (
      u.role='Diretor' OR
      (u.role IN ('Gerente','Coordenador de Escalas','Escalista') AND resource IN ('doctors','units','sectors','shifts','medical_documents')) OR
      (u.role='Jurídico' AND resource='medical_documents')
   ))
 ));
$$;
REVOKE ALL ON FUNCTION public.nv_can_write(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_can_write(text,text) TO authenticated;

ALTER TABLE public.sectors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sectors FROM anon;
REVOKE ALL ON public.sectors FROM authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sectors TO authenticated;
DROP POLICY IF EXISTS nv_read ON public.sectors;
DROP POLICY IF EXISTS nv_insert ON public.sectors;
DROP POLICY IF EXISTS nv_update ON public.sectors;
DROP POLICY IF EXISTS nv_delete ON public.sectors;
CREATE POLICY nv_read ON public.sectors FOR SELECT TO authenticated USING(public.nv_org_access(organization_id));
CREATE POLICY nv_insert ON public.sectors FOR INSERT TO authenticated WITH CHECK(public.nv_can_write(organization_id,'sectors'));
CREATE POLICY nv_update ON public.sectors FOR UPDATE TO authenticated USING(public.nv_can_write(organization_id,'sectors')) WITH CHECK(public.nv_can_write(organization_id,'sectors'));
CREATE POLICY nv_delete ON public.sectors FOR DELETE TO authenticated USING(public.nv_can_write(organization_id,'sectors'));

CREATE OR REPLACE FUNCTION public.nv_validate_sector() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE period jsonb; first_period jsonb;
BEGIN
 NEW.name := trim(NEW.name);
 IF length(NEW.name)=0 OR length(NEW.name)>100 THEN RAISE EXCEPTION 'Informe o nome do setor (até 100 caracteres).'; END IF;
 IF jsonb_typeof(NEW.coverage_periods)<>'array' OR jsonb_array_length(NEW.coverage_periods) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'Selecione um ou dois períodos de cobertura.'; END IF;
 FOR period IN SELECT value FROM jsonb_array_elements(NEW.coverage_periods) LOOP
   IF period->>'kind' NOT IN ('day','night') OR coalesce(period->>'startTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR coalesce(period->>'endTime','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR period->>'startTime'=period->>'endTime' THEN RAISE EXCEPTION 'Informe períodos e horários válidos.'; END IF;
   IF coalesce(period->>'requiredDoctors','') !~ '^[0-9]+$' OR (period->>'requiredDoctors')::integer NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'Informe de 1 a 99 médicos esperados por período.'; END IF;
 END LOOP;
 first_period := NEW.coverage_periods->0;
 NEW.default_start_time := first_period->>'startTime'; NEW.default_end_time := first_period->>'endTime'; NEW.required_doctors := (first_period->>'requiredDoctors')::integer;
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.units u WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'Selecione uma unidade válida da mesma empresa.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nv_validate_sector ON public.sectors;
CREATE TRIGGER nv_validate_sector BEFORE INSERT OR UPDATE ON public.sectors FOR EACH ROW EXECUTE FUNCTION public.nv_validate_sector();

CREATE OR REPLACE FUNCTION public.nv_validate_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE starts timestamp; ends timestamp; canonical_sector text;
BEGIN
 SELECT sec.name INTO canonical_sector FROM public.sectors sec
 WHERE sec.id=NEW.sector_id AND sec.unit_id=NEW.unit_id AND sec.organization_id=NEW.organization_id;
 IF canonical_sector IS NULL THEN RAISE EXCEPTION 'Selecione um setor válido desta unidade.'; END IF;
 NEW.sector := canonical_sector;
 IF NEW.specialty IS NOT NULL THEN NEW.specialty := nullif(trim(NEW.specialty),''); END IF;
 IF NEW.doctor_id IS NULL THEN
   NEW.status := CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'open' END;
   NEW.employment_type := NULL;
   NEW.employer_name := NULL;
 ELSE
   IF NEW.status='open' THEN NEW.status := 'pending'; END IF;
   IF NEW.employment_type IS NULL OR NEW.employment_type NOT IN ('clt','concursado','pj') THEN RAISE EXCEPTION 'Informe o vínculo de trabalho.'; END IF;
   IF NEW.employment_type='pj' AND coalesce(length(trim(NEW.employer_name)),0)=0 THEN RAISE EXCEPTION 'Informe a empresa PJ.'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.doctors WHERE id=NEW.doctor_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE EXCEPTION 'Selecione um médico ativo da mesma empresa.'; END IF;
 END IF;
 IF length(NEW.employer_name)>150 THEN RAISE EXCEPTION 'Nome do empregador muito longo.'; END IF;
 IF NEW.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.start_time=NEW.end_time THEN RAISE EXCEPTION 'Informe horários válidos e diferentes.'; END IF;
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.units WHERE id=NEW.unit_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE EXCEPTION 'Selecione uma unidade ativa da mesma empresa.'; END IF;
 IF NEW.doctor_id IS NOT NULL AND NEW.status<>'cancelled' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id || ':' || NEW.doctor_id,0));
   starts := NEW.date + NEW.start_time::time;
   ends := NEW.date + NEW.end_time::time + CASE WHEN NEW.end_time<NEW.start_time THEN interval '1 day' ELSE interval '0 day' END;
   IF EXISTS(SELECT 1 FROM public.shifts s WHERE s.doctor_id=NEW.doctor_id AND s.id<>NEW.id AND s.status<>'cancelled' AND s.organization_id=NEW.organization_id AND
     (s.date+s.start_time::time) < ends AND (s.date+s.end_time::time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0 day' END)>starts) THEN
     RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.';
   END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nv_validate_shift ON public.shifts;
CREATE TRIGGER nv_validate_shift BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.nv_validate_shift();

COMMIT;
