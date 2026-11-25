BEGIN;

-- The dashboard reads professional and operational fields through the existing tenant RLS.
REVOKE SELECT ON public.doctors FROM PUBLIC, anon, authenticated;
REVOKE SELECT (cpf, phone, email, address), UPDATE (cpf, phone, email, address)
  ON public.doctors FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, organization_id, name, crm, crm_uf, rqe, specialty, status,
  contract_model, contract_signed, linked_units, created_at, updated_at) ON public.doctors TO authenticated;

CREATE FUNCTION public.nv_can_read_doctor_personal(org text, doctor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_owns_doctor(org, doctor) OR public.nv_can_action(org, 'medicos', 'approve');
$$;

CREATE OR REPLACE FUNCTION public.nv_doctor_profile(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.doctors; e public.doctor_enrollments; personal boolean;
BEGIN
  SELECT * INTO d FROM public.doctors WHERE id = target;
  IF NOT FOUND OR NOT (public.nv_can_action(d.organization_id, 'medicos', 'view') OR public.nv_owns_doctor(d.organization_id, target)) THEN
    RAISE EXCEPTION 'Perfil indisponível.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.doctor_enrollments WHERE doctor_id = target;
  personal := public.nv_can_read_doctor_personal(d.organization_id, target);
  RETURN jsonb_build_object('profile', jsonb_build_object(
    'id', d.id, 'organization_id', d.organization_id, 'name', d.name, 'crm', d.crm, 'crm_uf', d.crm_uf,
    'rqe', d.rqe, 'specialty', d.specialty, 'status', d.status, 'linked_units', d.linked_units,
    'contract_model', d.contract_model, 'contract_signed', d.contract_signed, 'updated_at', d.updated_at
  ) || CASE WHEN personal THEN jsonb_build_object('cpf', d.cpf, 'phone', d.phone, 'email', d.email, 'address', d.address)
    ELSE '{}'::jsonb END,
    'can_read_personal', personal, 'specialties', coalesce(e.approved_specialties, '{}'),
    'has_enrollment', e.doctor_id IS NOT NULL, 'enrollment_status', e.status, 'requested_specialties', coalesce(e.requested_specialties, '{}'),
    'can_approve', public.nv_can_action(d.organization_id, 'medicos', 'approve'),
    'can_edit', public.nv_can_action(d.organization_id, 'medicos', 'edit') OR public.nv_owns_doctor(d.organization_id, target)
  ) || CASE WHEN personal THEN jsonb_build_object('birth_date', e.birth_date) ELSE '{}'::jsonb END;
END;
$$;

ALTER FUNCTION public.nv_update_doctor_profile(text,jsonb,timestamptz,text[],date) RENAME TO nv_update_doctor_profile_internal;
CREATE FUNCTION public.nv_update_doctor_profile(target text, profile jsonb, revision timestamptz, specialties text[] DEFAULT NULL, birth date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (profile ?| ARRAY['cpf', 'phone', 'address'] OR birth IS NOT NULL) AND NOT EXISTS (
    SELECT FROM public.doctors d WHERE d.id = target AND public.nv_can_read_doctor_personal(d.organization_id, target)
  ) THEN
    RAISE EXCEPTION 'A edição de dados pessoais exige acesso ao credenciamento.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.nv_update_doctor_profile_internal(target, profile, revision, specialties, birth);
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_doctor_access(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.doctors; a auth.users; allowed boolean;
BEGIN
  SELECT * INTO d FROM public.doctors WHERE id = target;
  IF NOT FOUND OR NOT public.nv_can_action(d.organization_id, 'medicos', 'view') THEN RAISE EXCEPTION 'Acesso indisponível.' USING ERRCODE = '42501'; END IF;
  SELECT u.* INTO a FROM public.doctor_enrollments e JOIN auth.users u ON u.id = e.auth_user_id WHERE e.doctor_id = target;
  allowed := public.nv_can_action(d.organization_id, 'portal_medico', 'edit');
  RETURN jsonb_build_object('linked', a.id IS NOT NULL,
    'status', CASE WHEN a.id IS NULL THEN 'not_released' WHEN a.banned_until > now() OR d.status = 'inactive' OR a.deleted_at IS NOT NULL THEN 'blocked'
      WHEN a.email_confirmed_at IS NULL OR a.raw_app_meta_data->>'must_change_password' = 'true' THEN 'pending' ELSE 'active' END,
    'can_manage', allowed, 'revision', d.updated_at, 'record_inactive', d.status = 'inactive', 'auth_blocked', coalesce(a.banned_until > now(), false)
  ) || CASE WHEN allowed THEN jsonb_build_object('email', coalesce(a.email, btrim(d.email), ''), 'last_sign_in_at', a.last_sign_in_at)
    ELSE '{}'::jsonb END;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_can_read_doctor_personal(text,text),
  public.nv_update_doctor_profile_internal(text,jsonb,timestamptz,text[],date), public.nv_update_doctor_profile(text,jsonb,timestamptz,text[],date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nv_update_doctor_profile(text,jsonb,timestamptz,text[],date) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
