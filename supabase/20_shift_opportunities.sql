-- NV Med: vacancies and exchanges share a single application and decision flow.
-- Apply after 19_doctor_portal.sql.
BEGIN;

ALTER TABLE public.sectors ADD COLUMN description text CHECK (length(description) <= 1000);

CREATE TABLE public.shift_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id text NOT NULL REFERENCES public.shifts(id),
  kind text NOT NULL CHECK (kind IN ('vacancy','exchange')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','selected','cancelled')),
  original_doctor_id text,
  selected_doctor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CHECK ((kind = 'exchange') = (original_doctor_id IS NOT NULL))
);
CREATE UNIQUE INDEX shift_opportunities_active_idx ON public.shift_opportunities(shift_id) WHERE status = 'open';

CREATE TABLE public.shift_applications (
  opportunity_id uuid REFERENCES public.shift_opportunities(id) NOT NULL,
  doctor_id text NOT NULL REFERENCES public.doctors(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','selected','not_selected','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, doctor_id)
);
CREATE INDEX shift_applications_doctor_idx ON public.shift_applications(doctor_id, created_at DESC);

CREATE TABLE public.shift_assignment_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  shift_id text NOT NULL,
  previous_doctor_id text,
  next_doctor_id text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shift_assignment_history_shift_idx ON public.shift_assignment_history(shift_id, created_at DESC);

ALTER TABLE public.shift_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_assignment_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_opportunities, public.shift_applications, public.shift_assignment_history FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_shift_starts(shift public.shifts)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (shift.date + shift.start_time::time) AT TIME ZONE 'America/Sao_Paulo';
$$;

CREATE FUNCTION public.nv_shift_ends(shift public.shifts)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (shift.date + shift.end_time::time + CASE WHEN shift.end_time < shift.start_time THEN interval '1 day' ELSE interval '0' END)
    AT TIME ZONE 'America/Sao_Paulo';
$$;

CREATE FUNCTION public.nv_credentialed_for_shift(doctor text, shift public.shifts)
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
      AND (cardinality(s.specialties) = 0 OR shift.specialty = ANY(s.specialties))
  );
$$;

CREATE FUNCTION public.nv_shift_documents_clear(doctor text, shift public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organizations o
    CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.settings->'requiredDocuments', '[]'::jsonb)) req
    WHERE o.id = shift.organization_id
      AND o.settings->'documentGovernance'->>'blockSchedulingOnCritical' = 'true'
      AND coalesce(req->>'blocking', 'true') = 'true'
      AND public.nv_required_document_applies(req, shift.specialty, ARRAY[shift.unit_id])
      AND NOT EXISTS (
        SELECT 1 FROM public.medical_documents doc
        WHERE doc.doctor_id = doctor AND doc.organization_id = o.id AND doc.type = req->>'type'
          AND doc.status = 'approved' AND doc.file_path IS NOT NULL
          AND CASE WHEN doc.expiry_date IS NULL THEN coalesce(req->>'expiryRequired','false') <> 'true'
            ELSE doc.expiry_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND doc.expiry_date >=
              (public.nv_shift_ends(shift) AT TIME ZONE 'America/Sao_Paulo')::date::text END
      )
  );
$$;

CREATE FUNCTION public.nv_portal_conflict(actor uuid, shift public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_enrollments e
    JOIN public.shifts other ON other.doctor_id = e.doctor_id AND other.organization_id = e.organization_id
    WHERE e.auth_user_id = actor AND other.id <> shift.id AND other.status <> 'cancelled'
      AND public.nv_shift_starts(other) < public.nv_shift_ends(shift)
      AND public.nv_shift_ends(other) > public.nv_shift_starts(shift)
  );
$$;

CREATE FUNCTION public.nv_validate_portal_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid;
  legacy_waiting boolean;
BEGIN
  IF NEW.doctor_id IS NULL OR NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.doctor_id, NEW.date, NEW.start_time, NEW.end_time, NEW.unit_id, NEW.sector_id, NEW.specialty)
    IS NOT DISTINCT FROM (OLD.doctor_id, OLD.date, OLD.start_time, OLD.end_time, OLD.unit_id, OLD.sector_id, OLD.specialty)
    AND OLD.status <> 'cancelled' THEN RETURN NEW; END IF;
  SELECT e.auth_user_id, e.legacy_link AND e.status <> 'approved' INTO actor, legacy_waiting
  FROM public.doctor_enrollments e WHERE e.doctor_id = NEW.doctor_id;
  IF NOT FOUND OR legacy_waiting THEN
    IF NOT public.nv_shift_documents_clear(NEW.doctor_id, NEW) THEN
      RAISE EXCEPTION 'Há pendências documentais que impedem esta atribuição.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF actor IS NULL OR NOT public.nv_credentialed_for_shift(NEW.doctor_id, NEW) OR NOT public.nv_shift_documents_clear(NEW.doctor_id, NEW) THEN
    RAISE EXCEPTION 'Médico sem credenciamento válido para esta unidade e especialidade.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-physician:' || actor::text, 0));
  IF public.nv_portal_conflict(actor, NEW) THEN
    RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_z_validate_portal_assignment BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_portal_assignment();

