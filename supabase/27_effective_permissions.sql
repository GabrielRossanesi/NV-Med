-- NV Med: effective user permissions, delegated administration and audited access.
-- Apply after 26_shift_payment_agreements.sql.
BEGIN;

CREATE FUNCTION public.nv_permission_actions()
RETURNS TABLE(module text, action text) LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT m.module, a.action FROM (VALUES
    ('medicos', ARRAY['view','create','edit','delete','approve']),
    ('unidades', ARRAY['view','create','edit','delete']),
    ('documentos', ARRAY['view','edit','approve']),
    ('escala', ARRAY['view','create','edit','delete','approve']),
    ('financeiro', ARRAY['view','edit']),
    ('relatorios', ARRAY['view']),
    ('configuracoes', ARRAY['view','edit']),
    ('usuarios', ARRAY['view','create','edit','deactivate'])
  ) m(module, actions) CROSS JOIN LATERAL unnest(m.actions) a(action);
$$;

CREATE OR REPLACE FUNCTION public.nv_valid_additional_permissions(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(value) p(key, decision) WHERE NOT (
      (p.key IN ('medicos','unidades','documentos','escala','financeiro','relatorios','configuracoes')
        AND p.decision IN ('view','edit'))
      OR (p.decision IN ('allow','deny') AND EXISTS (SELECT 1 FROM public.nv_permission_actions() a WHERE a.module || '.' || a.action = p.key))
    ) IS TRUE
  ) ELSE false END;
$$;

ALTER TABLE public.user_accounts
  ADD COLUMN permission_locks text[] NOT NULL DEFAULT '{}',
  ADD COLUMN delegated_permissions text[] NOT NULL DEFAULT '{}';

-- Existing individual grants belong to the SaaS administrator who configured them.
UPDATE public.user_accounts u SET permission_locks = ARRAY(SELECT jsonb_object_keys(u.additional_permissions))
WHERE u.type = 'tenant_user' AND u.additional_permissions <> '{}'::jsonb;

COMMENT ON COLUMN public.user_accounts.additional_permissions IS
  'Legacy module grants and individual module.action allow/deny overrides. Explicit view denial blocks every action in the module.';

