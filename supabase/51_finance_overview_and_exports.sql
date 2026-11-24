BEGIN;
SET LOCAL lock_timeout='5s';

CREATE INDEX nv_billing_movement_cash ON public.billing_movements(posted_on,invoice_id);

CREATE FUNCTION public.nv_finance_company_report(org text, from_date date, to_date date, regime text,
  filters jsonb DEFAULT '{}', exporting boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 unit_filter text:=nullif(filters->>'unit',''); sector_filter text:=nullif(filters->>'sector','');
 client_filter text:=nullif(filters->>'client',''); contract_filter text:=nullif(filters->>'contract','');
 doctor_filter text:=nullif(filters->>'doctor',''); specialty_filter text:=nullif(filters->>'specialty','');
 state_filter text:=nullif(filters->>'state',''); today date:=(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
 result jsonb;
BEGIN
 PERFORM nv_master_private.require_billing(org,'billing_view');
 IF exporting THEN PERFORM nv_master_private.require_billing(org,'export'); END IF;
 IF from_date IS NULL OR to_date IS NULL OR to_date-from_date NOT BETWEEN 0 AND 365
   OR (regime IN ('competence','cash')) IS NOT TRUE
   OR (state_filter IS NOT NULL AND state_filter NOT IN ('missing','assessed','billed','paid','unpaid','received','overdue','pending'))
   OR (regime='cash' AND state_filter IS NOT NULL AND state_filter NOT IN ('paid','received'))
   OR (regime='competence' AND (from_date<>nv_master_private.billing_month(from_date)
     OR to_date<>(nv_master_private.billing_month(to_date)+interval '1 month'-interval '1 day')::date))
   OR length(coalesce(filters::text,''))>1600 THEN
  RAISE EXCEPTION 'Selecione um período de até 366 dias e filtros válidos.' USING ERRCODE='22023';
 END IF;
 WITH scope AS NOT MATERIALIZED (
  SELECT s.id,s.date,s.unit_id,s.sector_id,s.specialty,s.doctor_id,d.name doctor,u.name unit,se.name sector,
    s.employment_type,s.payment_amount,s.paid_at,s.payment_status,
    coalesce(s.paid_amount,CASE WHEN s.payment_status='paid' THEN s.payment_amount END) settled,
    b.contract_id,c.name contract,cl.name client,cl.id client_id,coalesce(b.planned_minutes,nv_master_private.shift_planned_minutes(s)) planned_minutes,b.worked_minutes,b.payable_minutes,b.billable_minutes,
    nv_master_private.hour_value(b.planned_minutes,b.revenue_rate) expected_revenue,
    nv_master_private.hour_value(b.billable_minutes,b.revenue_rate) assessed_revenue,
    nv_master_private.hour_value(b.payable_minutes,b.medical_rate) medical_cost,
    i.id invoice_id,i.issued_on,l.revenue line_revenue
  FROM public.shifts s JOIN public.doctors d ON d.id=s.doctor_id JOIN public.units u ON u.id=s.unit_id
  LEFT JOIN public.sectors se ON se.id=s.sector_id
  LEFT JOIN public.shift_billing b ON b.shift_id=s.id
  LEFT JOIN public.billing_contracts c ON c.id=b.contract_id LEFT JOIN public.billing_clients cl ON cl.id=c.client_id
  LEFT JOIN public.billing_invoice_lines l ON l.shift_id=s.id LEFT JOIN public.billing_invoices i ON i.id=l.invoice_id
  WHERE s.organization_id=org AND s.status<>'cancelled'
    AND (unit_filter IS NULL OR s.unit_id=unit_filter) AND (sector_filter IS NULL OR s.sector_id=sector_filter)
    AND (specialty_filter IS NULL OR s.specialty=specialty_filter) AND (doctor_filter IS NULL OR s.doctor_id=doctor_filter)
    AND (contract_filter IS NULL OR b.contract_id::text=contract_filter) AND (client_filter IS NULL OR cl.id::text=client_filter)
 ), operations AS MATERIALIZED (
  SELECT s.*,CASE WHEN s.payment_amount IS NOT NULL THEN greatest(s.payment_amount-coalesce(s.settled,0),0) END balance
  FROM scope s
  WHERE regime='competence' AND s.date BETWEEN from_date AND to_date
   AND CASE state_filter WHEN 'missing' THEN s.contract_id IS NULL WHEN 'assessed' THEN s.assessed_revenue IS NOT NULL
    WHEN 'billed' THEN s.issued_on IS NOT NULL WHEN 'paid' THEN s.employment_type='pj' AND s.payment_status='paid' AND s.settled>=s.payment_amount
    WHEN 'unpaid' THEN s.employment_type='pj' AND s.payment_amount>coalesce(s.settled,0)
    WHEN 'pending' THEN false WHEN 'overdue' THEN false WHEN 'received' THEN false ELSE true END
 ), invoice_scope AS MATERIALIZED (
  SELECT i.id,i.month,i.due_on,i.issued_on,i.document_ref,i.contract_id,c.name contract,cl.name client,u.name unit,se.name sector
  FROM public.billing_invoices i JOIN public.billing_contracts c ON c.id=i.contract_id JOIN public.billing_clients cl ON cl.id=c.client_id
  JOIN public.units u ON u.id=i.unit_id LEFT JOIN public.sectors se ON se.id=i.sector_id
  WHERE i.organization_id=org AND i.issued_on IS NOT NULL AND specialty_filter IS NULL AND doctor_filter IS NULL
   AND (unit_filter IS NULL OR i.unit_id=unit_filter) AND (sector_filter IS NULL OR i.sector_id=sector_filter)
   AND (contract_filter IS NULL OR c.id::text=contract_filter) AND (client_filter IS NULL OR cl.id::text=client_filter)
   AND ((regime='cash' AND EXISTS(SELECT FROM public.billing_movements m WHERE m.invoice_id=i.id AND m.posted_on BETWEEN from_date AND to_date))
    OR (regime='competence' AND i.month BETWEEN from_date AND to_date))
 ), invoices AS MATERIALIZED (
  SELECT i.*,t.*,CASE WHEN t.balance=0 THEN 'received' WHEN i.due_on<today THEN 'overdue' ELSE 'pending' END state
  FROM invoice_scope i CROSS JOIN LATERAL nv_master_private.invoice_totals(i.id) t
  WHERE regime='competence' AND i.month BETWEEN from_date AND to_date
    AND CASE state_filter WHEN 'received' THEN t.balance=0 WHEN 'overdue' THEN t.balance>0 AND i.due_on<today
     WHEN 'pending' THEN t.balance>0 AND i.due_on>=today WHEN 'billed' THEN true ELSE state_filter IS NULL END
 ), receipts AS MATERIALIZED (
  SELECT m.id,m.invoice_id,i.month,i.contract,i.client,i.unit,i.sector,m.kind,coalesce(original.kind,m.kind) effective_kind,
    m.amount,m.posted_on,m.note,m.receipt_path,m.reverses
  FROM public.billing_movements m JOIN invoice_scope i ON i.id=m.invoice_id
  LEFT JOIN public.billing_movements original ON original.id=m.reverses
  WHERE (regime='cash' AND m.posted_on BETWEEN from_date AND to_date AND (state_filter IS NULL OR state_filter='received'))
     OR (regime='competence' AND EXISTS(SELECT FROM invoices eligible WHERE eligible.id=i.id))
 ), payment_entries AS MATERIALIZED (
  SELECT m.id::text id,m.shift_id,s.date,s.contract,s.client,s.unit,s.sector,s.specialty,s.doctor,m.amount,m.paid_on,m.method,m.note,
    m.receipt_path,m.reversal_of::text reversal_of
  FROM public.shift_payment_movements m JOIN scope s ON s.id=m.shift_id
  WHERE m.organization_id=org AND ((regime='cash' AND m.paid_on BETWEEN from_date AND to_date AND (state_filter IS NULL OR state_filter='paid'))
    OR (regime='competence' AND EXISTS(SELECT FROM operations o WHERE o.id=s.id)))
  UNION ALL
  SELECT 'legacy-'||s.id,s.id,s.date,s.contract,s.client,s.unit,s.sector,s.specialty,s.doctor,
    s.settled-coalesce(v.total,0),recorded.paid_on,NULL,NULL,NULL,NULL
  FROM scope s
  LEFT JOIN LATERAL (SELECT sum(m.amount) total,min(m.created_at) first
    FROM public.shift_payment_movements m WHERE m.shift_id=s.id) v ON true
  LEFT JOIN LATERAL (SELECT (h.next->>'paid_at')::timestamptz paid_at FROM public.shift_payment_history h
    WHERE h.shift_id=s.id AND h.changed_at<=v.first AND h.next->>'status'='paid' AND h.next->>'paid_at' IS NOT NULL
    ORDER BY h.changed_at DESC,h.id DESC LIMIT 1) h ON v.first IS NOT NULL
  CROSS JOIN LATERAL (SELECT (CASE WHEN v.first IS NOT NULL THEN h.paid_at ELSE s.paid_at END AT TIME ZONE 'America/Sao_Paulo')::date paid_on) recorded
  WHERE s.employment_type='pj' AND s.settled>coalesce(v.total,0)
   AND ((regime='cash' AND recorded.paid_on BETWEEN from_date AND to_date AND (state_filter IS NULL OR state_filter='paid'))
     OR (regime='competence' AND EXISTS(SELECT FROM operations o WHERE o.id=s.id)))
 ), totals AS (
  SELECT (SELECT sum(expected_revenue) FROM operations) expected_revenue,
    (SELECT sum(assessed_revenue) FROM operations) assessed_revenue,
    (SELECT sum(case when issued_on IS NOT NULL then line_revenue end) FROM operations) billed,
    (SELECT sum(medical_cost) FROM operations) medical_cost,
    (SELECT sum(amount) FROM receipts WHERE effective_kind='receipt') received,
    (SELECT sum(balance) FROM invoices WHERE balance>0) receivable,
    (SELECT sum(balance) FROM invoices WHERE state='overdue') overdue,
    (SELECT sum(amount) FROM payment_entries) paid,
    (SELECT sum(balance) FROM operations WHERE employment_type='pj' AND payment_amount IS NOT NULL) payable,
    (SELECT sum(worked_minutes) FROM operations) worked_minutes,
    (SELECT sum(billable_minutes) FROM operations) billable_minutes,
    (SELECT count(*) FROM operations WHERE employment_type='pj' AND payment_status='paid' AND balance=0) paid_count,
    (SELECT count(*) FROM operations WHERE employment_type='pj' AND payment_amount IS NOT NULL AND balance>0) payable_count,
    (SELECT count(*) FROM operations WHERE contract_id IS NULL) missing_count,
    (SELECT count(*) FROM invoices) invoice_count
 ), monthly AS (
  SELECT month,sum(revenue) revenue,sum(cost) cost FROM (
   SELECT nv_master_private.billing_month(date) AS month,assessed_revenue revenue,medical_cost cost FROM operations
   UNION ALL
   SELECT nv_master_private.billing_month(posted_on),amount,NULL FROM receipts WHERE regime='cash' AND effective_kind='receipt'
   UNION ALL SELECT nv_master_private.billing_month(paid_on),NULL,amount FROM payment_entries WHERE regime='cash'
  ) combined GROUP BY month ORDER BY month
 ), sizes AS (
  SELECT (SELECT count(*) FROM operations)+(SELECT count(*) FROM invoices)+(SELECT count(*) FROM receipts)
    +(SELECT count(*) FROM payment_entries) total
 )
 SELECT to_jsonb(t)||jsonb_build_object(
  'gross_result',t.assessed_revenue-t.medical_cost,
  'gross_margin',round((t.assessed_revenue-t.medical_cost)/nullif(t.assessed_revenue,0)*100,2),
  'net_cash',CASE WHEN regime='cash' THEN coalesce(t.received,0)-coalesce(t.paid,0) END,
  'invoice_scope_limited',specialty_filter IS NOT NULL OR doctor_filter IS NOT NULL,
  'timeline',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.month),'[]') FROM monthly m),
  'size',sizes.total,
  'periods',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.month),'[]') FROM public.billing_periods p
    WHERE p.organization_id=org AND p.month BETWEEN nv_master_private.billing_month(from_date) AND nv_master_private.billing_month(to_date)),
  'shifts',CASE WHEN exporting AND sizes.total<=10000 THEN (SELECT coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('expected_revenue',s.expected_revenue::text,'assessed_revenue',s.assessed_revenue::text,
   'medical_cost',s.medical_cost::text,'line_revenue',s.line_revenue::text)
   ORDER BY s.date,s.id),'[]') FROM operations s) END,
  'invoices',CASE WHEN exporting AND sizes.total<=10000 THEN (SELECT coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('billed',i.billed::text,'medical_cost',i.medical_cost::text,
   'received',i.received::text,'balance',i.balance::text,'discounts',i.discounts::text,'deductions',i.deductions::text,'adjustments',i.adjustments::text)
   ORDER BY i.month,i.id),'[]') FROM invoices i) END,
  'receipts',CASE WHEN exporting AND sizes.total<=10000 THEN (SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('amount',r.amount::text) ORDER BY r.posted_on,r.id),'[]') FROM receipts r) END,
  'payments',CASE WHEN exporting AND sizes.total<=10000 THEN (SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('amount',p.amount::text) ORDER BY p.paid_on,p.id),'[]') FROM payment_entries p) END)
 INTO result FROM totals t CROSS JOIN sizes;
 IF exporting AND (result->>'size')::integer>10000 THEN
  RAISE EXCEPTION 'Exporte até 10.000 registros por vez. Reduza o período ou os filtros.' USING ERRCODE='22023';
 END IF;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.nv_finance_company_report(text,date,date,text,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_finance_company_report(text,date,date,text,jsonb,boolean) TO authenticated;

DROP POLICY nv_finance_receipts_upload ON storage.objects;
CREATE POLICY nv_finance_receipts_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='finance-receipts' AND name ~ '^[^/]+/[0-9a-f-]{36}[.](pdf|jpg|png)$'
  AND (public.nv_can_finance(split_part(name,'/',1))
   OR public.nv_can_action(split_part(name,'/',1),'financeiro','receipt')
   OR public.nv_can_action(split_part(name,'/',1),'financeiro','adjustment')));

