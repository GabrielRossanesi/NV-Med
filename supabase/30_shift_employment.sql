-- Per-shift employment and PJ-only transfers. Existing rows are left intact.
BEGIN;

ALTER TABLE public.shift_assignment_history
  ADD COLUMN previous_employment_type text,
  ADD COLUMN next_employment_type text;

CREATE FUNCTION public.nv_shift_has_settlement(item public.shifts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(item.payment_status = 'paid', false) OR item.paid_at IS NOT NULL OR item.paid_amount IS NOT NULL;
$$;

CREATE FUNCTION public.nv_prepare_shift_employment(item public.shifts, previous public.shifts, selection jsonb)
RETURNS public.shifts LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  existing boolean := previous.id IS NOT NULL;
  contract_changed boolean := previous.employment_type IS DISTINCT FROM item.employment_type;
  assignee_changed boolean := previous.doctor_id IS DISTINCT FROM item.doctor_id;
  new_agreement boolean := NOT existing OR contract_changed OR (assignee_changed AND item.doctor_id IS NOT NULL);
BEGIN
  IF item.employment_type IS NULL AND (NOT existing OR contract_changed OR (assignee_changed AND item.doctor_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Confirme a modalidade de contratação do plantão.' USING ERRCODE = '22023';
  END IF;
  IF existing AND (contract_changed OR assignee_changed) AND public.nv_shift_has_settlement(previous) THEN
    RAISE EXCEPTION 'Regularize o pagamento registrado antes de alterar a contratação ou o responsável.' USING ERRCODE = '22023';
  END IF;

  item.payment_amount := previous.payment_amount;
  item.payment_frequency := coalesce(previous.payment_frequency,'on_delivery');
  item.payment_agreement := previous.payment_agreement;
  item.payment_status := coalesce(previous.payment_status,'pending');
  item.paid_at := previous.paid_at;
  item.paid_amount := previous.paid_amount;
  item.payment_note := previous.payment_note;

  IF item.employment_type IS DISTINCT FROM 'pj' THEN
    IF selection IS NOT NULL THEN
      RAISE EXCEPTION 'Somente plantões PJ possuem acordo de repasse.' USING ERRCODE = '22023';
    END IF;
    IF NOT existing OR contract_changed OR assignee_changed THEN
      IF (previous.payment_amount IS NOT NULL AND previous.payment_amount <> 0 OR previous.payment_agreement IS NOT NULL
        OR previous.payment_note IS NOT NULL) AND NOT public.nv_can_finance(item.organization_id) THEN
        RAISE EXCEPTION 'A mudança exige permissão financeira para encerrar o acordo anterior.' USING ERRCODE = '42501';
      END IF;
      item.payment_amount := NULL;
      item.payment_frequency := 'on_delivery';
      item.payment_agreement := NULL;
      item.payment_note := NULL;
    END IF;
  ELSE
    IF existing AND previous.doctor_id IS NOT NULL AND item.doctor_id IS NULL AND NOT contract_changed AND selection IS NULL THEN
      IF (coalesce(previous.payment_amount,0) <> 0 OR previous.payment_agreement IS NOT NULL OR previous.payment_note IS NOT NULL)
        AND NOT public.nv_can_finance(item.organization_id) THEN
        RAISE EXCEPTION 'A mudança exige permissão financeira para encerrar o acordo anterior.' USING ERRCODE = '42501';
      END IF;
      item.payment_amount := NULL;
      item.payment_agreement := NULL;
      item.payment_note := NULL;
      RETURN item;
    END IF;
    IF new_agreement AND (selection IS NULL OR selection->>'mode' IS NULL OR selection->>'mode' = 'keep') THEN
      RAISE EXCEPTION 'Confirme o valor combinado e a modalidade de pagamento do plantão PJ.' USING ERRCODE = '22023';
    END IF;
    IF selection IS NOT NULL THEN
      IF NOT public.nv_can_finance(item.organization_id) THEN
        RAISE EXCEPTION 'A definição do acordo PJ exige permissão financeira.' USING ERRCODE = '42501';
      END IF;
      IF public.nv_shift_has_settlement(previous) THEN
        RAISE EXCEPTION 'Use o ajuste administrativo para um plantão pago.' USING ERRCODE = '22023';
      END IF;
      IF new_agreement THEN
        item.payment_amount := NULL;
        item.payment_agreement := NULL;
        item.payment_note := NULL;
        IF existing THEN
          selection := selection || jsonb_build_object('reason','Confirmação de nova contratação PJ.');
        END IF;
      END IF;
      item := public.nv_apply_shift_agreement(item, selection, existing AND NOT new_agreement, false);
      IF item.payment_amount IS NULL THEN
        RAISE EXCEPTION 'Informe o valor combinado do plantão PJ.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  RETURN item;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_shift_has_settlement(public.shifts),
  public.nv_prepare_shift_employment(public.shifts,public.shifts,jsonb) FROM PUBLIC, anon, authenticated, service_role;


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
  IF item.employment_type IS DISTINCT FROM 'pj' OR jsonb_typeof(selection) IS DISTINCT FROM 'object'
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

CREATE OR REPLACE FUNCTION public.nv_payment_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE correcting boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND public.nv_shift_has_settlement(OLD)
    AND (NEW.employment_type, NEW.doctor_id) IS DISTINCT FROM (OLD.employment_type, OLD.doctor_id) THEN
    RAISE EXCEPTION 'Regularize o pagamento registrado antes de alterar a contratação ou o responsável.' USING ERRCODE = '22023';
  END IF;
  IF NEW.employment_type IS DISTINCT FROM 'pj' THEN
    IF TG_OP = 'INSERT' OR (NEW.employment_type, NEW.doctor_id) IS DISTINCT FROM (OLD.employment_type, OLD.doctor_id) THEN
      NEW.payment_amount := NULL;
      NEW.payment_agreement := NULL;
      NEW.payment_due_date := NULL;
      NEW.payment_note := NULL;
      NEW.payment_frequency := 'on_delivery';
      NEW.payment_status := 'pending';
      NEW.paid_amount := NULL;
      NEW.paid_at := NULL;
    ELSE
      IF (NEW.payment_amount, NEW.payment_agreement, NEW.payment_frequency, NEW.payment_status, NEW.paid_at, NEW.paid_amount, NEW.payment_note)
        IS DISTINCT FROM (OLD.payment_amount, OLD.payment_agreement, OLD.payment_frequency, OLD.payment_status, OLD.paid_at, OLD.paid_amount, OLD.payment_note)
        OR (public.nv_shift_has_settlement(OLD) AND (NEW.date, NEW.start_time, NEW.end_time) IS DISTINCT FROM (OLD.date, OLD.start_time, OLD.end_time)) THEN
        RAISE EXCEPTION 'O histórico financeiro deste plantão está preservado. Somente PJ possui repasse.' USING ERRCODE = '22023';
      END IF;
      NEW.payment_due_date := OLD.payment_due_date;
    END IF;
    RETURN NEW;
  END IF;
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
      ELSIF OLD.payment_due_date IS NULL OR (NEW.payment_frequency, NEW.date, NEW.end_time, NEW.employment_type, NEW.doctor_id)
        IS DISTINCT FROM (OLD.payment_frequency, OLD.date, OLD.end_time, OLD.employment_type, OLD.doctor_id) THEN
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

CREATE OR REPLACE FUNCTION public.nv_audit_shift_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  opportunity public.shift_opportunities%ROWTYPE;
BEGIN
  IF (NEW.doctor_id, NEW.status, NEW.date, NEW.start_time, NEW.end_time, NEW.unit_id, NEW.sector_id, NEW.specialty)
    IS DISTINCT FROM (OLD.doctor_id, OLD.status, OLD.date, OLD.start_time, OLD.end_time, OLD.unit_id, OLD.sector_id, OLD.specialty) THEN
    SELECT * INTO opportunity FROM public.shift_opportunities WHERE shift_id = OLD.id AND status = 'open';
    IF FOUND THEN
      IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
        RAISE EXCEPTION 'Use a fila de candidaturas para selecionar o responsável por este plantão.' USING ERRCODE = '22023';
      END IF;
      PERFORM public.nv_close_shift_opportunity(opportunity.id, NULL);
    END IF;
  END IF;
  IF (NEW.doctor_id, NEW.employment_type) IS DISTINCT FROM (OLD.doctor_id, OLD.employment_type) THEN
    INSERT INTO public.shift_assignment_history(organization_id, shift_id, previous_doctor_id, next_doctor_id, actor_id, previous_employment_type, next_employment_type)
    VALUES (NEW.organization_id, NEW.id, OLD.doctor_id, NEW.doctor_id, auth.uid(), OLD.employment_type, NEW.employment_type);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_payment_snapshot(shift public.shifts)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('employment', shift.employment_type, 'doctor_id', shift.doctor_id, 'amount', shift.payment_amount, 'frequency', shift.payment_frequency,
    'status', shift.payment_status, 'due_date', shift.payment_due_date, 'paid_at', shift.paid_at,
    'paid_amount', shift.paid_amount, 'note', shift.payment_note, 'agreement', shift.payment_agreement);
$$;

DROP FUNCTION public.nv_select_shift_candidate(uuid,text,text,text);

CREATE OR REPLACE FUNCTION public.nv_select_shift_candidate(target uuid, candidate text, employment text, employer text, agreement jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  opportunity public.shift_opportunities%ROWTYPE;
  updated public.shifts%ROWTYPE;
BEGIN
  SELECT s.* INTO shift FROM public.shifts s JOIN public.shift_opportunities o ON o.shift_id = s.id
  WHERE o.id = target FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.nv_coordinator(shift.organization_id) THEN
    RAISE EXCEPTION 'Oportunidade indisponível.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO opportunity FROM public.shift_opportunities WHERE id = target;
  IF NOT FOUND OR opportunity.status <> 'open' OR public.nv_shift_starts(shift) <= now()
    OR shift.doctor_id IS DISTINCT FROM opportunity.original_doctor_id
    OR shift.status <> (CASE WHEN opportunity.kind = 'vacancy' THEN 'open' ELSE 'confirmed' END)
    OR NOT EXISTS (SELECT 1 FROM public.shift_applications WHERE opportunity_id = target AND doctor_id = candidate AND status = 'pending') THEN
    RAISE EXCEPTION 'Esta candidatura já foi encerrada ou perdeu a validade.' USING ERRCODE = '22023';
  END IF;
  IF employment IS NULL OR employment NOT IN ('clt','concursado','pj')
    OR (employment = 'pj' AND coalesce(length(btrim(employer)),0) = 0) OR length(employer) > 150 THEN
    RAISE EXCEPTION 'Informe o vínculo e o empregador do médico selecionado.' USING ERRCODE = '22023';
  END IF;
  updated := shift;
  updated.doctor_id := candidate;
  updated.employment_type := employment;
  updated := public.nv_prepare_shift_employment(updated, shift, nullif(agreement,'null'::jsonb));
  PERFORM public.nv_close_shift_opportunity(target, candidate);
  -- The assignment trigger revalidates credentials, availability and overlap under a physician lock.
  UPDATE public.shifts SET doctor_id = candidate, status = 'confirmed', employment_type = employment,
    employer_name = nullif(btrim(employer), ''), payment_amount = updated.payment_amount,
    payment_frequency = updated.payment_frequency, payment_agreement = updated.payment_agreement,
    payment_note = updated.payment_note WHERE id = shift.id;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_select_shift_candidate(uuid,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_select_shift_candidate(uuid,text,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_shift_history(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'at', h.created_at,
    'previous', previous.name, 'next', next.name, 'actor', staff.name, 'previous_employment', h.previous_employment_type,
    'next_employment', h.next_employment_type) ORDER BY h.created_at DESC, h.id DESC), '[]'::jsonb)
  FROM public.shift_assignment_history h LEFT JOIN public.doctors previous ON previous.id = h.previous_doctor_id
  LEFT JOIN public.doctors next ON next.id = h.next_doctor_id LEFT JOIN public.user_accounts staff ON staff.auth_user_id = h.actor_id
  WHERE h.shift_id = target AND (public.nv_coordinator(h.organization_id) OR public.nv_can_action(h.organization_id,'escala','edit'));
$$;

CREATE OR REPLACE FUNCTION public.nv_shift_selection_queue(org text, target text DEFAULT NULL, scope text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'date', item->>'start_time'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('id', op.id, 'shift_id', s.id, 'kind', op.kind, 'date', s.date, 'start_time', s.start_time,
      'end_time', s.end_time, 'unit_id', s.unit_id, 'sector_id', s.sector_id, 'shift_type', s.type,
      'employment', s.employment_type, 'settled', CASE WHEN public.nv_can_read_finance(org) THEN public.nv_shift_has_settlement(s) END, 'unit', u.name, 'sector', s.sector, 'specialty', s.specialty, 'original', original.name,
      'candidates', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'crm', d.crm, 'uf', d.crm_uf)
        ORDER BY a.created_at, d.id), '[]'::jsonb)
        FROM public.shift_applications a JOIN public.doctors d ON d.id = a.doctor_id WHERE a.opportunity_id = op.id AND a.status = 'pending')) item
    FROM public.shift_opportunities op JOIN public.shifts s ON s.id = op.shift_id
    JOIN public.units u ON u.id = s.unit_id LEFT JOIN public.doctors original ON original.id = op.original_doctor_id
    WHERE s.organization_id = org AND (target IS NULL OR s.id = target)
      AND op.status = 'open' AND public.nv_shift_starts(s) > now() AND public.nv_coordinator(org)
      AND (scope IS NULL OR (scope = 'exchange' AND op.kind = 'exchange') OR (scope = 'applications'
        AND EXISTS (SELECT 1 FROM public.shift_applications a WHERE a.opportunity_id = op.id AND a.status = 'pending')))
    ORDER BY s.date, s.start_time, s.id LIMIT 100
  ) queue;
