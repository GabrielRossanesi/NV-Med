-- NV Med: sector price defaults and shift agreements before a physician is assigned.
-- Apply after 28_scoped_sectors_and_reports.sql. Existing amounts and settlements are not repriced.
BEGIN;

ALTER TABLE public.organization_shift_rates
  ALTER COLUMN amount_cents DROP NOT NULL,
  ADD COLUMN post_default boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_frequency text CHECK (payment_frequency IN ('on_delivery','monthly')),
  ADD COLUMN financial_notes text CHECK (length(financial_notes) <= 1000),
  ADD CONSTRAINT nv_post_rate_shape CHECK (
    (NOT post_default AND amount_cents IS NOT NULL AND payment_frequency IS NULL AND financial_notes IS NULL)
    OR (post_default AND sector_id IS NOT NULL AND unit_id IS NOT NULL AND specialty IS NULL
      AND duration_minutes IS NULL AND shift_type IS NULL
      AND (turn IS NULL OR (amount_cents IS NOT NULL AND payment_frequency IS NULL AND financial_notes IS NULL)))
  );
DO $migration$
DECLARE old_constraint name;
BEGIN
  SELECT conname INTO STRICT old_constraint FROM pg_constraint
  WHERE conrelid = 'public.organization_shift_rates'::regclass AND contype = 'u';
  EXECUTE format('ALTER TABLE public.organization_shift_rates DROP CONSTRAINT %I',old_constraint);
END
$migration$;
ALTER TABLE public.organization_shift_rates ADD CONSTRAINT nv_shift_rate_scope
  UNIQUE NULLS NOT DISTINCT (organization_id,unit_id,sector_id,specialty,duration_minutes,shift_type,turn,post_default);

ALTER TABLE public.shifts ALTER COLUMN payment_amount DROP NOT NULL, ALTER COLUMN payment_amount DROP DEFAULT;

-- Save the existing sector record and its private finance defaults as a single operation.
CREATE FUNCTION public.nv_save_sector_with_finance(sector jsonb, creating boolean, defaults jsonb)
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
    INSERT INTO public.sectors(id,organization_id,unit_id,name,description,specialties,status,
      default_start_time,default_end_time,required_doctors,coverage_periods)
    VALUES (item.id,item.organization_id,item.unit_id,item.name,item.description,item.specialties,item.status,
      item.default_start_time,item.default_end_time,item.required_doctors,item.coverage_periods);
  ELSE
    UPDATE public.sectors s SET name=item.name,description=item.description,specialties=item.specialties,status=item.status,
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
REVOKE ALL ON FUNCTION public.nv_save_sector_with_finance(jsonb,boolean,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nv_save_sector_with_finance(jsonb,boolean,jsonb) TO authenticated;


CREATE OR REPLACE FUNCTION public.nv_save_shift_rate(org text, target uuid, rule jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item public.organization_shift_rates%ROWTYPE;
  saved public.organization_shift_rates%ROWTYPE;
  cents text := rule->>'amount_cents';
BEGIN
  IF NOT public.nv_can_finance(org) OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org) THEN
    RAISE EXCEPTION 'Valores de plantões indisponíveis.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(rule) IS DISTINCT FROM 'object' OR cents IS NULL OR cents !~ '^[0-9]{1,12}$'
    OR jsonb_typeof(rule->'active') IS DISTINCT FROM 'boolean'
    OR (rule->>'duration_minutes' IS NOT NULL AND rule->>'duration_minutes' !~ '^[0-9]{1,4}$') THEN
    RAISE EXCEPTION 'Confira o valor, a duração e a situação da regra.' USING ERRCODE = '22023';
  END IF;
  item := jsonb_populate_record(NULL::public.organization_shift_rates, rule);
  item.specialty := nullif(btrim(item.specialty), '');
  IF (item.unit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.units WHERE id = item.unit_id AND organization_id = org))
    OR (item.sector_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.sectors
      WHERE id = item.sector_id AND organization_id = org AND unit_id = item.unit_id)) THEN
    RAISE EXCEPTION 'Selecione uma unidade e um posto válidos da empresa.' USING ERRCODE = '22023';
  END IF;
  IF target IS NULL THEN
    INSERT INTO public.organization_shift_rates(organization_id, unit_id, sector_id, specialty, duration_minutes, shift_type, turn, amount_cents, active)
    VALUES (org, item.unit_id, item.sector_id, item.specialty, item.duration_minutes, item.shift_type, item.turn, item.amount_cents, item.active)
    RETURNING * INTO saved;
  ELSE
    UPDATE public.organization_shift_rates SET unit_id = item.unit_id, sector_id = item.sector_id, specialty = item.specialty,
      duration_minutes = item.duration_minutes, shift_type = item.shift_type, turn = item.turn, amount_cents = item.amount_cents, active = item.active
    WHERE id = target AND organization_id = org AND NOT post_default RETURNING * INTO saved;
    IF NOT FOUND THEN RAISE EXCEPTION 'Regra indisponível.' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN to_jsonb(saved);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe uma regra para este recorte. Edite a regra cadastrada.' USING ERRCODE = '22023';
