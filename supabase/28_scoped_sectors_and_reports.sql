-- NV Med: company/unit/sector specialty constraints and expanded reports.
-- Apply after 27_effective_permissions.sql.
BEGIN;

CREATE FUNCTION public.nv_shift_specialty_allowed(org text, unit text, sector text, specialty text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations o JOIN public.units u ON u.organization_id = o.id
    LEFT JOIN public.sectors s ON s.unit_id = u.id AND s.organization_id = o.id AND s.id = sector
    WHERE o.id = org AND u.id = unit AND (sector IS NULL OR s.id IS NOT NULL)
      AND (CASE WHEN jsonb_typeof(o.settings->'specialties') = 'array' THEN
        jsonb_array_length(o.settings->'specialties') = 0 OR (o.settings->'specialties') ? specialty ELSE true END)
      AND (coalesce(cardinality(u.specialties),0) = 0 OR specialty = ANY(u.specialties))
      AND (coalesce(cardinality(s.specialties),0) = 0 OR specialty = ANY(s.specialties))
  );
$$;

CREATE FUNCTION public.nv_check_sector_specialties()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.organization_id,NEW.unit_id,NEW.specialties)
    IS NOT DISTINCT FROM (OLD.organization_id,OLD.unit_id,OLD.specialties) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.specialties) item
    WHERE item IS NULL OR NOT public.nv_shift_specialty_allowed(NEW.organization_id,NEW.unit_id,NULL,item)) THEN
    RAISE EXCEPTION 'Escolha especialidades autorizadas para esta unidade.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_check_sector_specialties BEFORE INSERT OR UPDATE OF organization_id, unit_id, specialties
ON public.sectors FOR EACH ROW EXECUTE FUNCTION public.nv_check_sector_specialties();

CREATE FUNCTION public.nv_check_shift_specialty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.organization_id,NEW.unit_id,NEW.sector_id,NEW.specialty)
    IS NOT DISTINCT FROM (OLD.organization_id,OLD.unit_id,OLD.sector_id,OLD.specialty) THEN RETURN NEW; END IF;
  IF NEW.specialty IS NOT NULL AND NOT public.nv_shift_specialty_allowed(NEW.organization_id,NEW.unit_id,NEW.sector_id,NEW.specialty) THEN
    RAISE EXCEPTION 'Escolha uma especialidade autorizada para a unidade e o setor.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_check_shift_specialty BEFORE INSERT OR UPDATE OF organization_id, unit_id, sector_id, specialty
ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.nv_check_shift_specialty();

CREATE FUNCTION public.nv_report_hour_match(starts time, ends time, from_time time, to_time time)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN from_time IS NULL THEN to_time IS NULL OR ends <= to_time
    WHEN to_time IS NULL THEN starts >= from_time
    ELSE EXISTS (
      SELECT 1 FROM (VALUES (0), (86400)) offsets(day_offset)
      WHERE extract(epoch FROM starts) + day_offset >= extract(epoch FROM from_time)
        AND extract(epoch FROM ends) + day_offset + CASE WHEN ends < starts THEN 86400 ELSE 0 END
          <= extract(epoch FROM to_time) + CASE WHEN to_time < from_time THEN 86400 ELSE 0 END
    )
  END;
$$;

CREATE FUNCTION public.nv_report_catalog(org text, financial_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  finance boolean := public.nv_can_read_finance(org);
  attendance boolean := public.nv_coordinator(org);
BEGIN
  IF (CASE WHEN financial_only THEN finance ELSE public.nv_can_report(org) END) IS NOT TRUE
    OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org) THEN
    RAISE EXCEPTION 'Relatório indisponível para este acesso.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'finance',finance,'attendance',attendance,
    'units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.name),'[]') FROM public.units u WHERE u.organization_id = org),
    'sectors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'unitId',s.unit_id,'name',s.name,'specialties',s.specialties,
      'coveragePeriods',s.coverage_periods,'defaultStartTime',s.default_start_time,'defaultEndTime',s.default_end_time,
      'requiredDoctors',s.required_doctors) ORDER BY s.name),'[]') FROM public.sectors s WHERE s.organization_id = org),
    'doctors',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,
      'crm',CASE WHEN finance THEN d.crm END,'crmUf',CASE WHEN finance THEN d.crm_uf END,'specialty',d.specialty) ORDER BY d.name),'[]') FROM public.doctors d WHERE d.organization_id = org),
    'specialties',(SELECT coalesce(jsonb_agg(name ORDER BY name),'[]') FROM (
      SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.settings->'specialties') = 'array' THEN o.settings->'specialties' ELSE '[]' END) name
        FROM public.organizations o WHERE o.id = org
      UNION SELECT s.specialty FROM public.shifts s WHERE s.organization_id = org AND s.specialty IS NOT NULL
    ) catalog)
  );
END;
$$;

