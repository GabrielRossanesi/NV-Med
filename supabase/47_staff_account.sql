-- Staff account preferences and a minimal, private account activity feed.
BEGIN;

CREATE TABLE public.account_preferences (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'system')),
  sidebar_collapsed boolean NOT NULL DEFAULT true,
  density text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  schedule_view text NOT NULL DEFAULT 'calendar' CHECK (schedule_view IN ('calendar', 'list')),
  home_page text NOT NULL DEFAULT '' CHECK (home_page IN ('', '/dashboard', '/escala', '/documentos', '/relatorios')),
  document_alerts boolean NOT NULL DEFAULT true,
  application_alerts boolean NOT NULL DEFAULT true
);

CREATE TABLE public.account_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (event_key IN (
    'login', 'logout', 'mfa_verified', 'factor_added', 'factor_removed',
    'password_changed', 'recovery_requested', 'profile_updated', 'avatar_updated'
  )),
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
CREATE INDEX account_activity_owner_order ON public.account_activity(auth_user_id, occurred_at DESC, id DESC);

ALTER TABLE public.account_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_preferences, public.account_activity FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.account_activity_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.nv_account_actor()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT u.auth_user_id
  FROM public.user_accounts u
  JOIN auth.sessions s ON s.user_id = u.auth_user_id
    AND s.id = (auth.jwt()->>'session_id')::uuid
  WHERE u.auth_user_id = public.nv_session_actor() AND u.status = 'active'
    AND (s.not_after IS NULL OR s.not_after > now())
$fn$;

CREATE POLICY account_preferences_owner ON public.account_preferences USING (auth_user_id = (SELECT public.nv_account_actor()));
CREATE POLICY account_activity_owner ON public.account_activity FOR SELECT USING (auth_user_id = (SELECT public.nv_account_actor()));

CREATE FUNCTION public.nv_account_session_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT public.nv_account_actor() IS NOT NULL
$fn$;

