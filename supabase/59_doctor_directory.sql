-- Incremental directory. No doctor backfill, Auth write, invitation or Storage operation.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE public.doctor_rqes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 doctor_id text NOT NULL,
 organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 number text NOT NULL CHECK(number ~ '^[0-9]{1,20}$'),
 specialty text CHECK(specialty IS NULL OR length(btrim(specialty)) BETWEEN 1 AND 150),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(doctor_id,organization_id) REFERENCES public.doctors(id,organization_id)
);
CREATE UNIQUE INDEX doctor_rqes_identity ON public.doctor_rqes(doctor_id,number);
CREATE INDEX doctor_rqes_company ON public.doctor_rqes(organization_id,doctor_id);
ALTER TABLE public.doctor_rqes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_rqes FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.doctor_rqes IS 'Registered qualifications, never an official validation. NULL specialty means an unidentified association. Legacy doctors.rqe is preserved separately.';

CREATE TABLE public.doctor_directory_operations (
 actor_id uuid NOT NULL,
 request_id uuid NOT NULL,
 organization_id text NOT NULL,
 action text NOT NULL,
 payload jsonb NOT NULL,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_id)
);
ALTER TABLE public.doctor_directory_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_directory_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX doctor_directory_operations_company ON public.doctor_directory_operations(organization_id,created_at DESC);
CREATE INDEX doctors_directory_company_name ON public.doctors(organization_id,lower(name),id);
CREATE INDEX directory_documents_scope ON public.medical_documents(organization_id,doctor_id,type,status,expiry_date);
CREATE INDEX directory_shifts_scope ON public.shifts(organization_id,doctor_id,status,date);

