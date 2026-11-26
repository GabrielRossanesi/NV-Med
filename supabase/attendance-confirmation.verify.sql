-- Disposable database only. Local attendance declarations and decisions are rolled back.
BEGIN;

INSERT INTO public.user_accounts(id, auth_user_id, name, email, type, organization_id, role, status)
VALUES ('nv-legacy-doctor-reviewer', '32000000-0000-4000-8000-000000000002', 'Médico e coordenador', 'bank-doctor@example.invalid',
  'tenant_user', 'nv-bank-org', 'Coordenador de Escalas', 'active');

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$ DECLARE local_now timestamp := now() AT TIME ZONE 'America/Sao_Paulo'; BEGIN
  PERFORM public.nv_save_unit_attendance('nv-bank-unit', -23.55, -46.63, 150, 75, 60, false);
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(jsonb_build_object(
    'id', 'nv-gps-review', 'organization_id', 'nv-bank-org', 'unit_id', 'nv-bank-unit', 'sector_id', 'nv-bank-sector',
    'doctor_id', 'nv-bank-doctor', 'date', (local_now - interval '1 hour')::date,
    'start_time', to_char(local_now - interval '1 hour', 'HH24:MI'), 'end_time', to_char(local_now - interval '5 minutes', 'HH24:MI'),
    'type', 'onsite', 'status', 'confirmed', 'specialty', 'Cirurgia', 'employment_type', 'pj', 'employer_name', 'Empresa sintética',
    'agreement', jsonb_build_object('mode', 'manual', 'frequency', 'on_delivery', 'amount_cents', 50000))));
  INSERT INTO public.shift_attendance(shift_id, kind, doctor_id, unit_id, recorded_at, result)
  VALUES ('nv-gps-review', 'check_in', 'nv-bank-doctor', 'nv-bank-unit', now() - interval '1 hour', 'inside_perimeter');
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.nv_record_attendance('nv-gps-review', 'check_out', -23.55, -46.63, 12);
SELECT public.nv_record_attendance('nv-gps-review', 'check_out', -23.55, -46.63, 12);
DO $$ DECLARE summary jsonb := public.nv_presence_summary('nv-gps-review'); BEGIN
  IF jsonb_array_length(summary->'events') <> 1 OR jsonb_array_length(summary->'requests') <> 1
    OR summary->'requests'->0->>'source' <> 'gps' OR summary->'requests'->0->>'status' <> 'pending'
    OR (SELECT status FROM public.shifts WHERE id = 'nv-gps-review') <> 'confirmed' THEN
    RAISE EXCEPTION 'FAIL: declared GPS closed a shift or duplicated its pending review';
  END IF;
  BEGIN
    PERFORM public.nv_review_attendance((summary->'requests'->0->>'id')::uuid, true, 'Conferência da presença pela unidade.');
    RAISE EXCEPTION 'FAIL: requester was allowed to review own attendance';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$ BEGIN
  BEGIN
    UPDATE public.shifts SET status = 'completed' WHERE id = 'nv-gps-review';
    RAISE EXCEPTION 'FAIL: a generic update completed pending attendance';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'A coordenação precisa%' THEN RAISE; END IF;
  END;
END $$;

SET LOCAL ROLE authenticated;
DO $$ DECLARE request jsonb := public.nv_attendance_queue('nv-bank-org')->0; BEGIN
  BEGIN
    PERFORM public.nv_save_shift_payment('nv-gps-review', 500, 'on_delivery', 'paid', 500, current_date, NULL);
    RAISE EXCEPTION 'FAIL: settlement accepted pending attendance';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'A coordenação precisa%' THEN RAISE; END IF;
  END;
  IF request->>'source' IS DISTINCT FROM 'gps' OR request ? 'latitude' OR request ? 'longitude' THEN
    RAISE EXCEPTION 'FAIL: queue does not identify source or exposes raw coordinates';
  END IF;
  PERFORM public.nv_review_attendance((request->>'id')::uuid, false, 'Registro da unidade ainda indisponível.');
  BEGIN
    PERFORM public.nv_save_shift_payment('nv-gps-review', 500, 'on_delivery', 'paid', 500, current_date, NULL);
    RAISE EXCEPTION 'FAIL: settlement accepted a rejected declaration';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'A coordenação precisa%' THEN RAISE; END IF;
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.nv_record_attendance('nv-gps-review', 'check_out', -23.55, -46.63, 12);
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
DO $$ BEGIN
  IF public.nv_attendance_queue('nv-bank-org') <> '[]'::jsonb THEN RAISE EXCEPTION 'FAIL: another tenant sees the presence queue'; END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$ DECLARE request uuid := (public.nv_attendance_queue('nv-bank-org')->0->>'id')::uuid; BEGIN
  PERFORM public.nv_review_attendance(request, true, 'Presença conferida com a supervisão da unidade.');
  IF (SELECT status FROM public.shifts WHERE id = 'nv-gps-review') <> 'completed'
    OR public.nv_presence_summary('nv-gps-review')->'events'->1->>'result' IS DISTINCT FROM 'gps_confirmed' THEN
    RAISE EXCEPTION 'FAIL: independent confirmation did not complete a shift';
  END IF;
  IF (public.nv_save_shift_payment('nv-gps-review', 500, 'on_delivery', 'paid', 500, current_date, NULL)).payment_status <> 'paid' THEN
    RAISE EXCEPTION 'FAIL: approved attendance blocked settlement';
  END IF;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.attendance_exceptions e JOIN public.shift_attendance a ON a.shift_id = e.shift_id AND a.kind = e.kind
    WHERE e.shift_id = 'nv-gps-review' AND e.source = 'gps' AND e.status = 'approved'
      AND e.requested_by = '32000000-0000-4000-8000-000000000002' AND e.decided_by = '32000000-0000-4000-8000-000000000001'
      AND e.review_note IS NOT NULL AND e.created_at = a.recorded_at AND a.latitude IS NULL AND a.longitude IS NULL) THEN
    RAISE EXCEPTION 'FAIL: confirmation audit provenance';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT public.nv_save_unit_attendance('nv-bank-unit', -23.55, -46.63, 150, 75, 60, true);
SELECT public.nv_save_operational_shifts(jsonb_build_array(jsonb_build_object(
  'id', 'nv-manual-review', 'organization_id', 'nv-bank-org', 'unit_id', 'nv-bank-unit', 'sector_id', 'nv-bank-sector',
  'doctor_id', 'nv-bank-doctor', 'date', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1,
  'start_time', '10:00', 'end_time', '12:00', 'type', 'onsite', 'status', 'confirmed', 'specialty', 'Cirurgia',
  'employment_type', 'clt', 'employer_name', 'Empresa sintética')));
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.nv_request_attendance_exception('nv-manual-review', 'check_out', 'GPS indisponível no local.');
SELECT set_config('request.jwt.claims', '{"sub":"32000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
DO $$ DECLARE request jsonb := public.nv_attendance_queue('nv-bank-org')->0; BEGIN
  IF request->>'source' IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'FAIL: manual request lost its origin'; END IF;
  PERFORM public.nv_review_attendance((request->>'id')::uuid, true, 'Presença confirmada no livro da unidade.');
  IF public.nv_presence_summary('nv-manual-review')->'events'->0->>'result' IS DISTINCT FROM 'manual_approved' THEN
    RAISE EXCEPTION 'FAIL: manual review regression';
  END IF;
END $$;

ROLLBACK;
