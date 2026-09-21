-- NV Med: payment tracking per medical shift for financial reporting.
-- Apply after 09_admin_deletions.sql.
BEGIN;

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS payment_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_payment_amount_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_payment_amount_check CHECK (payment_amount >= 0 AND payment_amount <= 9999999999.99);
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_payment_status_check;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_payment_status_check CHECK (payment_status IN ('pending','paid'));

COMMENT ON COLUMN public.shifts.payment_amount IS 'Gross amount agreed for this medical shift, in BRL.';
COMMENT ON COLUMN public.shifts.payment_status IS 'Financial settlement state: pending or paid.';

COMMIT;