CREATE FUNCTION public.nv_directory_search(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT nv_doctor_names.clean_spacing(lower(regexp_replace(normalize(coalesce(value,''),NFD),U&'[\0300-\036f]','','g') COLLATE pg_catalog."und-x-icu"));
$$;

-- Private set-based aggregation, never callable by an application role.
CREATE FUNCTION public.nv_directory_rows(org text) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH capabilities AS MATERIALIZED (SELECT public.nv_can_action(org,'medicos','view') doctors,
  public.nv_can_action(org,'documentos','view') documents,public.nv_can_action(org,'escala','view') schedule,public.nv_can_action(org,'portal_medico','view') portal),
 scoped AS MATERIALIZED (
  SELECT d.id,d.organization_id,d.name,d.crm,d.crm_uf,d.rqe,d.specialty,d.status,d.contract_model,d.contract_signed,d.linked_units,d.updated_at,
   array(SELECT DISTINCT s FROM unnest(ARRAY[d.specialty]||coalesce(e.approved_specialties,'{}')) s WHERE nullif(btrim(s),'') IS NOT NULL ORDER BY s) specialties,
   e.status enrollment_status,e.auth_user_id
  FROM public.doctors d CROSS JOIN capabilities cap LEFT JOIN public.doctor_enrollments e ON e.doctor_id=d.id AND e.organization_id=d.organization_id
  WHERE d.organization_id=org AND cap.doctors
 ), units AS MATERIALIZED (
  SELECT s.doctor_id,jsonb_agg(DISTINCT jsonb_build_object('id',u.id,'name',u.name) ORDER BY jsonb_build_object('id',u.id,'name',u.name)) units
  FROM public.shifts s CROSS JOIN capabilities cap JOIN public.units u ON u.id=s.unit_id AND u.organization_id=s.organization_id
  WHERE s.organization_id=org AND s.status<>'cancelled' AND cap.schedule GROUP BY s.doctor_id
 ), completed AS MATERIALIZED (
  SELECT s.doctor_id,max(public.nv_shift_ends(s)) last_shift
  FROM public.shifts s CROSS JOIN capabilities cap WHERE s.organization_id=org AND s.status='completed' AND public.nv_shift_ends(s)<=now()
   AND cap.schedule GROUP BY s.doctor_id
 ), rqes AS MATERIALIZED (
  SELECT d.id,jsonb_agg(jsonb_build_object('id',r.id,'number',r.number,'specialty',r.specialty,'legacy',r.legacy) ORDER BY r.legacy DESC,r.number,r.specialty) records
  FROM scoped d JOIN LATERAL (
   SELECT q.id::text,q.number,q.specialty,false legacy FROM public.doctor_rqes q WHERE q.doctor_id=d.id AND q.organization_id=org
   UNION ALL SELECT NULL,btrim(d.rqe),NULL,true WHERE nullif(btrim(d.rqe),'') IS NOT NULL
    AND NOT EXISTS(SELECT FROM public.doctor_rqes q WHERE q.doctor_id=d.id AND q.number=btrim(d.rqe))
  ) r ON true GROUP BY d.id
 ), requirements AS MATERIALIZED (
  SELECT DISTINCT d.id,r->>'type' type FROM scoped d CROSS JOIN capabilities cap JOIN public.organizations o ON o.id=d.organization_id
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(o.settings->'requiredDocuments','[]')) r
  WHERE cap.documents
   AND EXISTS(SELECT FROM unnest(d.specialties) sp WHERE public.nv_required_document_applies(r,sp,coalesce(d.linked_units,'{}')))
   AND (jsonb_array_length(coalesce(r->'states','[]'))=0 OR r->'states' ? upper(d.crm_uf))
 ), metadata AS MATERIALIZED (
  SELECT m.doctor_id,m.type,m.status,
   m.status='expired' OR (m.expiry_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND m.expiry_date<current_date::text) expired,
   m.status='approved' AND m.expiry_date BETWEEN current_date::text AND (current_date + coalesce((
    SELECT max(value::int) FROM public.organizations o CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(o.settings->'documentGovernance'->'expiryAlertDays','[30]')) WHERE o.id=org),30))::text near
  FROM public.medical_documents m CROSS JOIN capabilities cap WHERE m.organization_id=org AND cap.documents
   AND EXISTS(SELECT FROM requirements r WHERE r.id=m.doctor_id AND r.type=m.type)
 ), missing AS MATERIALIZED (
  SELECT r.id,count(*) FILTER(WHERE m.doctor_id IS NULL) count FROM requirements r
  LEFT JOIN (SELECT DISTINCT doctor_id,type FROM metadata) m ON m.doctor_id=r.id AND m.type=r.type GROUP BY r.id
 ), totals AS MATERIALIZED (
  SELECT m.doctor_id,count(*) FILTER(WHERE m.status<>'approved' OR m.expired) pending,
   count(*) FILTER(WHERE m.expired) expired,count(*) FILTER(WHERE m.near) near FROM metadata m GROUP BY m.doctor_id
 ), docs AS MATERIALIZED (
  SELECT d.id,coalesce(m.count,0) missing,coalesce(t.pending,0) pending,coalesce(t.expired,0) expired,coalesce(t.near,0) near
  FROM scoped d LEFT JOIN missing m ON m.id=d.id LEFT JOIN totals t ON t.doctor_id=d.id
 )
 SELECT jsonb_build_object('id',d.id,'organizationId',d.organization_id,'name',d.name,'crm',d.crm,'crmUf',d.crm_uf,
  'specialty',d.specialty,'specialties',d.specialties,'rqes',coalesce(q.records,'[]'),
  'status',d.status,'contractModel',d.contract_model,'contractSigned',d.contract_signed,'revision',d.updated_at,
  'units',coalesce(u.units,'[]'),'lastShift',c.last_shift,'enrollmentStatus',coalesce(d.enrollment_status,'not_started'),
  'documents',CASE WHEN cap.documents THEN jsonb_build_object(
   'pending',docs.pending+docs.missing,'missing',docs.missing,'expired',docs.expired,'near',docs.near,
   'complete',docs.pending+docs.missing+docs.near=0) END,
  'portalStatus',CASE WHEN cap.portal THEN
   CASE WHEN a.id IS NULL THEN 'not_released' WHEN a.banned_until>now() OR d.status='inactive' OR a.deleted_at IS NOT NULL THEN 'blocked'
    WHEN a.email_confirmed_at IS NULL OR a.raw_app_meta_data->>'must_change_password'='true' THEN 'pending' ELSE 'active' END END)
 FROM scoped d CROSS JOIN capabilities cap LEFT JOIN rqes q ON q.id=d.id LEFT JOIN units u ON u.doctor_id=d.id
 LEFT JOIN completed c ON c.doctor_id=d.id JOIN docs ON docs.id=d.id
 LEFT JOIN auth.users a ON a.id=d.auth_user_id;