WHEN integrity_constraint_violation OR data_exception THEN
  RAISE EXCEPTION 'Confira os campos do valor padrão.' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_resolve_shift_rate(shift public.shifts)
RETURNS public.organization_shift_rates LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH context AS (
    SELECT mod(1440 + (extract(epoch FROM (shift.end_time::time - shift.start_time::time)) / 60)::integer, 1440) AS minutes,
      CASE WHEN shift.start_time::time >= time '18:00' OR shift.start_time::time < time '06:00' THEN 'night' ELSE 'day' END AS inferred,
      coalesce(nullif(shift.specialty, ''), (SELECT d.specialty FROM public.doctors d
        WHERE d.id = shift.doctor_id AND d.organization_id = shift.organization_id)) AS specialty
  )
  SELECT r.* FROM public.organization_shift_rates r CROSS JOIN context c
  WHERE r.organization_id = shift.organization_id AND r.active AND r.amount_cents IS NOT NULL
    AND (r.unit_id IS NULL OR r.unit_id = shift.unit_id)
    AND (r.sector_id IS NULL OR r.sector_id = shift.sector_id)
    AND (r.specialty IS NULL OR r.specialty = c.specialty)
    AND (r.duration_minutes IS NULL OR r.duration_minutes = c.minutes)
    AND (r.shift_type IS NULL OR r.shift_type = shift.type)
    AND (r.turn IS NULL OR r.turn = coalesce(
      (SELECT p.value->>'kind' FROM public.sectors s
        CROSS JOIN LATERAL jsonb_array_elements(s.coverage_periods) WITH ORDINALITY AS p(value, position)
        WHERE s.id = shift.sector_id AND s.organization_id = shift.organization_id
        ORDER BY (p.value->>'startTime' = shift.start_time AND p.value->>'endTime' = shift.end_time) DESC,
          (p.value->>'kind' = c.inferred) DESC, p.position LIMIT 1), c.inferred))
  ORDER BY (r.sector_id IS NOT NULL) DESC, (r.unit_id IS NOT NULL) DESC, (r.specialty IS NOT NULL) DESC,
    (r.turn IS NOT NULL) DESC, (r.duration_minutes IS NOT NULL) DESC, (r.shift_type IS NOT NULL) DESC, r.post_default ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.nv_apply_shift_agreement(item public.shifts, selection jsonb, require_reason boolean, adjustment boolean)
RETURNS public.shifts LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  rule public.organization_shift_rates;
  mode text := selection->>'mode';
  frequency text := selection->>'frequency';
  reason text := nullif(btrim(selection->>'reason'), '');
  override_reason text := nullif(btrim(selection->>'override_reason'), '');
  cents text := selection->>'amount_cents';
  snapshot jsonb;
