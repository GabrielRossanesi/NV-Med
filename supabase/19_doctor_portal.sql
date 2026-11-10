-- NV Med: physician enrollment and isolation from staff data access.
-- Apply after 18_ad_hoc_shifts.sql.
BEGIN;

CREATE TABLE public.doctor_enrollments (
  doctor_id text PRIMARY KEY,
  organization_id text NOT NULL,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  birth_date date NOT NULL,
  pix_key text NOT NULL,
  submitted_name text NOT NULL,
  submitted_phone text NOT NULL,
  legacy_link boolean NOT NULL DEFAULT false,
  requested_specialties text[] NOT NULL,
  approved_specialties text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','correction_requested')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (doctor_id, organization_id) REFERENCES public.doctors(id, organization_id),
  UNIQUE (organization_id, auth_user_id)
);

CREATE INDEX doctor_enrollments_auth_idx ON public.doctor_enrollments(auth_user_id);
CREATE INDEX doctor_enrollments_queue_idx ON public.doctor_enrollments(organization_id, status, created_at);

CREATE TABLE public.doctor_enrollment_decisions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  doctor_id text NOT NULL REFERENCES public.doctor_enrollments(doctor_id),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('approved','rejected','correction_requested')),
  note text,
  specialties text[] NOT NULL,
  unit_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (recipient_id, event_key)
);

ALTER TABLE public.doctor_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_enrollment_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_enrollments, public.doctor_enrollment_decisions, public.portal_notifications FROM PUBLIC, anon, authenticated;

-- Use live Auth metadata so a JWT issued before a forced reset cannot bypass it.
CREATE FUNCTION public.nv_auth_session_started()
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.created_at FROM auth.sessions s
  WHERE s.id = (SELECT (auth.jwt()->>'session_id')::uuid) AND s.user_id = (SELECT auth.uid());
$$;
REVOKE ALL ON FUNCTION public.nv_auth_session_started() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_session_actor()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.id FROM auth.users a WHERE a.id = (SELECT auth.uid())
    AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until <= now())
    AND a.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true'
    AND (a.raw_app_meta_data->>'password_changed_at' IS NULL
      OR public.nv_auth_session_started() >= (a.raw_app_meta_data->>'password_changed_at')::timestamptz)
    AND NOT EXISTS (SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = a.id AND u.status <> 'active');
$$;
REVOKE ALL ON FUNCTION public.nv_session_actor() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_session_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_session_actor() IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.nv_session_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_session_ready() TO authenticated;

-- A pre-reset JWT cannot complete a required password change on the user's behalf.
CREATE FUNCTION public.nv_password_change_allowed()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users a WHERE a.id = (SELECT auth.uid())
      AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until <= now())
      AND NOT EXISTS (SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = a.id AND u.status <> 'active')
      AND public.nv_auth_session_started() >= greatest(now() - interval '15 minutes',
        (a.raw_app_meta_data->>'password_changed_at')::timestamptz,
        CASE WHEN a.raw_app_meta_data->>'must_change_password' = 'true'
          THEN coalesce((a.raw_app_meta_data->>'temporary_password_set_at')::timestamptz, a.updated_at) END)
  );