$$;

CREATE OR REPLACE FUNCTION public.nv_portal_schedule(from_date date, to_date date, mine boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF from_date IS NULL OR to_date IS NULL OR to_date - from_date NOT BETWEEN 0 AND 35 THEN
    RAISE EXCEPTION 'Escolha um período mensal válido.' USING ERRCODE = '22023';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time,
      'organization', o.name, 'unit', u.name, 'sector', s.sector, 'specialty', s.specialty,
      'status', CASE WHEN op.kind = 'exchange' THEN 'exchange' ELSE s.status END,
      'employment', CASE WHEN mine OR s.doctor_id IS NULL OR s.doctor_id = e.doctor_id THEN s.employment_type END,
      'assigned_to_me', s.doctor_id IS NOT DISTINCT FROM e.doctor_id, 'notes', CASE WHEN mine THEN s.notes END,
      'application', a.status, 'upcoming', public.nv_shift_starts(s) > now()
    ) ORDER BY s.date, s.start_time, s.id), '[]'::jsonb)
    FROM public.doctor_enrollments e JOIN public.shifts s ON s.organization_id = e.organization_id
    JOIN public.organizations o ON o.id = s.organization_id
    JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
    LEFT JOIN public.shift_opportunities op ON op.shift_id = s.id AND op.status = 'open'
    LEFT JOIN public.shift_applications a ON a.opportunity_id = op.id AND a.doctor_id = e.doctor_id
    WHERE e.auth_user_id = (SELECT public.nv_session_actor()) AND s.date BETWEEN from_date AND to_date
      AND CASE WHEN mine THEN s.doctor_id = e.doctor_id AND e.status = 'approved' AND public.nv_owns_doctor(e.organization_id, e.doctor_id)
        ELSE s.status IN ('open','confirmed') AND public.nv_credentialed_for_shift(e.doctor_id, s) END
  );
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
  wanted_employment text := filters->>'employment';
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
    OR (wanted_employment IS NOT NULL AND wanted_employment NOT IN ('pj','clt','concursado','undefined'))
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
        'doctor',d.name,'doctor_id',d.id,'employment',s.employment_type,'specialty',s.specialty,'date',s.date,'start_time',s.start_time,'end_time',s.end_time,
        'period',stats.period,'status',stats.state,'presence',CASE WHEN attendance THEN stats.presence END,
        'check_in',CASE WHEN attendance THEN ci.recorded_at END,'check_out',CASE WHEN attendance THEN co.recorded_at END)
        || CASE WHEN finance AND s.employment_type = 'pj' AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) THEN jsonb_build_object(
          'payment',stats.payment,'frequency',s.payment_frequency,'agreed',s.payment_amount,'due',CASE WHEN s.doctor_id IS NOT NULL THEN s.payment_due_date END,
          'paid_on',stats.paid_on,'paid_amount',CASE WHEN s.payment_status = 'paid' THEN coalesce(s.paid_amount,s.payment_amount) END,
          'balance',CASE WHEN s.doctor_id IS NULL OR s.payment_amount IS NULL THEN NULL WHEN s.payment_status = 'paid' OR s.status = 'cancelled' THEN 0 ELSE greatest(s.payment_amount - coalesce(s.paid_amount,0),0) END,
          'crm',concat_ws('-',d.crm,d.crm_uf),'employer',s.employer_name)
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
        CASE WHEN finance AND s.employment_type = 'pj' AND s.payment_amount IS NOT NULL THEN
          CASE WHEN s.doctor_id IS NULL AND s.status <> 'cancelled' THEN 'unassigned' ELSE public.nv_payment_state(s) END END payment,
        CASE WHEN finance AND s.employment_type = 'pj' THEN (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date END paid_on,
        coalesce((SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p
            WHERE p->>'startTime'=s.start_time AND p->>'endTime'=s.end_time LIMIT 1),
          (SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p WHERE p->>'kind'=clock.inferred LIMIT 1),
          sc.coverage_periods->0->>'kind',clock.inferred) period) stats
      WHERE s.organization_id = org AND s.date BETWEEN from_date AND to_date
        AND (NOT financial_only OR (s.employment_type = 'pj' AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND (s.status <> 'cancelled' OR wanted_payment = 'cancelled')))
        AND (wanted_unit IS NULL OR s.unit_id = wanted_unit) AND (wanted_sector IS NULL OR s.sector_id = wanted_sector)
        AND (wanted_doctor IS NULL OR s.doctor_id = wanted_doctor) AND (wanted_specialty IS NULL OR s.specialty = wanted_specialty)
        AND (wanted_employment IS NULL OR coalesce(s.employment_type,'undefined') = wanted_employment)
        AND (wanted_shift IS NULL OR s.id = wanted_shift)
        AND (wanted_state IS NULL OR stats.state = wanted_state OR (wanted_state='active' AND stats.state <> 'cancelled'))
        AND (wanted_presence IS NULL OR stats.presence = wanted_presence)
        AND (wanted_payment IS NULL OR ((s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND (stats.payment = wanted_payment
          OR (wanted_payment='unpaid' AND stats.payment IN ('pending','scheduled','overdue')))))
        AND (wanted_frequency IS NULL OR (s.employment_type = 'pj' AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND s.payment_frequency = wanted_frequency))
        AND (wanted_period IS NULL OR stats.period = wanted_period)
        AND (due_from IS NULL OR (s.employment_type = 'pj' AND s.doctor_id IS NOT NULL AND s.payment_due_date >= due_from))
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

CREATE OR REPLACE FUNCTION public.nv_report_shifts(org text, from_date date, to_date date, unit text DEFAULT NULL, specialty text DEFAULT NULL,
  sector text DEFAULT NULL, doctor text DEFAULT NULL, state text DEFAULT NULL, presence text DEFAULT NULL, payment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  finance boolean := public.nv_can_read_finance(org);
  attendance boolean := public.nv_coordinator(org);
BEGIN
  IF NOT public.nv_can_report(org) OR (payment IS NOT NULL AND NOT finance) OR (presence IS NOT NULL AND NOT attendance) THEN
    RAISE EXCEPTION 'Relatório indisponível para este acesso.' USING ERRCODE = '42501';
  END IF;
  IF from_date IS NULL OR to_date IS NULL OR to_date - from_date NOT BETWEEN 0 AND 365
    OR (state IS NOT NULL AND state NOT IN ('active','open','exchange','confirmed','pending','completed','cancelled'))
    OR (presence IS NOT NULL AND presence NOT IN ('pending','checked_in','checked_out'))
    OR (payment IS NOT NULL AND payment NOT IN ('pending','scheduled','overdue','unpaid','paid','cancelled')) THEN
    RAISE EXCEPTION 'Confira o período e os filtros do relatório.' USING ERRCODE = '22023';
  END IF;
  RETURN (
    SELECT jsonb_build_object('finance', finance, 'attendance', attendance, 'rows', coalesce(jsonb_agg(item ORDER BY item->>'date', item->>'start_time', item->>'id'), '[]'::jsonb))
    FROM (
      SELECT jsonb_build_object('id', s.id, 'organization', o.name, 'unit', u.name, 'sector', s.sector,
        'doctor', d.name, 'employment',s.employment_type, 'specialty', s.specialty, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time,
        'status', stats.state, 'presence', CASE WHEN attendance THEN stats.presence END,
        'check_in', CASE WHEN attendance THEN ci.recorded_at END, 'check_out', CASE WHEN attendance THEN co.recorded_at END,
        'payment', CASE WHEN finance AND s.employment_type = 'pj' AND s.doctor_id IS NOT NULL THEN stats.payment END,
        'agreed', CASE WHEN finance AND s.employment_type = 'pj' AND s.doctor_id IS NOT NULL THEN s.payment_amount END,
        'due', CASE WHEN finance AND s.employment_type = 'pj' AND s.doctor_id IS NOT NULL THEN s.payment_due_date END,
        'paid_on', CASE WHEN finance AND s.employment_type = 'pj' THEN (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date END,
        'paid_amount', CASE WHEN finance AND s.employment_type = 'pj' AND s.payment_status = 'paid' THEN coalesce(s.paid_amount, s.payment_amount) END) item
      FROM public.shifts s JOIN public.organizations o ON o.id = s.organization_id
      JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
      LEFT JOIN public.doctors d ON d.id = s.doctor_id AND d.organization_id = s.organization_id
      LEFT JOIN public.shift_opportunities op ON op.shift_id = s.id AND op.status = 'open' AND op.kind = 'exchange'
        AND public.nv_shift_starts(s) > now()
      LEFT JOIN public.shift_attendance ci ON ci.shift_id = s.id AND ci.kind = 'check_in'
      LEFT JOIN public.shift_attendance co ON co.shift_id = s.id AND co.kind = 'check_out'
      CROSS JOIN LATERAL (SELECT CASE WHEN op.id IS NULL THEN s.status ELSE 'exchange' END state,
        CASE WHEN co.recorded_at IS NOT NULL THEN 'checked_out' WHEN ci.recorded_at IS NOT NULL THEN 'checked_in'
          WHEN s.type = 'onsite' AND s.status = 'confirmed' AND s.doctor_id IS NOT NULL THEN 'pending' END presence,
        CASE WHEN s.employment_type = 'pj' AND s.payment_amount IS NOT NULL THEN public.nv_payment_state(s) END payment) stats
      WHERE s.organization_id = org AND s.date BETWEEN from_date AND to_date
        AND (nv_report_shifts.unit IS NULL OR s.unit_id = nv_report_shifts.unit)
        AND (nv_report_shifts.sector IS NULL OR s.sector_id = nv_report_shifts.sector)
        AND (nv_report_shifts.doctor IS NULL OR s.doctor_id = nv_report_shifts.doctor)
        AND (nv_report_shifts.specialty IS NULL OR s.specialty = nv_report_shifts.specialty)
        AND (nv_report_shifts.state IS NULL OR stats.state = nv_report_shifts.state
          OR (nv_report_shifts.state = 'active' AND stats.state <> 'cancelled'))
        AND (nv_report_shifts.presence IS NULL OR stats.presence = nv_report_shifts.presence)
        AND (nv_report_shifts.payment IS NULL OR (s.employment_type = 'pj' AND s.doctor_id IS NOT NULL AND (stats.payment = nv_report_shifts.payment
          OR (nv_report_shifts.payment = 'unpaid' AND stats.payment IN ('pending','scheduled','overdue')))))
      ORDER BY s.date, s.start_time, s.id LIMIT 10001
    ) report
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_operational_counts(org text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  schedule boolean := public.nv_can_action(org,'escala','view');
  coordination boolean := public.nv_coordinator(org);
  finance boolean := public.nv_can_read_finance(org);
  documents boolean := public.nv_can_read_documents(org);
  scope_start date := (today - interval '1 month')::date;
  scope_end date := (today + interval '2 months')::date;
BEGIN
  IF NOT public.nv_org_access(org) THEN RAISE EXCEPTION 'Empresa indisponível.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'today', today, 'from', scope_start, 'to', scope_end,
    'enrollments', CASE WHEN public.nv_can_action(org,'medicos','approve') THEN public.nv_pending_enrollments(org) END,
    'docs_pending', CASE WHEN documents THEN (SELECT count(*) FROM public.medical_documents d
      WHERE d.organization_id = org AND d.status IN ('not_sent','sent','analyzing','rejected')) END,
    'docs_expiring', CASE WHEN documents THEN (SELECT count(*) FROM public.medical_documents d
      WHERE d.organization_id = org AND (d.status = 'expired' OR (d.status = 'approved' AND d.expiry_date <= (today + 30)::text))) END,
    'open', CASE WHEN schedule THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.status = 'open' AND s.date BETWEEN today AND scope_end) ELSE 0 END,
    'exchanges', CASE WHEN coordination THEN (SELECT count(*) FROM public.shift_opportunities op JOIN public.shifts s ON s.id = op.shift_id
      WHERE s.organization_id = org AND op.kind = 'exchange' AND op.status = 'open' AND public.nv_shift_starts(s) > now()) END,
    'applications', CASE WHEN coordination THEN (SELECT count(*) FROM public.shift_applications a JOIN public.shift_opportunities op ON op.id = a.opportunity_id
      JOIN public.shifts s ON s.id = op.shift_id WHERE s.organization_id = org AND a.status = 'pending' AND op.status = 'open'
        AND public.nv_shift_starts(s) > now()) END,
    'shifts_today', CASE WHEN schedule THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date = today AND s.status <> 'cancelled') ELSE 0 END,
    'checkins_pending', CASE WHEN coordination THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date = today
      AND s.type = 'onsite' AND s.status = 'confirmed' AND s.doctor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.shift_attendance a WHERE a.shift_id = s.id AND a.kind IN ('check_in','check_out'))) END,
    'completed', CASE WHEN schedule THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.status = 'completed' AND s.date BETWEEN scope_start AND today) ELSE 0 END,
    'payments_pending', CASE WHEN finance THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date BETWEEN scope_start AND scope_end
      AND s.employment_type = 'pj' AND s.payment_amount IS NOT NULL AND s.doctor_id IS NOT NULL AND s.status <> 'cancelled' AND s.payment_status = 'pending') END,
    'payments_overdue', CASE WHEN finance THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date BETWEEN scope_start AND scope_end
      AND s.employment_type = 'pj' AND s.payment_amount IS NOT NULL AND s.doctor_id IS NOT NULL AND s.status <> 'cancelled' AND s.payment_status = 'pending' AND s.payment_due_date < today) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_edit_shift_agreement(target text, selection jsonb, adjustment boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item public.shifts%ROWTYPE;
  settled_amount numeric;
BEGIN
  SELECT * INTO item FROM public.shifts WHERE id = target AND employment_type = 'pj' AND public.nv_can_finance(organization_id) FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.nv_save_shift_payment(target text, agreed numeric, frequency text, state text,
  amount_paid numeric, paid_on date, note text)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE updated public.shifts%ROWTYPE;
BEGIN
  SELECT * INTO updated FROM public.shifts WHERE id = target AND employment_type = 'pj' AND doctor_id IS NOT NULL AND payment_amount IS NOT NULL AND public.nv_can_finance(organization_id) FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.nv_update_shift_payment(target_id text, next_status text)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_org text;
  updated_shift public.shifts;
BEGIN
  IF next_status NOT IN ('pending','paid') THEN
    RAISE EXCEPTION 'Situação de pagamento inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT organization_id INTO target_org
  FROM public.shifts
  WHERE id = target_id AND employment_type = 'pj' AND doctor_id IS NOT NULL AND payment_amount IS NOT NULL AND public.nv_can_finance(organization_id) FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento indisponível.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.shifts
  SET payment_status = next_status,
      paid_at = CASE WHEN next_status = 'paid' THEN now() ELSE NULL END
  WHERE id = target_id AND organization_id = target_org
  RETURNING * INTO updated_shift;

  RETURN updated_shift;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_update_shift_financials(
  target_id text,
  next_amount numeric,
  next_frequency text,
  next_status text
)
RETURNS public.shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_org text;
  updated_shift public.shifts;
BEGIN
  IF next_amount IS NULL OR next_amount < 0 OR next_amount > 9999999999.99 THEN
    RAISE EXCEPTION 'Valor do plantão inválido.' USING ERRCODE = '22023';
  END IF;
  IF next_frequency NOT IN ('on_delivery','monthly') THEN
    RAISE EXCEPTION 'Regime de pagamento inválido.' USING ERRCODE = '22023';
  END IF;
  IF next_status NOT IN ('pending','paid') THEN
    RAISE EXCEPTION 'Situação de pagamento inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT organization_id INTO target_org
  FROM public.shifts
  WHERE id = target_id AND employment_type = 'pj' AND public.nv_can_finance(organization_id) FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento indisponível.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.shifts
  SET payment_amount = next_amount,
      payment_frequency = next_frequency,
      payment_status = next_status,
      paid_at = CASE WHEN next_status = 'paid' THEN coalesce(paid_at, now()) ELSE NULL END
  WHERE id = target_id AND organization_id = target_org
  RETURNING * INTO updated_shift;

  RETURN updated_shift;
END;
$$;

CREATE FUNCTION public.nv_preview_pj_due(org text, shift_date date, start_time text, end_time text, frequency text)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.shifts;
BEGIN
  IF NOT public.nv_can_read_finance(org) THEN
    RAISE EXCEPTION 'Prazo de pagamento indisponível.' USING ERRCODE = '42501';
  END IF;
  IF shift_date IS NULL OR start_time IS NULL OR end_time IS NULL OR frequency IS NULL
    OR start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    OR start_time = end_time OR frequency NOT IN ('on_delivery','monthly') THEN
    RETURN NULL;
  END IF;
  item.organization_id := org;
  item.date := shift_date;
  item.start_time := start_time;
  item.end_time := end_time;
  item.payment_frequency := frequency;
  RETURN public.nv_calculate_shift_due(item);
END;
$$;
REVOKE ALL ON FUNCTION public.nv_preview_pj_due(text,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_preview_pj_due(text,date,text,text,text) TO authenticated;

COMMIT;