CREATE FUNCTION public.nv_report_filtered_shifts(org text, from_date date, to_date date, filters jsonb, financial_only boolean DEFAULT false)
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
    OR (wanted_payment IS NOT NULL AND wanted_payment NOT IN ('pending','scheduled','overdue','unpaid','paid','cancelled'))
    OR (wanted_frequency IS NOT NULL AND wanted_frequency NOT IN ('monthly','on_delivery'))
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
        'doctor',d.name,'doctor_id',d.id,'specialty',s.specialty,'date',s.date,'start_time',s.start_time,'end_time',s.end_time,
        'period',stats.period,'status',stats.state,'presence',CASE WHEN attendance THEN stats.presence END,
        'check_in',CASE WHEN attendance THEN ci.recorded_at END,'check_out',CASE WHEN attendance THEN co.recorded_at END)
        || CASE WHEN finance AND s.doctor_id IS NOT NULL THEN jsonb_build_object(
          'payment',stats.payment,'frequency',s.payment_frequency,'agreed',s.payment_amount,'due',s.payment_due_date,
          'paid_on',stats.paid_on,'paid_amount',CASE WHEN s.payment_status = 'paid' THEN coalesce(s.paid_amount,s.payment_amount) END,
          'balance',CASE WHEN s.payment_status = 'paid' OR s.status = 'cancelled' THEN 0 ELSE greatest(s.payment_amount - coalesce(s.paid_amount,0),0) END,
          'crm',concat_ws('-',d.crm,d.crm_uf),'employment',s.employment_type,'employer',s.employer_name)
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
        CASE WHEN finance THEN public.nv_payment_state(s) END payment,
        CASE WHEN finance THEN (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date END paid_on,
        coalesce((SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p
            WHERE p->>'startTime'=s.start_time AND p->>'endTime'=s.end_time LIMIT 1),
          (SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p WHERE p->>'kind'=clock.inferred LIMIT 1),
          sc.coverage_periods->0->>'kind',clock.inferred) period) stats
      WHERE s.organization_id = org AND s.date BETWEEN from_date AND to_date
        AND (NOT financial_only OR (s.doctor_id IS NOT NULL AND (s.status <> 'cancelled' OR wanted_payment = 'cancelled')))
        AND (wanted_unit IS NULL OR s.unit_id = wanted_unit) AND (wanted_sector IS NULL OR s.sector_id = wanted_sector)
        AND (wanted_doctor IS NULL OR s.doctor_id = wanted_doctor) AND (wanted_specialty IS NULL OR s.specialty = wanted_specialty)
        AND (wanted_shift IS NULL OR s.id = wanted_shift)
        AND (wanted_state IS NULL OR stats.state = wanted_state OR (wanted_state='active' AND stats.state <> 'cancelled'))
        AND (wanted_presence IS NULL OR stats.presence = wanted_presence)
        AND (wanted_payment IS NULL OR (s.doctor_id IS NOT NULL AND (stats.payment = wanted_payment
          OR (wanted_payment='unpaid' AND stats.payment IN ('pending','scheduled','overdue')))))
        AND (wanted_frequency IS NULL OR (s.doctor_id IS NOT NULL AND s.payment_frequency = wanted_frequency))
        AND (wanted_period IS NULL OR stats.period = wanted_period)
        AND (due_from IS NULL OR (s.doctor_id IS NOT NULL AND s.payment_due_date >= due_from))
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

REVOKE ALL ON FUNCTION public.nv_shift_specialty_allowed(text,text,text,text), public.nv_check_sector_specialties(),
  public.nv_check_shift_specialty(), public.nv_report_hour_match(time,time,time,time), public.nv_report_catalog(text,boolean),
  public.nv_report_filtered_shifts(text,date,date,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_report_catalog(text,boolean), public.nv_report_filtered_shifts(text,date,date,jsonb,boolean) TO authenticated;


CREATE OR REPLACE FUNCTION public.nv_validate_adhoc_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.coverage_mode = 'adhoc' THEN
    NEW.coverage_reason := NULLIF(BTRIM(NEW.coverage_reason), '');
    NEW.specialty := NULLIF(BTRIM(NEW.specialty), '');
    IF NEW.coverage_reason IS NULL OR char_length(NEW.coverage_reason) NOT BETWEEN 3 AND 200 THEN
      RAISE EXCEPTION 'Informe o motivo da cobertura avulsa (3 a 200 caracteres).';
    END IF;
    IF NEW.specialty IS NULL OR ((TG_OP = 'INSERT' OR (NEW.organization_id,NEW.unit_id,NEW.sector_id,NEW.specialty)
      IS DISTINCT FROM (OLD.organization_id,OLD.unit_id,OLD.sector_id,OLD.specialty))
      AND NOT public.nv_shift_specialty_allowed(NEW.organization_id,NEW.unit_id,NEW.sector_id,NEW.specialty)) THEN RAISE EXCEPTION 'Selecione uma especialidade do setor para o plantão avulso.'; END IF;
    IF NEW.doctor_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.doctors d LEFT JOIN public.doctor_enrollments e ON e.doctor_id = d.id
      WHERE d.id = NEW.doctor_id AND d.organization_id = NEW.organization_id
        AND (CASE WHEN e.doctor_id IS NULL THEN d.specialty = NEW.specialty ELSE NEW.specialty = ANY(e.approved_specialties) END)
    ) THEN RAISE EXCEPTION 'O médico deve atender à especialidade da cobertura avulsa.'; END IF;
  ELSE
    NEW.coverage_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_credentialed_for_shift(doctor text, shift public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.doctors d
    JOIN public.doctor_enrollments e ON e.doctor_id = d.id
    JOIN public.organizations o ON o.id = d.organization_id
    JOIN public.units u ON u.id = shift.unit_id AND u.organization_id = o.id
    JOIN public.sectors s ON s.id = shift.sector_id AND s.unit_id = u.id AND s.organization_id = o.id
    WHERE d.id = doctor AND d.organization_id = shift.organization_id AND d.status = 'active'
      AND e.status = 'approved' AND e.auth_user_id IS NOT NULL
      AND o.status = 'active' AND u.status = 'active' AND s.status = 'active'
      AND shift.unit_id = ANY(d.linked_units)
      AND shift.specialty = ANY(e.approved_specialties)
      AND public.nv_shift_specialty_allowed(shift.organization_id,shift.unit_id,shift.sector_id,shift.specialty)
  );
$$;

COMMIT;
