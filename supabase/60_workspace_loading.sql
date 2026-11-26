-- Incremental read-only RPCs. No records, credentials, invitations or existing policies are changed.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION public.nv_workspace_documents(org text,target text DEFAULT NULL,after_id text DEFAULT NULL,page_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.nv_session_ready(),false) OR NOT coalesce(public.nv_can_read_documents(org),false) THEN RAISE EXCEPTION 'Consulta indisponível.' USING ERRCODE='42501'; END IF;
 IF page_limit IS NULL OR page_limit<1 OR page_limit>500 THEN RAISE EXCEPTION 'Página inválida.' USING ERRCODE='22023'; END IF;
 IF target IS NOT NULL AND NOT EXISTS(SELECT FROM public.doctors d WHERE d.id=target AND d.organization_id=org) THEN RAISE EXCEPTION 'Pasta indisponível.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.id),'[]') INTO result FROM (
  SELECT m.id,m.organization_id,m.doctor_id,m.name,m.type,m.status,m.upload_date,m.expiry_date,m.file_name,m.file_path,
   m.review_note,m.reviewed_by,m.reviewed_at,m.version,m.created_at
  FROM public.medical_documents m WHERE m.organization_id=org AND (target IS NULL OR m.doctor_id=target) AND (after_id IS NULL OR m.id>after_id)
  ORDER BY m.id LIMIT page_limit
 )d;
 RETURN result;
END;
$$;

CREATE FUNCTION public.nv_workspace_document_audit(org text,target text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.nv_session_ready(),false) OR NOT coalesce(public.nv_can_read_documents(org),false) THEN RAISE EXCEPTION 'Consulta indisponível.' USING ERRCODE='42501'; END IF;
 IF target IS NOT NULL AND NOT EXISTS(SELECT FROM public.doctors d WHERE d.id=target AND d.organization_id=org) THEN RAISE EXCEPTION 'Pasta indisponível.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC,a.id DESC),'[]') INTO result FROM (
  SELECT a.id,a.organization_id,a.doctor_id,a.document_id,a.actor_user_id,a.actor_name,a.action,a.from_status,a.to_status,a.note,a.changes,a.created_at
  FROM public.document_audit_logs a WHERE a.organization_id=org AND (target IS NULL OR a.doctor_id=target)
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1000
 )a;
 RETURN result;
END;
$$;

CREATE FUNCTION public.nv_workspace_organization_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT coalesce(public.nv_session_ready(),false) THEN RAISE EXCEPTION 'Consulta indisponível.' USING ERRCODE='42501'; END IF;
 IF NOT coalesce(public.nv_admin(),false) THEN RAISE EXCEPTION 'Consulta indisponível.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_object_agg(o.id,jsonb_build_object(
  'doctors',CASE WHEN public.nv_can_action(o.id,'medicos','view') THEN (SELECT count(*) FROM public.doctors d WHERE d.organization_id=o.id) END,
  'units',CASE WHEN public.nv_can_action(o.id,'unidades','view') THEN (SELECT count(*) FROM public.units u WHERE u.organization_id=o.id) END,
  'sectors',CASE WHEN public.nv_can_action(o.id,'unidades','view') THEN (SELECT count(*) FROM public.sectors s WHERE s.organization_id=o.id) END,
  'shifts',CASE WHEN public.nv_can_action(o.id,'escala','view') THEN (SELECT count(*) FROM public.shifts s WHERE s.organization_id=o.id) END,
  'users',CASE WHEN public.nv_can_action(o.id,'usuarios','view') THEN (SELECT count(*) FROM public.user_accounts u WHERE u.organization_id=o.id) END,
  'accounts',CASE WHEN public.nv_can_action(o.id,'usuarios','view') THEN (SELECT count(*) FROM public.user_accounts u WHERE u.organization_id=o.id AND u.auth_user_id IS NOT NULL) END,
  'documents',CASE WHEN public.nv_can_read_documents(o.id) THEN (SELECT count(*) FROM public.medical_documents m WHERE m.organization_id=o.id) END,
  'pendingDocuments',CASE WHEN public.nv_can_read_documents(o.id) THEN (SELECT count(*) FROM public.medical_documents m WHERE m.organization_id=o.id AND m.status IN('analyzing','expired','rejected')) END
 )),'{}') INTO result FROM public.organizations o;
 RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_workspace_documents(text,text,text,integer),public.nv_workspace_document_audit(text,text),public.nv_workspace_organization_counts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_workspace_documents(text,text,text,integer),public.nv_workspace_document_audit(text,text),public.nv_workspace_organization_counts() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