-- Keep existing reports consistent with the net payment projection.
CREATE OR REPLACE FUNCTION public.nv_payment_state(shift public.shifts)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN shift.payment_status='paid' THEN CASE WHEN shift.paid_amount<shift.payment_amount THEN 'partial' ELSE 'paid' END
    WHEN shift.status='cancelled' THEN 'cancelled'
    WHEN shift.payment_due_date < (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'overdue'
    WHEN shift.payment_due_date IS NOT NULL THEN 'scheduled' ELSE 'pending' END;
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
    OR (wanted_payment IS NOT NULL AND wanted_payment NOT IN ('pending','scheduled','overdue','unpaid','paid','partial','cancelled','unassigned'))
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
          'balance',CASE WHEN s.doctor_id IS NULL OR s.payment_amount IS NULL THEN NULL WHEN s.status = 'cancelled' THEN 0 ELSE greatest(s.payment_amount - coalesce(s.paid_amount,CASE WHEN s.payment_status='paid' THEN s.payment_amount END,0),0) END,
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
          OR (wanted_payment='unpaid' AND stats.payment IN ('pending','scheduled','overdue','partial')))))
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
    OR (payment IS NOT NULL AND payment NOT IN ('pending','scheduled','overdue','unpaid','paid','partial','cancelled')) THEN
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
          OR (nv_report_shifts.payment = 'unpaid' AND stats.payment IN ('pending','scheduled','overdue','partial')))))
      ORDER BY s.date, s.start_time, s.id LIMIT 10001
    ) report
  );
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