CREATE FUNCTION public.nv_role_action(account_type text, account_role text, module text, action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(CASE
    WHEN action = 'view' AND account_type = 'saas_admin' THEN CASE module
      WHEN 'medicos' THEN account_role IN ('CEO','Gerente','Coordenador','Administrativo')
      WHEN 'unidades' THEN account_role IN ('CEO','Gerente','Coordenador','Administrativo')
      WHEN 'documentos' THEN account_role IN ('CEO','Gerente','Coordenador','Jurídico')
      WHEN 'escala' THEN account_role IN ('CEO','Gerente','Coordenador')
      WHEN 'financeiro' THEN account_role IN ('CEO','Gerente','Financeiro')
      WHEN 'relatorios' THEN account_role IN ('CEO','Gerente','Coordenador','Financeiro')
      WHEN 'configuracoes' THEN account_role IN ('CEO','Gerente')
      WHEN 'usuarios' THEN account_role IN ('CEO','Gerente','Coordenador','Administrativo')
      ELSE false END
    WHEN action = 'view' THEN CASE module
      WHEN 'medicos' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista','Jurídico')
      WHEN 'unidades' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista')
      WHEN 'documentos' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Jurídico')
      WHEN 'escala' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista','Financeiro')
      WHEN 'financeiro' THEN account_role IN ('Diretor','Gerente','Financeiro')
      WHEN 'relatorios' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista','Financeiro','Jurídico')
      WHEN 'configuracoes' THEN account_role = 'Diretor'
      WHEN 'usuarios' THEN account_role IN ('Diretor','Gerente')
      ELSE false END
    WHEN module = 'usuarios' THEN (CASE WHEN account_type = 'saas_admin'
      THEN account_role IN ('CEO','Gerente') ELSE account_role IN ('Diretor','Gerente') END)
    WHEN account_type = 'saas_admin' THEN
      account_role IN ('CEO','Gerente')
      OR (module = 'financeiro' AND account_role = 'Financeiro')
      OR (module = 'documentos' AND account_role IN ('Coordenador','Jurídico'))
      OR (action = 'approve' AND account_role = 'Coordenador')
      OR (action <> 'approve' AND module IN ('medicos','unidades','escala') AND account_role IN ('Coordenador','Administrativo'))
    WHEN module = 'financeiro' THEN account_role IN ('Diretor','Gerente','Financeiro')
    WHEN module = 'configuracoes' THEN account_role = 'Diretor'
    WHEN module = 'documentos' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Jurídico')
    WHEN action = 'approve' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas')
    ELSE account_role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista')
  END, false);
$$;

CREATE FUNCTION public.nv_profile_action(account_type text, account_role text, exceptions jsonb, module text, action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT EXISTS(SELECT 1 FROM public.nv_permission_actions() a WHERE a.module = nv_profile_action.module AND a.action = nv_profile_action.action)
  AND (module <> 'usuarios' OR action = 'view' OR public.nv_role_action(account_type, account_role, module, action))
  AND CASE WHEN account_type = 'saas_admin' THEN public.nv_role_action(account_type, account_role, module, action)
    AND public.nv_role_action(account_type, account_role, module, 'view')
  ELSE coalesce(exceptions->>(module || '.view') <> 'deny', true)
    AND (exceptions->>(module || '.view') = 'allow' OR public.nv_role_action(account_type, account_role, module, 'view')
      OR coalesce(exceptions->>module IN ('view','edit'), false))
    AND CASE WHEN action = 'view' THEN true ELSE coalesce(
      CASE exceptions->>(module || '.' || action) WHEN 'allow' THEN true WHEN 'deny' THEN false END,
      public.nv_role_action(account_type, account_role, module, action)
        OR (coalesce(exceptions->>module = 'edit', false) AND
          (action = 'edit' OR (action IN ('create','delete') AND module IN ('medicos','unidades','escala'))))
    ) END
  END IS TRUE;
$$;

CREATE FUNCTION public.nv_can_action(org text, module text, action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = (SELECT public.nv_session_actor())
    AND u.status = 'active' AND (u.type = 'saas_admin' OR u.organization_id = org)
    AND public.nv_profile_action(u.type,u.role,u.additional_permissions,module,action));
$$;

CREATE OR REPLACE FUNCTION public.nv_can_write(org text, resource text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_action(org, CASE resource WHEN 'doctors' THEN 'medicos'
    WHEN 'units' THEN 'unidades' WHEN 'sectors' THEN 'unidades' WHEN 'shifts' THEN 'escala'
    WHEN 'medical_documents' THEN 'documentos' WHEN 'organizations' THEN 'configuracoes' ELSE resource END, 'edit');
$$;

CREATE OR REPLACE FUNCTION public.nv_can_finance(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_action(org, 'financeiro', 'edit');
$$;
CREATE OR REPLACE FUNCTION public.nv_can_read_finance(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_action(org, 'financeiro', 'view');
$$;
CREATE OR REPLACE FUNCTION public.nv_can_report(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_action(org, 'relatorios', 'view');
$$;
CREATE OR REPLACE FUNCTION public.nv_coordinator(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_action(org, 'escala', 'approve');
$$;
CREATE OR REPLACE FUNCTION public.nv_can_read_documents(org text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_can_action(org, 'documentos', 'view');
$$;

CREATE TABLE public.user_permission_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_id text NOT NULL,
  actor_id text,
  actor_name text,
  organization_id text,
  previous jsonb,
  next jsonb NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_permission_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_permission_audit FROM PUBLIC, anon, authenticated;
CREATE INDEX user_permission_audit_target_idx ON public.user_permission_audit(target_id,id DESC);

CREATE FUNCTION public.nv_user_access_snapshot(profile public.user_accounts)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('type', profile.type, 'role', profile.role, 'status', profile.status,
    'permissions', profile.additional_permissions, 'locks', profile.permission_locks, 'delegations', profile.delegated_permissions);
$$;

CREATE FUNCTION public.nv_guard_last_user_manager()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.type = 'tenant_user' AND OLD.status = 'active' AND OLD.auth_user_id IS NOT NULL
    AND OLD.role IN ('Diretor','Gerente') AND public.nv_profile_action(OLD.type,OLD.role,OLD.additional_permissions,'usuarios','edit') THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.type = OLD.type AND NEW.organization_id = OLD.organization_id AND NEW.status = 'active' AND NEW.auth_user_id IS NOT NULL
        AND NEW.role IN ('Diretor','Gerente') AND public.nv_profile_action(NEW.type,NEW.role,NEW.additional_permissions,'usuarios','edit') THEN RETURN NEW; END IF;
    END IF;
    PERFORM 1 FROM public.organizations WHERE id = OLD.organization_id FOR UPDATE;
    IF FOUND AND NOT EXISTS (SELECT 1 FROM public.user_accounts u WHERE u.organization_id = OLD.organization_id AND u.id <> OLD.id
      AND u.type = 'tenant_user' AND u.role IN ('Diretor','Gerente') AND u.status = 'active' AND u.auth_user_id IS NOT NULL
      AND public.nv_profile_action(u.type,u.role,u.additional_permissions,'usuarios','edit')) THEN
      RAISE EXCEPTION 'Mantenha outro diretor ou gerente ativo antes de remover este acesso.' USING ERRCODE = 'PT409';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_guard_last_user_manager BEFORE UPDATE OF type, organization_id, status, role, auth_user_id, additional_permissions OR DELETE
ON public.user_accounts FOR EACH ROW EXECUTE FUNCTION public.nv_guard_last_user_manager();

DROP POLICY nv_profile_read ON public.user_accounts;
CREATE POLICY nv_profile_read ON public.user_accounts FOR SELECT TO authenticated USING (
  auth_user_id = (SELECT auth.uid()) OR public.nv_can_action(organization_id,'usuarios','view')
);

CREATE FUNCTION public.nv_manage_user(actor_auth uuid, target text, new_auth uuid, changes jsonb, reason text DEFAULT NULL)
RETURNS public.user_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor public.user_accounts;
  previous public.user_accounts;
  next_profile public.user_accounts;
  entry record;
  permission_key text;
  modifying boolean := target IS NOT NULL;
  saas boolean;
  next_org text := nullif(changes->>'organization_id','');
  next_type text := changes->>'type';
  next_role text := changes->>'role';
  next_status text := changes->>'status';
  exceptions jsonb := coalesce(changes->'additional_permissions','{}'::jsonb);
  delegation text[];
  locks text[];
  before_state jsonb;
  after_state jsonb;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = next_org FOR UPDATE;
  IF next_type = 'tenant_user' AND NOT FOUND THEN RAISE EXCEPTION 'Selecione uma empresa válida.' USING ERRCODE = '22023'; END IF;
  SELECT u.* INTO actor FROM public.user_accounts u JOIN auth.users a ON a.id = u.auth_user_id
  WHERE u.auth_user_id = actor_auth AND u.status = 'active' AND a.deleted_at IS NULL
    AND (a.banned_until IS NULL OR a.banned_until <= now())
    AND a.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true' FOR UPDATE OF u;
  IF NOT FOUND OR NOT public.nv_profile_action(actor.type,actor.role,actor.additional_permissions,'usuarios',CASE WHEN modifying THEN 'edit' ELSE 'create' END) THEN
    RAISE EXCEPTION 'Acesso indisponível para esta operação.' USING ERRCODE = '42501';
  END IF;
  saas := actor.type = 'saas_admin';
  IF (next_type NOT IN ('tenant_user','saas_admin') OR next_status NOT IN ('active','pending','inactive')
    OR (next_type = 'saas_admin' AND next_role NOT IN ('CEO','Gerente','Coordenador','Administrativo','Financeiro','Jurídico'))
    OR (next_type = 'tenant_user' AND next_role NOT IN ('Diretor','Gerente','Coordenador de Escalas','Escalista','Financeiro','Jurídico'))) IS NOT FALSE
    OR NOT public.nv_valid_additional_permissions(exceptions)
    OR length(btrim(coalesce(changes->>'name',''))) NOT BETWEEN 1 AND 150 OR length(coalesce(changes->>'email','')) > 254
    OR coalesce(changes->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(reason) > 500 THEN
    RAISE EXCEPTION 'Confira os dados e as permissões do acesso.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nv_permission_actions() a WHERE a.action <> 'view'
    AND exceptions->>(a.module || '.' || a.action) = 'allow'
    AND (NOT public.nv_profile_action(next_type,next_role,exceptions,a.module,'view')
      OR (a.module = 'usuarios' AND NOT public.nv_role_action(next_type,next_role,a.module,a.action)))) THEN
    RAISE EXCEPTION 'Permita visualizar o módulo antes de conceder outras ações nele.' USING ERRCODE = '22023';
  END IF;
  IF (saas AND next_type = 'saas_admin' AND actor.role <> 'CEO')
    OR (NOT saas AND (actor.role NOT IN ('Diretor','Gerente') OR next_type <> 'tenant_user' OR actor.organization_id IS DISTINCT FROM next_org
      OR next_role = 'Diretor' OR (next_role = 'Gerente' AND (actor.role <> 'Diretor' OR NOT modifying)))) THEN
    RAISE EXCEPTION 'Este perfil está fora do seu escopo.' USING ERRCODE = '42501';
  END IF;
  IF modifying THEN
    SELECT * INTO previous FROM public.user_accounts WHERE id = target FOR UPDATE;
    IF NOT FOUND OR target = actor.id OR previous.type <> next_type OR previous.organization_id IS DISTINCT FROM next_org
      OR (NOT saas AND (previous.role = 'Diretor' OR (previous.role = 'Gerente' AND actor.role <> 'Diretor')
        OR (next_role = 'Gerente' AND previous.role <> 'Gerente'))) THEN
      RAISE EXCEPTION 'Este perfil está fora do seu escopo.' USING ERRCODE = '42501';
    END IF;
    IF previous.email IS DISTINCT FROM changes->>'email' THEN
      RAISE EXCEPTION 'A troca do e-mail de acesso exige atualização no Supabase Auth.' USING ERRCODE = '22023';
    END IF;
    IF (changes->>'revision')::timestamptz IS DISTINCT FROM previous.updated_at THEN
      RAISE EXCEPTION 'O acesso mudou. Atualize a página e reabra a ficha.' USING ERRCODE = 'PT409';
    END IF;
    IF previous.status IS DISTINCT FROM next_status AND NOT public.nv_profile_action(actor.type,actor.role,actor.additional_permissions,'usuarios','deactivate') THEN
      RAISE EXCEPTION 'Seu acesso não permite alterar a situação do usuário.' USING ERRCODE = '42501';
    END IF;
    before_state := public.nv_user_access_snapshot(previous);
  END IF;

  IF NOT saas THEN
    locks := coalesce(previous.permission_locks,'{}');
    delegation := coalesce(previous.delegated_permissions,'{}');
    FOR entry IN SELECT * FROM public.nv_permission_actions() LOOP
      permission_key := entry.module || '.' || entry.action;
      IF (exceptions->permission_key IS DISTINCT FROM previous.additional_permissions->permission_key)
        OR (public.nv_profile_action(next_type,next_role,exceptions,entry.module,entry.action)
          AND NOT public.nv_profile_action(previous.type,previous.role,previous.additional_permissions,entry.module,entry.action)) THEN
        IF entry.module = 'usuarios' OR permission_key = ANY(locks) OR entry.module = ANY(locks) OR NOT permission_key = ANY(actor.delegated_permissions)
          OR NOT public.nv_profile_action(actor.type,actor.role,actor.additional_permissions,entry.module,entry.action) THEN
          RAISE EXCEPTION 'A ação % não pode ser delegada por este acesso.', permission_key USING ERRCODE = '42501';
        END IF;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(exceptions || coalesce(previous.additional_permissions,'{}')) key
      WHERE key NOT LIKE '%.%' AND exceptions->key IS DISTINCT FROM previous.additional_permissions->key) THEN
      RAISE EXCEPTION 'Concessões anteriores só podem ser alteradas pelo administrador SaaS.' USING ERRCODE = '42501';
    END IF;
  ELSE
    locks := ARRAY(SELECT key FROM jsonb_object_keys(exceptions) key
      WHERE NOT modifying OR key = ANY(previous.permission_locks) OR exceptions->key IS DISTINCT FROM previous.additional_permissions->key
      ORDER BY key);
    delegation := ARRAY(SELECT DISTINCT item FROM jsonb_array_elements_text(coalesce(changes->'delegated_permissions','[]')) item ORDER BY item);
    IF (cardinality(delegation) > 0 AND (next_type <> 'tenant_user' OR next_role NOT IN ('Diretor','Gerente')))
      OR EXISTS (SELECT 1 FROM unnest(delegation) k WHERE NOT EXISTS (SELECT 1 FROM public.nv_permission_actions() a
        WHERE a.module <> 'usuarios' AND a.module || '.' || a.action = k)) THEN
      RAISE EXCEPTION 'Confira as ações que podem ser delegadas.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- A null Auth identifier is a side-effect-free check before creating credentials.
  IF NOT modifying AND new_auth IS NULL THEN RETURN NULL; END IF;
  IF modifying THEN
    UPDATE public.user_accounts u SET name = btrim(changes->>'name'), phone = changes->>'phone', role = next_role,
      status = next_status, additional_permissions = exceptions, permission_locks = locks, delegated_permissions = delegation
      WHERE u.id = target RETURNING * INTO next_profile;
  ELSE
    INSERT INTO public.user_accounts(id, auth_user_id, name, email, phone, type, organization_id, role, status,
      additional_permissions, permission_locks, delegated_permissions)
    VALUES(gen_random_uuid()::text,new_auth,btrim(changes->>'name'),changes->>'email',changes->>'phone',next_type,next_org,next_role,next_status,
      exceptions,locks,delegation) RETURNING * INTO next_profile;
  END IF;
  after_state := public.nv_user_access_snapshot(next_profile);
  IF before_state IS DISTINCT FROM after_state THEN
    INSERT INTO public.user_permission_audit(target_id,actor_id,actor_name,organization_id,previous,next,reason)
      VALUES(next_profile.id,actor.id,actor.name,next_profile.organization_id,before_state,after_state,nullif(btrim(reason),''));
  END IF;
  RETURN next_profile;
END;
$$;

CREATE FUNCTION public.nv_user_permission_history(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(history) ORDER BY history.id DESC),'[]'::jsonb) FROM (
    SELECT h.id,h.actor_name,h.created_at,h.reason,h.previous,h.next
    FROM public.user_permission_audit h JOIN public.user_accounts u ON u.id = h.target_id
    WHERE h.target_id = target AND public.nv_can_action(u.organization_id,'usuarios','edit')
      AND h.organization_id IS NOT DISTINCT FROM u.organization_id
    ORDER BY h.id DESC LIMIT 40
  ) history;
$$;

REVOKE ALL ON FUNCTION public.nv_role_action(text,text,text,text), public.nv_profile_action(text,text,jsonb,text,text),
  public.nv_user_access_snapshot(public.user_accounts), public.nv_guard_last_user_manager(),
  public.nv_manage_user(uuid,text,uuid,jsonb,text), public.nv_user_permission_history(text), public.nv_can_action(text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_manage_user(uuid,text,uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nv_user_permission_history(text), public.nv_can_action(text,text,text) TO authenticated;


-- Enforce separate create, edit and delete actions at the table boundary.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES ('doctors','medicos'),('units','unidades'),('sectors','unidades')) t(relation,module) LOOP
    EXECUTE format('ALTER POLICY nv_read ON public.%I USING (public.nv_can_action(organization_id,%L,%L))',item.relation,item.module,'view');
    EXECUTE format('ALTER POLICY nv_insert ON public.%I WITH CHECK (public.nv_can_action(organization_id,%L,%L))',item.relation,item.module,'create');
    EXECUTE format('ALTER POLICY nv_update ON public.%I USING (public.nv_can_action(organization_id,%L,%L)) WITH CHECK (public.nv_can_action(organization_id,%L,%L))',
      item.relation,item.module,'edit',item.module,'edit');
    EXECUTE format('ALTER POLICY nv_delete ON public.%I USING (public.nv_can_action(organization_id,%L,%L))',item.relation,item.module,'delete');
  END LOOP;
END;
$$;
ALTER POLICY nv_read ON public.shifts USING (public.nv_can_action(organization_id,'escala','view'));
ALTER POLICY nv_delete ON public.shifts USING (public.nv_can_action(organization_id,'escala','delete'));

ALTER TABLE public.doctor_enrollments ADD COLUMN portal_role text NOT NULL DEFAULT 'Médico'
  CHECK (portal_role IN ('Médico','Coordenador Médico'));

CREATE FUNCTION public.nv_doctor_portal_role(target text, requested text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  enrollment public.doctor_enrollments;
  actor public.user_accounts;
BEGIN
  SELECT * INTO enrollment FROM public.doctor_enrollments WHERE doctor_id = target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF requested IS NULL THEN
    IF public.nv_owns_doctor(enrollment.organization_id,target) OR public.nv_can_action(enrollment.organization_id,'medicos','view')
      THEN RETURN enrollment.portal_role; END IF;
    RAISE EXCEPTION 'Cargo médico indisponível.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.nv_can_action(enrollment.organization_id,'medicos','edit')
    OR NOT public.nv_can_action(enrollment.organization_id,'medicos','approve') THEN
    RAISE EXCEPTION 'Seu acesso não permite alterar cargos médicos.' USING ERRCODE = '42501';
  END IF;
  IF requested NOT IN ('Médico','Coordenador Médico') OR enrollment.status <> 'approved' THEN
    RAISE EXCEPTION 'Escolha um cargo para um médico credenciado.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO enrollment FROM public.doctor_enrollments WHERE doctor_id = target FOR UPDATE;
  IF enrollment.status <> 'approved' THEN RAISE EXCEPTION 'O credenciamento mudou. Atualize a ficha.' USING ERRCODE = 'PT409'; END IF;
  IF enrollment.portal_role <> requested THEN
    SELECT * INTO actor FROM public.user_accounts WHERE auth_user_id = public.nv_session_actor();
    UPDATE public.doctor_enrollments SET portal_role = requested WHERE doctor_id = target;
    INSERT INTO public.user_permission_audit(target_id,actor_id,actor_name,organization_id,previous,next)
    VALUES('doctor:' || target,actor.id,actor.name,enrollment.organization_id,
      jsonb_build_object('role',enrollment.portal_role),jsonb_build_object('role',requested));
  END IF;
  RETURN requested;
END;
$$;
REVOKE ALL ON FUNCTION public.nv_doctor_portal_role(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_doctor_portal_role(text,text) TO authenticated;

CREATE OR REPLACE VIEW public.nv_staff_shifts WITH (security_barrier = true) AS
SELECT s.id, s.organization_id, s.doctor_id, s.unit_id, s.sector_id, s.sector, s.specialty, s.date,
  s.start_time, s.end_time, s.type, s.status, s.notes, s.employment_type, s.employer_name, s.coverage_mode, s.coverage_reason,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_amount END payment_amount,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_frequency END payment_frequency,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_status END payment_status,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.paid_at END paid_at,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.paid_amount END paid_amount,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_due_date END payment_due_date,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_note END payment_note,
  CASE WHEN public.nv_can_read_finance(s.organization_id) THEN s.payment_agreement END payment_agreement
FROM public.shifts s WHERE (public.nv_can_action(s.organization_id,'escala','view') OR public.nv_can_read_finance(s.organization_id));

CREATE OR REPLACE FUNCTION public.nv_save_operational_shifts(records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry jsonb;
  item public.shifts%ROWTYPE;
  previous public.shifts%ROWTYPE;
  selection jsonb;
  saved text[] := '{}';
BEGIN
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Envie de 1 a 5000 plantões por operação.' USING ERRCODE = '22023';
  END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(records)
    ORDER BY value->>'organization_id', value->>'doctor_id', value->>'id'
  LOOP
    IF entry->>'payment_amount' IS NOT NULL AND entry->>'payment_amount' !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'Informe um valor em reais com até duas casas decimais.' USING ERRCODE = '22023';
    END IF;
    item := jsonb_populate_record(NULL::public.shifts, entry);
    selection := entry->'agreement';
    IF item.id IS NULL OR length(item.id) > 100 OR length(item.notes) > 1000
      OR NOT public.nv_org_access(item.organization_id) THEN
      RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
    END IF;
    IF selection IS NOT NULL AND NOT public.nv_can_finance(item.organization_id) THEN
      RAISE EXCEPTION 'Alteração financeira indisponível.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO previous FROM public.shifts WHERE id = item.id FOR UPDATE;
    IF FOUND THEN
      IF previous.organization_id <> item.organization_id OR NOT public.nv_can_action(item.organization_id,'escala','edit') THEN
        RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE = '42501';
      END IF;
      item.payment_amount := previous.payment_amount;
      item.payment_frequency := previous.payment_frequency;
      item.payment_agreement := previous.payment_agreement;
      IF selection IS NOT NULL THEN
        IF previous.payment_status = 'paid' THEN
          RAISE EXCEPTION 'Use o ajuste administrativo para um plantão pago.' USING ERRCODE = '22023';
        END IF;
        item := public.nv_apply_shift_agreement(item, selection, previous.doctor_id IS NOT NULL, false);
      ELSIF previous.doctor_id IS NOT NULL AND item.doctor_id IS NULL AND public.nv_can_finance(item.organization_id) THEN
        item.payment_amount := 0;
        item.payment_frequency := 'on_delivery';
        item.payment_agreement := NULL;
      END IF;
      UPDATE public.shifts SET doctor_id = item.doctor_id, unit_id = item.unit_id, sector_id = item.sector_id,
        specialty = item.specialty, date = item.date, start_time = item.start_time, end_time = item.end_time,
        type = item.type, status = item.status, notes = item.notes, employment_type = item.employment_type,
        employer_name = item.employer_name, coverage_mode = coalesce(item.coverage_mode,'regular'), coverage_reason = item.coverage_reason,
        payment_amount = item.payment_amount, payment_frequency = item.payment_frequency,
        payment_agreement = item.payment_agreement WHERE id = item.id;
    ELSE
      IF NOT public.nv_can_action(item.organization_id,'escala','create') THEN
        RAISE EXCEPTION 'Seu acesso não permite criar plantões.' USING ERRCODE = '42501';
      END IF;
      item.payment_agreement := NULL;
      IF selection IS NOT NULL THEN
        item := public.nv_apply_shift_agreement(item, selection, false, false);
        item.payment_status := 'pending';
        item.paid_at := NULL;
      END IF;
      INSERT INTO public.shifts(id, organization_id, doctor_id, unit_id, sector_id, specialty,
        date, start_time, end_time, type, status, notes, employment_type, employer_name, coverage_mode, coverage_reason,
        payment_amount, payment_frequency, payment_status, paid_at, payment_agreement)
      VALUES (item.id, item.organization_id, item.doctor_id, item.unit_id, item.sector_id, item.specialty,
        item.date, item.start_time, item.end_time, item.type, item.status, item.notes, item.employment_type, item.employer_name,
        coalesce(item.coverage_mode,'regular'), item.coverage_reason, coalesce(item.payment_amount,0),
        coalesce(item.payment_frequency,'on_delivery'), coalesce(item.payment_status,'pending'), item.paid_at, item.payment_agreement);
    END IF;
    saved := array_append(saved, item.id);
  END LOOP;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]') FROM public.nv_staff_shifts s WHERE s.id = ANY(saved));
EXCEPTION WHEN integrity_constraint_violation OR numeric_value_out_of_range OR invalid_text_representation THEN
  RAISE EXCEPTION 'Não foi possível salvar os plantões. Confira os vínculos e os campos obrigatórios.' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_review_enrollment(target text, decision text, note text, specialties text[], units text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  enrollment public.doctor_enrollments%ROWTYPE;
  decision_id bigint;
BEGIN
  SELECT * INTO enrollment FROM public.doctor_enrollments WHERE doctor_id = target FOR UPDATE;
  IF NOT FOUND OR NOT public.nv_can_action(enrollment.organization_id,'medicos','approve') THEN
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

CREATE OR REPLACE FUNCTION public.nv_enrollment_queue(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'created_at'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('id', d.id, 'name', e.submitted_name, 'crm', d.crm, 'uf', d.crm_uf, 'email', d.email,
      'cpf', d.cpf, 'phone', e.submitted_phone, 'birth_date', e.birth_date, 'legacy_link', e.legacy_link, 'units', d.linked_units,
      'specialties', e.requested_specialties, 'created_at', e.created_at) item
    FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
    WHERE e.organization_id = org AND e.status = 'pending' AND public.nv_can_action(org,'medicos','approve')
    ORDER BY e.created_at, d.id LIMIT 100
  ) queue;
$$;

CREATE OR REPLACE FUNCTION public.nv_pending_enrollments(org text)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) FROM public.doctor_enrollments WHERE organization_id = org AND status = 'pending' AND public.nv_can_action(org,'medicos','approve');
$$;

CREATE OR REPLACE FUNCTION public.nv_portal_enrollments()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('doctor_id', d.id, 'organization_id', o.id, 'organization', o.name,
    'name', e.submitted_name, 'crm', d.crm, 'uf', d.crm_uf, 'cpf', d.cpf, 'phone', e.submitted_phone, 'birth_date', e.birth_date,
    'status', e.status, 'portal_role', e.portal_role, 'review_note', e.review_note, 'legacy_link', e.legacy_link, 'specialties', e.requested_specialties) ORDER BY o.name), '[]'::jsonb)
  FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
  JOIN public.organizations o ON o.id = e.organization_id
  WHERE e.auth_user_id = (SELECT public.nv_session_actor()) AND o.status = 'active';
$$;


-- Keep the document upload paths consistent on both supported versions of migration 25.
CREATE OR REPLACE FUNCTION public.nv_document_upload_allowed(actor uuid, org text, doctor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.doctor_enrollments e
    JOIN public.doctors d ON d.id = e.doctor_id AND d.organization_id = e.organization_id
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.organization_id = org AND e.doctor_id = doctor AND e.auth_user_id = actor
      AND d.status <> 'inactive' AND o.status = 'active' AND e.status <> 'rejected'
      AND (NOT e.legacy_link OR e.status = 'approved')
  ) OR EXISTS (
    SELECT 1 FROM public.user_accounts u WHERE u.auth_user_id = actor AND u.status = 'active'
      AND (u.type = 'saas_admin' OR u.organization_id = org)
      AND public.nv_profile_action(u.type,u.role,u.additional_permissions,'documentos','edit')
  );
$$;
REVOKE ALL ON FUNCTION public.nv_document_upload_allowed(uuid,text,text) FROM PUBLIC, anon, authenticated;

ALTER POLICY nv_update ON public.medical_documents USING (
  public.nv_can_action(organization_id,'documentos','edit') OR public.nv_can_action(organization_id,'documentos','approve'))
WITH CHECK (public.nv_can_action(organization_id,'documentos','edit') OR public.nv_can_action(organization_id,'documentos','approve'));
ALTER POLICY nv_delete ON public.medical_documents USING (false);

CREATE FUNCTION public.nv_check_document_actions()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.status IN ('approved','rejected') AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status)
    AND NOT public.nv_can_action(NEW.organization_id,'documentos','approve') THEN
    RAISE EXCEPTION 'Seu acesso não permite aprovar ou reprovar documentos.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT public.nv_can_action(NEW.organization_id,'documentos','edit')
    AND (NEW.status NOT IN ('approved','rejected')
      OR (to_jsonb(NEW) - ARRAY['status','review_note','reviewed_by','reviewed_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','review_note','reviewed_by','reviewed_at','updated_at'])) THEN
    RAISE EXCEPTION 'Seu acesso permite apenas revisar a situação do documento.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_check_document_actions BEFORE INSERT OR UPDATE ON public.medical_documents
FOR EACH ROW EXECUTE FUNCTION public.nv_check_document_actions();
REVOKE ALL ON FUNCTION public.nv_check_document_actions() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.nv_shift_doctor_specialties(org text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(e.doctor_id, CASE WHEN e.status = 'approved' THEN to_jsonb(e.approved_specialties) ELSE '[]'::jsonb END),'{}')
  FROM public.doctor_enrollments e
  WHERE e.organization_id = org AND public.nv_can_action(org,'escala','view');
$$;
REVOKE ALL ON FUNCTION public.nv_shift_doctor_specialties(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_shift_doctor_specialties(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_active_exchanges(org text)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id FROM public.shifts s JOIN public.shift_opportunities op ON op.shift_id = s.id
  WHERE s.organization_id = org AND op.status = 'open' AND op.kind = 'exchange'
    AND public.nv_shift_starts(s) > now() AND public.nv_can_action(org,'escala','view');
$$;

CREATE OR REPLACE FUNCTION public.nv_operational_counts(org text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  schedule boolean := public.nv_can_action(org,'escala','view');
  coordination boolean := public.nv_coordinator(org);
  finance boolean := public.nv_can_read_finance(org);
  documents boolean := public.nv_can_read_documents(org);
  scope_start date := (today - interval '1 month')::date;
  scope_end date := (today + interval '2 months')::date;
BEGIN
  IF NOT public.nv_org_access(org) THEN RAISE EXCEPTION 'Empresa indisponível.' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'today', today, 'from', scope_start, 'to', scope_end,
    'enrollments', CASE WHEN public.nv_can_action(org,'medicos','approve') THEN public.nv_pending_enrollments(org) END,
    'docs_pending', CASE WHEN documents THEN (SELECT count(*) FROM public.medical_documents d
      WHERE d.organization_id = org AND d.status IN ('not_sent','sent','analyzing','rejected')) END,
    'docs_expiring', CASE WHEN documents THEN (SELECT count(*) FROM public.medical_documents d
      WHERE d.organization_id = org AND (d.status = 'expired' OR (d.status = 'approved' AND d.expiry_date <= (today + 30)::text))) END,
    'open', CASE WHEN schedule THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.status = 'open' AND s.date BETWEEN today AND scope_end) ELSE 0 END,
    'exchanges', CASE WHEN coordination THEN (SELECT count(*) FROM public.shift_opportunities op JOIN public.shifts s ON s.id = op.shift_id
      WHERE s.organization_id = org AND op.kind = 'exchange' AND op.status = 'open' AND public.nv_shift_starts(s) > now()) END,
    'applications', CASE WHEN coordination THEN (SELECT count(*) FROM public.shift_applications a JOIN public.shift_opportunities op ON op.id = a.opportunity_id
      JOIN public.shifts s ON s.id = op.shift_id WHERE s.organization_id = org AND a.status = 'pending' AND op.status = 'open'
        AND public.nv_shift_starts(s) > now()) END,
    'shifts_today', CASE WHEN schedule THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date = today AND s.status <> 'cancelled') ELSE 0 END,
    'checkins_pending', CASE WHEN coordination THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date = today
      AND s.type = 'onsite' AND s.status = 'confirmed' AND s.doctor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.shift_attendance a WHERE a.shift_id = s.id AND a.kind IN ('check_in','check_out'))) END,
    'completed', CASE WHEN schedule THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.status = 'completed' AND s.date BETWEEN scope_start AND today) ELSE 0 END,
    'payments_pending', CASE WHEN finance THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date BETWEEN scope_start AND scope_end
      AND s.doctor_id IS NOT NULL AND s.status <> 'cancelled' AND s.payment_status = 'pending') END,
    'payments_overdue', CASE WHEN finance THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id = org AND s.date BETWEEN scope_start AND scope_end
      AND s.doctor_id IS NOT NULL AND s.status <> 'cancelled' AND s.payment_status = 'pending' AND s.payment_due_date < today) END
  );
END;
$$;

COMMIT;
