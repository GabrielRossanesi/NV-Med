-- Apply after 35. No invitation, password reset, approval or data backfill is performed.
BEGIN;

ALTER FUNCTION public.nv_permission_actions() RENAME TO nv_permission_actions_before_doctor_access;
CREATE FUNCTION public.nv_permission_actions()
RETURNS TABLE(module text, action text) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT * FROM public.nv_permission_actions_before_doctor_access()
 UNION ALL SELECT 'portal_medico',unnest(ARRAY['view','edit']);
$$;
ALTER FUNCTION public.nv_role_action(text,text,text,text) RENAME TO nv_role_action_before_doctor_access;
CREATE FUNCTION public.nv_role_action(account_type text,account_role text,module text,action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN module='portal_medico' THEN action IN('view','edit') AND
  CASE WHEN account_type='saas_admin' THEN account_role IN('CEO','Gerente') ELSE account_role IN('Diretor','Gerente') END
 ELSE public.nv_role_action_before_doctor_access(account_type,account_role,module,action) END;
$$;

-- Imported records have no known birth date. Do not invent personal information.
ALTER TABLE public.doctor_enrollments ALTER COLUMN birth_date DROP NOT NULL;

CREATE TABLE public.doctor_profile_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 doctor_id text NOT NULL,
 organization_id text NOT NULL,
 actor_id uuid,
 action text NOT NULL,
 changed_fields text[] NOT NULL DEFAULT '{}',
 details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doctor_profile_audit_target_idx ON public.doctor_profile_audit(doctor_id,id DESC);
CREATE TABLE public.doctor_access_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 doctor_id text NOT NULL REFERENCES public.doctors(id),
 organization_id text NOT NULL,
 actor_id uuid NOT NULL,
 auth_user_id uuid,
 action text NOT NULL CHECK(action IN('invite','reset','email','block','unblock')),
 email text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','sent','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
CREATE INDEX doctor_access_operations_target_idx ON public.doctor_access_operations(doctor_id,created_at DESC);
ALTER TABLE public.doctor_profile_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_access_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doctor_profile_audit,public.doctor_access_operations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.nv_doctor_profile_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE credential_email text;
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
  RAISE EXCEPTION 'A identidade e a empresa do médico devem ser preservadas.' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('nv-doctor-profile:'||NEW.organization_id,0));
 SELECT a.email INTO credential_email FROM public.doctor_enrollments e JOIN auth.users a ON a.id=e.auth_user_id WHERE e.doctor_id=NEW.id;
 IF NEW.email IS DISTINCT FROM OLD.email AND credential_email IS NOT NULL AND lower(btrim(NEW.email))<>lower(credential_email) THEN
  RAISE EXCEPTION 'Altere o e-mail pela seção Acesso ao Portal Médico.' USING ERRCODE='22023';
 END IF;
 IF NEW.email IS DISTINCT FROM OLD.email AND credential_email IS NULL AND NOT public.nv_can_action(NEW.organization_id,'portal_medico','edit')
  AND NOT EXISTS(SELECT FROM public.doctor_access_operations o WHERE o.doctor_id=NEW.id AND o.action='email' AND o.status='pending' AND o.email=lower(btrim(NEW.email)) AND o.created_at>now()-interval '5 minutes') THEN
  RAISE EXCEPTION 'A alteração do e-mail exige gestão de acesso ao portal.' USING ERRCODE='42501';
 END IF;
 -- Validate only changed values so incomplete imported records can be corrected incrementally.
 IF (NEW.name IS DISTINCT FROM OLD.name AND length(btrim(NEW.name)) NOT BETWEEN 3 AND 150)
  OR (coalesce(NEW.phone,'') IS DISTINCT FROM coalesce(OLD.phone,'') AND regexp_replace(coalesce(NEW.phone,''),'[^0-9]','','g') !~ '^[0-9]{10,13}$')
  OR (NEW.crm IS DISTINCT FROM OLD.crm AND coalesce(NEW.crm,'') !~ '^[0-9]{1,12}$')
  OR (NEW.crm_uf IS DISTINCT FROM OLD.crm_uf AND NEW.crm_uf NOT IN('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'))
  OR (NEW.cpf IS DISTINCT FROM OLD.cpf AND NOT public.nv_valid_cpf(regexp_replace(NEW.cpf,'[^0-9]','','g')))
  OR length(coalesce(NEW.address,''))>500
  OR (NEW.email IS DISTINCT FROM OLD.email AND (length(NEW.email)>254 OR NEW.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
  OR (NEW.specialty IS DISTINCT FROM OLD.specialty AND NOT EXISTS(SELECT FROM public.organizations o WHERE o.id=NEW.organization_id AND coalesce(o.settings->'specialties','[]') ? NEW.specialty)) THEN
  RAISE EXCEPTION 'Confira os dados cadastrais alterados.' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT FROM public.doctors d WHERE d.organization_id=NEW.organization_id AND d.id<>NEW.id AND (
  (NEW.email IS DISTINCT FROM OLD.email AND lower(btrim(d.email))=lower(btrim(NEW.email))) OR
  (NEW.cpf IS DISTINCT FROM OLD.cpf AND regexp_replace(d.cpf,'[^0-9]','','g')=regexp_replace(NEW.cpf,'[^0-9]','','g')) OR
  ((NEW.crm,NEW.crm_uf) IS DISTINCT FROM (OLD.crm,OLD.crm_uf) AND upper(d.crm_uf)=upper(NEW.crm_uf) AND ltrim(d.crm,'0')=ltrim(NEW.crm,'0')))) THEN
  RAISE EXCEPTION 'Já existe um médico com este e-mail, CPF ou CRM na empresa.' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER nv_a_doctor_profile_guard BEFORE UPDATE ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.nv_doctor_profile_guard();

CREATE FUNCTION public.nv_audit_doctor_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fields text[]; actor uuid:=public.nv_session_actor();
BEGIN
 SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_each(to_jsonb(NEW)) WHERE key NOT IN('updated_at','created_at') AND value IS DISTINCT FROM to_jsonb(OLD)->key;
 IF coalesce(cardinality(fields),0)>0 THEN
  IF actor IS NULL AND 'email'=ANY(fields) THEN SELECT o.actor_id INTO actor FROM public.doctor_access_operations o
   WHERE o.doctor_id=NEW.id AND o.action='email' AND o.email=lower(NEW.email) AND o.status='pending' AND o.created_at>now()-interval '5 minutes' ORDER BY o.created_at DESC LIMIT 1; END IF;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields)
   VALUES(NEW.id,NEW.organization_id,actor,'profile_updated',fields);
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER nv_audit_doctor_profile AFTER UPDATE ON public.doctors FOR EACH ROW EXECUTE FUNCTION public.nv_audit_doctor_profile();

