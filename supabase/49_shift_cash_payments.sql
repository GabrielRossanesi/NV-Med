BEGIN;
SET LOCAL lock_timeout = '5s';

-- The obligation is still the shift's agreement. Movements retain each transfer
-- and reversal while the existing shift fields project the net settlement.
CREATE TABLE public.shift_payment_movements (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES public.organizations(id),
  shift_id text NOT NULL REFERENCES public.shifts(id) ON DELETE RESTRICT,
  doctor_id text NOT NULL REFERENCES public.doctors(id),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0),
  paid_on date NOT NULL,
  method text NOT NULL CHECK (method IN ('pix','transfer','cash','other')),
  note text CHECK (length(note) <= 1000),
  receipt_path text,
  reversal_of uuid UNIQUE REFERENCES public.shift_payment_movements(id),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((amount < 0) = (reversal_of IS NOT NULL))
);
CREATE INDEX nv_shift_payment_movements_shift_idx ON public.shift_payment_movements(shift_id,created_at,id);
CREATE INDEX nv_shift_payment_movements_cash_idx ON public.shift_payment_movements(organization_id,paid_on);
ALTER TABLE public.shift_payment_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_payment_movements FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE nv_master_private.payment_movement_context (
  transaction_id bigint NOT NULL,
  shift_id text NOT NULL,
  PRIMARY KEY(transaction_id,shift_id)
);
REVOKE ALL ON nv_master_private.payment_movement_context FROM PUBLIC,anon,authenticated,service_role;

-- Separate private bucket on the project's existing Storage. Filenames are
-- immutable operation IDs and cannot expose patient data.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('finance-receipts','finance-receipts',false,10485760,ARRAY['application/pdf','image/jpeg','image/png']);
CREATE POLICY nv_finance_receipts_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'finance-receipts' AND public.nv_can_finance(split_part(name,'/',1))
  AND name ~ '^[^/]+/[0-9a-f-]{36}[.](pdf|jpg|png)$');
CREATE POLICY nv_finance_receipts_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'finance-receipts' AND public.nv_can_read_finance(split_part(name,'/',1))
  AND name ~ '^[^/]+/[0-9a-f-]{36}[.](pdf|jpg|png)$');

-- Existing trigger continues to validate the settlement projection. Only a
-- validated movement (or a legacy adjustment already supported) may update it.
CREATE OR REPLACE FUNCTION public.nv_payment_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE correcting boolean;
  is_movement boolean;
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
    is_movement := EXISTS (SELECT FROM nv_master_private.payment_movement_context c
      WHERE c.transaction_id = txid_current() AND c.shift_id = OLD.id);
    IF NOT is_movement AND OLD.payment_status = 'paid' THEN
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
    ELSIF NOT is_movement THEN
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

