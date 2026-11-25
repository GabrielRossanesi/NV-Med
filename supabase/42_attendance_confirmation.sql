-- Check-out geolocation is a declaration. The existing review queue records independent confirmation.
BEGIN;

ALTER TABLE public.attendance_exceptions
  ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source = 'manual' OR (source = 'gps' AND kind = 'check_out')),
  ADD COLUMN requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_exceptions ALTER COLUMN requested_by SET DEFAULT auth.uid();

ALTER TABLE public.shift_attendance DROP CONSTRAINT shift_attendance_result_check;
ALTER TABLE public.shift_attendance ADD CONSTRAINT shift_attendance_result_check
  CHECK (result IN ('inside_perimeter', 'manual_approved') OR (result = 'gps_confirmed' AND kind = 'check_out'));

CREATE OR REPLACE FUNCTION public.nv_record_attendance(target text, event_kind text, lat numeric, lon numeric, precision_m numeric)
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
  IF EXISTS (SELECT FROM public.shift_attendance a WHERE a.shift_id = target AND a.kind = event_kind) THEN
    RAISE EXCEPTION 'Este registro de presença já foi realizado.' USING ERRCODE = '22023';
  END IF;
  IF shift.status <> 'confirmed' OR shift.type <> 'onsite' THEN
    RAISE EXCEPTION 'A presença exige um plantão presencial confirmado.' USING ERRCODE = '22023';
  END IF;
  IF event_kind = 'check_out' AND EXISTS (SELECT FROM public.attendance_exceptions e
    WHERE e.shift_id = target AND e.doctor_id = shift.doctor_id AND e.kind = 'check_out' AND e.source = 'gps' AND e.status = 'pending') THEN
    RETURN;
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
    IF NOT EXISTS (SELECT FROM public.shift_attendance WHERE shift_id = target AND kind = 'check_in') THEN
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

  UPDATE public.attendance_exceptions SET status = 'superseded', decided_at = now()
  WHERE shift_id = target AND kind = event_kind AND status = 'pending';
  IF event_kind = 'check_out' THEN
    INSERT INTO public.attendance_exceptions(shift_id, doctor_id, kind, reason, source, created_at)
    VALUES (target, shift.doctor_id, event_kind, 'Localização declarada pelo médico dentro do perímetro.', 'gps', registered_at);
    RETURN;
  END IF;

  INSERT INTO public.shift_attendance(shift_id, kind, doctor_id, unit_id, recorded_at, result, latitude, longitude, accuracy_m, distance_m)
  VALUES (target, event_kind, shift.doctor_id, shift.unit_id, registered_at, 'inside_perimeter', round(lat,6), round(lon,6), round(precision_m,1), round(distance,1));
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_presence_summary(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'configured', c.unit_id IS NOT NULL,
    'allow_manual', coalesce(c.allow_manual,false),
    'can_record', s.status = 'confirmed' AND s.type = 'onsite'
      AND public.nv_owns_doctor(s.organization_id, s.doctor_id) AND public.nv_credentialed_for_shift(s.doctor_id, s),
    'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('kind', a.kind, 'at', a.recorded_at, 'result', a.result)
      ORDER BY a.recorded_at), '[]'::jsonb) FROM public.shift_attendance a WHERE a.shift_id = target),
    'requests', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'source', e.source, 'status', e.status, 'review_note', e.review_note)
      ORDER BY e.created_at DESC), '[]'::jsonb) FROM public.attendance_exceptions e WHERE e.shift_id = target)
  )
  FROM public.shifts s LEFT JOIN public.unit_attendance_settings c ON c.unit_id = s.unit_id
  WHERE s.id = target AND (public.nv_owns_doctor(s.organization_id, s.doctor_id) OR public.nv_coordinator(s.organization_id));
$$;

