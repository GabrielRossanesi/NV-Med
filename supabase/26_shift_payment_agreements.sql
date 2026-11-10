-- NV Med: scoped shift rates, agreement snapshots and audited paid corrections.
-- Apply after 25_document_notification_rules.sql. No backfill or repricing.
BEGIN;

CREATE TABLE public.organization_shift_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id text REFERENCES public.units(id) ON DELETE CASCADE,
  sector_id text REFERENCES public.sectors(id) ON DELETE CASCADE,
  specialty text CHECK (length(specialty) BETWEEN 1 AND 120),
  duration_minutes integer CHECK (duration_minutes BETWEEN 1 AND 1439),
  shift_type text CHECK (shift_type IN ('onsite', 'oncall', 'telemedicine')),
  turn text CHECK (turn IN ('day', 'night')),
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 0 AND 999999999999),
  active boolean NOT NULL DEFAULT true,
  CHECK (sector_id IS NULL OR unit_id IS NOT NULL),
  UNIQUE NULLS NOT DISTINCT (organization_id, unit_id, sector_id, specialty, duration_minutes, shift_type, turn)
);
ALTER TABLE public.organization_shift_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_shift_rates FROM PUBLIC, anon, authenticated;

ALTER TABLE public.shifts ADD COLUMN payment_agreement jsonb;

CREATE OR REPLACE VIEW public.nv_staff_shifts WITH (security_barrier = true) AS
SELECT s.id, s.organization_id, s.doctor_id, s.unit_id, s.sector_id, s.sector, s.specialty, s.date,
  s.start_time, s.end_time, s.type, s.status, s.notes, s.employment_type, s.employer_name, s.coverage_mode, s.coverage_reason,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_amount END payment_amount,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_frequency END payment_frequency,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_status END payment_status,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.paid_at END paid_at,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.paid_amount END paid_amount,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_due_date END payment_due_date,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_note END payment_note,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_agreement END payment_agreement
FROM public.shifts s WHERE public.nv_org_access(s.organization_id);

CREATE FUNCTION public.nv_shift_rates(org text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.nv_can_read_finance(org) THEN
    RAISE EXCEPTION 'Valores de plantões indisponíveis.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]') FROM public.organization_shift_rates r
    WHERE r.organization_id = org);
END;
$$;

CREATE FUNCTION public.nv_save_shift_rate(org text, target uuid, rule jsonb)
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
    WHERE id = target AND organization_id = org RETURNING * INTO saved;
    IF NOT FOUND THEN RAISE EXCEPTION 'Regra indisponível.' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN to_jsonb(saved);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe uma regra para este recorte. Edite a regra cadastrada.' USING ERRCODE = '22023';
WHEN integrity_constraint_violation OR data_exception THEN
  RAISE EXCEPTION 'Confira os campos do valor padrão.' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.nv_resolve_shift_rate(shift public.shifts)
RETURNS public.organization_shift_rates LANGUAGE sql STABLE SET search_path = '' AS $$
  WITH context AS (
    SELECT mod(1440 + (extract(epoch FROM (shift.end_time::time - shift.start_time::time)) / 60)::integer, 1440) AS minutes,
      CASE WHEN shift.start_time::time >= time '18:00' OR shift.start_time::time < time '06:00' THEN 'night' ELSE 'day' END AS inferred,
      coalesce(nullif(shift.specialty, ''), (SELECT d.specialty FROM public.doctors d
        WHERE d.id = shift.doctor_id AND d.organization_id = shift.organization_id)) AS specialty
  )
  SELECT r.* FROM public.organization_shift_rates r CROSS JOIN context c
  WHERE r.organization_id = shift.organization_id AND r.active
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
    (r.turn IS NOT NULL) DESC, (r.duration_minutes IS NOT NULL) DESC, (r.shift_type IS NOT NULL) DESC
  LIMIT 1;
$$;