CREATE FUNCTION public.nv_doctor_profile(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors; e public.doctor_enrollments;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target;
 IF NOT FOUND OR NOT(public.nv_can_action(d.organization_id,'medicos','view') OR public.nv_owns_doctor(d.organization_id,target)) THEN
  RAISE EXCEPTION 'Perfil indisponível.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.doctor_enrollments WHERE doctor_id=target;
 RETURN jsonb_build_object('profile',to_jsonb(d)-'created_at','specialties',coalesce(e.approved_specialties,'{}'),
  'birth_date',e.birth_date,'has_enrollment',e.doctor_id IS NOT NULL,'enrollment_status',e.status,'requested_specialties',coalesce(e.requested_specialties,'{}'),
  'can_approve',public.nv_can_action(d.organization_id,'medicos','approve'),
  'can_edit',public.nv_can_action(d.organization_id,'medicos','edit') OR public.nv_owns_doctor(d.organization_id,target));
END;
$$;

CREATE FUNCTION public.nv_update_doctor_profile(target text,profile jsonb,revision timestamptz,specialties text[] DEFAULT NULL,birth date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors; n public.doctors; staff boolean; catalog jsonb; e public.doctor_enrollments;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target FOR UPDATE;
 staff:=public.nv_can_action(d.organization_id,'medicos','edit');
 IF d.id IS NULL OR NOT(staff OR public.nv_owns_doctor(d.organization_id,target)) THEN RAISE EXCEPTION 'Edição não autorizada.' USING ERRCODE='42501'; END IF;
 IF revision IS NULL OR revision IS DISTINCT FROM d.updated_at THEN RAISE EXCEPTION 'O cadastro mudou. Reabra o formulário antes de salvar.' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(profile) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_object_keys(profile) k WHERE k NOT IN('name','phone','address','crm','crm_uf','rqe','cpf','specialty','status','contract_model','contract_signed')) THEN
  RAISE EXCEPTION 'Campos não permitidos.' USING ERRCODE='22023';
 END IF;
 IF NOT staff AND (EXISTS(SELECT FROM jsonb_object_keys(profile) k WHERE k NOT IN('name','phone','address')) OR specialties IS NOT NULL OR birth IS NOT NULL) THEN
  RAISE EXCEPTION 'A alteração profissional depende da coordenação.' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT FROM jsonb_each(profile) p WHERE p.value='null'::jsonb AND p.key<>'rqe') THEN RAISE EXCEPTION 'Confira os campos obrigatórios.' USING ERRCODE='22023'; END IF;
 SELECT * INTO n FROM jsonb_populate_record(d,profile);
 UPDATE public.doctors SET name=n.name,phone=n.phone,address=n.address,crm=n.crm,crm_uf=n.crm_uf,rqe=n.rqe,cpf=n.cpf,
  specialty=n.specialty,status=n.status,contract_model=n.contract_model,contract_signed=n.contract_signed WHERE id=target;
 SELECT * INTO e FROM public.doctor_enrollments WHERE doctor_id=target FOR UPDATE;
 IF e.status='approved' AND n.specialty IS DISTINCT FROM d.specialty AND NOT n.specialty=ANY(coalesce(specialties,e.approved_specialties)) THEN
  RAISE EXCEPTION 'A especialidade principal precisa estar entre as especialidades autorizadas.' USING ERRCODE='22023'; END IF;
 IF specialties IS NOT NULL AND specialties IS DISTINCT FROM (CASE WHEN e.status='approved' THEN e.approved_specialties ELSE e.requested_specialties END) THEN
  SELECT settings->'specialties' INTO catalog FROM public.organizations WHERE id=d.organization_id;
  IF e.doctor_id IS NULL OR e.status NOT IN('approved','pending','correction_requested') OR NOT staff OR (e.status='approved' AND NOT public.nv_can_action(d.organization_id,'medicos','approve')) THEN RAISE EXCEPTION 'Sem permissão para alterar as especialidades deste credenciamento.' USING ERRCODE='42501'; END IF;
  IF cardinality(specialties) NOT BETWEEN 1 AND 10 OR array_position(specialties,NULL) IS NOT NULL OR
   cardinality(specialties)<>(SELECT count(DISTINCT s) FROM unnest(specialties) s) OR EXISTS(SELECT FROM unnest(specialties) s WHERE NOT(catalog ? s)) OR NOT n.specialty=ANY(specialties) THEN
   RAISE EXCEPTION 'Selecione especialidades válidas, incluindo a principal.' USING ERRCODE='22023'; END IF;
  IF e.status='approved' AND EXISTS(SELECT FROM public.shifts s WHERE s.doctor_id=target AND s.status NOT IN('completed','cancelled') AND public.nv_shift_ends(s)>now() AND NOT s.specialty=ANY(specialties)) THEN
   RAISE EXCEPTION 'Uma especialidade removida está em uso em plantões futuros. Regularize a escala antes de removê-la.' USING ERRCODE='22023'; END IF;
  IF e.status='approved' THEN UPDATE public.doctor_enrollments SET approved_specialties=specialties,requested_specialties=ARRAY(SELECT DISTINCT unnest(requested_specialties||specialties)) WHERE doctor_id=target;
  ELSE UPDATE public.doctor_enrollments SET requested_specialties=specialties WHERE doctor_id=target; END IF;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields) VALUES(target,d.organization_id,public.nv_session_actor(),'profile_updated',ARRAY[CASE WHEN e.status='approved' THEN 'approved_specialties' ELSE 'requested_specialties' END]);
 END IF;
 IF birth IS NOT NULL AND birth IS DISTINCT FROM e.birth_date THEN
  IF e.doctor_id IS NULL OR birth>current_date-interval '18 years' OR birth<current_date-interval '120 years' THEN RAISE EXCEPTION 'Confira a data de nascimento.' USING ERRCODE='22023'; END IF;
  UPDATE public.doctor_enrollments SET birth_date=birth WHERE doctor_id=target;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields) VALUES(target,d.organization_id,public.nv_session_actor(),'profile_updated',ARRAY['birth_date']);
 END IF;
 -- Keep submitted display/contact values consistent, without changing credential decisions.
 UPDATE public.doctor_enrollments SET submitted_name=CASE WHEN n.name IS DISTINCT FROM d.name THEN n.name ELSE submitted_name END,
  submitted_phone=CASE WHEN n.phone IS DISTINCT FROM d.phone THEN coalesce(n.phone,'') ELSE submitted_phone END
  WHERE doctor_id=target AND (n.name IS DISTINCT FROM d.name OR n.phone IS DISTINCT FROM d.phone);
 IF staff AND n.specialty IS DISTINCT FROM d.specialty THEN
  UPDATE public.doctor_enrollments SET requested_specialties=ARRAY(SELECT DISTINCT unnest(requested_specialties||ARRAY[n.specialty])) WHERE doctor_id=target AND status='pending';
 END IF;
 PERFORM public.nv_sync_enrollment_documents(target);
