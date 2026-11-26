-- Require a verified, still active MFA session for identity administration.
BEGIN;

CREATE FUNCTION public.nv_admin_mfa_session_valid(actor uuid, session_key uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT FROM auth.sessions s
    JOIN auth.mfa_factors f ON f.id = s.factor_id AND f.user_id = s.user_id AND f.status = 'verified'
    JOIN auth.users a ON a.id = s.user_id
    JOIN public.user_accounts u ON u.auth_user_id = a.id AND u.status = 'active'
    WHERE s.id = session_key AND s.user_id = actor AND s.aal = 'aal2'
      AND (s.not_after IS NULL OR s.not_after > now())
      AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until <= now())
      AND a.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true'
      AND (a.raw_app_meta_data->>'password_changed_at' IS NULL
        OR s.created_at >= (a.raw_app_meta_data->>'password_changed_at')::timestamptz)
  );
$$;

CREATE FUNCTION public.nv_admin_mfa_session()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE session_key uuid;
BEGIN
  IF (auth.jwt()->>'aal') IS DISTINCT FROM 'aal2' THEN RETURN NULL; END IF;
  session_key := (auth.jwt()->>'session_id')::uuid;
  IF public.nv_admin_mfa_session_valid(auth.uid(), session_key) THEN RETURN session_key; END IF;
  RETURN NULL;
END;
$$;

ALTER FUNCTION public.nv_manage_user(uuid,text,uuid,jsonb,text) RENAME TO nv_manage_user_internal;
CREATE FUNCTION public.nv_manage_user(actor_auth uuid, actor_session uuid, target text, new_auth uuid, changes jsonb, reason text DEFAULT NULL)
RETURNS public.user_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.nv_admin_mfa_session_valid(actor_auth, actor_session) THEN
    RAISE EXCEPTION 'Confirme a verificação em duas etapas em Meu perfil para continuar.' USING ERRCODE = '42501';
  END IF;
  RETURN public.nv_manage_user_internal(actor_auth, target, new_auth, changes, reason);
END;
$$;

ALTER FUNCTION public.nv_delete_organization(text) RENAME TO nv_delete_organization_internal;
CREATE FUNCTION public.nv_delete_organization(target_id text, actor_auth uuid, actor_session uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.nv_admin_mfa_session_valid(actor_auth, actor_session) OR NOT EXISTS (
    SELECT FROM public.user_accounts u WHERE u.auth_user_id = actor_auth AND u.status = 'active'
      AND u.type = 'saas_admin' AND u.role = 'CEO'
  ) THEN
    RAISE EXCEPTION 'Exclusão da empresa indisponível para esta sessão.' USING ERRCODE = '42501';
  END IF;
  RETURN public.nv_delete_organization_internal(target_id);
END;
$$;

ALTER FUNCTION public.nv_begin_doctor_access(text,text,text,timestamptz) RENAME TO nv_begin_doctor_access_internal;
CREATE FUNCTION public.nv_begin_doctor_access(target text, operation text, new_email text DEFAULT NULL, revision timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.nv_admin_mfa_session() IS NULL THEN
    RAISE EXCEPTION 'Confirme a verificação em duas etapas em Meu perfil para continuar.' USING ERRCODE = '42501';
  END IF;
  RETURN public.nv_begin_doctor_access_internal(target, operation, new_email, revision);
END;
$$;

ALTER FUNCTION public.nv_doctor_portal_role(text,text) RENAME TO nv_doctor_portal_role_internal;
CREATE FUNCTION public.nv_doctor_portal_role(target text, requested text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF requested IS NOT NULL AND public.nv_admin_mfa_session() IS NULL THEN
    RAISE EXCEPTION 'Confirme a verificação em duas etapas em Meu perfil para continuar.' USING ERRCODE = '42501';
  END IF;
  RETURN public.nv_doctor_portal_role_internal(target, requested);
END;
$$;

REVOKE ALL ON FUNCTION public.nv_admin_mfa_session_valid(uuid,uuid), public.nv_admin_mfa_session(),
  public.nv_manage_user_internal(uuid,text,uuid,jsonb,text), public.nv_manage_user(uuid,uuid,text,uuid,jsonb,text),
  public.nv_delete_organization_internal(text), public.nv_delete_organization(text,uuid,uuid),
  public.nv_begin_doctor_access_internal(text,text,text,timestamptz), public.nv_begin_doctor_access(text,text,text,timestamptz),
  public.nv_doctor_portal_role_internal(text,text), public.nv_doctor_portal_role(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nv_admin_mfa_session(), public.nv_begin_doctor_access(text,text,text,timestamptz),
  public.nv_doctor_portal_role(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nv_manage_user(uuid,uuid,text,uuid,jsonb,text),
  public.nv_delete_organization(text,uuid,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
