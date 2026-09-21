-- NV Med: payment frequency, financial settlement and database-enforced finance permissions.
-- Apply after 10_financial_reporting.sql.
BEGIN;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS payment_frequency text NOT NULL DEFAULT 'on_delivery',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_payment_frequency_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_payment_frequency_check
  CHECK (payment_frequency IN ('on_delivery','monthly'));

UPDATE public.shifts
SET paid_at = coalesce(paid_at, updated_at, created_at, now())
WHERE payment_status = 'paid' AND paid_at IS NULL;

COMMENT ON COLUMN public.shifts.payment_frequency IS 'Payment agreement: on_delivery (à vista) or monthly.';
COMMENT ON COLUMN public.shifts.paid_at IS 'Timestamp when the financial settlement was confirmed.';

CREATE OR REPLACE FUNCTION public.nv_can_finance(org text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'
      AND (
        (u.type = 'saas_admin' AND u.role IN ('CEO','Gerente','Financeiro'))
        OR
        (u.type = 'tenant_user' AND u.organization_id = org AND u.role IN ('Diretor','Gerente','Financeiro'))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.nv_can_finance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_can_finance(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_protect_shift_financial_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.nv_can_finance(NEW.organization_id) THEN
    IF TG_OP = 'INSERT' THEN
      NEW.payment_amount := 0;
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

DROP TRIGGER IF EXISTS nv_protect_shift_financial_fields ON public.shifts;
CREATE TRIGGER nv_protect_shift_financial_fields
BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_protect_shift_financial_fields();
REVOKE ALL ON FUNCTION public.nv_protect_shift_financial_fields() FROM PUBLIC;

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
  WHERE id = target_id;

  IF target_org IS NULL THEN
    RAISE EXCEPTION 'Plantão não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.nv_can_finance(target_org) THEN
    RAISE EXCEPTION 'Acesso financeiro negado para esta empresa.' USING ERRCODE = '42501';
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
  WHERE id = target_id;

  IF target_org IS NULL THEN
    RAISE EXCEPTION 'Plantão não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.nv_can_finance(target_org) THEN
    RAISE EXCEPTION 'Acesso financeiro negado para esta empresa.' USING ERRCODE = '42501';
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