$$;

CREATE FUNCTION public.nv_directory_matches(row_data jsonb,filters jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT
  (coalesce(filters->>'q','')='' OR strpos(public.nv_directory_search(row_data->>'name'),public.nv_directory_search(filters->>'q'))>0
   OR strpos(row_data->>'crm',filters->>'q')>0
   OR EXISTS(SELECT FROM jsonb_array_elements(row_data->'rqes') r WHERE strpos(r->>'number',filters->>'q')>0)
   OR EXISTS(SELECT FROM jsonb_array_elements_text(row_data->'specialties') sp WHERE strpos(public.nv_directory_search(sp),public.nv_directory_search(filters->>'q'))>0))
  AND (coalesce(filters->>'status','all')='all' OR row_data->>'status'=filters->>'status')
  AND (coalesce(filters->>'specialty','all')='all' OR row_data->'specialties' ? (filters->>'specialty'))
  AND (coalesce(filters->>'rqe','all')='all' OR
   (filters->>'rqe'='with')=EXISTS(SELECT FROM jsonb_array_elements(row_data->'rqes') r WHERE coalesce(filters->>'specialty','all')='all' OR r->>'specialty'=filters->>'specialty'))
  AND (coalesce(filters->>'unit','all')='all' OR
   CASE WHEN filters->>'unit'='none' THEN jsonb_array_length(row_data->'units')=0
   ELSE EXISTS(SELECT FROM jsonb_array_elements(row_data->'units') u WHERE u->>'id'=filters->>'unit') END)
  AND (coalesce(filters->>'contract','all')='all' OR row_data->>'contractModel'=filters->>'contract')
  AND (coalesce(filters->>'signed','all')='all' OR (row_data->>'contractSigned')::boolean=(filters->>'signed'='signed'))
  AND (coalesce(filters->>'portal','all')='all' OR row_data->>'portalStatus'=filters->>'portal')
  AND (coalesce(filters->>'documents','all')='all' OR CASE filters->>'documents'
   WHEN 'complete' THEN (row_data->'documents'->>'complete')::boolean
   WHEN 'pending' THEN (row_data->'documents'->>'pending')::int>0 OR (row_data->'documents'->>'near')::int>0
   WHEN 'expired' THEN (row_data->'documents'->>'expired')::int>0
   WHEN 'near' THEN (row_data->'documents'->>'near')::int>0 ELSE false END)
  AND (coalesce(filters->>'lastShift','all')='all' OR CASE WHEN filters->>'lastShift'='none' THEN row_data->>'lastShift' IS NULL
   ELSE (row_data->>'lastShift')::timestamptz>=now()-make_interval(days=>(filters->>'lastShift')::int) END);
$$;

CREATE FUNCTION public.nv_directory_validate(org text,filters jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF org IS NULL OR NOT public.nv_can_action(org,'medicos','view') THEN RAISE EXCEPTION 'Listagem indisponível.' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(filters) IS DISTINCT FROM 'object' OR length(coalesce(filters->>'q',''))>150
  OR EXISTS(SELECT FROM jsonb_each(filters) p WHERE p.key NOT IN('q','status','specialty','rqe','unit','contract','signed','documents','portal','lastShift') OR jsonb_typeof(p.value)<>'string')
  OR coalesce(filters->>'status','all') NOT IN('all','active','pending','inactive')
  OR coalesce(filters->>'rqe','all') NOT IN('all','with','without')
  OR coalesce(filters->>'contract','all') NOT IN('all','pf','pj','scp')
  OR coalesce(filters->>'signed','all') NOT IN('all','pending','signed')
  OR coalesce(filters->>'documents','all') NOT IN('all','complete','pending','expired','near')
  OR coalesce(filters->>'portal','all') NOT IN('all','not_released','pending','active','blocked')
  OR coalesce(filters->>'lastShift','all') NOT IN('all','30','60','90','none') THEN RAISE EXCEPTION 'Filtros inválidos.' USING ERRCODE='22023'; END IF;
 IF ((coalesce(filters->>'documents','all')<>'all') AND NOT public.nv_can_action(org,'documentos','view'))
  OR ((coalesce(filters->>'unit','all')<>'all' OR coalesce(filters->>'lastShift','all')<>'all') AND NOT public.nv_can_action(org,'escala','view'))
  OR (coalesce(filters->>'portal','all')<>'all' AND NOT public.nv_can_action(org,'portal_medico','view')) THEN RAISE EXCEPTION 'Filtro indisponível para este perfil.' USING ERRCODE='42501'; END IF;
END;
$$;

CREATE FUNCTION public.nv_doctor_directory(org text,filters jsonb DEFAULT '{}',page integer DEFAULT 1,page_size integer DEFAULT 25,sort_by text DEFAULT 'name',descending boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 PERFORM public.nv_directory_validate(org,filters);
 IF page IS NULL OR page<1 OR page>1000000 OR page_size IS NULL OR page_size NOT IN(25,50,100) OR sort_by IS NULL OR sort_by NOT IN('name','crm','specialty','status','pending') OR descending IS NULL THEN
  RAISE EXCEPTION 'Paginação inválida.' USING ERRCODE='22023'; END IF;
 IF sort_by='pending' AND NOT public.nv_can_action(org,'documentos','view') THEN RAISE EXCEPTION 'Ordenação indisponível.' USING ERRCODE='42501'; END IF;
 WITH all_rows AS MATERIALIZED (SELECT r FROM public.nv_directory_rows(org) r),
 filtered AS MATERIALIZED (SELECT r FROM all_rows WHERE public.nv_directory_matches(r,filters)),
 keyed AS (SELECT r,CASE sort_by WHEN 'name' THEN public.nv_directory_search(r->>'name') WHEN 'specialty' THEN public.nv_directory_search(r->>'specialty') WHEN 'status' THEN r->>'status' END text_key,
  CASE sort_by WHEN 'crm' THEN coalesce(nullif(regexp_replace(r->>'crm','[^0-9]','','g'),''),'0')::numeric WHEN 'pending' THEN (r->'documents'->>'pending')::numeric END number_key FROM filtered),
 numbered AS (SELECT r,row_number() OVER(ORDER BY
  CASE WHEN NOT descending THEN text_key END ASC NULLS LAST,CASE WHEN descending THEN text_key END DESC NULLS LAST,
  CASE WHEN NOT descending THEN number_key END ASC NULLS LAST,CASE WHEN descending THEN number_key END DESC NULLS LAST,r->>'id') position FROM keyed),
 counts AS (SELECT count(*) total,count(*) FILTER(WHERE r->>'status'='active') active,count(*) FILTER(WHERE r->>'status'='pending') pending,
  count(*) FILTER(WHERE jsonb_array_length(r->'rqes')>0) with_rqe,count(*) FILTER(WHERE jsonb_array_length(r->'rqes')=0) without_rqe,
  count(*) FILTER(WHERE (r->'documents'->>'pending')::int>0 OR (r->'documents'->>'near')::int>0) documents FROM all_rows),
 bounds AS (SELECT greatest(1,least(page,ceil(count(*)::numeric/page_size)::int)) current_page,count(*) total FROM filtered)
 SELECT jsonb_build_object('rows',coalesce((SELECT jsonb_agg(n.r ORDER BY n.position) FROM numbered n WHERE n.position BETWEEN (b.current_page-1)*page_size+1 AND b.current_page*page_size),'[]'),
  'total',b.total,'page',b.current_page,'pageSize',page_size,'indicators',to_jsonb(c),
  'specialties',(SELECT coalesce(jsonb_agg(sp ORDER BY sp),'[]') FROM (SELECT DISTINCT jsonb_array_elements_text(r->'specialties') sp FROM all_rows) options),
  'units',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name) ORDER BY u.name,u.id),'[]') FROM public.units u WHERE u.organization_id=org AND public.nv_can_action(org,'escala','view')),
  'permissions',jsonb_build_object('documents',public.nv_can_action(org,'documentos','view'),'schedule',public.nv_can_action(org,'escala','view'),
   'portal',public.nv_can_action(org,'portal_medico','view'),'edit',public.nv_can_action(org,'medicos','edit'),
   'requestDocuments',public.nv_can_action(org,'documentos','edit'),'export',public.nv_can_action(org,'relatorios','view')))
 INTO result FROM counts c CROSS JOIN bounds b;
 RETURN result;
