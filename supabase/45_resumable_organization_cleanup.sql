BEGIN;

CREATE TABLE public.organization_cleanup_jobs (
  organization_id text PRIMARY KEY,
  organization_name text NOT NULL,
  started_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  document_paths text[] NOT NULL DEFAULT '{}',
  avatar_paths text[] NOT NULL DEFAULT '{}',
  auth_user_ids uuid[] NOT NULL DEFAULT '{}'
);
ALTER TABLE public.organization_cleanup_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_cleanup_jobs FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.nv_can_delete_organization(actor uuid, session_key uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.nv_admin_mfa_session_valid(actor, session_key) AND EXISTS (
    SELECT FROM public.user_accounts u WHERE u.auth_user_id = actor AND u.status = 'active'
      AND u.type = 'saas_admin' AND u.role = 'CEO'
  );
$$;

CREATE FUNCTION public.nv_guard_pending_auth_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.auth_user_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.auth_user_id IS NOT DISTINCT FROM OLD.auth_user_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-auth-cleanup:' || NEW.auth_user_id::text, 0));
  IF EXISTS (SELECT FROM public.organization_cleanup_jobs j
    WHERE j.completed_at IS NULL AND NEW.auth_user_id = ANY(j.auth_user_ids)) THEN
    RAISE EXCEPTION 'Esta conta aguarda conclusão de uma exclusão administrativa.' USING ERRCODE = 'PT409';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nv_guard_pending_auth_cleanup BEFORE INSERT OR UPDATE OF auth_user_id ON public.user_accounts
  FOR EACH ROW EXECUTE FUNCTION public.nv_guard_pending_auth_cleanup();
CREATE TRIGGER nv_guard_pending_auth_cleanup BEFORE INSERT OR UPDATE OF auth_user_id ON public.doctor_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.nv_guard_pending_auth_cleanup();

DROP FUNCTION public.nv_delete_organization(text,uuid,uuid);
DROP FUNCTION public.nv_delete_organization_internal(text);
CREATE FUNCTION public.nv_delete_organization(target_id text, actor_auth uuid, actor_session uuid, confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE company public.organizations; job public.organization_cleanup_jobs; candidate uuid; identities uuid[];
BEGIN
  IF NOT public.nv_can_delete_organization(actor_auth, actor_session) THEN
    RAISE EXCEPTION 'Exclusão da empresa indisponível para esta sessão.' USING ERRCODE = '42501';
  END IF;
  IF target_id IS NULL OR target_id !~ '^[A-Za-z0-9_-]{1,100}$' THEN RAISE EXCEPTION 'Confira a empresa.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-organization-cleanup:' || target_id, 0));
  SELECT * INTO job FROM public.organization_cleanup_jobs WHERE organization_id = target_id;
  IF FOUND THEN
    IF btrim(confirmation) IS DISTINCT FROM btrim(job.organization_name) THEN RAISE EXCEPTION 'Digite o nome exato da empresa.' USING ERRCODE = '22023'; END IF;
    IF job.completed_at IS NOT NULL THEN RETURN jsonb_build_object('complete', true); END IF;
    IF job.lease_until > now() THEN RAISE EXCEPTION 'A exclusão já está sendo processada. Tente novamente em instantes.' USING ERRCODE = 'PT409'; END IF;
  ELSE
    SELECT * INTO company FROM public.organizations WHERE id = target_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.' USING ERRCODE = 'PT404'; END IF;
    IF btrim(confirmation) IS DISTINCT FROM btrim(company.name) THEN RAISE EXCEPTION 'Digite o nome exato da empresa.' USING ERRCODE = '22023'; END IF;

    -- This workflow does not erase operational history with separate retention rules.
    IF company.settings->>'retention_hold' = 'true' OR EXISTS (SELECT FROM public.shifts WHERE organization_id = target_id) THEN
      RAISE EXCEPTION 'A empresa possui retenção ativa ou histórico de plantões. Os registros foram preservados.' USING ERRCODE = 'PT409';
    END IF;
    IF EXISTS (SELECT FROM public.doctor_access_operations
      WHERE organization_id = target_id AND status = 'pending' AND created_at > now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'Há uma operação de acesso em andamento. Tente novamente após a conclusão.' USING ERRCODE = 'PT409';
    END IF;

    SELECT coalesce(array_agg(auth_id ORDER BY auth_id), '{}') INTO identities FROM (
      SELECT u.auth_user_id auth_id FROM public.user_accounts u WHERE u.organization_id = target_id AND u.auth_user_id IS NOT NULL
      UNION
      SELECT e.auth_user_id FROM public.doctor_enrollments e WHERE e.organization_id = target_id AND e.auth_user_id IS NOT NULL
    ) candidates;
    FOREACH candidate IN ARRAY identities LOOP
      PERFORM pg_advisory_xact_lock(hashtextextended('nv-auth-cleanup:' || candidate::text, 0));
    END LOOP;

    SELECT coalesce(array_agg(entry.id), '{}') INTO identities FROM unnest(identities) AS entry(id)
    WHERE NOT EXISTS (SELECT FROM public.user_accounts u WHERE u.auth_user_id = entry.id AND u.organization_id IS DISTINCT FROM target_id)
      AND NOT EXISTS (SELECT FROM public.doctor_enrollments e WHERE e.auth_user_id = entry.id AND e.organization_id <> target_id)
      AND NOT EXISTS (SELECT FROM public.master_schedule_rules r WHERE r.created_by = entry.id)
      AND NOT EXISTS (SELECT FROM public.master_schedule_versions v WHERE v.authorized_by = entry.id)
      AND NOT EXISTS (SELECT FROM public.doctor_absences a WHERE a.created_by = entry.id);

    INSERT INTO public.organization_cleanup_jobs(organization_id, organization_name, started_by, document_paths, avatar_paths, auth_user_ids)
    SELECT company.id, company.name, actor_auth,
      ARRAY(SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'medical-documents' AND starts_with(o.name, target_id || '/')),
      ARRAY(SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'profile-avatars'
        AND split_part(o.name, '/', 1) IN (SELECT id::text FROM unnest(identities) AS account(id))
        AND NOT EXISTS (SELECT FROM public.user_accounts u WHERE u.avatar = o.name AND u.organization_id IS DISTINCT FROM target_id)),
      identities;

    DELETE FROM public.doctor_access_operations WHERE organization_id = target_id;
    DELETE FROM public.doctor_enrollment_decisions d USING public.doctor_enrollments e
      WHERE d.doctor_id = e.doctor_id AND e.organization_id = target_id;
    DELETE FROM public.doctor_enrollments WHERE organization_id = target_id;
    DELETE FROM public.organizations WHERE id = target_id;
  END IF;

  UPDATE public.organization_cleanup_jobs SET lease_id = gen_random_uuid(), lease_until = now() + interval '2 minutes'
    WHERE organization_id = target_id RETURNING * INTO job;
  RETURN jsonb_build_object('lease', job.lease_id);
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'A empresa possui vínculos que impedem o expurgo. Os registros foram preservados.' USING ERRCODE = 'PT409';
END;
$$;

CREATE FUNCTION public.nv_reconcile_organization_cleanup(target_id text, lease uuid, release_lease boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE job public.organization_cleanup_jobs; complete boolean;
BEGIN
  SELECT * INTO job FROM public.organization_cleanup_jobs WHERE organization_id = target_id
    AND lease_id = lease AND lease_until > now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A sessão de limpeza expirou. Retome a exclusão.' USING ERRCODE = 'PT409'; END IF;

  job.document_paths := ARRAY(SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'medical-documents'
    AND starts_with(o.name, target_id || '/'));
  job.avatar_paths := ARRAY(SELECT o.name FROM storage.objects o WHERE o.bucket_id = 'profile-avatars'
    AND (o.name = ANY(job.avatar_paths) OR split_part(o.name, '/', 1) IN (SELECT id::text FROM unnest(job.auth_user_ids) AS account(id)))
    AND NOT EXISTS (SELECT FROM public.user_accounts u WHERE u.avatar = o.name));
  job.auth_user_ids := ARRAY(SELECT a.id FROM auth.users a WHERE a.id = ANY(job.auth_user_ids) AND a.deleted_at IS NULL);
  complete := cardinality(job.document_paths) + cardinality(job.avatar_paths) + cardinality(job.auth_user_ids) = 0;

  UPDATE public.organization_cleanup_jobs SET document_paths = job.document_paths, avatar_paths = job.avatar_paths,
    auth_user_ids = job.auth_user_ids, completed_at = CASE WHEN complete THEN now() END,
    lease_id = CASE WHEN complete OR release_lease THEN NULL ELSE lease_id END,
    lease_until = CASE WHEN complete OR release_lease THEN NULL ELSE lease_until END WHERE organization_id = target_id;
  IF complete AND to_regclass('public.medical_document_scans') IS NOT NULL THEN
    DELETE FROM public.medical_document_scans WHERE starts_with(object_name, target_id || '/');
  END IF;
  IF complete OR release_lease THEN RETURN jsonb_build_object('complete', complete); END IF;
  RETURN jsonb_build_object('complete', false, 'document_paths', job.document_paths[1:100],
    'avatar_paths', job.avatar_paths[1:100], 'auth_user_ids', job.auth_user_ids[1:8]);
END;
$$;

CREATE FUNCTION public.nv_pending_organization_cleanups(actor_auth uuid, actor_session uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.nv_can_delete_organization(actor_auth, actor_session) THEN
    RAISE EXCEPTION 'Limpezas administrativas indisponíveis para esta sessão.' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', organization_id, 'name', organization_name) ORDER BY created_at), '[]')
    FROM public.organization_cleanup_jobs WHERE completed_at IS NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.nv_can_delete_organization(uuid,uuid), public.nv_guard_pending_auth_cleanup(),
  public.nv_delete_organization(text,uuid,uuid,text), public.nv_reconcile_organization_cleanup(text,uuid,boolean),
  public.nv_pending_organization_cleanups(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nv_delete_organization(text,uuid,uuid,text), public.nv_reconcile_organization_cleanup(text,uuid,boolean),
  public.nv_pending_organization_cleanups(uuid,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
