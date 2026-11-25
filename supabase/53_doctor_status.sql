-- Status-only write. No Auth, credential, document or financial action is performed.
-- Apply after 52 and before publishing the corresponding interface.
BEGIN;
CREATE OR REPLACE FUNCTION public.nv_audit_doctor_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fields text[]; actor uuid:=public.nv_session_actor();
BEGIN
 SELECT array_agg(key ORDER BY key) INTO fields FROM jsonb_each(to_jsonb(NEW))
  WHERE key NOT IN('updated_at','created_at') AND value IS DISTINCT FROM to_jsonb(OLD)->key;
 IF coalesce(cardinality(fields),0)>0 THEN
  IF actor IS NULL AND 'email'=ANY(fields) THEN SELECT o.actor_id INTO actor FROM public.doctor_access_operations o
   WHERE o.doctor_id=NEW.id AND o.action='email' AND o.email=lower(NEW.email) AND o.status='pending'
    AND o.created_at>now()-interval '5 minutes' ORDER BY o.created_at DESC LIMIT 1; END IF;
  INSERT INTO public.doctor_profile_audit(doctor_id,organization_id,actor_id,action,changed_fields,details)
   VALUES(NEW.id,NEW.organization_id,actor,'profile_updated',fields,
    CASE WHEN NEW.status IS DISTINCT FROM OLD.status THEN jsonb_build_object('previous_status',OLD.status,'status',NEW.status) ELSE '{}'::jsonb END);
 END IF;
 RETURN NEW;
END;
$$;

CREATE FUNCTION public.nv_set_doctor_status(target text,new_status text,revision timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.doctors;
BEGIN
 SELECT * INTO d FROM public.doctors WHERE id=target FOR UPDATE;
 IF NOT FOUND OR NOT public.nv_can_action(d.organization_id,'medicos','edit') THEN
  RAISE EXCEPTION 'Edição não autorizada.' USING ERRCODE='42501'; END IF;
 IF new_status IS NULL OR new_status NOT IN('active','pending','inactive') THEN
  RAISE EXCEPTION 'Status inválido.' USING ERRCODE='22023'; END IF;
 IF revision IS NULL OR revision IS DISTINCT FROM d.updated_at THEN
  RAISE EXCEPTION 'O cadastro mudou. Reabra o formulário antes de salvar.' USING ERRCODE='22023'; END IF;
 IF d.status IS DISTINCT FROM new_status THEN
  UPDATE public.doctors SET status=new_status WHERE id=target RETURNING * INTO d;
 END IF;
 -- The existing deferred banking constraint is preserved and checked at commit.
 -- Return only professional fields already available in the staff listing.
 RETURN jsonb_build_object('id',d.id,'organization_id',d.organization_id,'name',d.name,'crm',d.crm,'crm_uf',d.crm_uf,
  'rqe',d.rqe,'specialty',d.specialty,'status',d.status,'contract_model',d.contract_model,
  'contract_signed',d.contract_signed,'linked_units',d.linked_units,'updated_at',d.updated_at);
END;
$$;
REVOKE ALL ON FUNCTION public.nv_set_doctor_status(text,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_set_doctor_status(text,text,timestamptz) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