CREATE FUNCTION public.nv_apply_shift_agreement(item public.shifts, selection jsonb, require_reason boolean, adjustment boolean)
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
  IF item.doctor_id IS NULL OR jsonb_typeof(selection) IS DISTINCT FROM 'object'
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
    IF mode = 'override' AND coalesce(length(override_reason), 0) < 3 THEN
      RAISE EXCEPTION 'Informe a justificativa do valor diferenciado.' USING ERRCODE = '22023';
    END IF;
    snapshot := CASE WHEN rule.id IS NOT NULL THEN to_jsonb(rule) - 'organization_id' - 'active' END;
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
      OR NOT public.nv_can_write(item.organization_id, 'shifts') THEN
      RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
    END IF;
    IF selection IS NOT NULL AND NOT public.nv_can_finance(item.organization_id) THEN
      RAISE EXCEPTION 'Alteração financeira indisponível.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO previous FROM public.shifts WHERE id = item.id FOR UPDATE;
    IF FOUND THEN
      IF previous.organization_id <> item.organization_id THEN
        RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
      END IF;
      item.payment_amount := previous.payment_amount;
      item.payment_frequency := previous.payment_frequency;
      item.payment_agreement := previous.payment_agreement;
      IF selection IS NOT NULL THEN
        IF previous.payment_status = 'paid' THEN
          RAISE EXCEPTION 'Use o ajuste administrativo para um plantão pago.' USING ERRCODE = '22023';
        END IF;
        item := public.nv_apply_shift_agreement(item, selection, previous.doctor_id IS NOT NULL, false);
      ELSIF previous.doctor_id IS NOT NULL AND item.doctor_id IS NULL AND public.nv_can_finance(item.organization_id) THEN
        item.payment_amount := 0;
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
        coalesce(item.coverage_mode,'regular'), item.coverage_reason, coalesce(item.payment_amount,0),
        coalesce(item.payment_frequency,'on_delivery'), coalesce(item.payment_status,'pending'), item.paid_at, item.payment_agreement);
    END IF;
    saved := array_append(saved, item.id);
  END LOOP;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') FROM public.nv_staff_shifts s WHERE s.id = ANY(saved));