CREATE OR REPLACE FUNCTION public.nv_attendance_queue(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'at'), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('id', e.id, 'kind', e.kind, 'source', e.source, 'reason', e.reason, 'at', e.created_at,
      'date', CASE WHEN e.kind = 'check_out' THEN (public.nv_shift_ends(s) AT TIME ZONE 'America/Sao_Paulo')::date ELSE s.date END,
      'time', CASE WHEN e.kind = 'check_out' THEN s.end_time ELSE s.start_time END,
      'unit', u.name, 'doctor', d.name) item
    FROM public.attendance_exceptions e JOIN public.shifts s ON s.id = e.shift_id
    JOIN public.units u ON u.id = s.unit_id JOIN public.doctors d ON d.id = e.doctor_id
    WHERE s.organization_id = org AND e.status = 'pending' AND public.nv_coordinator(org)
    ORDER BY e.created_at, e.id LIMIT 100
  ) queue;
$$;

CREATE OR REPLACE FUNCTION public.nv_review_attendance(target uuid, approve boolean, note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  request public.attendance_exceptions%ROWTYPE;
  reviewer uuid := public.nv_session_actor();
BEGIN
  SELECT s.* INTO shift FROM public.shifts s JOIN public.attendance_exceptions e ON e.shift_id = s.id
  WHERE e.id = target FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.nv_coordinator(shift.organization_id) THEN
    RAISE EXCEPTION 'Solicitação indisponível.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO request FROM public.attendance_exceptions WHERE id = target;
  IF request.requested_by = reviewer OR EXISTS (SELECT FROM public.doctor_enrollments e
    WHERE e.doctor_id = request.doctor_id AND e.auth_user_id = reviewer) THEN
    RAISE EXCEPTION 'Peça a outro responsável para revisar esta presença.' USING ERRCODE = '42501';
  END IF;
  note := btrim(note);
  IF request.status <> 'pending' OR approve IS NULL OR note IS NULL OR length(note) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'Escolha a decisão e informe uma justificativa de 10 a 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF approve THEN
    IF shift.doctor_id IS DISTINCT FROM request.doctor_id OR shift.status <> 'confirmed' OR shift.type <> 'onsite'
      OR (request.source = 'manual' AND NOT EXISTS (SELECT FROM public.unit_attendance_settings WHERE unit_id = shift.unit_id AND allow_manual))
      OR EXISTS (SELECT FROM public.shift_attendance WHERE shift_id = shift.id AND kind = request.kind)
      OR (request.kind = 'check_out' AND now() < public.nv_shift_ends(shift)) THEN
      RAISE EXCEPTION 'O plantão já foi alterado ou ainda não terminou. Confira antes de aprovar.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.shift_attendance(shift_id, kind, doctor_id, unit_id, recorded_at, result)
    VALUES (shift.id, request.kind, shift.doctor_id, shift.unit_id,
      CASE WHEN request.source = 'gps' THEN request.created_at ELSE now() END,
      CASE WHEN request.source = 'gps' THEN 'gps_confirmed' ELSE 'manual_approved' END);
  END IF;
  UPDATE public.attendance_exceptions SET status = CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
    decided_at = now(), decided_by = reviewer, review_note = note WHERE id = target;
  IF approve AND request.kind = 'check_out' THEN UPDATE public.shifts SET status = 'completed' WHERE id = shift.id; END IF;
END;
$$;

CREATE FUNCTION public.nv_require_attendance_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF ((NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
      OR (public.nv_shift_has_settlement(NEW) AND NOT public.nv_shift_has_settlement(OLD)))
    AND EXISTS (SELECT FROM public.attendance_exceptions e WHERE e.shift_id = OLD.id AND e.doctor_id = OLD.doctor_id
      AND e.kind = 'check_out' AND e.source = 'gps' AND e.status IN ('pending','rejected'))
    AND NOT EXISTS (SELECT FROM public.shift_attendance a WHERE a.shift_id = OLD.id AND a.doctor_id = OLD.doctor_id
      AND a.kind = 'check_out' AND a.result IN ('gps_confirmed','manual_approved')) THEN
    RAISE EXCEPTION 'A coordenação precisa confirmar a presença antes de concluir ou liquidar este plantão.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_z_require_attendance_confirmation
  BEFORE UPDATE OF status, payment_status, paid_amount, paid_at ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.nv_require_attendance_confirmation();
REVOKE ALL ON FUNCTION public.nv_require_attendance_confirmation() FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
