-- NV Med: keep financial columns out of operational sessions without finance permission.
-- Apply after 23_operational_reporting.sql and before the associated frontend.
BEGIN;

CREATE VIEW public.nv_staff_shifts WITH (security_barrier = true) AS
SELECT s.id, s.organization_id, s.doctor_id, s.unit_id, s.sector_id, s.sector, s.specialty, s.date,
  s.start_time, s.end_time, s.type, s.status, s.notes, s.employment_type, s.employer_name, s.coverage_mode, s.coverage_reason,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_amount END payment_amount,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_frequency END payment_frequency,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_status END payment_status,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.paid_at END paid_at,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.paid_amount END paid_amount,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_due_date END payment_due_date,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_note END payment_note
FROM public.shifts s WHERE public.nv_org_access(s.organization_id);

REVOKE ALL ON public.nv_staff_shifts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nv_staff_shifts TO authenticated;
REVOKE SELECT, INSERT, UPDATE ON public.shifts FROM PUBLIC, anon, authenticated;
-- Table ACLs and column ACLs are independent. Rebuild the column allowlist.
DO $$ DECLARE columns text; BEGIN
  SELECT string_agg(quote_ident(attname), ', ') INTO columns FROM pg_attribute
    WHERE attrelid = 'public.shifts'::regclass AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s) ON public.shifts FROM PUBLIC, anon, authenticated', columns);
END $$;
GRANT SELECT(id, organization_id, doctor_id, unit_id, sector_id, sector, specialty, date, start_time, end_time,
  type, status, notes, employment_type, employer_name, coverage_mode, coverage_reason) ON public.shifts TO authenticated;
CREATE POLICY nv_shift_rpc_insert ON public.shifts AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY nv_shift_rpc_update ON public.shifts AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);

CREATE FUNCTION public.nv_save_operational_shifts(records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  item public.shifts%ROWTYPE;
  existing_org text;
  saved text[] := '{}';
BEGIN
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Envie de 1 a 5000 plantões por operação.' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT row.* FROM jsonb_populate_recordset(NULL::public.shifts, records) row
    ORDER BY row.organization_id, row.doctor_id, row.id
  LOOP
    IF item.id IS NULL OR length(item.id) > 100 OR length(item.notes) > 1000 OR NOT public.nv_can_write(item.organization_id, 'shifts') THEN
      RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
    END IF;
    SELECT organization_id INTO existing_org FROM public.shifts WHERE id = item.id FOR UPDATE;
    IF FOUND THEN
      IF existing_org <> item.organization_id THEN RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501'; END IF;
      UPDATE public.shifts SET doctor_id = item.doctor_id, unit_id = item.unit_id, sector_id = item.sector_id,
        specialty = item.specialty, date = item.date, start_time = item.start_time, end_time = item.end_time,
        type = item.type, status = item.status, notes = item.notes, employment_type = item.employment_type,
        employer_name = item.employer_name, coverage_mode = coalesce(item.coverage_mode,'regular'), coverage_reason = item.coverage_reason,
        payment_amount = item.payment_amount, payment_frequency = item.payment_frequency,
        payment_status = item.payment_status, paid_at = item.paid_at WHERE id = item.id;
    ELSE
      INSERT INTO public.shifts(id, organization_id, doctor_id, unit_id, sector_id, specialty,
        date, start_time, end_time, type, status, notes, employment_type, employer_name, coverage_mode, coverage_reason,
        payment_amount, payment_frequency, payment_status, paid_at)
      VALUES (item.id, item.organization_id, item.doctor_id, item.unit_id, item.sector_id, item.specialty,
        item.date, item.start_time, item.end_time, item.type, item.status, item.notes, item.employment_type, item.employer_name,
        coalesce(item.coverage_mode,'regular'), item.coverage_reason, coalesce(item.payment_amount,0),
        coalesce(item.payment_frequency,'on_delivery'), coalesce(item.payment_status,'pending'), item.paid_at);
    END IF;
    saved := array_append(saved, item.id);
  END LOOP;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') FROM public.nv_staff_shifts s WHERE s.id = ANY(saved));
EXCEPTION WHEN integrity_constraint_violation THEN
  -- PostgreSQL can include the full failing row, including masked payment fields.
  RAISE EXCEPTION 'Não foi possível salvar os plantões. Confira os vínculos e os campos obrigatórios.'
    USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.nv_protect_financial_shift_removal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR (OLD.doctor_id IS NOT NULL AND NEW.doctor_id IS NULL))
    AND (OLD.payment_status = 'paid' OR OLD.payment_amount > 0)
    AND auth.uid() IS NOT NULL AND NOT public.nv_can_finance(OLD.organization_id) THEN
    RAISE EXCEPTION 'Alteração indisponível para este acesso. Procure a coordenação.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_protect_financial_shift_removal BEFORE UPDATE OR DELETE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_protect_financial_shift_removal();
REVOKE ALL ON FUNCTION public.nv_protect_financial_shift_removal() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.nv_save_operational_shifts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_save_operational_shifts(jsonb) TO authenticated;

-- Preserve the legacy payment entry points with the same tenant-scoped denial as the new RPC.
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
  WHERE id = target_id AND public.nv_can_finance(organization_id) FOR UPDATE;

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
REVOKE ALL ON FUNCTION public.nv_update_shift_payment(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_update_shift_payment(text,text) TO authenticated;

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
  WHERE id = target_id AND public.nv_can_finance(organization_id) FOR UPDATE;

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
REVOKE ALL ON FUNCTION public.nv_update_shift_financials(text,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_update_shift_financials(text,numeric,text,text) TO authenticated;

COMMIT;