EXCEPTION WHEN integrity_constraint_violation OR numeric_value_out_of_range OR invalid_text_representation THEN
  RAISE EXCEPTION 'Não foi possível salvar os plantões. Confira os vínculos e os campos obrigatórios.' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.nv_edit_shift_agreement(target text, selection jsonb, adjustment boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item public.shifts%ROWTYPE;
  settled_amount numeric;
BEGIN
  SELECT * INTO item FROM public.shifts WHERE id = target AND public.nv_can_finance(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento indisponível.' USING ERRCODE = '42501'; END IF;
  IF item.payment_status = 'paid' THEN
    IF adjustment IS NOT TRUE OR NOT public.nv_can_write(item.organization_id, 'organizations') THEN
      RAISE EXCEPTION 'O plantão pago exige ajuste administrativo.' USING ERRCODE = '42501';
    END IF;
    IF selection->>'frequency' IS DISTINCT FROM item.payment_frequency THEN
      RAISE EXCEPTION 'A modalidade do pagamento já efetuado deve ser preservada.' USING ERRCODE = '22023';
    END IF;
  ELSIF adjustment IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Este plantão ainda não foi pago.' USING ERRCODE = '22023';
  END IF;
  settled_amount := CASE WHEN adjustment THEN coalesce(item.paid_amount, item.payment_amount) ELSE item.paid_amount END;
  item := public.nv_apply_shift_agreement(item, selection, true, adjustment);
  UPDATE public.shifts SET payment_amount = item.payment_amount, payment_frequency = item.payment_frequency,
    payment_agreement = item.payment_agreement, paid_amount = settled_amount WHERE id = target;
  RETURN (SELECT to_jsonb(s) FROM public.nv_staff_shifts s WHERE id = target);
EXCEPTION WHEN integrity_constraint_violation OR numeric_value_out_of_range OR invalid_text_representation THEN
  RAISE EXCEPTION 'Não foi possível registrar o acordo financeiro.' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.nv_shift_payment_history(target text, before_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org text;
BEGIN
  SELECT organization_id INTO org FROM public.shifts WHERE id = target AND public.nv_can_read_finance(organization_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Histórico indisponível.' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY entry.id DESC), '[]') FROM (
    SELECT h.id, h.changed_at, h.actor_id, u.name AS actor_name, h.previous, h.next
    FROM public.shift_payment_history h LEFT JOIN public.user_accounts u ON u.auth_user_id = h.actor_id
    WHERE h.shift_id = target AND h.organization_id = org AND (before_id IS NULL OR h.id < before_id)
    ORDER BY h.id DESC LIMIT 20
  ) entry);
END;
$$;

REVOKE ALL ON FUNCTION public.nv_resolve_shift_rate(public.shifts),
  public.nv_apply_shift_agreement(public.shifts,jsonb,boolean,boolean)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.nv_shift_rates(text), public.nv_save_shift_rate(text,uuid,jsonb),
  public.nv_edit_shift_agreement(text,jsonb,boolean), public.nv_shift_payment_history(text,bigint)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_shift_rates(text), public.nv_save_shift_rate(text,uuid,jsonb),
  public.nv_edit_shift_agreement(text,jsonb,boolean), public.nv_shift_payment_history(text,bigint)
TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_payment_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE correcting boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.payment_due_date := public.nv_calculate_shift_due(NEW);
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
      IF NEW.doctor_id IS NOT NULL AND (NEW.payment_amount, NEW.payment_frequency) IS DISTINCT FROM (OLD.payment_amount, OLD.payment_frequency)
        AND NEW.payment_agreement IS NOT DISTINCT FROM OLD.payment_agreement AND auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Use o acordo financeiro e informe o motivo da alteração.' USING ERRCODE = '22023';
      END IF;
      IF OLD.payment_due_date IS NULL OR (NEW.payment_frequency, NEW.date, NEW.end_time)
        IS DISTINCT FROM (OLD.payment_frequency, OLD.date, OLD.end_time) THEN
        NEW.payment_due_date := public.nv_calculate_shift_due(NEW);
      END IF;
    END IF;
  END IF;
  IF NEW.payment_status = 'paid' THEN
    IF NEW.doctor_id IS NULL OR NEW.status = 'cancelled'
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

CREATE OR REPLACE FUNCTION public.nv_payment_snapshot(shift public.shifts)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('amount', shift.payment_amount, 'frequency', shift.payment_frequency,
    'status', shift.payment_status, 'due_date', shift.payment_due_date, 'paid_at', shift.paid_at,
    'paid_amount', shift.paid_amount, 'note', shift.payment_note, 'agreement', shift.payment_agreement);
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
  ELSIF NEW.payment_amount = 0 AND NEW.payment_status <> 'paid' AND NEW.payment_agreement IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shift_payment_history(organization_id, shift_id, actor_id, previous, next)
  VALUES (NEW.organization_id, NEW.id, auth.uid(), old_fields, new_fields);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_save_shift_payment(target text, agreed numeric, frequency text, state text,
  amount_paid numeric, paid_on date, note text)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE updated public.shifts%ROWTYPE;
BEGIN
  SELECT * INTO updated FROM public.shifts WHERE id = target AND public.nv_can_finance(organization_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento indisponível.' USING ERRCODE = '42501'; END IF;
  IF updated.payment_status = 'paid' THEN
    RAISE EXCEPTION 'O pagamento já foi registrado. A baixa e seu valor são preservados.' USING ERRCODE = '22023';
  END IF;
  IF (agreed, frequency) IS DISTINCT FROM (updated.payment_amount, updated.payment_frequency) THEN
    RAISE EXCEPTION 'O acordo financeiro mudou. Reabra a ficha antes de registrar a baixa.' USING ERRCODE = '22023';
  END IF;
  IF (state IN ('pending','paid')
    AND (state = 'pending' OR (amount_paid BETWEEN 0 AND 9999999999.99 AND scale(trim_scale(amount_paid)) <= 2 AND paid_on IS NOT NULL))
    AND coalesce(length(btrim(note)),0) <= 1000) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confira o valor pago, a situação e a data do pagamento.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shifts SET payment_status = state,
    paid_amount = CASE WHEN state = 'paid' THEN amount_paid END, payment_note = nullif(btrim(note),''),
    paid_at = CASE WHEN state = 'paid' THEN (paid_on + time '12:00') AT TIME ZONE 'America/Sao_Paulo' END
    WHERE id = target RETURNING * INTO updated;
  RETURN updated;
EXCEPTION WHEN integrity_constraint_violation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'Não foi possível registrar o pagamento. Confira os campos.' USING ERRCODE = '22023';
END;
$$;

COMMIT;
