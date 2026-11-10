-- NV Med: authorized report projection and operational indicators.
-- Apply after 22_payment_terms.sql.
BEGIN;

CREATE FUNCTION public.nv_can_report(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = (SELECT public.nv_session_actor()) AND u.status = 'active'
      AND ((u.type = 'saas_admin' AND u.role IN ('CEO','Gerente','Coordenador','Financeiro'))
        OR (u.type = 'tenant_user' AND u.organization_id = org AND (
          u.role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista','Financeiro','Jurídico')
          OR u.additional_permissions->>'relatorios' IN ('view','edit'))))
  );
$$;

CREATE FUNCTION public.nv_report_shifts(org text, from_date date, to_date date, unit text DEFAULT NULL, specialty text DEFAULT NULL,
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
        'doctor', d.name, 'specialty', s.specialty, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time,
        'status', stats.state, 'presence', CASE WHEN attendance THEN stats.presence END,
        'check_in', CASE WHEN attendance THEN ci.recorded_at END, 'check_out', CASE WHEN attendance THEN co.recorded_at END,
        'payment', CASE WHEN finance AND s.doctor_id IS NOT NULL THEN stats.payment END,
        'agreed', CASE WHEN finance AND s.doctor_id IS NOT NULL THEN s.payment_amount END,
        'due', CASE WHEN finance AND s.doctor_id IS NOT NULL THEN s.payment_due_date END,
        'paid_on', CASE WHEN finance THEN (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date END,
        'paid_amount', CASE WHEN finance AND s.payment_status = 'paid' THEN coalesce(s.paid_amount, s.payment_amount) END) item
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
        public.nv_payment_state(s) payment) stats
      WHERE s.organization_id = org AND s.date BETWEEN from_date AND to_date
        AND (nv_report_shifts.unit IS NULL OR s.unit_id = nv_report_shifts.unit)
        AND (nv_report_shifts.sector IS NULL OR s.sector_id = nv_report_shifts.sector)
        AND (nv_report_shifts.doctor IS NULL OR s.doctor_id = nv_report_shifts.doctor)
        AND (nv_report_shifts.specialty IS NULL OR s.specialty = nv_report_shifts.specialty)
        AND (nv_report_shifts.state IS NULL OR stats.state = nv_report_shifts.state
          OR (nv_report_shifts.state = 'active' AND stats.state <> 'cancelled'))
        AND (nv_report_shifts.presence IS NULL OR stats.presence = nv_report_shifts.presence)
        AND (nv_report_shifts.payment IS NULL OR (s.doctor_id IS NOT NULL AND (stats.payment = nv_report_shifts.payment
          OR (nv_report_shifts.payment = 'unpaid' AND stats.payment IN ('pending','scheduled','overdue')))))
      ORDER BY s.date, s.start_time, s.id LIMIT 10001
    ) report
  );
END;
$$;

CREATE FUNCTION public.nv_operational_counts(org text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  coordination boolean := public.nv_coordinator(org);
  finance boolean := public.nv_can_read_finance(org);
  documents boolean := public.nv_can_read_documents(org);
  scope_start date := (today - interval '1 month')::date;
  scope_end date := (today + interval '2 months')::date;
BEGIN
  IF NOT public.nv_org_access(org) THEN RAISE EXCEPTION 'Empresa indisponível.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'today', today, 'from', scope_start, 'to', scope_end,
    'enrollments', CASE WHEN coordination THEN public.nv_pending_enrollments(org) END,
    'docs_pending', CASE WHEN documents THEN (SELECT count(*) FROM public.medical_documents d
      WHERE d.organization_id = org AND d.status IN ('not_sent','sent','analyzing','rejected')) END,
    'docs_expiring', CASE WHEN documents THEN (SELECT count(*) FROM public.medical_documents d
      WHERE d.organization_id = org AND (d.status = 'expired' OR (d.status = 'approved' AND d.expiry_date <= (today + 30)::text))) END,
    'open', (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.status = 'open' AND s.date BETWEEN today AND scope_end),
    'exchanges', CASE WHEN coordination THEN (SELECT count(*) FROM public.shift_opportunities op JOIN public.shifts s ON s.id = op.shift_id
      WHERE s.organization_id = org AND op.kind = 'exchange' AND op.status = 'open' AND public.nv_shift_starts(s) > now()) END,
    'applications', CASE WHEN coordination THEN (SELECT count(*) FROM public.shift_applications a JOIN public.shift_opportunities op ON op.id = a.opportunity_id
      JOIN public.shifts s ON s.id = op.shift_id WHERE s.organization_id = org AND a.status = 'pending' AND op.status = 'open'
        AND public.nv_shift_starts(s) > now()) END,
    'shifts_today', (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date = today AND s.status <> 'cancelled'),
    'checkins_pending', CASE WHEN coordination THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date = today
      AND s.type = 'onsite' AND s.status = 'confirmed' AND s.doctor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.shift_attendance a WHERE a.shift_id = s.id AND a.kind IN ('check_in','check_out'))) END,
    'completed', (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.status = 'completed' AND s.date BETWEEN scope_start AND today),
    'payments_pending', CASE WHEN finance THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date BETWEEN scope_start AND scope_end
      AND s.doctor_id IS NOT NULL AND s.status <> 'cancelled' AND s.payment_status = 'pending') END,
    'payments_overdue', CASE WHEN finance THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date BETWEEN scope_start AND scope_end
      AND s.doctor_id IS NOT NULL AND s.status <> 'cancelled' AND s.payment_status = 'pending' AND s.payment_due_date < today) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nv_can_report(text), public.nv_operational_counts(text),
  public.nv_report_shifts(text,date,date,text,text,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_can_report(text), public.nv_operational_counts(text),
  public.nv_report_shifts(text,date,date,text,text,text,text,text,text,text) TO authenticated;

COMMIT;