CREATE FUNCTION public.nv_validate_active_shift_post()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status <> 'cancelled' AND (TG_OP = 'INSERT'
    OR (NEW.sector_id, NEW.unit_id, NEW.date, NEW.start_time, NEW.end_time)
      IS DISTINCT FROM (OLD.sector_id, OLD.unit_id, OLD.date, OLD.start_time, OLD.end_time)
    OR OLD.status = 'cancelled')
    AND NOT EXISTS (
      SELECT 1 FROM public.sectors s WHERE s.id = NEW.sector_id AND s.organization_id = NEW.organization_id
        AND s.unit_id = NEW.unit_id AND s.status = 'active'
    ) THEN RAISE EXCEPTION 'Selecione um posto ativo para o plantão.' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_validate_active_shift_post BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_validate_active_shift_post();

-- Preserve the legacy rule for doctors without a portal account.
CREATE OR REPLACE FUNCTION public.nv_validate_adhoc_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.coverage_mode = 'adhoc' THEN
    NEW.coverage_reason := NULLIF(BTRIM(NEW.coverage_reason), '');
    NEW.specialty := NULLIF(BTRIM(NEW.specialty), '');
    IF NEW.coverage_reason IS NULL OR char_length(NEW.coverage_reason) NOT BETWEEN 3 AND 200 THEN
      RAISE EXCEPTION 'Informe o motivo da cobertura avulsa (3 a 200 caracteres).';
    END IF;
    IF NEW.specialty IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.sectors sector
      WHERE sector.id = NEW.sector_id AND sector.unit_id = NEW.unit_id
        AND sector.organization_id = NEW.organization_id AND NEW.specialty = ANY(sector.specialties)
    ) THEN RAISE EXCEPTION 'Selecione uma especialidade do setor para o plantão avulso.'; END IF;
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

