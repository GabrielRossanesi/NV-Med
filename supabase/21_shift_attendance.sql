-- NV Med: on-demand attendance with per-unit geofence and reviewed exceptions.
-- Apply after 20_shift_opportunities.sql.
BEGIN;

CREATE TABLE public.unit_attendance_settings (
  unit_id text PRIMARY KEY REFERENCES public.units(id) ON DELETE CASCADE,
  latitude numeric NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m integer NOT NULL CHECK (radius_m BETWEEN 25 AND 5000),
  max_accuracy_m integer NOT NULL CHECK (max_accuracy_m BETWEEN 5 AND 200),
  tolerance_min integer NOT NULL CHECK (tolerance_min BETWEEN 0 AND 180),
  allow_manual boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shift_attendance (
  shift_id text NOT NULL REFERENCES public.shifts(id),
  kind text NOT NULL CHECK (kind IN ('check_in','check_out')),
  doctor_id text NOT NULL REFERENCES public.doctors(id),
  unit_id text NOT NULL REFERENCES public.units(id),
  recorded_at timestamptz NOT NULL,
  result text NOT NULL CHECK (result IN ('inside_perimeter','manual_approved')),
  latitude numeric,
  longitude numeric,
  accuracy_m numeric,
  distance_m numeric,
  PRIMARY KEY (shift_id, kind)
);

CREATE TABLE public.attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id text NOT NULL REFERENCES public.shifts(id),
  doctor_id text NOT NULL REFERENCES public.doctors(id),
  kind text NOT NULL CHECK (kind IN ('check_in','check_out')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note text
);
CREATE UNIQUE INDEX attendance_exceptions_pending_idx ON public.attendance_exceptions(shift_id, kind) WHERE status = 'pending';

ALTER TABLE public.unit_attendance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_exceptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_attendance_settings, public.shift_attendance, public.attendance_exceptions FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_unit_attendance(unit text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT to_jsonb(c) - 'updated_by' - 'updated_at'
  FROM public.unit_attendance_settings c JOIN public.units u ON u.id = c.unit_id
  WHERE u.id = unit AND public.nv_can_write(u.organization_id, 'units');
$$;

CREATE FUNCTION public.nv_save_unit_attendance(unit text, lat numeric, lon numeric, radius integer,
  precision_m integer, tolerance integer, manual boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.units u WHERE u.id = unit AND public.nv_can_write(u.organization_id,'units')) THEN
    RAISE EXCEPTION 'Unidade indisponível.' USING ERRCODE = '42501';
  END IF;
  IF (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND radius BETWEEN 25 AND 5000
    AND precision_m BETWEEN 5 AND 200 AND tolerance BETWEEN 0 AND 180 AND manual IS NOT NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confira as coordenadas, o raio, a precisão e a tolerância.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.unit_attendance_settings(unit_id, latitude, longitude, radius_m, max_accuracy_m, tolerance_min, allow_manual, updated_by)
  VALUES (unit, lat, lon, radius, precision_m, tolerance, manual, auth.uid())
  ON CONFLICT (unit_id) DO UPDATE SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
    radius_m = EXCLUDED.radius_m, max_accuracy_m = EXCLUDED.max_accuracy_m, tolerance_min = EXCLUDED.tolerance_min,
    allow_manual = EXCLUDED.allow_manual, updated_by = EXCLUDED.updated_by, updated_at = now();
END;
$$;

CREATE FUNCTION public.nv_presence_summary(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'configured', c.unit_id IS NOT NULL,
    'allow_manual', coalesce(c.allow_manual,false),
    'can_record', s.status = 'confirmed' AND s.type = 'onsite'
      AND public.nv_owns_doctor(s.organization_id, s.doctor_id) AND public.nv_credentialed_for_shift(s.doctor_id, s),
    'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'at', a.recorded_at, 'result', a.result)
      ORDER BY a.recorded_at), '[]'::jsonb) FROM public.shift_attendance a WHERE a.shift_id = target),
    'requests', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'status', e.status, 'review_note', e.review_note)
      ORDER BY e.created_at DESC), '[]'::jsonb) FROM public.attendance_exceptions e WHERE e.shift_id = target)
  )
  FROM public.shifts s LEFT JOIN public.unit_attendance_settings c ON c.unit_id = s.unit_id
  WHERE s.id = target AND (public.nv_owns_doctor(s.organization_id, s.doctor_id) OR public.nv_coordinator(s.organization_id));
$$;