END;
$$;

-- Atomic, serialized idempotency per actor/request; individual failures use subtransactions.
CREATE FUNCTION public.nv_doctor_directory_bulk(org text,request_id uuid,operation text,targets jsonb,new_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=public.nv_session_actor(); payload jsonb:=jsonb_build_object('operation',operation,'targets',targets,'status',new_status);
 prior public.doctor_directory_operations; item jsonb; d public.doctors; results jsonb:='[]'; outcome text; recipient uuid; pending_ids text[];
BEGIN
 PERFORM public.nv_directory_validate(org,'{}');
 IF public.nv_admin_mfa_session() IS NULL OR (operation='status' AND NOT public.nv_can_action(org,'medicos','edit'))
  OR (operation='request_documents' AND NOT public.nv_can_action(org,'documentos','edit')) THEN RAISE EXCEPTION 'Confirme MFA e suas permissões para continuar.' USING ERRCODE='42501'; END IF;
 IF request_id IS NULL OR operation IS NULL OR operation NOT IN('status','request_documents') OR jsonb_typeof(targets) IS DISTINCT FROM 'array'
  OR jsonb_array_length(targets) NOT BETWEEN 1 AND 100 OR (operation='status' AND (new_status IS NULL OR new_status NOT IN('active','pending','inactive')))
  OR EXISTS(SELECT FROM jsonb_array_elements(targets) t WHERE jsonb_typeof(t)<>'object' OR nullif(t->>'id','') IS NULL OR nullif(t->>'revision','') IS NULL)
  OR (SELECT count(DISTINCT t->>'id') FROM jsonb_array_elements(targets) t)<>jsonb_array_length(targets) THEN RAISE EXCEPTION 'Seleção inválida.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.doctor_directory_operations(actor_id,request_id,organization_id,action,payload) VALUES(actor,request_id,org,operation,payload) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM public.doctor_directory_operations o WHERE o.actor_id=actor AND o.request_id=nv_doctor_directory_bulk.request_id FOR UPDATE;
 IF prior.organization_id<>org OR prior.payload<>payload THEN RAISE EXCEPTION 'Requisição divergente.' USING ERRCODE='22023'; END IF;
 IF prior.result IS NOT NULL THEN RETURN prior.result; END IF;
 IF operation='request_documents' THEN SELECT array_agg(r->>'id') INTO pending_ids FROM public.nv_directory_rows(org) r WHERE (r->'documents'->>'pending')::int>0 OR (r->'documents'->>'near')::int>0; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(targets) LOOP
  BEGIN
   SELECT * INTO d FROM public.doctors WHERE id=item->>'id' AND organization_id=org FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Indisponível.' USING ERRCODE='42501'; END IF;
   IF d.updated_at IS DISTINCT FROM (item->>'revision')::timestamptz THEN RAISE EXCEPTION 'Cadastro alterado.' USING ERRCODE='40001'; END IF;
   outcome:='success';
   IF operation='status' THEN PERFORM public.nv_set_doctor_status(d.id,new_status,d.updated_at); SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
   ELSE
    SELECT e.auth_user_id INTO recipient FROM public.doctor_enrollments e JOIN auth.users a ON a.id=e.auth_user_id
     WHERE e.doctor_id=d.id AND e.organization_id=org AND d.status<>'inactive' AND a.deleted_at IS NULL AND a.email_confirmed_at IS NOT NULL
      AND a.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true' AND (a.banned_until IS NULL OR a.banned_until<=now());
    IF NOT coalesce(d.id=ANY(pending_ids),false) THEN outcome:='no_pending_documents';
    ELSIF recipient IS NULL THEN outcome:='no_portal_account';
    ELSE
     INSERT INTO public.portal_notifications(recipient_id,event_key,message) VALUES(recipient,'document-request:'||request_id||':'||d.id,'A administração solicitou a regularização dos seus documentos pendentes. Consulte Documentos no Portal Médico.') ON CONFLICT DO NOTHING;
     INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,details) VALUES(d.id,org,actor,'documents_requested',jsonb_build_object('request_id',request_id));
    END IF;
   END IF;
  EXCEPTION WHEN OTHERS THEN outcome:=CASE SQLSTATE WHEN '42501' THEN 'unavailable' WHEN '40001' THEN 'stale' WHEN '22023' THEN 'invalid' ELSE 'failed' END;
  END;
  results:=results||jsonb_build_array(jsonb_build_object('id',item->>'id','result',outcome));
 END LOOP;
 UPDATE public.doctor_directory_operations o SET result=results WHERE o.actor_id=actor AND o.request_id=nv_doctor_directory_bulk.request_id;
 RETURN results;