CREATE FUNCTION public.nv_register_shift_payment(target text, request_id uuid, amount numeric, paid_on date,
  method text, note text DEFAULT NULL, receipt text DEFAULT NULL, reverse_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.shifts; original public.shift_payment_movements; existing public.shift_payment_movements;
  balance numeric; settled numeric; change numeric; pay_date date; result jsonb;
BEGIN
  SELECT * INTO item FROM public.shifts s
  WHERE s.id = target AND s.doctor_id IS NOT NULL AND s.employment_type = 'pj'
    AND s.payment_amount IS NOT NULL AND s.status <> 'cancelled' FOR UPDATE;
  IF NOT FOUND OR NOT public.nv_can_finance(item.organization_id) THEN
    RAISE EXCEPTION 'Pagamento indisponível.' USING ERRCODE = '42501';
  END IF;
  note := nullif(btrim(note),'');
  IF request_id IS NULL OR paid_on IS NULL OR paid_on > (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
    OR coalesce(length(note),0) > 1000 THEN
    RAISE EXCEPTION 'Confira a data e as observações do pagamento.' USING ERRCODE = '22023';
  END IF;
  IF reverse_id IS NOT NULL THEN
    SELECT * INTO original FROM public.shift_payment_movements m WHERE m.id = reverse_id AND m.shift_id = target AND m.amount > 0;
    IF NOT FOUND OR NOT public.nv_can_action(item.organization_id,'configuracoes','edit') THEN
      RAISE EXCEPTION 'Estorno indisponível.' USING ERRCODE = '42501';
    END IF;
    IF coalesce(length(note),0) < 3 OR paid_on < original.paid_on THEN
      RAISE EXCEPTION 'Informe a justificativa e a data do estorno.' USING ERRCODE = '22023';
    END IF;
    method := original.method;
    receipt := NULL;
    change := -original.amount;
  ELSE
    IF (amount BETWEEN 0.01 AND 9999999999.99 AND scale(trim_scale(amount)) <= 2
      AND method IN ('pix','transfer','cash','other')) IS NOT TRUE THEN
      RAISE EXCEPTION 'Informe o valor efetivamente pago e a forma de pagamento.' USING ERRCODE = '22023';
    END IF;
    IF receipt IS NOT NULL AND NOT EXISTS (SELECT FROM storage.objects o
      WHERE o.bucket_id = 'finance-receipts' AND o.name = receipt
        AND receipt IN (item.organization_id || '/' || request_id || '.pdf',
          item.organization_id || '/' || request_id || '.jpg',item.organization_id || '/' || request_id || '.png')) THEN
      RAISE EXCEPTION 'Comprovante indisponível.' USING ERRCODE = '22023';
    END IF;
    change := amount;
  END IF;

  SELECT * INTO existing FROM public.shift_payment_movements m WHERE m.id = request_id;
  IF FOUND THEN
    IF (existing.shift_id,existing.amount,existing.paid_on,existing.method,existing.note,existing.receipt_path,existing.reversal_of)
      IS DISTINCT FROM (target,change,paid_on,method,note,receipt,reverse_id) THEN
      RAISE EXCEPTION 'Esta operação já foi utilizada. Confira o histórico.' USING ERRCODE = '22023';
    END IF;
  ELSE
    settled := coalesce(item.paid_amount, CASE WHEN item.payment_status='paid' THEN item.payment_amount END,0);
    balance := settled + change;
    IF balance < 0 OR (change > 0 AND balance > item.payment_amount) THEN
      RAISE EXCEPTION 'O valor deve respeitar o saldo pendente.' USING ERRCODE = '22023';
    END IF;
    IF reverse_id IS NOT NULL AND EXISTS (SELECT FROM public.shift_payment_movements m WHERE m.reversal_of = reverse_id) THEN
      RAISE EXCEPTION 'Este pagamento já foi estornado.' USING ERRCODE = '22023';
    END IF;
    -- Migration 42 adds the GPS source. The older attendance schema has no
    -- GPS review queue and still supports the original settlement rules.
    IF change > 0 AND EXISTS (SELECT FROM public.attendance_exceptions e WHERE e.shift_id = target AND e.doctor_id = item.doctor_id
        AND e.kind = 'check_out' AND to_jsonb(e)->>'source' = 'gps' AND e.status IN ('pending','rejected'))
      AND NOT EXISTS (SELECT FROM public.shift_attendance a WHERE a.shift_id = target AND a.doctor_id = item.doctor_id
        AND a.kind = 'check_out' AND a.result IN ('gps_confirmed','manual_approved')) THEN
      RAISE EXCEPTION 'A coordenação precisa confirmar a presença antes de liquidar este plantão.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.shift_payment_movements(id,organization_id,shift_id,doctor_id,amount,paid_on,
      method,note,receipt_path,reversal_of,actor_id)
    VALUES(request_id,item.organization_id,target,item.doctor_id,change,paid_on,method,note,receipt,reverse_id,public.nv_session_actor());
    INSERT INTO nv_master_private.payment_movement_context VALUES(txid_current(),target);
    SELECT coalesce(max(m.paid_on), (item.paid_at AT TIME ZONE 'America/Sao_Paulo')::date) INTO pay_date
    FROM public.shift_payment_movements m WHERE m.shift_id = target AND m.amount > 0
      AND NOT EXISTS (SELECT FROM public.shift_payment_movements r WHERE r.reversal_of = m.id);
    UPDATE public.shifts SET paid_amount = nullif(balance,0),
      payment_status = CASE WHEN balance > 0 THEN 'paid' ELSE 'pending' END,
      paid_at = CASE WHEN balance > 0 THEN (pay_date + time '12:00') AT TIME ZONE 'America/Sao_Paulo' END
    WHERE id = target;
    DELETE FROM nv_master_private.payment_movement_context WHERE transaction_id = txid_current() AND shift_id = target;
  END IF;
  SELECT to_jsonb(s) INTO result FROM public.nv_staff_shifts s WHERE s.id=target;
  RETURN result;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A operação já foi registrada. Confira o histórico.' USING ERRCODE = '22023';
END $$;

CREATE FUNCTION public.nv_shift_payment_movements(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at,m.id),'[]')
  FROM public.shift_payment_movements m
  WHERE m.shift_id = target AND public.nv_can_read_finance(m.organization_id);
