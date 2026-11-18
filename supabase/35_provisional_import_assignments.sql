-- Provisional assignments explicitly authorized for identified source posts.
-- Authorizations are provisioned only by the privileged import job. They do not
-- activate doctors, approve credentials, create Auth users or authorize new posts.
BEGIN;
CREATE TABLE public.import_assignment_authorizations (
 shift_id text PRIMARY KEY REFERENCES public.shifts(id) ON DELETE CASCADE,
 doctor_id text NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
 organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 unit_id text NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
 sector_id text NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
 specialty text NOT NULL,
 date date NOT NULL,
 start_time text NOT NULL,
 end_time text NOT NULL,
 employment_type text NOT NULL CHECK(employment_type IN('pj','clt','concursado')),
 employer_name text,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 identity_basis text NOT NULL,
 authorization_note text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
ALTER TABLE public.import_assignment_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.import_assignment_authorizations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.nv_import_assignment_matches(item public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT FROM public.import_assignment_authorizations a
  JOIN public.doctors d ON d.id=a.doctor_id AND d.organization_id=a.organization_id
  JOIN public.organizations o ON o.id=a.organization_id AND o.status='active'
  JOIN public.units u ON u.id=a.unit_id AND u.organization_id=o.id AND u.status='active'
  JOIN public.sectors s ON s.id=a.sector_id AND s.unit_id=u.id AND s.organization_id=o.id AND s.status='active'
  WHERE a.shift_id=item.id AND a.doctor_id=item.doctor_id AND a.revoked_at IS NULL
   AND a.organization_id=item.organization_id AND a.unit_id=item.unit_id AND a.sector_id=item.sector_id
   AND a.specialty=item.specialty AND a.date=item.date
   AND a.start_time=item.start_time AND a.end_time=item.end_time
   AND a.employment_type=item.employment_type AND a.employer_name IS NOT DISTINCT FROM item.employer_name
   AND d.status IN('active','pending') AND a.unit_id=ANY(d.linked_units)
   AND d.specialty=item.specialty
   AND public.nv_shift_specialty_allowed(item.organization_id,item.unit_id,item.sector_id,item.specialty)
   AND ((SELECT auth.uid())IS NULL OR public.nv_org_access(item.organization_id))
 );
$$;
REVOKE ALL ON FUNCTION public.nv_import_assignment_matches(public.shifts) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.nv_import_assignment_matches(public.shifts) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.nv_validate_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE starts timestamp; ends timestamp; canonical_sector text;
BEGIN
 SELECT sec.name INTO canonical_sector FROM public.sectors sec
 WHERE sec.id=NEW.sector_id AND sec.unit_id=NEW.unit_id AND sec.organization_id=NEW.organization_id;
 IF canonical_sector IS NULL AND NOT(NEW.sector_id IS NULL AND NEW.coverage_mode='adhoc')THEN RAISE EXCEPTION 'Selecione um setor válido desta unidade.';END IF;
 NEW.sector := canonical_sector;
 IF NEW.specialty IS NOT NULL THEN NEW.specialty := nullif(trim(NEW.specialty),''); END IF;
 IF NEW.doctor_id IS NULL THEN
   NEW.status := CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'open' END;
 ELSE
   IF NEW.status='open' THEN NEW.status := 'pending'; END IF;
   IF NEW.employment_type IS NULL AND (TG_OP='INSERT' OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR OLD.employment_type IS NOT NULL) THEN RAISE EXCEPTION 'Informe o vínculo de trabalho.'; END IF;
   IF NEW.employment_type='pj' AND coalesce(length(trim(NEW.employer_name)),0)=0 THEN RAISE EXCEPTION 'Informe a empresa PJ.'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.doctors WHERE id=NEW.doctor_id AND organization_id=NEW.organization_id AND status='active')
     AND NOT(NEW.status IN('pending','cancelled')AND public.nv_import_assignment_matches(NEW)) THEN
     RAISE EXCEPTION 'Selecione um médico ativo da mesma empresa.';
   END IF;
 END IF;
 IF length(NEW.employer_name)>150 THEN RAISE EXCEPTION 'Nome do empregador muito longo.'; END IF;
 IF NEW.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.start_time=NEW.end_time THEN RAISE EXCEPTION 'Informe horários válidos e diferentes.'; END IF;
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.units WHERE id=NEW.unit_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE EXCEPTION 'Selecione uma unidade ativa da mesma empresa.'; END IF;
 IF NEW.doctor_id IS NOT NULL AND NEW.status<>'cancelled' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.doctor_id,0));
   starts:=NEW.date+NEW.start_time::time;
   ends:=NEW.date+NEW.end_time::time+CASE WHEN NEW.end_time<NEW.start_time THEN interval '1 day' ELSE interval '0 day' END;
   IF EXISTS(SELECT 1 FROM public.shifts s WHERE s.doctor_id=NEW.doctor_id AND s.id<>NEW.id AND s.status<>'cancelled'AND s.organization_id=NEW.organization_id AND
    (s.date+s.start_time::time)<ends AND(s.date+s.end_time::time+CASE WHEN s.end_time<=s.start_time THEN interval '1 day' ELSE interval '0 day' END)>starts)THEN
    RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nv_validate_portal_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; provisional boolean;
BEGIN
 IF NEW.doctor_id IS NULL OR NEW.status='cancelled'THEN RETURN NEW;END IF;
 provisional:=public.nv_import_assignment_matches(NEW)AND NOT public.nv_credentialed_for_shift(NEW.doctor_id,NEW);
 IF provisional THEN
  IF NEW.status<>'pending'THEN
   RAISE EXCEPTION 'Vínculo provisório: conclua o cadastro e o credenciamento antes de confirmar o plantão.' USING ERRCODE='22023';
  END IF;
 ELSE
  IF TG_OP='UPDATE'AND(NEW.doctor_id,NEW.date,NEW.start_time,NEW.end_time,NEW.unit_id,NEW.sector_id,NEW.specialty)
    IS NOT DISTINCT FROM(OLD.doctor_id,OLD.date,OLD.start_time,OLD.end_time,OLD.unit_id,OLD.sector_id,OLD.specialty)
    AND OLD.status<>'cancelled'
    AND NOT EXISTS(SELECT FROM public.import_assignment_authorizations a WHERE a.shift_id=NEW.id AND a.doctor_id=NEW.doctor_id)
    THEN RETURN NEW;END IF;
  IF NOT public.nv_credentialed_for_shift(NEW.doctor_id,NEW)THEN
   RAISE EXCEPTION 'Médico sem credenciamento válido ou com bloqueio documental para esta unidade e especialidade.' USING ERRCODE='22023';
  END IF;
 END IF;
 IF NOT public.nv_shift_documents_clear(NEW.doctor_id,NEW)THEN
  RAISE EXCEPTION 'Médico sem credenciamento válido ou com bloqueio documental para esta unidade e especialidade.' USING ERRCODE='22023';
 END IF;
 SELECT auth_user_id INTO actor FROM public.doctor_enrollments WHERE doctor_id=NEW.doctor_id;
 IF actor IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-physician:'||actor::text,0));
  IF public.nv_portal_conflict(actor,NEW)THEN
   RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
COMMIT;