BEGIN
  IF jsonb_typeof(selection) IS DISTINCT FROM 'object'
    OR (mode IN ('keep','default','manual','override') AND frequency IN ('on_delivery','monthly')) IS NOT TRUE
    OR coalesce(length(reason), 0) > 1000 OR coalesce(length(override_reason), 0) > 1000
    OR (require_reason AND coalesce(length(reason), 0) < 3) THEN
    RAISE EXCEPTION 'Confira a modalidade e informe o motivo da alteração financeira.' USING ERRCODE = '22023';
  END IF;
  IF require_reason AND ((selection->>'expected_amount_cents') IS DISTINCT FROM ((item.payment_amount * 100)::bigint)::text
    OR (selection->>'expected_frequency') IS DISTINCT FROM item.payment_frequency
    OR (selection->>'expected_changed_at') IS DISTINCT FROM (item.payment_agreement->>'changed_at')) THEN
    -- PostgREST must return a conflict so the caller can reload the agreement.
    RAISE EXCEPTION 'O acordo financeiro mudou. Reabra a ficha antes de salvar.' USING ERRCODE = 'PT409';
  END IF;
  IF mode = 'keep' THEN
    snapshot := item.payment_agreement->'rate';
    override_reason := item.payment_agreement->>'override_reason';
    mode := coalesce(item.payment_agreement->>'mode', 'manual');
  ELSE
    rule := public.nv_resolve_shift_rate(item);
    IF (selection->>'rate_id') IS DISTINCT FROM rule.id::text OR (selection->>'rate_cents') IS DISTINCT FROM rule.amount_cents::text THEN
      RAISE EXCEPTION 'O valor padrão mudou. Reabra o plantão para conferir a referência.' USING ERRCODE = 'PT409';
    END IF;
    IF mode = 'default' THEN
      IF rule.id IS NULL THEN RAISE EXCEPTION 'Nenhum valor padrão corresponde ao plantão.' USING ERRCODE = '22023'; END IF;
      item.payment_amount := rule.amount_cents / 100.0;
    ELSE
      IF cents IS NULL OR cents !~ '^[0-9]{1,12}$' OR (mode = 'manual' AND rule.id IS NOT NULL) THEN
        RAISE EXCEPTION 'Informe um valor em reais ou selecione valor diferenciado.' USING ERRCODE = '22023';
      END IF;
      item.payment_amount := cents::numeric / 100.0;
    END IF;
    IF mode = 'override' AND (rule.id IS NULL OR coalesce(length(override_reason), 0) < 3) THEN
      RAISE EXCEPTION 'Informe a justificativa do valor diferenciado.' USING ERRCODE = '22023';
    END IF;
    snapshot := CASE WHEN rule.id IS NOT NULL THEN to_jsonb(rule) - ARRAY['organization_id','active','post_default','payment_frequency','financial_notes'] END;
  END IF;
  item.payment_frequency := frequency;
  item.payment_agreement := jsonb_build_object('mode', mode, 'rate', snapshot,
    'override_reason', CASE WHEN mode = 'override' THEN override_reason END,
    'reason', reason, 'actor', public.nv_session_actor(), 'changed_at', clock_timestamp(),
    'kind', CASE WHEN adjustment THEN 'paid_adjustment' ELSE 'agreement' END);
  RETURN item;
END;
$$;

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
    selection := entry->'agreement';
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
      item.payment_amount := previous.payment_amount;
      item.payment_frequency := previous.payment_frequency;
      item.payment_agreement := previous.payment_agreement;
      IF selection IS NOT NULL THEN
        IF previous.payment_status = 'paid' THEN
          RAISE EXCEPTION 'Use o ajuste administrativo para um plantão pago.' USING ERRCODE = '22023';
        END IF;
        item := public.nv_apply_shift_agreement(item, selection, true, false);
      ELSIF previous.doctor_id IS NOT NULL AND item.doctor_id IS NULL AND public.nv_can_finance(item.organization_id) THEN
        -- Explicitly removing an assigned physician still clears that physician's agreement.
        item.payment_amount := NULL;
        item.payment_frequency := 'on_delivery';
        item.payment_agreement := NULL;
      END IF;
      UPDATE public.shifts SET doctor_id = item.doctor_id, unit_id = item.unit_id, sector_id = item.sector_id,
        specialty = item.specialty, date = item.date, start_time = item.start_time, end_time = item.end_time,
        type = item.type, status = item.status, notes = item.notes, employment_type = item.employment_type,
        employer_name = item.employer_name, coverage_mode = coalesce(item.coverage_mode,'regular'), coverage_reason = item.coverage_reason,
        payment_amount = item.payment_amount, payment_frequency = item.payment_frequency,
        payment_agreement = item.payment_agreement WHERE id = item.id;
    ELSE
      IF NOT public.nv_can_action(item.organization_id,'escala','create') THEN
        RAISE EXCEPTION 'Seu acesso não permite criar plantões.' USING ERRCODE = '42501';
      END IF;
      item.payment_agreement := NULL;
      IF selection IS NOT NULL THEN
        item := public.nv_apply_shift_agreement(item, selection, false, false);
        item.payment_status := 'pending';
        item.paid_at := NULL;
      END IF;
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