CREATE FUNCTION public.nv_account_home_allowed(profile public.user_accounts, page text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT CASE page
    WHEN '' THEN true
    WHEN '/dashboard' THEN CASE profile.type
      WHEN 'saas_admin' THEN profile.role IN ('CEO','Gerente','Coordenador','Administrativo','Financeiro','Jurídico')
      WHEN 'tenant_user' THEN profile.role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista','Financeiro','Jurídico')
      ELSE false END
    ELSE public.nv_profile_action(profile.type, profile.role, profile.additional_permissions,
      CASE page WHEN '/escala' THEN 'escala' WHEN '/documentos' THEN 'documentos'
        WHEN '/relatorios' THEN 'relatorios' END, 'view')
  END IS TRUE
$fn$;

CREATE FUNCTION public.nv_account_preferences()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT jsonb_build_object('theme', p.theme, 'sidebarCollapsed', p.sidebar_collapsed,
    'density', p.density, 'scheduleView', p.schedule_view,
    'homePage', CASE WHEN public.nv_account_home_allowed(u, p.home_page)
      THEN p.home_page ELSE '' END,
    'documentAlerts', p.document_alerts, 'applicationAlerts', p.application_alerts)
  FROM public.account_preferences p JOIN public.user_accounts u USING (auth_user_id)
  WHERE p.auth_user_id = public.nv_account_actor()
$fn$;

-- Match the staff recipients of nv_apply_for_shift and their effective approval permission.
CREATE FUNCTION public.nv_staff_application_alert_allowed(profile public.user_accounts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
  SELECT profile.type = 'tenant_user' AND profile.role IN ('Diretor','Gerente','Coordenador de Escalas')
    AND public.nv_profile_action(profile.type, profile.role, profile.additional_permissions, 'escala', 'edit')
    AND public.nv_profile_action(profile.type, profile.role, profile.additional_permissions, 'escala', 'approve')
$fn$;

CREATE FUNCTION public.nv_save_account_preferences(changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  actor uuid := public.nv_account_actor();
  profile public.user_accounts;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(changes) IS DISTINCT FROM 'object' OR changes = '{}'::jsonb OR EXISTS (
    SELECT FROM jsonb_each(changes) e(key, value)
    WHERE CASE WHEN key IN ('sidebarCollapsed', 'documentAlerts', 'applicationAlerts') THEN jsonb_typeof(value) <> 'boolean'
      WHEN key IN ('theme', 'density', 'scheduleView', 'homePage') THEN jsonb_typeof(value) <> 'string'
      ELSE true END
  ) THEN RAISE EXCEPTION 'Preferências inválidas.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO STRICT profile FROM public.user_accounts WHERE auth_user_id = actor AND status = 'active';
  IF changes ? 'homePage' AND NOT public.nv_account_home_allowed(profile, changes->>'homePage') THEN
    RAISE EXCEPTION 'Página inicial indisponível.' USING ERRCODE = '42501';
  END IF;
  IF (changes ? 'documentAlerts' AND NOT public.nv_profile_action(
        profile.type, profile.role, profile.additional_permissions, 'documentos', 'view'))
     OR (changes ? 'scheduleView' AND NOT public.nv_profile_action(
        profile.type, profile.role, profile.additional_permissions, 'escala', 'view'))
     OR (changes ? 'applicationAlerts' AND NOT public.nv_staff_application_alert_allowed(profile)) THEN
    RAISE EXCEPTION 'Preferência indisponível para esta conta.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.account_preferences (auth_user_id) VALUES (actor) ON CONFLICT DO NOTHING;
  UPDATE public.account_preferences p SET
    theme = coalesce(changes->>'theme', p.theme),
    sidebar_collapsed = coalesce((changes->>'sidebarCollapsed')::boolean, p.sidebar_collapsed),
    density = coalesce(changes->>'density', p.density),
    schedule_view = coalesce(changes->>'scheduleView', p.schedule_view),
    home_page = coalesce(changes->>'homePage', p.home_page),
    document_alerts = coalesce((changes->>'documentAlerts')::boolean, p.document_alerts),
    application_alerts = coalesce((changes->>'applicationAlerts')::boolean, p.application_alerts)
  WHERE p.auth_user_id = actor;

  RETURN public.nv_account_preferences();
END;
$fn$;

CREATE FUNCTION public.nv_filter_staff_application_notice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT FROM public.user_accounts u
    LEFT JOIN public.account_preferences p USING (auth_user_id)
    WHERE u.auth_user_id = NEW.recipient_id AND u.status = 'active'
      AND public.nv_staff_application_alert_allowed(u) AND coalesce(p.application_alerts, true)
  ) THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER nv_filter_staff_application_notice BEFORE INSERT ON public.portal_notifications
  FOR EACH ROW WHEN (split_part(NEW.event_key, ':', 1) = 'application')
  EXECUTE FUNCTION public.nv_filter_staff_application_notice();

-- Signed AMR timestamps survive token refresh without extending the confirmation window.
CREATE FUNCTION public.nv_account_security_ready(requires_mfa boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT CASE WHEN a.actor IS NULL THEN false
    WHEN requires_mfa OR EXISTS (SELECT FROM auth.mfa_factors f
      WHERE f.user_id = a.actor AND f.status = 'verified' AND f.factor_type::text <> 'recovery_code')
    THEN public.nv_admin_mfa_session() IS NOT NULL AND EXISTS (
      SELECT FROM jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) entry
      WHERE entry->>'method' = 'totp' AND jsonb_typeof(entry->'timestamp') = 'number'
        AND (entry->>'timestamp')::numeric BETWEEN extract(epoch FROM (now() - interval '10 minutes'))
          AND extract(epoch FROM now())
    )
    ELSE EXISTS (
      SELECT FROM jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) entry
      WHERE entry->>'method' = 'password' AND jsonb_typeof(entry->'timestamp') = 'number'
        AND (entry->>'timestamp')::numeric BETWEEN extract(epoch FROM (now() - interval '10 minutes'))
          AND extract(epoch FROM now())
    )
  END
  FROM (SELECT public.nv_account_actor() actor) a
$fn$;

CREATE FUNCTION public.nv_account_sessions()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'current', s.current_session, 'createdAt', s.created_at, 'key', s.position,
    'browser', CASE
      WHEN s.user_agent ~* '(Edg|Edge|EdgA|EdgiOS)/' THEN 'Edge'
      WHEN s.user_agent ~* '(OPR|Opera)/' THEN 'Opera'
      WHEN s.user_agent ~* 'SamsungBrowser/' THEN 'Samsung Internet'
      WHEN s.user_agent ~* '(Firefox|FxiOS)/' THEN 'Firefox'
      WHEN s.user_agent ~* '(Chrome|CriOS)/' THEN 'Chrome'
      WHEN s.user_agent ~* 'Version/.*Safari/' THEN 'Safari' END,
    'system', CASE
      WHEN s.user_agent ~* 'Android' THEN 'Android'
      WHEN s.user_agent ~* '(iPhone|iPad|iPod)' THEN 'iOS / iPadOS'
      WHEN s.user_agent ~* 'Windows' THEN 'Windows'
      WHEN s.user_agent ~* 'CrOS' THEN 'ChromeOS'
      WHEN s.user_agent ~* '(Mac OS|Macintosh)' THEN 'macOS'
      WHEN s.user_agent ~* 'Linux' THEN 'Linux' END
  ) ORDER BY s.position), '[]'::jsonb)
  FROM (
    SELECT sess.created_at, sess.user_agent,
      sess.id = (auth.jwt()->>'session_id')::uuid AS current_session,
      row_number() OVER (ORDER BY (sess.id = (auth.jwt()->>'session_id')::uuid) DESC,
        sess.created_at DESC, sess.id) AS position
    FROM auth.sessions sess WHERE sess.user_id = public.nv_account_actor()
      AND (sess.not_after IS NULL OR sess.not_after > now())
    ORDER BY position LIMIT 21
  ) s
$fn$;