END;
$$;

CREATE FUNCTION public.nv_export_doctor_directory(org text,filters jsonb,ids text[],request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=public.nv_session_actor(); exported_rows jsonb; prior public.doctor_directory_operations; payload jsonb:=jsonb_build_object('filters',filters,'ids',ids);
BEGIN
 PERFORM public.nv_directory_validate(org,filters);
 IF NOT public.nv_can_action(org,'relatorios','view') OR public.nv_admin_mfa_session() IS NULL THEN RAISE EXCEPTION 'Exportação exige permissão e MFA.' USING ERRCODE='42501'; END IF;
 IF request_id IS NULL OR cardinality(ids)>100 OR array_position(ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Seleção inválida.' USING ERRCODE='22023'; END IF;
 IF ids IS NOT NULL AND EXISTS(SELECT FROM unnest(ids) chosen(doctor_id) WHERE NOT EXISTS(SELECT FROM public.doctors d WHERE d.id=chosen.doctor_id AND d.organization_id=org)) THEN RAISE EXCEPTION 'Seleção indisponível.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.doctor_directory_operations(actor_id,request_id,organization_id,action,payload) VALUES(actor,request_id,org,'export',payload) ON CONFLICT DO NOTHING;
 SELECT * INTO prior FROM public.doctor_directory_operations o WHERE o.actor_id=actor AND o.request_id=nv_export_doctor_directory.request_id FOR UPDATE;
 IF prior.organization_id<>org OR prior.action<>'export' OR prior.payload<>payload THEN RAISE EXCEPTION 'Requisição divergente.' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(r ORDER BY public.nv_directory_search(r->>'name'),r->>'id'),'[]') INTO exported_rows FROM public.nv_directory_rows(org) r
  WHERE public.nv_directory_matches(r,filters) AND (ids IS NULL OR r->>'id'=ANY(ids));
 IF jsonb_array_length(exported_rows)>10000 THEN RAISE EXCEPTION 'Refine os filtros para exportar até 10.000 médicos.' USING ERRCODE='22023'; END IF;
 IF octet_length(exported_rows::text)>16000000 THEN RAISE EXCEPTION 'Refine os filtros para reduzir a exportação.' USING ERRCODE='22023'; END IF;
 UPDATE public.doctor_directory_operations o SET result=jsonb_build_object('count',jsonb_array_length(exported_rows)) WHERE o.actor_id=actor AND o.request_id=nv_export_doctor_directory.request_id;
 RETURN exported_rows;
END;
$$;

-- No second preference store: extend the existing account RPCs.
CREATE FUNCTION public.nv_doctor_rqes(target text,entries jsonb DEFAULT NULL,revision text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors; previous jsonb; current_revision text; result jsonb;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target FOR UPDATE;
 IF NOT FOUND OR NOT public.nv_can_action(d.organization_id,'medicos','view') THEN RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('number',q.number,'specialty',q.specialty) ORDER BY q.number),'[]') INTO previous FROM public.doctor_rqes q WHERE q.doctor_id=target;
 current_revision:=md5(previous::text||coalesce(d.rqe,''));
 IF entries IS NOT NULL THEN
  IF NOT public.nv_can_action(d.organization_id,'medicos','edit') OR public.nv_admin_mfa_session() IS NULL THEN RAISE EXCEPTION 'Edição exige permissão e MFA.' USING ERRCODE='42501'; END IF;
  IF revision IS DISTINCT FROM current_revision THEN RAISE EXCEPTION 'Registros alterados. Reabra o formulário.' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries)>20
   OR EXISTS(SELECT FROM jsonb_array_elements(entries) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
    OR EXISTS(SELECT FROM jsonb_object_keys(e) k WHERE k NOT IN('number','specialty'))
    OR e->>'number' IS NULL OR e->>'number' !~ '^[0-9]{1,20}$'
    OR (e->>'specialty' IS NOT NULL AND NOT EXISTS(SELECT FROM public.organizations o WHERE o.id=d.organization_id AND o.settings->'specialties' ? (e->>'specialty'))
     AND NOT EXISTS(SELECT FROM public.doctor_rqes q WHERE q.doctor_id=target AND q.number=e->>'number' AND q.specialty=e->>'specialty')))
   OR (SELECT count(DISTINCT e->>'number') FROM jsonb_array_elements(entries) e)<>jsonb_array_length(entries) THEN RAISE EXCEPTION 'Confira os RQEs e suas especialidades.' USING ERRCODE='22023'; END IF;
  DELETE FROM public.doctor_rqes q WHERE q.doctor_id=target AND NOT EXISTS(SELECT FROM jsonb_array_elements(entries) e WHERE e->>'number'=q.number);
  INSERT INTO public.doctor_rqes(doctor_id,organization_id,number,specialty) SELECT target,d.organization_id,e->>'number',e->>'specialty' FROM jsonb_array_elements(entries) e
   ON CONFLICT(doctor_id,number) DO UPDATE SET specialty=excluded.specialty;
  SELECT coalesce(jsonb_agg(jsonb_build_object('number',q.number,'specialty',q.specialty) ORDER BY q.number),'[]') INTO result FROM public.doctor_rqes q WHERE q.doctor_id=target;
  IF result IS DISTINCT FROM previous THEN INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields,details)
   VALUES(target,d.organization_id,public.nv_session_actor(),'rqes_updated',ARRAY['rqes'],jsonb_build_object('before',previous,'after',result)); END IF;
  previous:=result; current_revision:=md5(previous::text||coalesce(d.rqe,''));
 END IF;
 RETURN jsonb_build_object('entries',previous,'legacy',d.rqe,'revision',current_revision,'canEdit',public.nv_can_action(d.organization_id,'medicos','edit'));