CREATE OR REPLACE FUNCTION public.nv_protect_shift_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.nv_can_finance(NEW.organization_id) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.payment_amount := NULL;
      NEW.payment_status := 'pending';
      NEW.payment_frequency := 'on_delivery';
      NEW.paid_at := NULL;
    ELSE
      NEW.payment_amount := OLD.payment_amount;
      NEW.payment_status := OLD.payment_status;
      NEW.payment_frequency := OLD.payment_frequency;
      NEW.paid_at := OLD.paid_at;
    END IF;
  END IF;

  IF NEW.payment_status = 'paid' AND NEW.paid_at IS NULL THEN
    NEW.paid_at := now();
  ELSIF NEW.payment_status = 'pending' THEN
    NEW.paid_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_payment_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE correcting boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.payment_due_date := CASE WHEN NEW.doctor_id IS NOT NULL AND NEW.payment_amount IS NOT NULL THEN public.nv_calculate_shift_due(NEW) END;
    IF NOT public.nv_can_finance(NEW.organization_id) THEN
      NEW.paid_amount := NULL;
      NEW.payment_note := NULL;
      NEW.payment_agreement := NULL;
    END IF;
  ELSE
    NEW.payment_due_date := OLD.payment_due_date;
    IF NOT public.nv_can_finance(NEW.organization_id) THEN
      NEW.paid_amount := OLD.paid_amount;
      NEW.payment_note := OLD.payment_note;
      NEW.payment_agreement := OLD.payment_agreement;
    END IF;
    IF OLD.payment_status = 'paid' THEN
      correcting := coalesce(NEW.payment_agreement->>'kind' = 'paid_adjustment'
        AND NEW.payment_agreement IS DISTINCT FROM OLD.payment_agreement
        AND public.nv_can_finance(OLD.organization_id) AND public.nv_can_write(OLD.organization_id, 'organizations'), false);
      IF (NEW.date, NEW.start_time, NEW.end_time, NEW.doctor_id) IS DISTINCT FROM (OLD.date, OLD.start_time, OLD.end_time, OLD.doctor_id)
        OR (NEW.payment_status, NEW.payment_frequency, NEW.paid_at, NEW.payment_note)
          IS DISTINCT FROM (OLD.payment_status, OLD.payment_frequency, OLD.paid_at, OLD.payment_note)
        OR NEW.paid_amount IS DISTINCT FROM (CASE WHEN correcting THEN coalesce(OLD.paid_amount, OLD.payment_amount) ELSE OLD.paid_amount END)
        OR ((NEW.payment_amount, NEW.payment_agreement) IS DISTINCT FROM (OLD.payment_amount, OLD.payment_agreement)
          AND NOT correcting) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = CASE WHEN public.nv_can_read_finance(OLD.organization_id)
          THEN 'Plantão pago. Use o ajuste administrativo para corrigir o valor acordado.'
          ELSE 'Alteração indisponível para este acesso. Procure a coordenação.' END;
      END IF;
    ELSE
      IF NOT (OLD.doctor_id IS NOT NULL AND NEW.doctor_id IS NULL AND NEW.payment_amount IS NULL AND NEW.payment_agreement IS NULL)
        AND (NEW.payment_amount, NEW.payment_frequency) IS DISTINCT FROM (OLD.payment_amount, OLD.payment_frequency)
        AND NEW.payment_agreement IS NOT DISTINCT FROM OLD.payment_agreement AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Use o acordo financeiro e informe o motivo da alteração.' USING ERRCODE = '22023';
      END IF;
      IF NEW.doctor_id IS NULL OR NEW.payment_amount IS NULL THEN
        NEW.payment_due_date := NULL;
      ELSIF OLD.payment_due_date IS NULL OR (NEW.payment_frequency, NEW.date, NEW.end_time)
        IS DISTINCT FROM (OLD.payment_frequency, OLD.date, OLD.end_time) THEN
        NEW.payment_due_date := public.nv_calculate_shift_due(NEW);
      END IF;
    END IF;
  END IF;
  IF NEW.payment_status = 'paid' THEN
    IF NEW.doctor_id IS NULL OR NEW.payment_amount IS NULL OR NEW.status = 'cancelled'
      OR (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = CASE WHEN public.nv_can_read_finance(NEW.organization_id)
        THEN 'Confira o responsável, o estado do plantão e a data do pagamento.'
        ELSE 'Alteração indisponível para este acesso. Procure a coordenação.' END;
    END IF;
    IF TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid' THEN
      NEW.paid_amount := coalesce(NEW.paid_amount, NEW.payment_amount);
    END IF;
  ELSE
    NEW.paid_amount := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_audit_shift_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_fields jsonb;
  new_fields jsonb := public.nv_payment_snapshot(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_fields := public.nv_payment_snapshot(OLD);
    IF old_fields = new_fields THEN RETURN NEW; END IF;
    IF OLD.doctor_id IS NOT NULL AND NEW.doctor_id IS NULL THEN
      new_fields := new_fields || jsonb_build_object('reason', 'Médico removido da escala.');
    END IF;
  ELSIF coalesce(NEW.payment_amount,0) = 0 AND NEW.payment_status <> 'paid' AND NEW.payment_agreement IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shift_payment_history(organization_id, shift_id, actor_id, previous, next)
  VALUES (NEW.organization_id, NEW.id, auth.uid(), old_fields, new_fields);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_report_filtered_shifts(org text, from_date date, to_date date, filters jsonb, financial_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  finance boolean := public.nv_can_read_finance(org);
  attendance boolean := public.nv_coordinator(org);
  company text;
  wanted_unit text := filters->>'unit';
  wanted_sector text := filters->>'sector';
  wanted_doctor text := filters->>'doctor';
  wanted_specialty text := filters->>'specialty';
  wanted_state text := filters->>'state';
  wanted_presence text := filters->>'presence';
  wanted_payment text := filters->>'payment';
  wanted_frequency text := filters->>'frequency';
  wanted_period text := filters->>'period';
  wanted_shift text := filters->>'shift_id';
  start_hour time;
  end_hour time;
  due_from date;
  due_to date;
  paid_from date;
  paid_to date;
BEGIN
  SELECT name INTO company FROM public.organizations WHERE id = org;
  IF company IS NULL OR (CASE WHEN financial_only THEN finance ELSE public.nv_can_report(org) END) IS NOT TRUE
    OR (NOT finance AND filters ?| ARRAY['payment','frequency','due_from','due_to','paid_from','paid_to'])
    OR (NOT attendance AND wanted_presence IS NOT NULL) THEN
    RAISE EXCEPTION 'Relatório indisponível para este acesso ou filtro.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(filters) IS DISTINCT FROM 'object' OR from_date IS NULL OR to_date IS NULL OR from_date > to_date
    OR (NOT financial_only AND to_date - from_date > 365)
    OR EXISTS (SELECT 1 FROM jsonb_each_text(filters) entry WHERE length(entry.value) > 150)
    OR (wanted_state IS NOT NULL AND wanted_state NOT IN ('active','open','exchange','confirmed','pending','completed','cancelled'))
    OR (wanted_presence IS NOT NULL AND wanted_presence NOT IN ('pending','checked_in','checked_out'))
    OR (wanted_payment IS NOT NULL AND wanted_payment NOT IN ('pending','scheduled','overdue','unpaid','paid','cancelled','unassigned'))
    OR (wanted_frequency IS NOT NULL AND wanted_frequency NOT IN ('monthly','on_delivery'))
    OR (wanted_period IS NOT NULL AND wanted_period NOT IN ('day','night'))
    OR EXISTS (SELECT 1 FROM jsonb_each_text(filters) entry WHERE
      (entry.key IN ('start_hour','end_hour') AND entry.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      OR (entry.key IN ('due_from','due_to','paid_from','paid_to') AND entry.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) THEN
    RAISE EXCEPTION 'Confira o período e os filtros do relatório.' USING ERRCODE = '22023';
  END IF;
  start_hour := (filters->>'start_hour')::time;
  end_hour := (filters->>'end_hour')::time;
  due_from := (filters->>'due_from')::date;
  due_to := (filters->>'due_to')::date;
  paid_from := (filters->>'paid_from')::date;
  paid_to := (filters->>'paid_to')::date;
  IF due_from > due_to OR paid_from > paid_to THEN
    RAISE EXCEPTION 'Confira a ordem das datas de vencimento e pagamento.' USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT jsonb_build_object('organization',company,'finance',finance,'attendance',attendance,
      'rows',coalesce(jsonb_agg(item ORDER BY item->>'date',item->>'start_time',item->>'id'),'[]'::jsonb))
    FROM (
      SELECT jsonb_build_object('id',s.id,'organization',company,'unit',u.name,'unit_id',u.id,'sector',s.sector,
        'doctor',d.name,'doctor_id',d.id,'specialty',s.specialty,'date',s.date,'start_time',s.start_time,'end_time',s.end_time,
        'period',stats.period,'status',stats.state,'presence',CASE WHEN attendance THEN stats.presence END,
        'check_in',CASE WHEN attendance THEN ci.recorded_at END,'check_out',CASE WHEN attendance THEN co.recorded_at END)
        || CASE WHEN finance AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) THEN jsonb_build_object(
          'payment',stats.payment,'frequency',s.payment_frequency,'agreed',s.payment_amount,'due',CASE WHEN s.doctor_id IS NOT NULL THEN s.payment_due_date END,
          'paid_on',stats.paid_on,'paid_amount',CASE WHEN s.payment_status = 'paid' THEN coalesce(s.paid_amount,s.payment_amount) END,
          'balance',CASE WHEN s.doctor_id IS NULL OR s.payment_amount IS NULL THEN NULL WHEN s.payment_status = 'paid' OR s.status = 'cancelled' THEN 0 ELSE greatest(s.payment_amount - coalesce(s.paid_amount,0),0) END,
          'crm',concat_ws('-',d.crm,d.crm_uf),'employment',s.employment_type,'employer',s.employer_name)
          ELSE '{}'::jsonb END item
      FROM public.shifts s JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
      LEFT JOIN public.sectors sc ON sc.id = s.sector_id AND sc.unit_id = u.id AND sc.organization_id = s.organization_id
      LEFT JOIN public.doctors d ON d.id = s.doctor_id AND d.organization_id = s.organization_id
      LEFT JOIN public.shift_opportunities op ON op.shift_id = s.id AND op.status = 'open' AND op.kind = 'exchange' AND public.nv_shift_starts(s) > now()
      LEFT JOIN public.shift_attendance ci ON ci.shift_id = s.id AND ci.kind = 'check_in'
      LEFT JOIN public.shift_attendance co ON co.shift_id = s.id AND co.kind = 'check_out'
      CROSS JOIN LATERAL (SELECT CASE WHEN s.start_time >= '18:00' OR s.start_time < '06:00' THEN 'night' ELSE 'day' END inferred) clock
      CROSS JOIN LATERAL (SELECT CASE WHEN op.id IS NULL THEN s.status ELSE 'exchange' END state,
        CASE WHEN co.recorded_at IS NOT NULL THEN 'checked_out' WHEN ci.recorded_at IS NOT NULL THEN 'checked_in'
          WHEN s.type = 'onsite' AND s.status = 'confirmed' AND s.doctor_id IS NOT NULL THEN 'pending' END presence,
        CASE WHEN finance THEN CASE WHEN s.doctor_id IS NULL AND s.status <> 'cancelled' THEN 'unassigned' ELSE public.nv_payment_state(s) END END payment,
        CASE WHEN finance THEN (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date END paid_on,
        coalesce((SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p
            WHERE p->>'startTime'=s.start_time AND p->>'endTime'=s.end_time LIMIT 1),
          (SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p WHERE p->>'kind'=clock.inferred LIMIT 1),
          sc.coverage_periods->0->>'kind',clock.inferred) period) stats
      WHERE s.organization_id = org AND s.date BETWEEN from_date AND to_date
        AND (NOT financial_only OR ((s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND (s.status <> 'cancelled' OR wanted_payment = 'cancelled')))
        AND (wanted_unit IS NULL OR s.unit_id = wanted_unit) AND (wanted_sector IS NULL OR s.sector_id = wanted_sector)
        AND (wanted_doctor IS NULL OR s.doctor_id = wanted_doctor) AND (wanted_specialty IS NULL OR s.specialty = wanted_specialty)
        AND (wanted_shift IS NULL OR s.id = wanted_shift)
        AND (wanted_state IS NULL OR stats.state = wanted_state OR (wanted_state='active' AND stats.state <> 'cancelled'))
        AND (wanted_presence IS NULL OR stats.presence = wanted_presence)
        AND (wanted_payment IS NULL OR ((s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND (stats.payment = wanted_payment
          OR (wanted_payment='unpaid' AND stats.payment IN ('pending','scheduled','overdue')))))
        AND (wanted_frequency IS NULL OR ((s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND s.payment_frequency = wanted_frequency))
        AND (wanted_period IS NULL OR stats.period = wanted_period)
        AND (due_from IS NULL OR (s.doctor_id IS NOT NULL AND s.payment_due_date >= due_from))
        AND (due_to IS NULL OR (s.doctor_id IS NOT NULL AND s.payment_due_date <= due_to))
        AND (paid_from IS NULL OR stats.paid_on >= paid_from) AND (paid_to IS NULL OR stats.paid_on <= paid_to)
        AND public.nv_report_hour_match(s.start_time::time,s.end_time::time,start_hour,end_hour)
      ORDER BY s.date,s.start_time,s.id LIMIT 10001
    ) report
  );
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Confira as datas e os horários do relatório.' USING ERRCODE = '22023';
END;
$$;

COMMIT;
