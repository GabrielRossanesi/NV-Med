-- Apply after 30. No automatic inference or rewrite of legacy sectors/shifts.
BEGIN;

ALTER TABLE public.sectors ADD COLUMN primary_specialty text
  CHECK (primary_specialty IS NULL OR length(btrim(primary_specialty)) BETWEEN 1 AND 150);
COMMENT ON COLUMN public.sectors.primary_specialty IS 'Principal specialty for new shifts; specialties retains legacy relationships.';
ALTER TABLE public.shifts ALTER COLUMN sector_id DROP NOT NULL;
ALTER TABLE public.shifts ADD CONSTRAINT nv_regular_shift_sector_required CHECK (sector_id IS NOT NULL OR coverage_mode='adhoc');

CREATE TABLE public.sector_specialty_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  sector_id text NOT NULL,
  previous_specialty text,
  next_specialty text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sector_specialty_history_sector_idx ON public.sector_specialty_history(organization_id,sector_id,changed_at DESC);
ALTER TABLE public.sector_specialty_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sector_specialty_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sector_specialty_history TO authenticated;
CREATE POLICY nv_read ON public.sector_specialty_history FOR SELECT TO authenticated
  USING (public.nv_can_action(organization_id,'unidades','view'));

CREATE FUNCTION public.nv_sector_primary_specialty_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  NEW.primary_specialty := nullif(btrim(NEW.primary_specialty),'');
  IF NEW.primary_specialty IS NOT NULL AND NOT NEW.primary_specialty=ANY(NEW.specialties) THEN
    NEW.specialties := array_append(NEW.specialties,NEW.primary_specialty);
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.primary_specialty,NEW.unit_id,NEW.organization_id)
    IS NOT DISTINCT FROM (OLD.primary_specialty,OLD.unit_id,OLD.organization_id) THEN RETURN NEW; END IF;
  IF NEW.primary_specialty IS NULL THEN
    RAISE EXCEPTION 'Vincule uma especialidade principal ao setor.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.organizations o JOIN public.units u ON u.organization_id=o.id
    WHERE o.id=NEW.organization_id AND u.id=NEW.unit_id
      AND coalesce(o.settings->'specialties','[]'::jsonb) ? NEW.primary_specialty
      AND (cardinality(u.specialties)=0 OR NEW.primary_specialty=ANY(u.specialties))) THEN
    RAISE EXCEPTION 'Escolha uma especialidade ativa da empresa e autorizada para a unidade.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT count(*) INTO affected FROM public.shifts s WHERE s.sector_id=OLD.id
      AND s.organization_id=OLD.organization_id AND s.status NOT IN ('cancelled','completed')
      AND public.nv_shift_ends(s)>now() AND s.specialty IS DISTINCT FROM NEW.primary_specialty;
    IF affected>0 THEN
      RAISE EXCEPTION 'Alteração bloqueada: % plantão(ões) futuro(s) ou em andamento usam outra especialidade. Regularize as escalas, candidaturas e trocas antes de alterar o setor.', affected USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_a_sector_primary_specialty BEFORE INSERT OR UPDATE ON public.sectors
FOR EACH ROW EXECUTE FUNCTION public.nv_sector_primary_specialty_guard();