END;
$$;

CREATE FUNCTION public.nv_doctor_history(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE org text;
BEGIN
 SELECT organization_id INTO org FROM public.doctors WHERE id=target;
 IF NOT public.nv_can_action(org,'medicos','view') THEN RAISE EXCEPTION 'Histórico indisponível.' USING ERRCODE='42501'; END IF;
 RETURN(SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id DESC),'[]') FROM
  (SELECT a.id,a.actor_id,coalesce(u.name,'Conta médica ou sistema') actor_name,a.action,a.changed_fields,a.details,a.created_at FROM public.doctor_profile_audit a
   LEFT JOIN public.user_accounts u ON u.auth_user_id=a.actor_id WHERE a.doctor_id=target ORDER BY a.id DESC LIMIT 50) h);
END;
$$;

CREATE FUNCTION public.nv_doctor_access(target text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors; a auth.users; allowed boolean;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target;
 IF NOT FOUND OR NOT public.nv_can_action(d.organization_id,'medicos','view') THEN RAISE EXCEPTION 'Acesso indisponível.' USING ERRCODE='42501'; END IF;
 SELECT u.* INTO a FROM public.doctor_enrollments e JOIN auth.users u ON u.id=e.auth_user_id WHERE e.doctor_id=target;
 allowed:=public.nv_can_action(d.organization_id,'portal_medico','edit');
 RETURN jsonb_build_object('email',coalesce(a.email,btrim(d.email),''),'linked',a.id IS NOT NULL,
  'status',CASE WHEN a.id IS NULL THEN 'not_released' WHEN a.banned_until>now() OR d.status='inactive' OR a.deleted_at IS NOT NULL THEN 'blocked'
    WHEN a.email_confirmed_at IS NULL OR a.raw_app_meta_data->>'must_change_password'='true' THEN 'pending' ELSE 'active' END,
  'last_sign_in_at',a.last_sign_in_at,'can_manage',allowed,'revision',d.updated_at,
  'record_inactive',d.status='inactive','auth_blocked',coalesce(a.banned_until>now(),false));
END;
$$;

-- Called with the administrator's session (RLS/effective permissions), before using Auth Admin.
CREATE FUNCTION public.nv_begin_doctor_access(target text,operation text,new_email text DEFAULT NULL,revision timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors; a auth.users; operation_id uuid; destination text;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target FOR UPDATE;
 IF d.id IS NULL OR NOT public.nv_can_action(d.organization_id,'medicos','view') OR NOT public.nv_can_action(d.organization_id,'portal_medico','edit') THEN RAISE EXCEPTION 'Gestão de acesso não autorizada.' USING ERRCODE='42501'; END IF;
 IF revision IS NULL OR revision IS DISTINCT FROM d.updated_at THEN RAISE EXCEPTION 'O cadastro mudou. Atualize a página.' USING ERRCODE='22023'; END IF;
 IF operation IS NULL OR operation NOT IN('invite','reset','email','block','unblock') THEN RAISE EXCEPTION 'Ação inválida.' USING ERRCODE='22023'; END IF;
 SELECT u.* INTO a FROM public.doctor_enrollments e JOIN auth.users u ON u.id=e.auth_user_id WHERE e.doctor_id=target;
 destination:=CASE WHEN operation='email' THEN lower(btrim(new_email)) ELSE lower(btrim(coalesce(a.email,d.email))) END;
 IF destination IS NULL OR length(destination)>254 OR destination !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Informe um e-mail válido.' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('nv-doctor-email:'||destination,0));
 IF EXISTS(SELECT FROM public.doctor_access_operations o WHERE (o.doctor_id=target OR (a.id IS NOT NULL AND o.auth_user_id=a.id) OR (o.email=destination AND o.status='pending')) AND o.created_at>now()-interval '60 seconds') THEN RAISE EXCEPTION 'Aguarde um minuto antes de repetir uma ação de acesso.' USING ERRCODE='22023'; END IF;
 IF operation='invite' AND EXISTS(SELECT FROM public.doctors x WHERE x.id<>target AND x.organization_id=d.organization_id AND lower(btrim(x.email))=destination) THEN
  RAISE EXCEPTION 'Há mais de um cadastro médico com este e-mail na empresa. Regularize antes de liberar o acesso.' USING ERRCODE='23505'; END IF;
 IF a.id IS NULL AND operation NOT IN('invite','email') THEN RAISE EXCEPTION 'Envie primeiro um convite de acesso.' USING ERRCODE='22023'; END IF;
 IF a.id IS NOT NULL AND operation='invite' AND a.email_confirmed_at IS NOT NULL AND a.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Conta já ativada. Use a redefinição de senha.' USING ERRCODE='22023'; END IF;
 IF operation IN('invite','reset') AND (d.status='inactive' OR a.banned_until>now() OR a.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'Regularize o acesso inativo ou bloqueado antes de enviar um link.' USING ERRCODE='22023'; END IF;
 IF a.id IS NULL AND operation='invite' THEN
  SELECT * INTO a FROM auth.users WHERE lower(email)=destination AND deleted_at IS NULL;
 END IF;
 IF operation IN('invite','reset') AND a.banned_until>now() THEN RAISE EXCEPTION 'A conta já existente está bloqueada. Solicite a regularização a um administrador.' USING ERRCODE='22023'; END IF;
 IF a.id IS NOT NULL AND (EXISTS(SELECT FROM public.user_accounts WHERE auth_user_id=a.id) OR EXISTS(
  SELECT FROM public.doctor_enrollments e WHERE e.auth_user_id=a.id AND e.organization_id=d.organization_id AND e.doctor_id<>target)) THEN
  RAISE EXCEPTION 'Este e-mail pertence a outro acesso. Regularize os vínculos antes de continuar.' USING ERRCODE='23505'; END IF;
 IF operation IN('email','block','unblock') AND a.id IS NOT NULL AND EXISTS(
  SELECT FROM public.doctor_enrollments e WHERE e.auth_user_id=a.id AND NOT(public.nv_can_action(e.organization_id,'portal_medico','edit') AND public.nv_can_action(e.organization_id,'medicos','view'))) THEN
  RAISE EXCEPTION 'A conta é compartilhada com outra empresa. Solicite a ação a um administrador autorizado em todos os vínculos.' USING ERRCODE='42501'; END IF;
 IF operation='email' AND (EXISTS(SELECT FROM auth.users u WHERE lower(u.email)=destination AND u.id IS DISTINCT FROM a.id AND u.deleted_at IS NULL)
  OR EXISTS(SELECT FROM public.doctors x WHERE lower(btrim(x.email))=destination AND x.id<>target AND
    (x.organization_id=d.organization_id OR x.organization_id IN(SELECT e.organization_id FROM public.doctor_enrollments e WHERE e.auth_user_id=a.id)) AND
    NOT EXISTS(SELECT FROM public.doctor_enrollments e WHERE e.doctor_id=x.id AND e.auth_user_id=a.id))) THEN RAISE EXCEPTION 'E-mail já utilizado por outro cadastro.' USING ERRCODE='23505'; END IF;
 INSERT INTO public.doctor_access_operations(doctor_id,organization_id,actor_id,auth_user_id,action,email)
  VALUES(target,d.organization_id,public.nv_session_actor(),a.id,operation,destination) RETURNING id INTO operation_id;
 INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,details)
  VALUES(target,d.organization_id,public.nv_session_actor(),operation||'_requested',jsonb_build_object('operation_id',operation_id));
 RETURN jsonb_build_object('id',operation_id,'auth_user_id',a.id,'email',destination);
END;
$$;

-- Service-only completion rechecks live administrative rights. No passwords/tokens enter public tables.
CREATE FUNCTION public.nv_finish_doctor_access(operation_id uuid,outcome text,new_auth uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op public.doctor_access_operations; d public.doctors; a auth.users;
BEGIN
 SELECT * INTO op FROM public.doctor_access_operations WHERE id=operation_id FOR UPDATE;
 IF NOT FOUND OR op.status<>'pending' OR op.created_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Operação expirada.' USING ERRCODE='22023'; END IF;
 IF outcome IS NULL OR outcome NOT IN('linked','sent','failed') THEN RAISE EXCEPTION 'Resultado inválido.' USING ERRCODE='22023'; END IF;
 IF outcome<>'failed' AND NOT EXISTS(SELECT FROM public.user_accounts u JOIN auth.users au ON au.id=u.auth_user_id
  WHERE u.auth_user_id=op.actor_id AND u.status='active' AND au.deleted_at IS NULL AND (au.banned_until IS NULL OR au.banned_until<=now())
   AND au.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true'
   AND (u.type='saas_admin' OR u.organization_id=op.organization_id)
   AND public.nv_profile_action(u.type,u.role,u.additional_permissions,'portal_medico','edit')
   AND public.nv_profile_action(u.type,u.role,u.additional_permissions,'medicos','view')) THEN RAISE EXCEPTION 'Permissão revogada.' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.doctors WHERE id=op.doctor_id FOR UPDATE;
 IF outcome='linked' THEN
  IF op.action<>'invite' OR (op.auth_user_id IS NOT NULL AND op.auth_user_id IS DISTINCT FROM new_auth) THEN RAISE EXCEPTION 'Vínculo inválido.' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM auth.users WHERE id=new_auth AND lower(email)=op.email AND deleted_at IS NULL;
  IF a.id IS NULL OR EXISTS(SELECT FROM public.user_accounts WHERE auth_user_id=a.id) THEN RAISE EXCEPTION 'Conta inválida.' USING ERRCODE='23505'; END IF;
  IF lower(btrim(d.email))<>op.email THEN RAISE EXCEPTION 'E-mail cadastral alterado. Atualize a página.' USING ERRCODE='22023'; END IF;
  IF op.auth_user_id=a.id AND EXISTS(SELECT FROM public.doctor_enrollments WHERE doctor_id=d.id AND auth_user_id=a.id) THEN RETURN; END IF;
  INSERT INTO public.doctor_enrollments(doctor_id,organization_id,auth_user_id,birth_date,submitted_name,submitted_phone,legacy_link,requested_specialties)
   VALUES(d.id,d.organization_id,a.id,NULL,d.name,coalesce(d.phone,''),true,CASE WHEN coalesce(d.specialty,'')='' THEN '{}'::text[] ELSE ARRAY[d.specialty] END)
   ON CONFLICT(doctor_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id
    WHERE doctor_enrollments.auth_user_id IS NULL OR doctor_enrollments.auth_user_id=EXCLUDED.auth_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'O médico já possui outro acesso vinculado.' USING ERRCODE='23505'; END IF;
  UPDATE public.doctor_access_operations SET auth_user_id=a.id WHERE id=op.id;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,details)
   VALUES(d.id,d.organization_id,op.actor_id,'account_linked',jsonb_build_object('operation_id',op.id));
  RETURN;
 END IF;
 IF outcome='sent' AND op.action='email' AND op.auth_user_id IS NULL THEN UPDATE public.doctors SET email=op.email WHERE id=d.id; END IF;
 UPDATE public.doctor_access_operations SET status=outcome,finished_at=now() WHERE id=op.id;
 INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,details)
  VALUES(d.id,d.organization_id,op.actor_id,op.action||'_'||outcome,jsonb_build_object('operation_id',op.id));
END;
$$;

-- Auth remains the source of truth. This trigger runs in the SAME transaction as
-- GoTrue's update; any conflicting physician email rolls back the Auth change too.
CREATE FUNCTION public.nv_sync_doctor_auth()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e record; actor uuid; action_name text;
BEGIN
 IF (NEW.email,NEW.banned_until) IS NOT DISTINCT FROM (OLD.email,OLD.banned_until) THEN RETURN NEW; END IF;
 SELECT actor_id INTO actor FROM public.doctor_access_operations WHERE auth_user_id=NEW.id AND status='pending' AND created_at>now()-interval '5 minutes'
  AND ((action='email' AND email=lower(NEW.email)) OR action IN('block','unblock')) ORDER BY created_at DESC LIMIT 1;
 action_name:=CASE WHEN NEW.email IS DISTINCT FROM OLD.email THEN 'email_changed' WHEN NEW.banned_until>now() THEN 'access_blocked' ELSE 'access_unblocked' END;
 FOR e IN SELECT doctor_id,organization_id FROM public.doctor_enrollments WHERE auth_user_id=NEW.id ORDER BY doctor_id LOOP
  IF NEW.email IS DISTINCT FROM OLD.email THEN UPDATE public.doctors SET email=lower(NEW.email) WHERE id=e.doctor_id; END IF;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,details) VALUES(e.doctor_id,e.organization_id,coalesce(actor,NEW.id),action_name,
   CASE WHEN action_name='email_changed' THEN jsonb_build_object('previous_email',OLD.email,'email',NEW.email) ELSE '{}'::jsonb END);
 END LOOP;
 RETURN NEW;
END;
$$;
CREATE TRIGGER nv_sync_doctor_auth AFTER UPDATE OF email,banned_until ON auth.users FOR EACH ROW EXECUTE FUNCTION public.nv_sync_doctor_auth();

CREATE FUNCTION public.nv_link_invited_doctor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE op uuid;
BEGIN
 -- The random operation marker is supplied only by the server's invite call.
 -- It is accepted only with a live, authorized, email-bound operation.
 SELECT id INTO op FROM public.doctor_access_operations WHERE action='invite' AND status='pending' AND auth_user_id IS NULL
  AND id::text=NEW.raw_user_meta_data->>'nv_med_access_operation'
  AND email=lower(NEW.email) AND created_at>now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF op IS NOT NULL THEN
  PERFORM public.nv_finish_doctor_access(op,'linked',NEW.id);
  UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('must_change_password',true,'temporary_password_set_at',now()) WHERE id=NEW.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER nv_link_invited_doctor AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.nv_link_invited_doctor();

-- Credentialing is independent from portal credentials: an enrollment can be
-- reviewed with auth_user_id NULL and later receive an individual invitation.
CREATE FUNCTION public.nv_prepare_doctor_credential(target text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target FOR UPDATE;
 IF d.id IS NULL OR NOT(public.nv_can_action(d.organization_id,'medicos','create') OR public.nv_can_action(d.organization_id,'medicos','edit')) THEN RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.doctor_enrollments(doctor_id,organization_id,birth_date,submitted_name,submitted_phone,legacy_link,requested_specialties)
  VALUES(d.id,d.organization_id,NULL,d.name,coalesce(d.phone,''),true,CASE WHEN coalesce(d.specialty,'')='' THEN '{}'::text[] ELSE ARRAY[d.specialty] END)
  ON CONFLICT(doctor_id) DO NOTHING;
 IF FOUND THEN INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action) VALUES(d.id,d.organization_id,public.nv_session_actor(),'credential_prepared'); END IF;
END;
$$;

-- Retain the banking gate and existing decision flow; remove only the Auth
-- prerequisite from its internal implementation.
CREATE OR REPLACE FUNCTION public.nv_review_enrollment_before_banking(target text,decision text,note text,specialties text[],units text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE enrollment public.doctor_enrollments; decision_id bigint;
BEGIN
 SELECT * INTO enrollment FROM public.doctor_enrollments WHERE doctor_id=target FOR UPDATE;
 IF NOT FOUND OR NOT public.nv_can_action(enrollment.organization_id,'medicos','approve') THEN RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE='42501'; END IF;
 IF enrollment.status<>'pending' OR decision IS NULL OR decision NOT IN('approved','rejected','correction_requested') THEN RAISE EXCEPTION 'Este cadastro não aguarda decisão.' USING ERRCODE='22023'; END IF;
 note:=nullif(btrim(note),'');
 IF length(note)>1000 OR (decision<>'approved' AND note IS NULL) THEN RAISE EXCEPTION 'Informe uma justificativa de até 1000 caracteres.' USING ERRCODE='22023'; END IF;
 IF decision='approved' THEN
  IF coalesce(cardinality(specialties),0)=0 OR array_position(specialties,NULL) IS NOT NULL OR NOT(specialties<@enrollment.requested_specialties)
   OR coalesce(cardinality(units),0)=0 OR EXISTS(SELECT FROM unnest(units) unit_id WHERE NOT EXISTS(
    SELECT FROM public.units u WHERE u.id=unit_id AND u.organization_id=enrollment.organization_id AND u.status='active')) THEN
   RAISE EXCEPTION 'Selecione especialidades solicitadas e unidades ativas da empresa.' USING ERRCODE='22023'; END IF;
  UPDATE public.doctors SET name=enrollment.submitted_name,phone=coalesce(nullif(enrollment.submitted_phone,''),phone),specialty=specialties[1],linked_units=units,status='active' WHERE id=target;
 ELSE
  specialties:='{}'; units:='{}';
  IF NOT enrollment.legacy_link THEN UPDATE public.doctors SET status=CASE WHEN decision='rejected' THEN 'inactive' ELSE 'pending' END WHERE id=target; END IF;
 END IF;
 UPDATE public.doctor_enrollments SET status=decision,review_note=note,reviewed_at=now(),approved_specialties=specialties WHERE doctor_id=target;
 PERFORM public.nv_sync_enrollment_documents(target);
 INSERT INTO public.doctor_enrollment_decisions(doctor_id,actor_id,status,note,specialties,unit_ids)
  VALUES(target,public.nv_session_actor(),decision,note,specialties,units) RETURNING id INTO decision_id;
 INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields)
  VALUES(target,enrollment.organization_id,public.nv_session_actor(),'credential_'||decision,ARRAY['approved_specialties','linked_units']);
 IF enrollment.auth_user_id IS NOT NULL THEN INSERT INTO public.portal_notifications(recipient_id,event_key,message)
  VALUES(enrollment.auth_user_id,'enrollment:'||decision_id,CASE decision WHEN 'approved' THEN 'Seu cadastro médico foi aprovado.' WHEN 'rejected' THEN 'Seu cadastro médico foi rejeitado.' ELSE 'A coordenação solicitou correções no seu cadastro.' END); END IF;
END;
$$;

-- Self registration cannot claim an imported/administrative record that has
-- not been individually released. New, unrelated self-enrollments remain supported.
ALTER FUNCTION public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[],jsonb) RENAME TO nv_submit_enrollment_before_individual_access;
CREATE FUNCTION public.nv_submit_enrollment(org text,full_name text,registration text,uf text,tax_id text,birth date,phone_number text,pix text,specialties text[],banking jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT FROM public.doctors d WHERE d.organization_id=org AND
  (regexp_replace(d.cpf,'[^0-9]','','g')=tax_id OR (ltrim(d.crm,'0')=ltrim(registration,'0') AND upper(d.crm_uf)=upper(uf))
    OR lower(btrim(d.email))=(SELECT lower(email) FROM auth.users WHERE id=public.nv_session_actor()))
  AND NOT EXISTS(SELECT FROM public.doctor_enrollments e WHERE e.doctor_id=d.id AND e.auth_user_id=public.nv_session_actor())) THEN
  RAISE EXCEPTION 'Seu cadastro já existe. Solicite a liberação individual do portal à administração.' USING ERRCODE='42501';
 END IF;
 PERFORM public.nv_submit_enrollment_before_individual_access(org,full_name,registration,uf,tax_id,birth,phone_number,pix,specialties,banking);