CREATE FUNCTION public.nv_close_shift_opportunity(target uuid, chosen text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  opportunity public.shift_opportunities%ROWTYPE;
BEGIN
  UPDATE public.shift_opportunities SET status = CASE WHEN chosen IS NULL THEN 'cancelled' ELSE 'selected' END,
    selected_doctor_id = chosen, decided_at = now(), decided_by = auth.uid()
  WHERE id = target AND status = 'open' RETURNING * INTO opportunity;
  IF NOT FOUND THEN RAISE EXCEPTION 'A oportunidade já foi encerrada.' USING ERRCODE = '22023'; END IF;

  WITH decided AS (
    UPDATE public.shift_applications SET status = CASE WHEN doctor_id = chosen THEN 'selected'
      WHEN chosen IS NULL THEN 'cancelled' ELSE 'not_selected' END, updated_at = now()
    WHERE opportunity_id = target AND status = 'pending' RETURNING doctor_id, status
  )
  INSERT INTO public.portal_notifications(recipient_id, event_key, message)
  SELECT e.auth_user_id, 'decision:' || target, CASE decided.status WHEN 'selected' THEN 'Sua candidatura foi aprovada.'
    WHEN 'cancelled' THEN 'A oportunidade do plantão foi encerrada.' ELSE 'Sua candidatura ao plantão não foi selecionada.' END
  FROM decided JOIN public.doctor_enrollments e USING (doctor_id) WHERE e.auth_user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  IF chosen IS NOT NULL AND opportunity.original_doctor_id IS NOT NULL THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT auth_user_id, 'exchange:' || target, 'Sua troca foi aprovada. O novo médico assumiu o plantão.'
    FROM public.doctor_enrollments WHERE doctor_id = opportunity.original_doctor_id AND auth_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION public.nv_audit_shift_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  opportunity public.shift_opportunities%ROWTYPE;
BEGIN
  IF (NEW.doctor_id, NEW.status, NEW.date, NEW.start_time, NEW.end_time, NEW.unit_id, NEW.sector_id, NEW.specialty)
    IS DISTINCT FROM (OLD.doctor_id, OLD.status, OLD.date, OLD.start_time, OLD.end_time, OLD.unit_id, OLD.sector_id, OLD.specialty) THEN
    SELECT * INTO opportunity FROM public.shift_opportunities WHERE shift_id = OLD.id AND status = 'open';
    IF FOUND THEN
      IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
        RAISE EXCEPTION 'Use a fila de candidaturas para selecionar o responsável por este plantão.' USING ERRCODE = '22023';
      END IF;
      PERFORM public.nv_close_shift_opportunity(opportunity.id, NULL);
    END IF;
  END IF;
  IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
    INSERT INTO public.shift_assignment_history(organization_id, shift_id, previous_doctor_id, next_doctor_id, actor_id)
    VALUES (NEW.organization_id, NEW.id, OLD.doctor_id, NEW.doctor_id, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nv_audit_shift_assignment AFTER UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION public.nv_audit_shift_assignment();

CREATE FUNCTION public.nv_request_exchange(target text, cancel_request boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  opportunity uuid;
BEGIN
  SELECT * INTO shift FROM public.shifts WHERE id = target FOR UPDATE;
  IF NOT FOUND OR NOT (public.nv_owns_doctor(shift.organization_id, shift.doctor_id)
    OR (cancel_request AND public.nv_coordinator(shift.organization_id))) THEN
    RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
  END IF;
  IF cancel_request THEN
    SELECT id INTO opportunity FROM public.shift_opportunities WHERE shift_id = target AND status = 'open' AND kind = 'exchange';
    IF FOUND THEN PERFORM public.nv_close_shift_opportunity(opportunity, NULL); END IF;
    RETURN;
  END IF;
  IF shift.status <> 'confirmed' OR public.nv_shift_starts(shift) <= now() OR shift.payment_status = 'paid'
    OR NOT public.nv_credentialed_for_shift(shift.doctor_id, shift) THEN
    RAISE EXCEPTION 'Este plantão não está disponível para troca.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.shift_opportunities(shift_id, kind, original_doctor_id)
  VALUES (target, 'exchange', shift.doctor_id) ON CONFLICT (shift_id) WHERE status = 'open' DO NOTHING
  RETURNING id INTO opportunity;
  IF opportunity IS NOT NULL THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT e.auth_user_id, 'offer:' || opportunity, 'Há um plantão disponível para troca em uma das suas unidades.'
    FROM public.doctor_enrollments e WHERE e.doctor_id <> shift.doctor_id AND public.nv_credentialed_for_shift(e.doctor_id, shift)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION public.nv_apply_for_shift(target text, cancel_application boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  opportunity public.shift_opportunities%ROWTYPE;
  doctor text;
BEGIN
  SELECT * INTO shift FROM public.shifts WHERE id = target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501'; END IF;
  SELECT doctor_id INTO doctor FROM public.doctor_enrollments
  WHERE organization_id = shift.organization_id AND auth_user_id = (SELECT public.nv_session_actor());
  IF doctor IS NULL THEN RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501'; END IF;

  SELECT * INTO opportunity FROM public.shift_opportunities WHERE shift_id = target AND status = 'open';
  IF cancel_application THEN
    UPDATE public.shift_applications SET status = 'cancelled', updated_at = now()
    WHERE opportunity_id = opportunity.id AND doctor_id = doctor AND status = 'pending';
    RETURN;
  END IF;
  IF public.nv_shift_starts(shift) <= now() OR shift.payment_status = 'paid'
    OR NOT ((shift.status = 'open' AND shift.doctor_id IS NULL) OR
      (shift.status = 'confirmed' AND opportunity.kind IS NOT DISTINCT FROM 'exchange'::text AND shift.doctor_id <> doctor))
    OR NOT public.nv_credentialed_for_shift(doctor, shift)
    OR NOT public.nv_shift_documents_clear(doctor, shift) THEN
    RAISE EXCEPTION 'Seu credenciamento não permite candidatura para este plantão.' USING ERRCODE = '22023';
  END IF;
  IF public.nv_portal_conflict(auth.uid(), shift) THEN
    RAISE EXCEPTION 'Este horário coincide com outro plantão da sua agenda.' USING ERRCODE = '22023';
  END IF;
  IF opportunity.id IS NULL THEN
    INSERT INTO public.shift_opportunities(shift_id, kind) VALUES (target, 'vacancy') RETURNING * INTO opportunity;
  END IF;
  INSERT INTO public.shift_applications(opportunity_id, doctor_id)
    VALUES (opportunity.id, doctor)
    ON CONFLICT (opportunity_id, doctor_id) DO UPDATE SET status = 'pending', updated_at = now()
      WHERE public.shift_applications.status = 'cancelled';
  IF FOUND THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT u.auth_user_id, 'application:' || opportunity.id || ':' || doctor, 'Uma candidatura de plantão aguarda decisão.'
    FROM public.user_accounts u WHERE u.auth_user_id IS NOT NULL AND u.status = 'active'
      AND u.type = 'tenant_user' AND u.organization_id = shift.organization_id
      AND u.role IN ('Diretor','Gerente','Coordenador de Escalas')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

CREATE FUNCTION public.nv_select_shift_candidate(target uuid, candidate text, employment text, employer text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  opportunity public.shift_opportunities%ROWTYPE;
BEGIN
  SELECT s.* INTO shift FROM public.shifts s JOIN public.shift_opportunities o ON o.shift_id = s.id
  WHERE o.id = target FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.nv_coordinator(shift.organization_id) THEN
    RAISE EXCEPTION 'Oportunidade indisponível.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO opportunity FROM public.shift_opportunities WHERE id = target;
  IF opportunity.status <> 'open' OR public.nv_shift_starts(shift) <= now() OR shift.payment_status = 'paid'
    OR shift.doctor_id IS DISTINCT FROM opportunity.original_doctor_id
    OR shift.status <> (CASE WHEN opportunity.kind = 'vacancy' THEN 'open' ELSE 'confirmed' END)
    OR NOT EXISTS (SELECT 1 FROM public.shift_applications WHERE opportunity_id = target AND doctor_id = candidate AND status = 'pending') THEN
    RAISE EXCEPTION 'Esta candidatura já foi encerrada ou perdeu a validade.' USING ERRCODE = '22023';
  END IF;
  IF employment IS NULL OR employment NOT IN ('clt','concursado','pj')
    OR (employment = 'pj' AND coalesce(length(btrim(employer)),0) = 0) OR length(employer) > 150 THEN
    RAISE EXCEPTION 'Informe o vínculo e o empregador do médico selecionado.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.nv_close_shift_opportunity(target, candidate);
  -- The assignment trigger revalidates credentials, availability and overlap under a physician lock.
  UPDATE public.shifts SET doctor_id = candidate, status = 'confirmed', employment_type = employment,
    employer_name = nullif(btrim(employer), '') WHERE id = shift.id;
END;
$$;

CREATE FUNCTION public.nv_cancel_shift_opportunity(target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org text;
BEGIN
  SELECT s.organization_id INTO org FROM public.shifts s JOIN public.shift_opportunities op ON op.shift_id = s.id
  WHERE op.id = target FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.nv_coordinator(org) THEN
    RAISE EXCEPTION 'Oportunidade indisponível.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.nv_close_shift_opportunity(target, NULL);
END;
$$;

CREATE FUNCTION public.nv_portal_schedule(from_date date, to_date date, mine boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF from_date IS NULL OR to_date IS NULL OR to_date - from_date NOT BETWEEN 0 AND 35 THEN
    RAISE EXCEPTION 'Escolha um período mensal válido.' USING ERRCODE = '22023';
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time,
      'organization', o.name, 'unit', u.name, 'sector', s.sector, 'specialty', s.specialty,
      'status', CASE WHEN op.kind = 'exchange' THEN 'exchange' ELSE s.status END,
      'assigned_to_me', s.doctor_id IS NOT DISTINCT FROM e.doctor_id, 'notes', CASE WHEN mine THEN s.notes END,
      'application', a.status, 'upcoming', public.nv_shift_starts(s) > now()
    ) ORDER BY s.date, s.start_time, s.id), '[]'::jsonb)
    FROM public.doctor_enrollments e JOIN public.shifts s ON s.organization_id = e.organization_id
    JOIN public.organizations o ON o.id = s.organization_id
    JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
    LEFT JOIN public.shift_opportunities op ON op.shift_id = s.id AND op.status = 'open'
    LEFT JOIN public.shift_applications a ON a.opportunity_id = op.id AND a.doctor_id = e.doctor_id
    WHERE e.auth_user_id = (SELECT public.nv_session_actor()) AND s.date BETWEEN from_date AND to_date
      AND CASE WHEN mine THEN s.doctor_id = e.doctor_id AND e.status = 'approved' AND public.nv_owns_doctor(e.organization_id, e.doctor_id)
        ELSE s.status IN ('open','confirmed') AND public.nv_credentialed_for_shift(e.doctor_id, s) END
  );
END;
$$;

CREATE FUNCTION public.nv_portal_applications()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'updated_at' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('id', op.id, 'shift_id', s.id, 'date', s.date, 'start_time', s.start_time, 'end_time', s.end_time,
      'organization', o.name, 'unit', u.name, 'sector', s.sector, 'specialty', s.specialty,
      'status', CASE WHEN a.status = 'pending' AND public.nv_shift_starts(s) <= now() THEN 'not_selected' ELSE a.status END,
      'updated_at', a.updated_at) item
    FROM public.doctor_enrollments e JOIN public.shift_applications a ON a.doctor_id = e.doctor_id
    JOIN public.shift_opportunities op ON op.id = a.opportunity_id JOIN public.shifts s ON s.id = op.shift_id
    JOIN public.organizations o ON o.id = e.organization_id JOIN public.units u ON u.id = s.unit_id
    WHERE e.auth_user_id = (SELECT public.nv_session_actor()) AND public.nv_owns_doctor(e.organization_id, e.doctor_id)
    ORDER BY a.updated_at DESC LIMIT 100
  ) applications;
$$;

CREATE FUNCTION public.nv_shift_selection_queue(org text, target text DEFAULT NULL, scope text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'date', item->>'start_time'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('id', op.id, 'shift_id', s.id, 'kind', op.kind, 'date', s.date, 'start_time', s.start_time,
      'end_time', s.end_time, 'unit', u.name, 'sector', s.sector, 'specialty', s.specialty, 'original', original.name,
      'candidates', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'crm', d.crm, 'uf', d.crm_uf)
        ORDER BY a.created_at, d.id), '[]'::jsonb)
        FROM public.shift_applications a JOIN public.doctors d ON d.id = a.doctor_id WHERE a.opportunity_id = op.id AND a.status = 'pending')) item
    FROM public.shift_opportunities op JOIN public.shifts s ON s.id = op.shift_id
    JOIN public.units u ON u.id = s.unit_id LEFT JOIN public.doctors original ON original.id = op.original_doctor_id
    WHERE s.organization_id = org AND (target IS NULL OR s.id = target)
      AND op.status = 'open' AND public.nv_shift_starts(s) > now() AND public.nv_coordinator(org)
      AND (scope IS NULL OR (scope = 'exchange' AND op.kind = 'exchange') OR (scope = 'applications'
        AND EXISTS (SELECT 1 FROM public.shift_applications a WHERE a.opportunity_id = op.id AND a.status = 'pending')))
    ORDER BY s.date, s.start_time, s.id LIMIT 100
  ) queue;