$$;

-- A planned à vista payment is the existing on_delivery agreement. When a real
-- payment is sent with the form, persist both the agreement and transfer together.
ALTER FUNCTION public.nv_save_operational_shifts(jsonb) RENAME TO nv_save_operational_shifts_with_reason;
REVOKE ALL ON FUNCTION public.nv_save_operational_shifts_with_reason(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.nv_save_operational_shifts(records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; cash jsonb; result jsonb;
BEGIN
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Envie uma lista de plantões.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(records) = 1 THEN
    item := records->0;
    cash := nullif(item->'cash_payment','null');
  END IF;
  IF cash IS NULL THEN
    IF jsonb_typeof(records) = 'array' AND EXISTS(SELECT FROM jsonb_array_elements(records) r WHERE nullif(r->'cash_payment','null') IS NOT NULL) THEN
      RAISE EXCEPTION 'Registre o pagamento de um plantão por vez.' USING ERRCODE = '22023';
    END IF;
    RETURN public.nv_save_operational_shifts_with_reason(records);
  END IF;
  IF NOT public.nv_can_finance(item->>'organization_id') THEN
    RAISE EXCEPTION 'Seu acesso não permite registrar pagamentos.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT FROM public.shift_payment_movements m WHERE m.id = (cash->>'id')::uuid
    AND m.shift_id = item->>'id' AND m.organization_id = item->>'organization_id') THEN
    PERFORM public.nv_save_operational_shifts_with_reason(records);
  END IF;
  IF NOT EXISTS (SELECT FROM public.shifts s WHERE s.id = item->>'id' AND s.organization_id = item->>'organization_id'
    AND s.payment_frequency = 'on_delivery') THEN
    RAISE EXCEPTION 'Selecione pagamento à vista no acordo do plantão.' USING ERRCODE = '22023';
  END IF;
  result := public.nv_register_shift_payment(item->>'id',(cash->>'id')::uuid,(cash->>'amount')::numeric,
    (cash->>'paid_on')::date,cash->>'method',cash->>'note',cash->>'receipt');
  RETURN jsonb_build_array(result);
END $$;

REVOKE ALL ON FUNCTION public.nv_register_shift_payment(text,uuid,numeric,date,text,text,text,uuid),
  public.nv_shift_payment_movements(text),public.nv_save_operational_shifts(jsonb)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_register_shift_payment(text,uuid,numeric,date,text,text,text,uuid),
  public.nv_shift_payment_movements(text),public.nv_save_operational_shifts(jsonb) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