END;
$$;

REVOKE ALL ON FUNCTION public.nv_permission_actions(),public.nv_role_action(text,text,text,text),
 public.nv_permission_actions_before_doctor_access(),public.nv_role_action_before_doctor_access(text,text,text,text),
 public.nv_submit_enrollment_before_individual_access(text,text,text,text,text,date,text,text,text[],jsonb),
 public.nv_prepare_doctor_credential(text),public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[],jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nv_permission_actions(),public.nv_role_action(text,text,text,text),
 public.nv_permission_actions_before_doctor_access(),public.nv_role_action_before_doctor_access(text,text,text,text),
 public.nv_prepare_doctor_credential(text),public.nv_submit_enrollment(text,text,text,text,text,date,text,text,text[],jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.nv_doctor_profile_guard(),public.nv_audit_doctor_profile(),public.nv_sync_doctor_auth(),public.nv_link_invited_doctor(),
 public.nv_finish_doctor_access(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nv_finish_doctor_access(uuid,text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.nv_doctor_profile(text),public.nv_update_doctor_profile(text,jsonb,timestamptz,text[],date),public.nv_doctor_history(text),
 public.nv_doctor_access(text),public.nv_begin_doctor_access(text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nv_doctor_profile(text),public.nv_update_doctor_profile(text,jsonb,timestamptz,text[],date),public.nv_doctor_history(text),
 public.nv_doctor_access(text),public.nv_begin_doctor_access(text,text,text,timestamptz) TO authenticated;
COMMIT;
