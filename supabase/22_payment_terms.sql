-- NV Med: payment due dates, settlement amounts and a financial audit trail.
-- Apply after 21_shift_attendance.sql.
BEGIN;

CREATE TABLE public.organization_payment_terms (
  organization_id text PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  payment_day integer NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
  month_offset integer NOT NULL CHECK (month_offset IN (0,1)),
  short_month text NOT NULL CHECK (short_month IN ('last_day','next_month')),
  business_adjustment text NOT NULL CHECK (business_adjustment IN ('none','next','previous')),
  holidays date[] NOT NULL DEFAULT '{}'
);

ALTER TABLE public.shifts ADD COLUMN payment_due_date date,
  ADD COLUMN paid_amount numeric(12,2) CHECK (paid_amount BETWEEN 0 AND 9999999999.99),
  ADD COLUMN payment_note text CHECK (length(payment_note) <= 1000);

CREATE TABLE public.shift_payment_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  shift_id text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous jsonb,
  next jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_payment_history_shift_idx ON public.shift_payment_history(shift_id, changed_at DESC);
CREATE INDEX shifts_payment_due_idx ON public.shifts(organization_id, payment_due_date) WHERE payment_status = 'pending' AND doctor_id IS NOT NULL;

ALTER TABLE public.organization_payment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_payment_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_payment_terms, public.shift_payment_history FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_can_read_finance(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_finance(org) OR EXISTS (
    SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = (SELECT public.nv_session_actor())
      AND u.status = 'active' AND u.type = 'tenant_user' AND u.organization_id = org
      AND u.additional_permissions->>'financeiro' = 'view'
  );
$$;

CREATE FUNCTION public.nv_payment_terms(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(t) - 'organization_id' FROM public.organization_payment_terms t
  WHERE t.organization_id = org AND public.nv_can_write(org, 'organizations');
$$;

CREATE FUNCTION public.nv_save_payment_terms(org text, day_of_month integer, offset_month integer,
  missing_day text, adjustment text, holiday_dates date[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.nv_can_write(org, 'organizations') OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org) THEN
    RAISE EXCEPTION 'Empresa indisponível.' USING ERRCODE = '42501';
  END IF;
  IF (day_of_month BETWEEN 1 AND 31 AND offset_month IN (0,1)
    AND missing_day IN ('last_day','next_month') AND adjustment IN ('none','next','previous')
    AND cardinality(holiday_dates) <= 366 AND array_position(holiday_dates, NULL) IS NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confira as regras de vencimento e a lista de feriados.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization_payment_terms(organization_id, payment_day, month_offset, short_month, business_adjustment, holidays)
  VALUES (org, day_of_month, offset_month, missing_day, adjustment, holiday_dates)
  ON CONFLICT (organization_id) DO UPDATE SET payment_day = EXCLUDED.payment_day, month_offset = EXCLUDED.month_offset,
    short_month = EXCLUDED.short_month, business_adjustment = EXCLUDED.business_adjustment, holidays = EXCLUDED.holidays;
END;
$$;

CREATE FUNCTION public.nv_calculate_shift_due(shift public.shifts)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  terms public.organization_payment_terms%ROWTYPE;
  month_start date;
  month_end date;
  due date;
BEGIN
  IF shift.payment_frequency = 'on_delivery' THEN
    RETURN (public.nv_shift_ends(shift) AT TIME ZONE 'America/Sao_Paulo')::date;
  END IF;
  SELECT * INTO terms FROM public.organization_payment_terms WHERE organization_id = shift.organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  month_start := (date_trunc('month', shift.date::timestamp) + make_interval(months => terms.month_offset))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  due := month_start + terms.payment_day - 1;
  IF due > month_end THEN
    due := month_end + CASE WHEN terms.short_month = 'next_month' THEN 1 ELSE 0 END;
  END IF;
  IF terms.business_adjustment <> 'none' THEN
    WHILE extract(isodow FROM due) >= 6 OR due = ANY(terms.holidays) LOOP
      due := due + CASE WHEN terms.business_adjustment = 'next' THEN 1 ELSE -1 END;
    END LOOP;
  END IF;
  RETURN due;
END;
$$;

CREATE FUNCTION public.nv_payment_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.payment_due_date := public.nv_calculate_shift_due(NEW);
    IF NOT public.nv_can_finance(NEW.organization_id) THEN
      NEW.paid_amount := NULL;
      NEW.payment_note := NULL;
    END IF;
  ELSE
    NEW.payment_due_date := OLD.payment_due_date;
    IF NOT public.nv_can_finance(NEW.organization_id) THEN
      NEW.paid_amount := OLD.paid_amount;
      NEW.payment_note := OLD.payment_note;
    END IF;
    IF OLD.payment_status = 'paid' AND
      (NEW.payment_amount, NEW.payment_frequency, NEW.date, NEW.start_time, NEW.end_time, NEW.doctor_id)
        IS DISTINCT FROM (OLD.payment_amount, OLD.payment_frequency, OLD.date, OLD.start_time, OLD.end_time, OLD.doctor_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = CASE WHEN public.nv_can_read_finance(OLD.organization_id)
        THEN 'Reabra o pagamento antes de alterar as condições de um plantão pago.'
        ELSE 'Alteração indisponível para este acesso. Procure a coordenação.' END;
    END IF;
    IF OLD.payment_due_date IS NULL OR (NEW.payment_frequency, NEW.date, NEW.end_time)
      IS DISTINCT FROM (OLD.payment_frequency, OLD.date, OLD.end_time) THEN
      NEW.payment_due_date := public.nv_calculate_shift_due(NEW);
    END IF;
  END IF;
  IF NEW.payment_status = 'paid' THEN
    IF NEW.doctor_id IS NULL OR NEW.status = 'cancelled'
      OR (NEW.paid_at AT TIME ZONE 'America/Sao_Paulo')::date > (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = CASE WHEN public.nv_can_read_finance(NEW.organization_id)
        THEN 'Confira o responsável, o estado do plantão e a data do pagamento.'
        ELSE 'Alteração indisponível para este acesso. Procure a coordenação.' END;
    END IF;
    NEW.paid_amount := coalesce(NEW.paid_amount, NEW.payment_amount);
  ELSE
    NEW.paid_amount := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_z_payment_fields BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_payment_fields();

CREATE FUNCTION public.nv_payment_snapshot(shift public.shifts)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('amount', shift.payment_amount, 'frequency', shift.payment_frequency,
    'status', shift.payment_status, 'due_date', shift.payment_due_date, 'paid_at', shift.paid_at,
    'paid_amount', shift.paid_amount, 'note', shift.payment_note);
$$;

CREATE FUNCTION public.nv_audit_shift_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_fields jsonb;
  new_fields jsonb := public.nv_payment_snapshot(NEW);
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_fields := public.nv_payment_snapshot(OLD);
    IF old_fields = new_fields THEN RETURN NEW; END IF;
  ELSIF NEW.payment_amount = 0 AND NEW.payment_status <> 'paid' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shift_payment_history(organization_id, shift_id, actor_id, previous, next)
  VALUES (NEW.organization_id, NEW.id, auth.uid(), old_fields, new_fields);
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_audit_shift_payment AFTER INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_audit_shift_payment();

CREATE FUNCTION public.nv_save_shift_payment(target text, agreed numeric, frequency text, state text,
  amount_paid numeric, paid_on date, note text)
RETURNS public.shifts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE updated public.shifts%ROWTYPE;
BEGIN
  SELECT * INTO updated FROM public.shifts WHERE id = target FOR UPDATE;
  IF NOT FOUND OR NOT public.nv_can_finance(updated.organization_id) THEN
    RAISE EXCEPTION 'Pagamento indisponível.' USING ERRCODE = '42501';
  END IF;
  IF (agreed BETWEEN 0 AND 9999999999.99 AND frequency IN ('on_delivery','monthly') AND state IN ('pending','paid')
    AND (state = 'pending' OR (amount_paid BETWEEN 0 AND 9999999999.99 AND paid_on IS NOT NULL))
    AND coalesce(length(btrim(note)),0) <= 1000) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confira valor, modalidade, situação e data do pagamento.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.shifts SET payment_amount = agreed, payment_frequency = frequency, payment_status = state,
    paid_amount = CASE WHEN state = 'paid' THEN amount_paid END, payment_note = nullif(btrim(note),''),
    paid_at = CASE WHEN state = 'paid' THEN (paid_on + time '12:00') AT TIME ZONE 'America/Sao_Paulo' END
    WHERE id = target RETURNING * INTO updated;
  RETURN updated;
END;
$$;

CREATE FUNCTION public.nv_payment_state(shift public.shifts)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE WHEN shift.payment_status = 'paid' THEN 'paid'
    WHEN shift.status = 'cancelled' THEN 'cancelled'
    WHEN shift.payment_due_date < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue'
    WHEN shift.payment_due_date IS NOT NULL THEN 'scheduled' ELSE 'pending' END;
$$;

REVOKE ALL ON FUNCTION public.nv_calculate_shift_due(public.shifts), public.nv_payment_fields(),
  public.nv_payment_snapshot(public.shifts), public.nv_audit_shift_payment(), public.nv_payment_state(public.shifts)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nv_can_read_finance(text), public.nv_payment_terms(text),
  public.nv_save_payment_terms(text,integer,integer,text,text,date[]),
  public.nv_save_shift_payment(text,numeric,text,text,numeric,date,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_can_read_finance(text), public.nv_payment_terms(text),
  public.nv_save_payment_terms(text,integer,integer,text,text,date[]),
  public.nv_save_shift_payment(text,numeric,text,text,numeric,date,text) TO authenticated;

COMMIT;
