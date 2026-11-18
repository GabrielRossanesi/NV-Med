-- Disposable local database only, after migration 33 and doctor-banking.fixture.sql.
-- Exercise the same full-row 500-item pagination as the dashboard bootstrap.
BEGIN;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,date,start_time,end_time,status,specialty)
SELECT 'nv-bank-read-'||n,'nv-bank-org','nv-bank-unit','nv-bank-sector',current_date+n,'07:00','19:00','open','Cirurgia'
FROM generate_series(1,1000)n;

SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout='8s';
DO $$ DECLARE page jsonb; BEGIN
  SELECT jsonb_agg(to_jsonb(s))INTO page FROM(
    SELECT *FROM public.nv_staff_shifts WHERE organization_id='nv-bank-org'ORDER BY id LIMIT 500
  )s;
  IF jsonb_array_length(page)<>500 OR EXISTS(SELECT FROM jsonb_array_elements(page)s WHERE s->>'payment_status'IS DISTINCT FROM 'pending')THEN
    RAISE EXCEPTION 'FAIL: finance-capable staff full-row pagination';
  END IF;
  IF NOT EXISTS(SELECT FROM public.nv_staff_shifts WHERE id='nv-bank-shift'AND payment_amount=500)THEN
    RAISE EXCEPTION 'FAIL: authorized financial field lost';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $$ DECLARE page jsonb; BEGIN
  SELECT jsonb_agg(to_jsonb(s))INTO page FROM(
    SELECT *FROM public.nv_staff_shifts WHERE organization_id='nv-bank-org'ORDER BY id LIMIT 500 OFFSET 500
  )s;
  IF jsonb_array_length(page)<>500 OR EXISTS(SELECT FROM jsonb_array_elements(page)s WHERE
    s->>'payment_amount'IS NOT NULL OR s->>'payment_status'IS NOT NULL OR s->>'payment_frequency'IS NOT NULL
    OR s->>'paid_at'IS NOT NULL OR s->>'paid_amount'IS NOT NULL OR s->>'payment_due_date'IS NOT NULL
    OR s->>'payment_note'IS NOT NULL OR s->>'payment_agreement'IS NOT NULL)THEN
    RAISE EXCEPTION 'FAIL: operational staff pagination or financial mask';
  END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.nv_staff_shifts WHERE organization_id='nv-bank-org')THEN
    RAISE EXCEPTION 'FAIL: foreign organization obtained staff rows';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.nv_staff_shifts WHERE organization_id='nv-bank-org')THEN
    RAISE EXCEPTION 'FAIL: physician portal obtained staff rows';
  END IF;
END $$;
SELECT set_config('request.jwt.claims','{}',true);
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.nv_staff_shifts)THEN RAISE EXCEPTION 'FAIL: missing identity obtained staff rows';END IF;
END $$;
ROLLBACK;
