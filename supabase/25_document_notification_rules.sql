-- NV Med: document scope, review validation and internal notification preferences.
-- Apply after 24_financial_data_access.sql.
BEGIN;

CREATE FUNCTION public.nv_document_scope(requirement jsonb, specialties text[], units text[], uf text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(requirement) = 'object'
    AND requirement->>'type' ~ '^[a-z0-9_]{1,100}$'
    AND nullif(btrim(requirement->>'name'), '') IS NOT NULL
    AND (jsonb_array_length(coalesce(requirement->'specialties','[]')) = 0
      OR (requirement->'specialties') ?| coalesce(specialties, ARRAY[]::text[]))
    AND (jsonb_array_length(coalesce(requirement->'unitIds','[]')) = 0
      OR (requirement->'unitIds') ?| coalesce(units, ARRAY[]::text[]))
    AND (jsonb_array_length(coalesce(requirement->'states','[]')) = 0
      OR (requirement->'states') ? upper(uf));
$$;

CREATE OR REPLACE FUNCTION public.nv_sync_enrollment_documents(target text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-doctor-documents:' || target, 0));
  INSERT INTO public.medical_documents(id, organization_id, doctor_id, name, type, status)
  SELECT gen_random_uuid()::text, d.organization_id, d.id, requirement->>'name', requirement->>'type', 'not_sent'
  FROM public.doctors d
  LEFT JOIN public.doctor_enrollments e ON e.doctor_id = d.id
  JOIN public.organizations o ON o.id = d.organization_id
  CROSS JOIN LATERAL (
    SELECT DISTINCT ON (req->>'type') req requirement
    FROM jsonb_array_elements(coalesce(o.settings->'requiredDocuments','[]')) req
    WHERE public.nv_document_scope(req, ARRAY[d.specialty] || coalesce(e.requested_specialties || e.approved_specialties, ARRAY[]::text[]),
      d.linked_units, d.crm_uf)
    ORDER BY req->>'type'
  ) catalog
  WHERE d.id = target AND NOT EXISTS (
    SELECT 1 FROM public.medical_documents doc WHERE doc.doctor_id = d.id AND doc.type = requirement->>'type'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_create_required_documents()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.nv_sync_enrollment_documents(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_sync_documents_after_doctor_change
AFTER UPDATE OF specialty, linked_units, crm_uf ON public.doctors
FOR EACH ROW WHEN ((OLD.specialty, OLD.linked_units, OLD.crm_uf) IS DISTINCT FROM (NEW.specialty, NEW.linked_units, NEW.crm_uf))
EXECUTE FUNCTION public.nv_create_required_documents();

CREATE OR REPLACE FUNCTION public.nv_sync_required_documents(target_organization_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target text;
BEGIN
  FOR target IN SELECT id FROM public.doctors WHERE organization_id = target_organization_id ORDER BY id LOOP
    PERFORM public.nv_sync_enrollment_documents(target);
  END LOOP;
END;
$$;

CREATE FUNCTION public.nv_date_or_null(value text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF value IS NULL OR value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  RETURN value::date;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_shift_documents_clear(doctor text, shift public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organizations o JOIN public.doctors d ON d.organization_id = o.id AND d.id = doctor
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.settings->'requiredDocuments', '[]'::jsonb)) req
    WHERE o.id = shift.organization_id
      AND o.settings->'documentGovernance'->>'blockSchedulingOnCritical' = 'true'
      AND coalesce(req->>'required','true') = 'true' AND coalesce(req->>'blocking', 'true') = 'true'
      AND public.nv_document_scope(req, ARRAY[coalesce(shift.specialty,d.specialty)], ARRAY[shift.unit_id], d.crm_uf)
      AND NOT EXISTS (
        SELECT 1 FROM public.medical_documents doc
        WHERE doc.doctor_id = doctor AND doc.organization_id = o.id AND doc.type = req->>'type'
          AND doc.status = 'approved' AND doc.file_path IS NOT NULL
          AND CASE WHEN doc.expiry_date IS NULL THEN coalesce(req->>'expiryRequired','false') <> 'true'
            AND coalesce(req->>'annualRenewal','false') <> 'true'
            ELSE public.nv_date_or_null(doc.expiry_date) >= (public.nv_shift_ends(shift) AT TIME ZONE 'America/Sao_Paulo')::date END
      )
  );
$$;

CREATE FUNCTION public.nv_validate_document_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  requirement jsonb;
  expiry date := public.nv_date_or_null(NEW.expiry_date);
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.status, NEW.file_path, NEW.expiry_date, NEW.review_note)
    IS NOT DISTINCT FROM (OLD.status, OLD.file_path, OLD.expiry_date, OLD.review_note) THEN RETURN NEW; END IF;
  IF NEW.expiry_date IS NOT NULL AND expiry IS NULL THEN RAISE EXCEPTION 'Informe uma validade válida.' USING ERRCODE = '22023'; END IF;
  IF NEW.status = 'rejected' AND coalesce(length(btrim(NEW.review_note)),0) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação.' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'approved' THEN
    SELECT req INTO requirement FROM public.organizations o
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.settings->'requiredDocuments','[]')) req
    WHERE o.id = NEW.organization_id AND req->>'type' = NEW.type LIMIT 1;
    IF NEW.file_path IS NULL OR NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE bucket_id = 'medical-documents' AND name = NEW.file_path
    ) THEN RAISE EXCEPTION 'Envie o arquivo antes de aprovar o documento.' USING ERRCODE = '22023'; END IF;
    IF expiry < today OR (expiry IS NULL AND (requirement->>'expiryRequired' = 'true' OR requirement->>'annualRenewal' = 'true')) THEN
      RAISE EXCEPTION 'Informe a data de validade antes de aprovar o documento.' USING ERRCODE = '22023';
    END IF;
    IF requirement->>'annualRenewal' = 'true' AND extract(year FROM expiry) <> extract(year FROM today) THEN
      RAISE EXCEPTION 'Informe uma validade dentro do ano da renovação.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_validate_document_review BEFORE INSERT OR UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_document_review();