CREATE FUNCTION public.nv_sector_specialty_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.sector_specialty_history(organization_id,sector_id,next_specialty,actor_id)
      VALUES(NEW.organization_id,NEW.id,NEW.primary_specialty,auth.uid());
  ELSIF NEW.primary_specialty IS DISTINCT FROM OLD.primary_specialty THEN
    INSERT INTO public.sector_specialty_history(organization_id,sector_id,previous_specialty,next_specialty,actor_id)
      VALUES(NEW.organization_id,NEW.id,OLD.primary_specialty,NEW.primary_specialty,auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_sector_specialty_audit AFTER INSERT OR UPDATE ON public.sectors
FOR EACH ROW EXECUTE FUNCTION public.nv_sector_specialty_audit();

CREATE FUNCTION public.nv_define_shift_specialty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sector public.sectors;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.organization_id,NEW.unit_id,NEW.sector_id,NEW.specialty)
      IS NOT DISTINCT FROM (OLD.organization_id,OLD.unit_id,OLD.sector_id,OLD.specialty) THEN RETURN NEW; END IF;
    IF public.nv_shift_ends(OLD)<=now() OR OLD.status='completed' THEN
      RAISE EXCEPTION 'A especialidade do plantão histórico deve ser preservada.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF NEW.sector_id IS NULL AND NEW.coverage_mode='adhoc' THEN
    IF NOT EXISTS (SELECT FROM public.organizations o WHERE o.id=NEW.organization_id
      AND coalesce(o.settings->'specialties','[]'::jsonb) ? NEW.specialty) THEN
      RAISE EXCEPTION 'Escolha uma especialidade ativa da empresa.' USING ERRCODE='22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO sector FROM public.sectors s WHERE s.id=NEW.sector_id
    AND s.organization_id=NEW.organization_id AND s.unit_id=NEW.unit_id FOR SHARE;
  IF NOT FOUND OR sector.status<>'active' THEN
    RAISE EXCEPTION 'Selecione um setor ativo desta unidade e empresa.' USING ERRCODE='22023';
  END IF;
  IF sector.primary_specialty IS NULL THEN
    RAISE EXCEPTION 'Configure a especialidade principal do setor antes de criar novos plantões.' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.organizations o WHERE o.id=NEW.organization_id
    AND coalesce(o.settings->'specialties','[]'::jsonb) ? sector.primary_specialty) THEN
    RAISE EXCEPTION 'A especialidade do setor precisa estar ativa no catálogo da empresa.' USING ERRCODE='22023';
  END IF;
  IF NEW.specialty IS NOT NULL AND NEW.specialty<>sector.primary_specialty THEN
    RAISE EXCEPTION 'A especialidade do plantão é definida pelo setor.' USING ERRCODE='22023';
  END IF;
  NEW.specialty := sector.primary_specialty;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_a_define_shift_specialty BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_define_shift_specialty();

-- A structured approved enrollment is mandatory, including legacy physicians.
-- Existing occurrences use their stored specialty snapshot.
CREATE OR REPLACE FUNCTION public.nv_credentialed_for_shift(doctor text, shift public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT FROM public.doctors d
    JOIN public.doctor_enrollments e ON e.doctor_id=d.id AND e.organization_id=d.organization_id
    JOIN public.organizations o ON o.id=d.organization_id
    JOIN public.units u ON u.id=shift.unit_id AND u.organization_id=o.id
    LEFT JOIN public.sectors s ON s.id=shift.sector_id AND s.unit_id=u.id AND s.organization_id=o.id
    WHERE d.id=doctor AND d.organization_id=shift.organization_id AND d.status='active'
      AND e.status='approved' AND o.status='active' AND u.status='active'
      AND coalesce(o.settings->'specialties','[]'::jsonb) ? shift.specialty
      AND (s.status='active' OR (shift.sector_id IS NULL AND shift.coverage_mode='adhoc'))
      AND shift.unit_id=ANY(d.linked_units) AND shift.specialty=ANY(e.approved_specialties)
      AND public.nv_shift_specialty_allowed(shift.organization_id,shift.unit_id,shift.sector_id,shift.specialty)
  );
$$;

CREATE OR REPLACE FUNCTION public.nv_validate_portal_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid;
BEGIN
  IF NEW.doctor_id IS NULL OR NEW.status='cancelled' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND (NEW.doctor_id,NEW.date,NEW.start_time,NEW.end_time,NEW.unit_id,NEW.sector_id,NEW.specialty)
    IS NOT DISTINCT FROM (OLD.doctor_id,OLD.date,OLD.start_time,OLD.end_time,OLD.unit_id,OLD.sector_id,OLD.specialty)
    AND OLD.status<>'cancelled' THEN RETURN NEW; END IF;
  IF NOT public.nv_credentialed_for_shift(NEW.doctor_id,NEW)
    OR NOT public.nv_shift_documents_clear(NEW.doctor_id,NEW) THEN
    RAISE EXCEPTION 'Médico sem credenciamento válido ou com bloqueio documental para esta unidade e especialidade.' USING ERRCODE='22023';
  END IF;
  SELECT auth_user_id INTO actor FROM public.doctor_enrollments WHERE doctor_id=NEW.doctor_id;
  IF actor IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('nv-physician:' || actor::text,0));
    IF public.nv_portal_conflict(actor,NEW) THEN
      RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Only IDs are returned. Credentials, documents and conflicts stay on the server.