$$;
REVOKE ALL ON FUNCTION public.nv_password_change_allowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_password_change_allowed() TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_accounts WHERE auth_user_id = (SELECT public.nv_session_actor()) AND status='active' AND type='saas_admin');
$$;
CREATE OR REPLACE FUNCTION public.nv_org_access(org text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id=(SELECT public.nv_session_actor()) AND u.status='active' AND (u.type='saas_admin' OR u.organization_id=org));
$$;
CREATE OR REPLACE FUNCTION public.nv_can_write(org text, resource text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT public.nv_session_actor())
      AND u.status = 'active'
      AND (
        (u.type = 'saas_admin' AND (
          u.role IN ('CEO','Gerente') OR
          (u.role IN ('Coordenador','Administrativo') AND resource IN ('doctors','units','sectors','shifts')) OR
          (u.role IN ('Coordenador','Jurídico') AND resource = 'medical_documents')
        ))
        OR
        (u.type = 'tenant_user' AND u.organization_id = org AND (
          u.role = 'Diretor' OR
          (u.role IN ('Gerente','Coordenador de Escalas','Escalista') AND resource IN ('doctors','units','sectors','shifts')) OR
          (u.role IN ('Gerente','Coordenador de Escalas','Jurídico') AND resource = 'medical_documents') OR
          u.additional_permissions ->> CASE resource
            WHEN 'doctors' THEN 'medicos'
            WHEN 'units' THEN 'unidades'
            WHEN 'sectors' THEN 'unidades'
            WHEN 'shifts' THEN 'escala'
            WHEN 'medical_documents' THEN 'documentos'
            WHEN 'organizations' THEN 'configuracoes'
            ELSE resource
          END = 'edit'
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.nv_can_write(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_can_write(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_can_finance(org text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT public.nv_session_actor())
      AND u.status = 'active'
      AND (
        (u.type = 'saas_admin' AND u.role IN ('CEO','Gerente','Financeiro'))
        OR
        (u.type = 'tenant_user' AND u.organization_id = org AND (
          u.role IN ('Diretor','Gerente','Financeiro')
          OR u.additional_permissions ->> 'financeiro' = 'edit'
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.nv_can_finance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_can_finance(text) TO authenticated;

-- Restrictive policies compose with every permissive policy on these resources.
DO $$ DECLARE relation text; BEGIN
  FOREACH relation IN ARRAY ARRAY['organizations','user_accounts','doctors','units','sectors','shifts',
    'medical_documents','document_audit_logs'] LOOP
    EXECUTE format('CREATE POLICY nv_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.nv_session_ready())) WITH CHECK ((SELECT public.nv_session_ready()))', relation);
  END LOOP;
END $$;
CREATE POLICY nv_avatar_session ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (CASE WHEN bucket_id = 'profile-avatars' THEN (SELECT public.nv_session_ready()) ELSE true END)
WITH CHECK (CASE WHEN bucket_id = 'profile-avatars' THEN (SELECT public.nv_session_ready()) ELSE true END);

CREATE FUNCTION public.nv_coordinator(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT public.nv_session_actor()) AND u.status = 'active'
      AND ((u.type = 'saas_admin' AND u.role IN ('CEO','Gerente','Coordenador'))
        OR (u.type = 'tenant_user' AND u.organization_id = org
          AND u.role IN ('Diretor','Gerente','Coordenador de Escalas')))
  );
$$;

CREATE FUNCTION public.nv_can_read_documents(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_coordinator(org) OR EXISTS (
    SELECT 1 FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT public.nv_session_actor()) AND u.status = 'active'
      AND ((u.type = 'saas_admin' AND u.role = 'Jurídico')
        OR (u.type = 'tenant_user' AND u.organization_id = org AND (
          u.role = 'Jurídico' OR u.additional_permissions->>'documentos' IN ('view','edit'))))
  );
$$;

CREATE FUNCTION public.nv_owns_doctor(org text, doctor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_enrollments e
    JOIN public.doctors d ON d.id = e.doctor_id AND d.organization_id = e.organization_id
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.organization_id = org AND e.doctor_id = doctor
      AND d.status <> 'inactive' AND o.status = 'active'
      AND e.auth_user_id = (SELECT public.nv_session_actor()) AND e.status <> 'rejected'
      AND (NOT e.legacy_link OR e.status = 'approved')
  );
$$;

-- The portal receives only selected fields from its own medical folder.
DROP POLICY nv_read ON public.medical_documents;
CREATE POLICY nv_read ON public.medical_documents FOR SELECT TO authenticated
USING (public.nv_can_read_documents(organization_id));

DROP POLICY nv_read ON public.document_audit_logs;
CREATE POLICY nv_read ON public.document_audit_logs FOR SELECT TO authenticated
USING (public.nv_can_read_documents(organization_id));
CREATE POLICY nv_docs_staff_read ON public.medical_documents AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (public.nv_can_read_documents(organization_id));
CREATE POLICY nv_document_audit_staff_read ON public.document_audit_logs AS RESTRICTIVE FOR SELECT TO anon, authenticated
USING (public.nv_can_read_documents(organization_id));

DROP POLICY nv_files_read ON storage.objects;
CREATE POLICY nv_files_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'medical-documents' AND public.nv_can_read_documents((storage.foldername(name))[1]));

CREATE FUNCTION public.nv_valid_cpf(value text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  total integer;
  check_digit integer;
  digit_count integer;
BEGIN
  IF value IS NULL OR value !~ '^[0-9]{11}$' OR value ~ '^([0-9])\1{10}$' THEN RETURN false; END IF;
  FOR digit_count IN 9..10 LOOP
    SELECT sum(substring(value FROM n FOR 1)::integer * (digit_count + 2 - n))
      INTO total FROM generate_series(1, digit_count) n;
    check_digit := (total * 10) % 11;
    IF (check_digit % 10) <> substring(value FROM digit_count + 1 FOR 1)::integer THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION public.nv_enrollment_catalog(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('name', o.name, 'specialties', coalesce(o.settings->'specialties', '[]'::jsonb))
  FROM public.organizations o WHERE o.id = org AND o.status = 'active' AND (SELECT public.nv_session_actor()) IS NOT NULL;
$$;

CREATE FUNCTION public.nv_sync_enrollment_documents(target text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.medical_documents(id, organization_id, doctor_id, name, type, status)
  SELECT gen_random_uuid()::text, d.organization_id, d.id, requirement->>'name', requirement->>'type', 'not_sent'
  FROM public.doctors d
  JOIN public.doctor_enrollments e ON e.doctor_id = d.id
  JOIN public.organizations o ON o.id = d.organization_id
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.settings->'requiredDocuments', '[]'::jsonb)) requirement
  WHERE d.id = target AND EXISTS (
    SELECT 1 FROM unnest(e.requested_specialties || e.approved_specialties) specialty
    WHERE public.nv_required_document_applies(requirement, specialty, d.linked_units)
  ) AND NOT EXISTS (
    SELECT 1 FROM public.medical_documents doc WHERE doc.doctor_id = d.id AND doc.type = requirement->>'type'
  );
$$;

CREATE FUNCTION public.nv_submit_enrollment(
  org text, full_name text, registration text, uf text, tax_id text, birth date, phone_number text,
  pix text, specialties text[]
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := public.nv_session_actor();
  verified_email text;
  catalog jsonb;
  existing public.doctor_enrollments%ROWTYPE;
  target text;
  legacy_match text;
BEGIN
  SELECT lower(email) INTO verified_email FROM auth.users WHERE id = actor AND email_confirmed_at IS NOT NULL;
  IF verified_email IS NULL OR EXISTS (SELECT 1 FROM public.user_accounts WHERE auth_user_id = actor) THEN
    RAISE EXCEPTION 'Use uma conta médica com e-mail confirmado.' USING ERRCODE = '42501';
  END IF;
  SELECT settings->'specialties' INTO catalog FROM public.organizations WHERE id = org AND status = 'active';
  IF catalog IS NULL THEN RAISE EXCEPTION 'Empresa indisponível.' USING ERRCODE = '22023'; END IF;
  full_name := btrim(full_name);
  registration := ltrim(btrim(registration), '0');
  uf := upper(btrim(uf));
  pix := btrim(pix);
  IF full_name IS NULL OR length(full_name) NOT BETWEEN 3 AND 150 OR full_name !~ '[^[:space:]]+[[:space:]]+[^[:space:]]+'
    OR registration IS NULL OR registration !~ '^[0-9]{1,12}$'
    OR uf IS NULL OR uf NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
    OR NOT public.nv_valid_cpf(tax_id)
    OR birth IS NULL OR birth > current_date - interval '18 years' OR birth < current_date - interval '120 years'
    OR phone_number IS NULL OR phone_number !~ '^[0-9]{10,13}$'
    OR pix IS NULL OR length(pix) NOT BETWEEN 5 AND 140 OR pix ~ '[[:cntrl:]]'
    OR coalesce(cardinality(specialties), 0) NOT BETWEEN 1 AND 10
    OR cardinality(specialties) <> (SELECT count(DISTINCT s) FROM unnest(specialties) s)
    OR EXISTS (SELECT 1 FROM unnest(specialties) s WHERE NOT (catalog ? s)) THEN
    RAISE EXCEPTION 'Confira os dados cadastrais e as especialidades.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('nv-enrollment:' || org, 0));
  SELECT * INTO existing FROM public.doctor_enrollments WHERE organization_id = org AND auth_user_id = actor FOR UPDATE;
  IF FOUND AND existing.status <> 'correction_requested' THEN
    RAISE EXCEPTION 'Já existe um cadastro para esta conta na empresa.' USING ERRCODE = '23505';
  END IF;
  SELECT d.id INTO legacy_match FROM public.doctors d
  WHERE d.organization_id = org AND lower(btrim(d.email)) = verified_email
    AND regexp_replace(d.cpf, '[^0-9]', '', 'g') = tax_id AND upper(btrim(d.crm_uf)) = uf
    AND ltrim(regexp_replace(d.crm, '[^0-9]', '', 'g'), '0') = registration
    AND (d.id = existing.doctor_id OR NOT EXISTS (SELECT 1 FROM public.doctor_enrollments e WHERE e.doctor_id = d.id))
  ORDER BY d.id LIMIT 1;
  IF existing.legacy_link AND legacy_match IS DISTINCT FROM existing.doctor_id THEN
    RAISE EXCEPTION 'O CRM, o CPF e o e-mail devem corresponder ao cadastro já mantido pela empresa.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.doctors d WHERE d.organization_id = org AND d.id IS DISTINCT FROM coalesce(existing.doctor_id, legacy_match) AND (
      lower(btrim(d.email)) = verified_email
      OR regexp_replace(d.cpf, '[^0-9]', '', 'g') = tax_id
      OR (upper(btrim(d.crm_uf)) = uf AND ltrim(regexp_replace(d.crm, '[^0-9]', '', 'g'), '0') = registration)
    )
  ) THEN RAISE EXCEPTION 'Já existe um cadastro com estes dados. Procure a coordenação.' USING ERRCODE = '23505'; END IF;

  IF existing.doctor_id IS NULL THEN
    target := coalesce(legacy_match, gen_random_uuid()::text);
    IF legacy_match IS NULL THEN
      INSERT INTO public.doctors(id, organization_id, name, crm, crm_uf, cpf, email, phone, specialty, status)
      VALUES (target, org, full_name, registration, uf, tax_id, verified_email, phone_number, specialties[1], 'pending');
    END IF;
    INSERT INTO public.doctor_enrollments(doctor_id, organization_id, auth_user_id, birth_date, pix_key, requested_specialties,
      submitted_name, submitted_phone, legacy_link)
    VALUES (target, org, actor, birth, pix, specialties, full_name, phone_number, legacy_match IS NOT NULL);
  ELSE
    target := existing.doctor_id;
    IF NOT existing.legacy_link THEN
      UPDATE public.doctors SET name = full_name, crm = registration, crm_uf = uf, cpf = tax_id, phone = phone_number,
        email = verified_email, specialty = specialties[1], status = 'pending' WHERE id = target;
    END IF;
    UPDATE public.doctor_enrollments SET birth_date = birth, pix_key = pix, requested_specialties = specialties,
      submitted_name = full_name, submitted_phone = phone_number,
      status = 'pending', review_note = NULL, reviewed_at = NULL WHERE doctor_id = target;
  END IF;
  PERFORM public.nv_sync_enrollment_documents(target);
END;
$$;

CREATE FUNCTION public.nv_review_enrollment(target text, decision text, note text, specialties text[], units text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  enrollment public.doctor_enrollments%ROWTYPE;
  decision_id bigint;
BEGIN
  SELECT * INTO enrollment FROM public.doctor_enrollments WHERE doctor_id = target FOR UPDATE;
  IF NOT FOUND OR NOT public.nv_coordinator(enrollment.organization_id) THEN
    RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE = '42501';
  END IF;
  IF enrollment.status <> 'pending' OR decision IS NULL OR decision NOT IN ('approved','rejected','correction_requested') THEN
    RAISE EXCEPTION 'Este cadastro não aguarda decisão.' USING ERRCODE = '22023';
  END IF;
  note := nullif(btrim(note), '');
  IF length(note) > 1000 OR (decision <> 'approved' AND note IS NULL) THEN
    RAISE EXCEPTION 'Informe uma justificativa de até 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF decision = 'approved' THEN
    IF enrollment.auth_user_id IS NULL OR coalesce(cardinality(specialties), 0) = 0
      OR array_position(specialties, NULL) IS NOT NULL OR NOT (specialties <@ enrollment.requested_specialties)
      OR coalesce(cardinality(units), 0) = 0 OR EXISTS (
        SELECT 1 FROM unnest(units) unit_id WHERE NOT EXISTS (
          SELECT 1 FROM public.units u WHERE u.id = unit_id AND u.organization_id = enrollment.organization_id AND u.status = 'active'
        )
      ) THEN RAISE EXCEPTION 'Selecione especialidades solicitadas e unidades ativas da empresa.' USING ERRCODE = '22023'; END IF;
    UPDATE public.doctors SET name = enrollment.submitted_name, phone = enrollment.submitted_phone,
      specialty = specialties[1], linked_units = units, status = 'active' WHERE id = target;
  ELSE
    specialties := '{}';
    units := '{}';
    IF NOT enrollment.legacy_link THEN
      UPDATE public.doctors SET status = CASE WHEN decision = 'rejected' THEN 'inactive' ELSE 'pending' END WHERE id = target;
    END IF;
  END IF;
  UPDATE public.doctor_enrollments SET status = decision, review_note = note, reviewed_at = now(),
    approved_specialties = specialties WHERE doctor_id = target;
  PERFORM public.nv_sync_enrollment_documents(target);
  INSERT INTO public.doctor_enrollment_decisions(doctor_id, actor_id, status, note, specialties, unit_ids)
    VALUES (target, public.nv_session_actor(), decision, note, specialties, units) RETURNING id INTO decision_id;
  IF enrollment.auth_user_id IS NOT NULL THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    VALUES (enrollment.auth_user_id, 'enrollment:' || decision_id,
      CASE decision WHEN 'approved' THEN 'Seu cadastro médico foi aprovado.'
        WHEN 'rejected' THEN 'Seu cadastro médico foi rejeitado.' ELSE 'A coordenação solicitou correções no seu cadastro.' END);
  END IF;
END;
$$;

CREATE FUNCTION public.nv_enrollment_queue(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'created_at'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('id', d.id, 'name', e.submitted_name, 'crm', d.crm, 'uf', d.crm_uf, 'email', d.email,
      'cpf', d.cpf, 'phone', e.submitted_phone, 'birth_date', e.birth_date, 'legacy_link', e.legacy_link, 'units', d.linked_units,
      'specialties', e.requested_specialties, 'created_at', e.created_at) item
    FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
    WHERE e.organization_id = org AND e.status = 'pending' AND public.nv_coordinator(org)
    ORDER BY e.created_at, d.id LIMIT 100
  ) queue;
$$;

CREATE FUNCTION public.nv_pending_enrollments(org text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) FROM public.doctor_enrollments WHERE organization_id = org AND status = 'pending' AND public.nv_coordinator(org);
$$;

CREATE FUNCTION public.nv_portal_enrollments()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('doctor_id', d.id, 'organization_id', o.id, 'organization', o.name,
    'name', e.submitted_name, 'crm', d.crm, 'uf', d.crm_uf, 'cpf', d.cpf, 'phone', e.submitted_phone, 'birth_date', e.birth_date,
    'status', e.status, 'review_note', e.review_note, 'legacy_link', e.legacy_link, 'specialties', e.requested_specialties) ORDER BY o.name), '[]'::jsonb)
  FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.auth_user_id = (SELECT public.nv_session_actor()) AND o.status = 'active';
$$;

CREATE FUNCTION public.nv_portal_documents(target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org text;
BEGIN
  SELECT organization_id INTO org FROM public.doctor_enrollments
    WHERE doctor_id = target AND public.nv_owns_doctor(organization_id, doctor_id);
  IF org IS NULL THEN RAISE EXCEPTION 'Pasta indisponível.' USING ERRCODE = '42501'; END IF;
  PERFORM public.nv_sync_enrollment_documents(target);
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name,
      'status', CASE WHEN status = 'approved' AND expiry_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND expiry_date < ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text THEN 'expired' ELSE status END,
      'upload_date', upload_date,
      'expiry_date', expiry_date, 'has_file', file_path IS NOT NULL, 'review_note', review_note) ORDER BY name), '[]'::jsonb)
    FROM public.medical_documents WHERE doctor_id = target AND organization_id = org
  );
END;
$$;

CREATE FUNCTION public.nv_portal_notifications(mark_read uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF mark_read IS NOT NULL THEN
    UPDATE public.portal_notifications SET read_at = coalesce(read_at, now())
    WHERE id = mark_read AND recipient_id = (SELECT public.nv_session_actor());
  END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(to_jsonb(n) - 'recipient_id' - 'event_key' ORDER BY created_at DESC), '[]'::jsonb)
    FROM (SELECT * FROM public.portal_notifications WHERE recipient_id = (SELECT public.nv_session_actor())
      ORDER BY created_at DESC LIMIT 50) n
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nv_valid_cpf(text), public.nv_sync_enrollment_documents(text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.nv_coordinator(text), public.nv_can_read_documents(text),
  public.nv_owns_doctor(text,text), public.nv_enrollment_catalog(text),
  public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[]),
  public.nv_review_enrollment(text,text,text,text[],text[]), public.nv_enrollment_queue(text),
  public.nv_pending_enrollments(text), public.nv_portal_enrollments(), public.nv_portal_documents(text),
  public.nv_portal_notifications(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.nv_coordinator(text), public.nv_can_read_documents(text),
  public.nv_enrollment_catalog(text), public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[]),
  public.nv_review_enrollment(text,text,text,text[],text[]), public.nv_enrollment_queue(text),
  public.nv_pending_enrollments(text), public.nv_portal_enrollments(), public.nv_portal_documents(text),
  public.nv_portal_notifications(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.nv_owns_doctor(text,text) FROM authenticated;

COMMIT;