ALTER TABLE public.document_audit_logs ADD COLUMN actor_auth_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE FUNCTION public.nv_document_audit_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE physician_name text;
BEGIN
  NEW.actor_auth_id := auth.uid();
  IF NEW.actor_user_id IS NULL THEN
    SELECT d.name INTO physician_name FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
    WHERE e.doctor_id = NEW.doctor_id AND e.auth_user_id = NEW.actor_auth_id;
    NEW.actor_name := coalesce(physician_name, NEW.actor_name);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_document_audit_actor BEFORE INSERT ON public.document_audit_logs
FOR EACH ROW EXECUTE FUNCTION public.nv_document_audit_actor();

CREATE POLICY nv_docs_staff_insert ON public.medical_documents AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (public.nv_can_read_documents(organization_id) AND public.nv_can_write(organization_id,'medical_documents'));
CREATE POLICY nv_docs_staff_update ON public.medical_documents AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.nv_can_read_documents(organization_id) AND public.nv_can_write(organization_id,'medical_documents'))
WITH CHECK (public.nv_can_read_documents(organization_id) AND public.nv_can_write(organization_id,'medical_documents'));
CREATE POLICY nv_docs_staff_delete ON public.medical_documents AS RESTRICTIVE FOR DELETE TO authenticated
USING (public.nv_can_read_documents(organization_id) AND public.nv_can_write(organization_id,'medical_documents'));

CREATE FUNCTION public.nv_guard_document_storage_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('anon','authenticated') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.file_path IS NOT NULL OR NEW.file_url IS NOT NULL OR NEW.file_name IS NOT NULL
      OR NEW.upload_date IS NOT NULL OR NEW.version <> 1 THEN
      RAISE EXCEPTION 'Envie o arquivo pela rota de documentos.' USING ERRCODE = '42501';
    END IF;
  ELSIF (NEW.id, NEW.organization_id, NEW.doctor_id, NEW.file_path, NEW.file_url, NEW.file_name, NEW.upload_date, NEW.version)
    IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.doctor_id, OLD.file_path, OLD.file_url, OLD.file_name, OLD.upload_date, OLD.version) THEN
    RAISE EXCEPTION 'Envie o arquivo pela rota de documentos.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_a_document_storage_columns BEFORE INSERT OR UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_guard_document_storage_columns();