CREATE FUNCTION public.nv_eligible_shift_doctors(candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.shifts;
BEGIN
  item := jsonb_populate_record(NULL::public.shifts,candidate);
  IF NOT public.nv_org_access(item.organization_id) OR NOT public.nv_can_action(item.organization_id,'escala','view') THEN
    RAISE EXCEPTION 'Consulta indisponível para este acesso.' USING ERRCODE='42501';
  END IF;
  IF item.date IS NULL OR item.start_time IS NULL OR item.end_time IS NULL
    OR item.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR item.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR item.start_time=item.end_time THEN RETURN '[]'::jsonb; END IF;
  RETURN (SELECT coalesce(jsonb_agg(d.id),'[]') FROM public.doctors d
    JOIN public.doctor_enrollments e ON e.doctor_id=d.id AND e.organization_id=d.organization_id
    WHERE d.organization_id=item.organization_id AND public.nv_credentialed_for_shift(d.id,item)
      AND public.nv_shift_documents_clear(d.id,item)
      AND (e.auth_user_id IS NULL OR NOT public.nv_portal_conflict(e.auth_user_id,item))
      AND NOT EXISTS (SELECT FROM public.shifts other WHERE other.doctor_id=d.id AND other.organization_id=item.organization_id
        AND other.id IS DISTINCT FROM item.id AND other.status<>'cancelled'
        AND public.nv_shift_starts(other)<public.nv_shift_ends(item) AND public.nv_shift_ends(other)>public.nv_shift_starts(item)));
END;
$$;
REVOKE ALL ON FUNCTION public.nv_sector_primary_specialty_guard(),public.nv_sector_specialty_audit(),
  public.nv_define_shift_specialty(),public.nv_eligible_shift_doctors(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nv_eligible_shift_doctors(jsonb) TO authenticated;

-- Remaining compatibility replacements are below.

CREATE OR REPLACE FUNCTION public.nv_save_sector_with_finance(sector jsonb, creating boolean, defaults jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item public.sectors;
  rule_key text;
  amount text;
  notes text := nullif(btrim(defaults->>'notes'),'');
  frequency text := defaults->>'frequency';
  turn_name text;
BEGIN
  IF jsonb_typeof(sector) IS DISTINCT FROM 'object' OR jsonb_typeof(defaults) IS DISTINCT FROM 'object' OR creating IS NULL
    OR coalesce(length(notes),0) > 1000 OR (frequency IS NOT NULL AND frequency NOT IN ('on_delivery','monthly')) THEN
    RAISE EXCEPTION 'Confira a configuração financeira do setor.' USING ERRCODE = '22023';
  END IF;
  item := jsonb_populate_record(NULL::public.sectors,sector);
  IF item.id IS NULL OR length(item.id) > 100 OR NOT public.nv_org_access(item.organization_id)
    OR NOT public.nv_can_action(item.organization_id,'unidades',CASE WHEN creating THEN 'create' ELSE 'edit' END)
    OR NOT public.nv_can_finance(item.organization_id)
    OR NOT EXISTS (SELECT FROM public.units u WHERE u.id=item.unit_id AND u.organization_id=item.organization_id) THEN
    RAISE EXCEPTION 'Configuração financeira do setor indisponível.' USING ERRCODE = '42501';
  END IF;
  IF creating THEN
    INSERT INTO public.sectors(id,organization_id,unit_id,name,description,specialties,primary_specialty,status,
      default_start_time,default_end_time,required_doctors,coverage_periods)
    VALUES (item.id,item.organization_id,item.unit_id,item.name,item.description,item.specialties,item.primary_specialty,item.status,
      item.default_start_time,item.default_end_time,item.required_doctors,item.coverage_periods);
  ELSE
    UPDATE public.sectors s SET name=item.name,description=item.description,specialties=item.specialties,primary_specialty=item.primary_specialty,status=item.status,
      default_start_time=item.default_start_time,default_end_time=item.default_end_time,
      required_doctors=item.required_doctors,coverage_periods=item.coverage_periods
    WHERE s.id=item.id AND s.organization_id=item.organization_id AND s.unit_id=item.unit_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Setor indisponível.' USING ERRCODE = '42501'; END IF;
  END IF;
  FOREACH rule_key IN ARRAY ARRAY['amount_cents','day_cents','night_cents'] LOOP
    turn_name := CASE rule_key WHEN 'day_cents' THEN 'day' WHEN 'night_cents' THEN 'night' END;
    amount := defaults->>rule_key;
    IF amount IS NOT NULL AND (amount !~ '^[0-9]{1,12}$' OR (turn_name IS NOT NULL AND NOT EXISTS
      (SELECT FROM jsonb_array_elements(item.coverage_periods) p WHERE p->>'kind'=turn_name))) THEN
      RAISE EXCEPTION 'Confira os valores e os turnos da referência financeira.' USING ERRCODE = '22023';
    END IF;
    IF amount IS NULL AND (turn_name IS NOT NULL OR (frequency IS NULL AND notes IS NULL)) THEN
      DELETE FROM public.organization_shift_rates r WHERE r.organization_id=item.organization_id AND r.unit_id=item.unit_id
        AND r.sector_id=item.id AND r.post_default AND r.turn IS NOT DISTINCT FROM turn_name;
    ELSE
      INSERT INTO public.organization_shift_rates(organization_id,unit_id,sector_id,turn,amount_cents,post_default,payment_frequency,financial_notes)
      VALUES (item.organization_id,item.unit_id,item.id,turn_name,amount::bigint,true,
        CASE WHEN turn_name IS NULL THEN frequency END,CASE WHEN turn_name IS NULL THEN notes END)
      ON CONFLICT ON CONSTRAINT nv_shift_rate_scope DO UPDATE SET
        amount_cents=EXCLUDED.amount_cents,payment_frequency=EXCLUDED.payment_frequency,financial_notes=EXCLUDED.financial_notes,active=true;
    END IF;
  END LOOP;
  RETURN item.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_validate_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE starts timestamp; ends timestamp; canonical_sector text;
BEGIN
 SELECT sec.name INTO canonical_sector FROM public.sectors sec
 WHERE sec.id=NEW.sector_id AND sec.unit_id=NEW.unit_id AND sec.organization_id=NEW.organization_id;
 IF canonical_sector IS NULL AND NOT (NEW.sector_id IS NULL AND NEW.coverage_mode='adhoc') THEN RAISE EXCEPTION 'Selecione um setor válido desta unidade.'; END IF;
 NEW.sector := canonical_sector;
 IF NEW.specialty IS NOT NULL THEN NEW.specialty := nullif(trim(NEW.specialty),''); END IF;
 IF NEW.doctor_id IS NULL THEN
   NEW.status := CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'open' END;
 ELSE
   IF NEW.status='open' THEN NEW.status := 'pending'; END IF;
   IF NEW.employment_type IS NULL AND (TG_OP = 'INSERT' OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR OLD.employment_type IS NOT NULL) THEN RAISE EXCEPTION 'Informe o vínculo de trabalho.'; END IF;
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


CREATE OR REPLACE FUNCTION public.nv_validate_active_shift_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT (NEW.sector_id IS NULL AND NEW.coverage_mode='adhoc') AND NEW.status <> 'cancelled' AND (TG_OP = 'INSERT'
    OR (NEW.sector_id, NEW.unit_id, NEW.date, NEW.start_time, NEW.end_time)
      IS DISTINCT FROM (OLD.sector_id, OLD.unit_id, OLD.date, OLD.start_time, OLD.end_time)
    OR OLD.status = 'cancelled')
    AND NOT EXISTS (
      SELECT 1 FROM public.sectors s WHERE s.id = NEW.sector_id AND s.organization_id = NEW.organization_id
        AND s.unit_id = NEW.unit_id AND s.status = 'active'
    ) THEN RAISE EXCEPTION 'Selecione um posto ativo para o plantão.' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_filter_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE category text := split_part(NEW.event_key, ':', 1);
BEGIN
  -- An approved physician may have no portal account; there is no recipient to notify.
  IF NEW.recipient_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.portal_notification_preferences p WHERE p.recipient_id = NEW.recipient_id AND (
    (category IN ('offer','vacancy') AND NOT p.offers) OR (category = 'reminder' AND NOT p.reminders)
    OR (category IN ('document','expiry') AND NOT p.documents)
  )) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;

-- Resolve the sector specialty before applying existing PJ pricing rules.
CREATE OR REPLACE FUNCTION public.nv_save_operational_shifts(records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry jsonb;
  item public.shifts%ROWTYPE;
  previous public.shifts%ROWTYPE;
  selection jsonb;
  saved text[] := '{}';
BEGIN
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Envie de 1 a 5000 plantões por operação.' USING ERRCODE = '22023';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(records)
    ORDER BY value->>'organization_id', value->>'doctor_id', value->>'id'
  LOOP
    IF entry->>'payment_amount' IS NOT NULL AND entry->>'payment_amount' !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Informe um valor em reais com até duas casas decimais.' USING ERRCODE = '22023';
    END IF;
    item := jsonb_populate_record(NULL::public.shifts, entry);
    selection := nullif(entry->'agreement','null'::jsonb);
    IF item.id IS NULL OR length(item.id) > 100 OR length(item.notes) > 1000
      OR NOT public.nv_org_access(item.organization_id) THEN
      RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
    END IF;
    IF selection IS NOT NULL AND NOT public.nv_can_finance(item.organization_id) THEN
      RAISE EXCEPTION 'Alteração financeira indisponível.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO previous FROM public.shifts WHERE id = item.id FOR UPDATE;
    IF FOUND THEN
      IF previous.organization_id <> item.organization_id OR NOT public.nv_can_action(item.organization_id,'escala','edit') THEN
        RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
      END IF;
      IF item.specialty IS NULL AND item.sector_id IS NOT NULL
        AND (item.unit_id,item.sector_id) IS DISTINCT FROM (previous.unit_id,previous.sector_id) THEN
        SELECT s.primary_specialty INTO item.specialty FROM public.sectors s
          WHERE s.id=item.sector_id AND s.unit_id=item.unit_id AND s.organization_id=item.organization_id FOR SHARE;
      END IF;
      item := public.nv_prepare_shift_employment(item, previous, selection);
      UPDATE public.shifts SET doctor_id = item.doctor_id, unit_id = item.unit_id, sector_id = item.sector_id,
        specialty = item.specialty, date = item.date, start_time = item.start_time, end_time = item.end_time,
        type = item.type, status = item.status, notes = item.notes, employment_type = item.employment_type,
        employer_name = item.employer_name, coverage_mode = coalesce(item.coverage_mode,'regular'), coverage_reason = item.coverage_reason,
        payment_amount = item.payment_amount, payment_frequency = item.payment_frequency,
        payment_agreement = item.payment_agreement, payment_note = item.payment_note WHERE id = item.id;
    ELSE
      IF NOT public.nv_can_action(item.organization_id,'escala','create') THEN
        RAISE EXCEPTION 'Seu acesso não permite criar plantões.' USING ERRCODE = '42501';
      END IF;
      IF item.specialty IS NULL AND item.sector_id IS NOT NULL THEN
        SELECT s.primary_specialty INTO item.specialty FROM public.sectors s
          WHERE s.id=item.sector_id AND s.unit_id=item.unit_id AND s.organization_id=item.organization_id FOR SHARE;
      END IF;
      item := public.nv_prepare_shift_employment(item, NULL::public.shifts, selection);
      INSERT INTO public.shifts(id, organization_id, doctor_id, unit_id, sector_id, specialty,
        date, start_time, end_time, type, status, notes, employment_type, employer_name, coverage_mode, coverage_reason,
        payment_amount, payment_frequency, payment_status, paid_at, payment_agreement)
      VALUES (item.id, item.organization_id, item.doctor_id, item.unit_id, item.sector_id, item.specialty,
        item.date, item.start_time, item.end_time, item.type, item.status, item.notes, item.employment_type, item.employer_name,
        coalesce(item.coverage_mode,'regular'), item.coverage_reason, item.payment_amount,
        coalesce(item.payment_frequency,'on_delivery'), coalesce(item.payment_status,'pending'), item.paid_at, item.payment_agreement);
    END IF;
    saved := array_append(saved, item.id);
  END LOOP;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') FROM public.nv_staff_shifts s WHERE s.id = ANY(saved));
EXCEPTION WHEN integrity_constraint_violation OR numeric_value_out_of_range OR invalid_text_representation THEN
  RAISE EXCEPTION 'Não foi possível salvar os plantões. Confira os vínculos e os campos obrigatórios.' USING ERRCODE = '22023';
END;
$$;

COMMIT;