CREATE FUNCTION public.nv_record_attendance(target text, event_kind text, lat numeric, lon numeric, precision_m numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  config public.unit_attendance_settings%ROWTYPE;
  registered_at timestamptz := clock_timestamp();
  tolerance interval;
  distance numeric;
BEGIN
  SELECT * INTO shift FROM public.shifts WHERE id = target FOR UPDATE;
  IF NOT FOUND OR NOT public.nv_owns_doctor(shift.organization_id, shift.doctor_id)
    OR NOT public.nv_credentialed_for_shift(shift.doctor_id, shift) THEN
    RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
  END IF;
  IF event_kind IS NULL OR event_kind NOT IN ('check_in','check_out') THEN
    RAISE EXCEPTION 'Tipo de registro inválido.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shift_attendance a WHERE a.shift_id = target AND a.kind = event_kind) THEN
    RAISE EXCEPTION 'Este registro de presença já foi realizado.' USING ERRCODE = '22023';
  END IF;
  IF shift.status <> 'confirmed' OR shift.type <> 'onsite' THEN
    RAISE EXCEPTION 'A presença exige um plantão presencial confirmado.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO config FROM public.unit_attendance_settings WHERE unit_id = shift.unit_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'A unidade ainda precisa configurar a geolocalização.' USING ERRCODE = '22023'; END IF;
  IF (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180 AND precision_m > 0 AND precision_m <= config.max_accuracy_m) IS NOT TRUE THEN
    RAISE EXCEPTION 'Localização inválida ou com precisão insuficiente. Tente novamente em uma área aberta.' USING ERRCODE = '22023';
  END IF;
  tolerance := make_interval(mins => config.tolerance_min);
  IF event_kind = 'check_in' AND registered_at NOT BETWEEN public.nv_shift_starts(shift) - tolerance AND public.nv_shift_ends(shift) THEN
    RAISE EXCEPTION 'O horário atual está fora da janela de check-in.' USING ERRCODE = '22023';
  END IF;
  IF event_kind = 'check_out' THEN
    IF NOT EXISTS (SELECT 1 FROM public.shift_attendance WHERE shift_id = target AND kind = 'check_in') THEN
      RAISE EXCEPTION 'Realize o check-in antes de registrar o check-out.' USING ERRCODE = '22023';
    END IF;
    IF registered_at NOT BETWEEN public.nv_shift_ends(shift) - tolerance AND public.nv_shift_ends(shift) + tolerance THEN
      RAISE EXCEPTION 'O horário atual está fora da janela de check-out.' USING ERRCODE = '22023';
    END IF;
  END IF;
  distance := 12742000 * asin(sqrt(least(1.0,
    power(sin(radians((lat - config.latitude)::double precision) / 2), 2)
    + cos(radians(config.latitude::double precision)) * cos(radians(lat::double precision))
    * power(sin(radians((lon - config.longitude)::double precision) / 2), 2))));
  IF distance > config.radius_m THEN
    RAISE EXCEPTION 'Sua localização está fora do perímetro da unidade.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shift_attendance(shift_id, kind, doctor_id, unit_id, recorded_at, result, latitude, longitude, accuracy_m, distance_m)
  VALUES (target, event_kind, shift.doctor_id, shift.unit_id, registered_at, 'inside_perimeter', round(lat,6), round(lon,6), round(precision_m,1), round(distance,1));
  UPDATE public.attendance_exceptions SET status = 'superseded', decided_at = now()
  WHERE shift_id = target AND kind = event_kind AND status = 'pending';
  IF event_kind = 'check_out' THEN UPDATE public.shifts SET status = 'completed' WHERE id = target; END IF;
END;
$$;

CREATE FUNCTION public.nv_request_attendance_exception(target text, event_kind text, explanation text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE shift public.shifts%ROWTYPE;
BEGIN
  SELECT * INTO shift FROM public.shifts WHERE id = target FOR UPDATE;
  IF NOT FOUND OR NOT public.nv_owns_doctor(shift.organization_id, shift.doctor_id)
    OR NOT public.nv_credentialed_for_shift(shift.doctor_id, shift) THEN
    RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
  END IF;
  IF shift.status <> 'confirmed' OR shift.type <> 'onsite' OR now() < public.nv_shift_starts(shift) - interval '3 hours'
    OR NOT EXISTS (SELECT 1 FROM public.unit_attendance_settings WHERE unit_id = shift.unit_id AND allow_manual)
    OR EXISTS (SELECT 1 FROM public.shift_attendance WHERE shift_id = target AND kind = event_kind) THEN
    RAISE EXCEPTION 'Registro manual indisponível para este plantão.' USING ERRCODE = '22023';
  END IF;
  explanation := btrim(explanation);
  IF event_kind IS NULL OR event_kind NOT IN ('check_in','check_out')
    OR explanation IS NULL OR length(explanation) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Informe uma justificativa de 10 a 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.attendance_exceptions(shift_id, doctor_id, kind, reason) VALUES (target, shift.doctor_id, event_kind, explanation)
  ON CONFLICT (shift_id, kind) WHERE status = 'pending' DO NOTHING;
END;
$$;

CREATE FUNCTION public.nv_attendance_queue(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', e.id, 'kind', e.kind, 'reason', e.reason, 'at', e.created_at,
      'date', s.date, 'time', s.start_time, 'unit', u.name, 'doctor', d.name) item
    FROM public.attendance_exceptions e JOIN public.shifts s ON s.id = e.shift_id
    JOIN public.units u ON u.id = s.unit_id JOIN public.doctors d ON d.id = e.doctor_id
    WHERE s.organization_id = org AND e.status = 'pending' AND public.nv_coordinator(org)
    ORDER BY e.created_at, e.id LIMIT 100
  ) queue;
$$;

CREATE FUNCTION public.nv_review_attendance(target uuid, approve boolean, note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  request public.attendance_exceptions%ROWTYPE;
BEGIN
  SELECT s.* INTO shift FROM public.shifts s JOIN public.attendance_exceptions e ON e.shift_id = s.id
  WHERE e.id = target FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.nv_coordinator(shift.organization_id) THEN
    RAISE EXCEPTION 'Solicitação indisponível.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO request FROM public.attendance_exceptions WHERE id = target;
  note := btrim(note);
  IF request.status <> 'pending' OR approve IS NULL OR note IS NULL OR length(note) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Escolha a decisão e informe uma justificativa de 10 a 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF approve THEN
    IF shift.doctor_id IS DISTINCT FROM request.doctor_id OR shift.status <> 'confirmed'
      OR NOT EXISTS (SELECT 1 FROM public.unit_attendance_settings WHERE unit_id = shift.unit_id AND allow_manual)
      OR EXISTS (SELECT 1 FROM public.shift_attendance WHERE shift_id = shift.id AND kind = request.kind)
      OR (request.kind = 'check_out' AND now() < public.nv_shift_ends(shift)) THEN
      RAISE EXCEPTION 'O plantão já foi alterado ou ainda não terminou. Confira antes de aprovar.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.shift_attendance(shift_id, kind, doctor_id, unit_id, recorded_at, result)
    VALUES (shift.id, request.kind, shift.doctor_id, shift.unit_id, now(), 'manual_approved');
  END IF;
  UPDATE public.attendance_exceptions SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    decided_at = now(), decided_by = auth.uid(), review_note = note WHERE id = target;
  IF approve AND request.kind = 'check_out' THEN UPDATE public.shifts SET status = 'completed' WHERE id = shift.id; END IF;
END;
$$;

CREATE FUNCTION public.nv_preserve_attendance_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.doctor_id, NEW.unit_id, NEW.sector_id, NEW.date, NEW.start_time, NEW.end_time, NEW.type, NEW.specialty)
    IS DISTINCT FROM (OLD.doctor_id, OLD.unit_id, OLD.sector_id, OLD.date, OLD.start_time, OLD.end_time, OLD.type, OLD.specialty) THEN
    IF EXISTS (SELECT 1 FROM public.shift_attendance WHERE shift_id = OLD.id) THEN
      RAISE EXCEPTION 'O plantão tem presença registrada e seus dados operacionais devem ser preservados.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.attendance_exceptions SET status = 'superseded', decided_at = now() WHERE shift_id = OLD.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_preserve_attendance_shift BEFORE UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_preserve_attendance_shift();

REVOKE ALL ON FUNCTION public.nv_preserve_attendance_shift() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nv_unit_attendance(text), public.nv_save_unit_attendance(text,numeric,numeric,integer,integer,integer,boolean),
  public.nv_presence_summary(text), public.nv_record_attendance(text,text,numeric,numeric,numeric),
  public.nv_request_attendance_exception(text,text,text), public.nv_attendance_queue(text), public.nv_review_attendance(uuid,boolean,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_unit_attendance(text), public.nv_save_unit_attendance(text,numeric,numeric,integer,integer,integer,boolean),
  public.nv_presence_summary(text), public.nv_record_attendance(text,text,numeric,numeric,numeric),
  public.nv_request_attendance_exception(text,text,text), public.nv_attendance_queue(text), public.nv_review_attendance(uuid,boolean,text)
  TO authenticated;

COMMIT;