REVOKE ALL ON FUNCTION public.nv_guard_document_storage_columns() FROM PUBLIC, anon, authenticated;

-- The medical bucket is server-only, even if the target has another permissive policy.
DROP POLICY IF EXISTS nv_files_read ON storage.objects;
DROP POLICY IF EXISTS nv_files_insert ON storage.objects;
DROP POLICY IF EXISTS nv_files_delete ON storage.objects;
CREATE POLICY nv_medical_server_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
USING (bucket_id <> 'medical-documents') WITH CHECK (bucket_id <> 'medical-documents');
REVOKE ALL ON FUNCTION public.nv_document_storage_target_exists(text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_document_path_matches(org text, doctor text, path text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(org ~ '^[A-Za-z0-9_-]+$' AND doctor ~ '^[A-Za-z0-9_-]+$'
    AND split_part(path, '/', 1) = org AND split_part(path, '/', 2) = doctor
    AND path ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(pdf|jpe?g|png)$', false);
$$;

CREATE FUNCTION public.nv_portal_document_target(target text, operation text DEFAULT 'read', revision uuid DEFAULT NULL)
RETURNS TABLE(doctor_id text, organization_id text, file_path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.doctor_id, d.organization_id, candidate.path
  FROM public.medical_documents d
  JOIN public.doctors doctor ON doctor.id = d.doctor_id AND doctor.organization_id = d.organization_id
  LEFT JOIN public.document_audit_logs history ON history.id = revision
    AND history.document_id = d.id AND history.organization_id = d.organization_id AND history.doctor_id = d.doctor_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN revision IS NULL THEN d.file_path ELSE history.changes->>'previousFilePath' END AS path
  ) candidate
  WHERE d.id = target AND (
    (operation = 'write' AND revision IS NULL AND (public.nv_owns_doctor(d.organization_id, d.doctor_id) OR
      (public.nv_can_read_documents(d.organization_id) AND public.nv_can_write(d.organization_id,'medical_documents'))))
    OR
    (operation = 'read' AND (public.nv_can_read_documents(d.organization_id) OR
      (revision IS NULL AND public.nv_owns_doctor(d.organization_id, d.doctor_id)))
      AND public.nv_document_path_matches(d.organization_id, d.doctor_id, candidate.path)
      AND EXISTS (
        SELECT 1 FROM storage.objects obj JOIN storage.buckets b ON b.id = obj.bucket_id
        WHERE b.id = 'medical-documents' AND b.public = false AND obj.name = candidate.path
      ))
  );
$$;

CREATE FUNCTION public.nv_save_portal_document(actor uuid, target text, path text, filename text, previous_path text, actor_session uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET request.jwt.claims = '' SET request.jwt.claim = '' SET request.jwt.claim.sub = '' AS $$
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor, 'session_id', actor_session)::text, true);
  PERFORM set_config('request.jwt.claim.sub', actor::text, true);
  UPDATE public.medical_documents d SET file_path = path, file_name = filename, file_url = NULL,
    status = 'sent', upload_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date::text,
    expiry_date = NULL, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL
  WHERE d.id = target AND d.file_path IS NOT DISTINCT FROM previous_path
    AND public.nv_document_path_matches(d.organization_id, d.doctor_id, path)
    AND EXISTS (SELECT 1 FROM storage.objects obj JOIN storage.buckets b ON b.id = obj.bucket_id
      WHERE b.id = 'medical-documents' AND b.public = false AND obj.name = path)
    AND (public.nv_owns_doctor(d.organization_id, d.doctor_id) OR
      (public.nv_can_read_documents(d.organization_id) AND public.nv_can_write(d.organization_id,'medical_documents')));
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.nv_document_path_matches(text,text,text),
  public.nv_save_portal_document(uuid,text,text,text,text,uuid),
  public.nv_portal_document_target(text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_portal_document_target(text,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nv_save_portal_document(uuid,text,text,text,text,uuid) TO service_role;

CREATE TABLE public.document_upload_limits (
  actor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
ALTER TABLE public.document_upload_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_upload_limits FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_reserve_document_upload()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := public.nv_session_actor();
  requested_at timestamptz := statement_timestamp();
BEGIN
  IF actor IS NULL THEN RETURN false; END IF;
  INSERT INTO public.document_upload_limits AS quota(actor_id, window_started_at, attempts)
  VALUES (actor, requested_at, 1)
  ON CONFLICT (actor_id) DO UPDATE SET
    window_started_at = CASE WHEN quota.window_started_at <= requested_at - interval '10 minutes'
      THEN requested_at ELSE quota.window_started_at END,
    attempts = CASE WHEN quota.window_started_at <= requested_at - interval '10 minutes' THEN 1 ELSE quota.attempts + 1 END
  WHERE quota.window_started_at <= requested_at - interval '10 minutes' OR quota.attempts < 12;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.nv_reserve_document_upload() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_reserve_document_upload() TO authenticated;

CREATE TABLE public.portal_notification_preferences (
  recipient_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  offers boolean NOT NULL DEFAULT true,
  reminders boolean NOT NULL DEFAULT true,
  documents boolean NOT NULL DEFAULT true
);
ALTER TABLE public.portal_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_notification_preferences FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_notification_preferences()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('offers', coalesce(p.offers,true), 'reminders', coalesce(p.reminders,true), 'documents', coalesce(p.documents,true))
  FROM (SELECT public.nv_session_actor() id) actor LEFT JOIN public.portal_notification_preferences p ON p.recipient_id = actor.id
  WHERE actor.id IS NOT NULL;
$$;

CREATE FUNCTION public.nv_save_notification_preferences(offers boolean, reminders boolean, documents boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.portal_notification_preferences(recipient_id, offers, reminders, documents)
  SELECT actor, offers, reminders, documents FROM (SELECT public.nv_session_actor() actor) session
  WHERE actor IS NOT NULL
  ON CONFLICT (recipient_id) DO UPDATE SET offers = EXCLUDED.offers, reminders = EXCLUDED.reminders, documents = EXCLUDED.documents;
$$;

CREATE FUNCTION public.nv_filter_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE category text := split_part(NEW.event_key, ':', 1);
BEGIN
  IF EXISTS (SELECT 1 FROM public.portal_notification_preferences p WHERE p.recipient_id = NEW.recipient_id AND (
    (category IN ('offer','vacancy') AND NOT p.offers) OR (category = 'reminder' AND NOT p.reminders)
    OR (category IN ('document','expiry') AND NOT p.documents)
  )) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_filter_notification BEFORE INSERT ON public.portal_notifications
FOR EACH ROW EXECUTE FUNCTION public.nv_filter_notification();

CREATE FUNCTION public.nv_notify_document_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected') THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT e.auth_user_id, 'document:' || NEW.id || ':' || NEW.status || ':' || NEW.updated_at::text,
      CASE WHEN NEW.status = 'approved' THEN 'Um documento médico foi aprovado.' ELSE 'Um documento médico precisa de correção.' END
    FROM public.doctor_enrollments e JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.doctor_id = NEW.doctor_id AND e.auth_user_id IS NOT NULL
      AND o.settings->'documentGovernance'->>'internalNotifications' IS DISTINCT FROM 'false'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_notify_document_review AFTER UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_notify_document_review();

CREATE FUNCTION public.nv_notify_shift_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'open' AND NEW.specialty IS NOT NULL AND public.nv_shift_starts(NEW) > now()
    AND (TG_OP = 'INSERT' OR OLD.status <> 'open') THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT e.auth_user_id, 'vacancy:' || NEW.id || ':' || NEW.updated_at::text,
      'Uma vaga de plantão foi publicada em uma das suas unidades.'
    FROM public.doctor_enrollments e WHERE e.organization_id = NEW.organization_id AND e.status = 'approved'
      AND public.nv_credentialed_for_shift(e.doctor_id, NEW)
    ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.doctor_id, NEW.status, NEW.date, NEW.start_time, NEW.end_time, NEW.unit_id, NEW.sector_id)
    IS DISTINCT FROM (OLD.doctor_id, OLD.status, OLD.date, OLD.start_time, OLD.end_time, OLD.unit_id, OLD.sector_id)
    AND NEW.status <> 'completed'
    AND NOT EXISTS (SELECT 1 FROM public.shift_opportunities op WHERE op.shift_id = NEW.id AND op.status = 'selected' AND op.decided_at = now()) THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT DISTINCT e.auth_user_id, 'shift:' || NEW.id || ':' || NEW.updated_at::text, 'Um plantão na sua escala foi alterado.'
    FROM public.doctor_enrollments e WHERE e.auth_user_id IS NOT NULL AND e.doctor_id IN (OLD.doctor_id, NEW.doctor_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_notify_shift_change AFTER INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_notify_shift_change();

CREATE FUNCTION public.nv_refresh_portal_notices(actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  INSERT INTO public.portal_notifications(recipient_id, event_key, message)
  SELECT actor, 'reminder:' || s.id || ':' || s.date || ':' || s.start_time, 'Você tem um plantão confirmado nas próximas 24 horas.'
  FROM public.doctor_enrollments e JOIN public.shifts s ON s.doctor_id = e.doctor_id AND s.organization_id = e.organization_id
  WHERE e.auth_user_id = actor AND e.status = 'approved' AND s.status = 'confirmed' AND s.date BETWEEN today AND today + 1
    AND public.nv_shift_starts(s) BETWEEN now() AND now() + interval '24 hours'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.portal_notifications(recipient_id, event_key, message)
  SELECT actor, 'expiry:' || doc.id || ':' || expiry.expiry_day || ':' || band.days, 'Um documento médico está próximo do vencimento.'
  FROM public.doctor_enrollments e JOIN public.medical_documents doc ON doc.doctor_id = e.doctor_id AND doc.organization_id = e.organization_id
  JOIN public.organizations o ON o.id = e.organization_id
  CROSS JOIN LATERAL (SELECT public.nv_date_or_null(doc.expiry_date) AS expiry_day) expiry
  CROSS JOIN LATERAL (
    SELECT min(value::integer) days
    FROM jsonb_array_elements_text(coalesce(o.settings->'documentGovernance'->'expiryAlertDays','[90,60,30,7]')) value
    WHERE CASE WHEN value ~ '^[0-9]{1,3}$' THEN value::integer BETWEEN expiry.expiry_day - today AND 365 ELSE false END
  ) band
  WHERE e.auth_user_id = actor AND e.status <> 'rejected' AND doc.status = 'approved'
    AND o.settings->'documentGovernance'->>'internalNotifications' IS DISTINCT FROM 'false'
    AND expiry.expiry_day >= today AND band.days IS NOT NULL
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_portal_notifications(mark_read uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := public.nv_session_actor();
BEGIN
  IF actor IS NULL THEN RETURN '[]'; END IF;
  PERFORM public.nv_refresh_portal_notices(actor);
  IF mark_read IS NOT NULL THEN
    UPDATE public.portal_notifications SET read_at = coalesce(read_at, now())
    WHERE id = mark_read AND recipient_id = actor;
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(n) - 'recipient_id' - 'event_key' ORDER BY created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.portal_notifications WHERE recipient_id = actor
      ORDER BY created_at DESC LIMIT 50) n
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nv_document_scope(jsonb,text[],text[],text), public.nv_date_or_null(text),
  public.nv_validate_document_review(), public.nv_document_audit_actor(), public.nv_filter_notification(), public.nv_notify_document_review(),
  public.nv_notify_shift_change(), public.nv_refresh_portal_notices(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nv_notification_preferences(), public.nv_save_notification_preferences(boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_notification_preferences(), public.nv_save_notification_preferences(boolean,boolean,boolean) TO authenticated;

COMMIT;