END;
$$;

ALTER TABLE public.account_preferences ADD COLUMN doctor_listing jsonb NOT NULL DEFAULT '{"pageSize":25,"sort":"name","descending":false,"columns":["crm","specialty","contract","units","status","documents"]}';
ALTER FUNCTION public.nv_account_preferences() RENAME TO nv_account_preferences_before_directory;
CREATE FUNCTION public.nv_account_preferences() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.nv_account_preferences_before_directory()||jsonb_build_object('doctorListing',p.doctor_listing)
 FROM public.account_preferences p WHERE p.auth_user_id=public.nv_account_actor();
$$;
ALTER FUNCTION public.nv_save_account_preferences(jsonb) RENAME TO nv_save_account_preferences_before_directory;
CREATE FUNCTION public.nv_save_account_preferences(changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=public.nv_account_actor(); listing jsonb:=changes->'doctorListing';
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Acesso restrito.' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(changes) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Preferências inválidas.' USING ERRCODE='22023'; END IF;
 IF changes ? 'doctorListing' THEN
  IF jsonb_typeof(listing) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(listing))<>4
   OR jsonb_typeof(listing->'pageSize') IS DISTINCT FROM 'number' OR listing->>'pageSize' NOT IN('25','50','100')
   OR listing->>'sort' IS NULL OR listing->>'sort' NOT IN('name','crm','specialty','status','pending')
   OR jsonb_typeof(listing->'descending') IS DISTINCT FROM 'boolean' OR jsonb_typeof(listing->'columns') IS DISTINCT FROM 'array'
   OR NOT(listing->'columns' ?& ARRAY['crm','status'])
   OR EXISTS(SELECT FROM jsonb_array_elements(listing->'columns') c WHERE jsonb_typeof(c)<>'string' OR c#>>'{}' NOT IN('crm','specialty','contract','units','status','documents'))
   OR jsonb_array_length(listing->'columns')<>(SELECT count(DISTINCT c) FROM jsonb_array_elements(listing->'columns') c) THEN RAISE EXCEPTION 'Preferências inválidas.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.account_preferences(auth_user_id) VALUES(actor) ON CONFLICT DO NOTHING;
  UPDATE public.account_preferences SET doctor_listing=listing WHERE auth_user_id=actor;
 END IF;
 IF changes-'doctorListing'<>'{}'::jsonb THEN PERFORM public.nv_save_account_preferences_before_directory(changes-'doctorListing');
 ELSIF NOT changes ? 'doctorListing' THEN RAISE EXCEPTION 'Preferências inválidas.' USING ERRCODE='22023'; END IF;
 RETURN public.nv_account_preferences();
END;
$$;

REVOKE ALL ON FUNCTION public.nv_directory_search(text),public.nv_directory_rows(text),public.nv_directory_matches(jsonb,jsonb),public.nv_directory_validate(text,jsonb),
 public.nv_doctor_directory(text,jsonb,integer,integer,text,boolean),public.nv_doctor_directory_bulk(text,uuid,text,jsonb,text),public.nv_export_doctor_directory(text,jsonb,text[],uuid),public.nv_doctor_rqes(text,jsonb,text),
 public.nv_account_preferences_before_directory(),public.nv_save_account_preferences_before_directory(jsonb),public.nv_account_preferences(),public.nv_save_account_preferences(jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_doctor_directory(text,jsonb,integer,integer,text,boolean),public.nv_doctor_directory_bulk(text,uuid,text,jsonb,text),
 public.nv_export_doctor_directory(text,jsonb,text[],uuid),public.nv_doctor_rqes(text,jsonb,text),public.nv_account_preferences(),public.nv_save_account_preferences(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