-- Keep the prior NV Med policy of requiring a replacement once staff enroll a TOTP.
-- The Auth service also invokes this trigger on direct factor deletion.
CREATE FUNCTION public.nv_account_preserve_totp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF OLD.status = 'verified' AND OLD.factor_type = 'totp' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(OLD.user_id::text, 4701));
    IF EXISTS (
      SELECT FROM public.user_accounts u JOIN auth.users a ON a.id = u.auth_user_id
      WHERE u.auth_user_id = OLD.user_id AND u.status = 'active' AND a.deleted_at IS NULL
    ) AND NOT EXISTS (
      SELECT FROM auth.mfa_factors f WHERE f.user_id = OLD.user_id AND f.id <> OLD.id
        AND f.status = 'verified' AND f.factor_type = 'totp'
    ) THEN
      RAISE EXCEPTION 'Cadastre outro autenticador antes de remover o último.' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.account_activity(auth_user_id, event_key)
      SELECT u.auth_user_id, 'factor_removed' FROM public.user_accounts u JOIN auth.users a ON a.id = u.auth_user_id
      WHERE u.auth_user_id = OLD.user_id AND a.deleted_at IS NULL;
  END IF;
  RETURN OLD;
END;
$fn$;

CREATE TRIGGER nv_account_preserve_totp BEFORE DELETE ON auth.mfa_factors
  FOR EACH ROW EXECUTE FUNCTION public.nv_account_preserve_totp();

CREATE FUNCTION public.nv_account_factor_added()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  INSERT INTO public.account_activity(auth_user_id, event_key)
    SELECT auth_user_id, 'factor_added' FROM public.user_accounts WHERE auth_user_id = NEW.user_id;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER nv_account_factor_added AFTER UPDATE OF status ON auth.mfa_factors
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'verified')
  EXECUTE FUNCTION public.nv_account_factor_added();

CREATE FUNCTION public.nv_account_profile_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.auth_user_id IS NULL OR OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id THEN RETURN NEW; END IF;
  IF OLD.name IS DISTINCT FROM NEW.name OR OLD.phone IS DISTINCT FROM NEW.phone THEN
    INSERT INTO public.account_activity(auth_user_id, event_key) VALUES (NEW.auth_user_id, 'profile_updated');
  END IF;
  IF coalesce(OLD.avatar,'') <> coalesce(NEW.avatar,'') THEN
    INSERT INTO public.account_activity(auth_user_id, event_key) VALUES (NEW.auth_user_id, 'avatar_updated');
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER nv_account_profile_activity AFTER UPDATE OF name, phone, avatar ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.nv_account_profile_activity();

-- Copy only allowlisted, committed Auth events. No actor names, addresses or payloads.
CREATE FUNCTION public.nv_account_auth_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE
  event text := CASE NEW.payload->>'action'
    WHEN 'login' THEN 'login' WHEN 'logout' THEN 'logout'
    WHEN 'verification_attempted' THEN 'mfa_verified'
    WHEN 'user_updated_password' THEN 'password_changed'
    WHEN 'user_recovery_requested' THEN 'recovery_requested' END;
  actor text := NEW.payload->>'actor_id';
BEGIN
  IF event IS NOT NULL AND actor ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    INSERT INTO public.account_activity(auth_user_id, event_key, occurred_at)
      SELECT u.auth_user_id, event, coalesce(NEW.created_at, statement_timestamp())
      FROM public.user_accounts u WHERE u.auth_user_id = actor::uuid;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER nv_account_auth_activity AFTER INSERT ON auth.audit_log_entries
  FOR EACH ROW WHEN ((NEW.payload->>'action') IN (
    'login', 'logout', 'verification_attempted', 'user_updated_password', 'user_recovery_requested'))
  EXECUTE FUNCTION public.nv_account_auth_activity();

CREATE FUNCTION public.nv_account_activity(before_id bigint DEFAULT NULL)
RETURNS TABLE (id text, event_key text, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH owner AS (SELECT public.nv_account_actor() AS id),
  cursor_at AS (
    SELECT a.occurred_at FROM public.account_activity a, owner
    WHERE a.id = before_id AND a.auth_user_id = owner.id
  )
  SELECT a.id::text, a.event_key, a.occurred_at FROM public.account_activity a, owner
  WHERE a.auth_user_id = owner.id AND a.occurred_at >= now() - interval '90 days'
    AND (before_id IS NULL OR (a.occurred_at, a.id) < ((SELECT occurred_at FROM cursor_at), before_id))
  ORDER BY a.occurred_at DESC, a.id DESC LIMIT 21
$fn$;

REVOKE ALL ON FUNCTION public.nv_account_actor(), public.nv_account_preferences(), public.nv_account_session_ready(),
  public.nv_account_home_allowed(public.user_accounts,text),
  public.nv_staff_application_alert_allowed(public.user_accounts), public.nv_filter_staff_application_notice(),
  public.nv_save_account_preferences(jsonb), public.nv_account_security_ready(boolean), public.nv_account_sessions(),
  public.nv_account_preserve_totp(), public.nv_account_factor_added(), public.nv_account_profile_activity(),
  public.nv_account_auth_activity(), public.nv_account_activity(bigint) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.nv_account_preferences(), public.nv_save_account_preferences(jsonb), public.nv_account_session_ready(),
  public.nv_account_security_ready(boolean), public.nv_account_sessions(), public.nv_account_activity(bigint) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