$$;

CREATE FUNCTION public.nv_active_exchanges(org text)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id FROM public.shifts s JOIN public.shift_opportunities op ON op.shift_id = s.id
  WHERE s.organization_id = org AND op.status = 'open' AND op.kind = 'exchange'
    AND public.nv_shift_starts(s) > now() AND public.nv_org_access(org);
$$;

CREATE FUNCTION public.nv_shift_history(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'at', h.created_at,
    'previous', previous.name, 'next', next.name, 'actor', staff.name) ORDER BY h.created_at DESC, h.id DESC), '[]'::jsonb)
  FROM public.shift_assignment_history h LEFT JOIN public.doctors previous ON previous.id = h.previous_doctor_id
  LEFT JOIN public.doctors next ON next.id = h.next_doctor_id LEFT JOIN public.user_accounts staff ON staff.auth_user_id = h.actor_id
  WHERE h.shift_id = target AND public.nv_coordinator(h.organization_id);
$$;

REVOKE ALL ON FUNCTION public.nv_shift_starts(public.shifts), public.nv_shift_ends(public.shifts),
  public.nv_credentialed_for_shift(text,public.shifts), public.nv_shift_documents_clear(text,public.shifts),
  public.nv_portal_conflict(uuid,public.shifts), public.nv_validate_portal_assignment(),
  public.nv_validate_active_shift_post(), public.nv_close_shift_opportunity(uuid,text), public.nv_audit_shift_assignment()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.nv_request_exchange(text,boolean), public.nv_apply_for_shift(text,boolean),
  public.nv_cancel_shift_opportunity(uuid),
  public.nv_select_shift_candidate(uuid,text,text,text), public.nv_portal_schedule(date,date,boolean),
  public.nv_portal_applications(), public.nv_shift_selection_queue(text,text,text), public.nv_shift_history(text),
  public.nv_active_exchanges(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nv_request_exchange(text,boolean), public.nv_apply_for_shift(text,boolean),
  public.nv_cancel_shift_opportunity(uuid),
  public.nv_select_shift_candidate(uuid,text,text,text), public.nv_portal_schedule(date,date,boolean),
  public.nv_portal_applications(), public.nv_shift_selection_queue(text,text,text), public.nv_shift_history(text),
  public.nv_active_exchanges(text) TO authenticated;

COMMIT;
