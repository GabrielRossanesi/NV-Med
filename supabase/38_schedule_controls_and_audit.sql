-- Additive after 37. No existing shifts, physicians, absences or permissions are rewritten.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE FUNCTION public.nv_schedule_administrative_role(account_type text,account_role text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE account_type WHEN 'tenant_user' THEN account_role IN('Diretor','Gerente','Coordenador de Escalas','Escalista','Financeiro','Jurídico')
 WHEN 'saas_admin' THEN account_role IN('CEO','Gerente','Coordenador','Administrativo','Financeiro','Jurídico') ELSE false END;
$$;
CREATE OR REPLACE FUNCTION public.nv_permission_actions()
RETURNS TABLE(module text,action text) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT * FROM public.nv_permission_actions_before_doctor_access()
 UNION ALL SELECT 'portal_medico',unnest(ARRAY['view','edit'])
 UNION ALL SELECT 'escala','history';
$$;
CREATE OR REPLACE FUNCTION public.nv_role_action(account_type text,account_role text,module text,action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN module='escala' AND action='history' THEN
  CASE WHEN account_type='saas_admin' THEN account_role IN('CEO','Gerente','Coordenador') ELSE account_role IN('Diretor','Gerente','Coordenador de Escalas') END
 WHEN module='portal_medico' THEN action IN('view','edit') AND
  CASE WHEN account_type='saas_admin' THEN account_role IN('CEO','Gerente') ELSE account_role IN('Diretor','Gerente') END
 ELSE public.nv_role_action_before_doctor_access(account_type,account_role,module,action) END;
$$;
CREATE OR REPLACE FUNCTION public.nv_profile_action(account_type text,account_role text,exceptions jsonb,module text,action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (EXISTS(SELECT FROM public.nv_permission_actions() a WHERE a.module=nv_profile_action.module AND a.action=nv_profile_action.action)
 AND (module<>'escala' OR public.nv_schedule_administrative_role(account_type,account_role))
 AND CASE WHEN module='escala' AND action IN('create','delete','approve') THEN public.nv_profile_action(account_type,account_role,exceptions,module,'edit') ELSE true END
 AND (module<>'usuarios' OR action='view' OR public.nv_role_action(account_type,account_role,module,action))
 AND CASE WHEN account_type='saas_admin' THEN public.nv_role_action(account_type,account_role,module,action)
  AND public.nv_role_action(account_type,account_role,module,'view')
 ELSE coalesce(exceptions->>(module||'.view')<>'deny',true)
  AND (exceptions->>(module||'.view')='allow' OR public.nv_role_action(account_type,account_role,module,'view') OR coalesce(exceptions->>module IN('view','edit'),false))
  AND CASE WHEN action='view' THEN true ELSE coalesce(
   CASE exceptions->>(module||'.'||action) WHEN 'allow' THEN true WHEN 'deny' THEN false END,
   public.nv_role_action(account_type,account_role,module,action) OR (coalesce(exceptions->>module='edit',false)
    AND (action='edit' OR (action IN('create','delete') AND module IN('medicos','unidades','escala'))))) END
 END) IS TRUE;
$$;
REVOKE ALL ON FUNCTION public.nv_schedule_administrative_role(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.nv_schedule_administrative_role(text,text) TO authenticated;
-- Existing shifts policies/RPCs already call nv_can_action/nv_can_write. Keep their
-- restrictive direct INSERT/UPDATE policies and portal-specific validated RPCs intact.

ALTER TABLE public.master_schedule_audit ADD COLUMN unit_id text, ADD COLUMN sector_id text,
 ADD COLUMN shift_date date, ADD COLUMN actor_name text, ADD COLUMN actor_role text,
 ADD COLUMN origin text, ADD COLUMN previous jsonb, ADD COLUMN next jsonb;
CREATE INDEX schedule_audit_filter_idx ON public.master_schedule_audit(organization_id,unit_id,id DESC);
ALTER TABLE nv_master_private.write_context ADD COLUMN origin text NOT NULL DEFAULT 'master';
-- Only transaction-local staging; not a second audit log. Deferred triggers consume
-- the row once, coalescing temporary cancellation/restoration during absence edits.
CREATE TABLE nv_master_private.audit_pending (
 transaction_id bigint NOT NULL,entity_kind text NOT NULL,entity_id text NOT NULL,organization_id text NOT NULL,
 previous jsonb,next jsonb,actor_id uuid,actor_name text,actor_role text,origin text NOT NULL,occurred_at timestamptz NOT NULL,
 PRIMARY KEY(transaction_id,entity_kind,entity_id)
);
REVOKE ALL ON nv_master_private.audit_pending FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION nv_master_private.schedule_snapshot(kind text,value jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN value IS NULL THEN NULL WHEN kind='shift' THEN jsonb_build_object(
  'doctor_id',value->'doctor_id','doctor',(SELECT d.name FROM public.doctors d WHERE d.id=value->>'doctor_id' AND d.organization_id=value->>'organization_id'),
  'unit_id',value->'unit_id','sector_id',value->'sector_id','date',value->'date','start_time',value->'start_time','end_time',value->'end_time',
  'status',value->'status','type',value->'type','specialty',value->'specialty','employment_type',value->'employment_type',
  'employer_name',value->'employer_name','coverage_mode',value->'coverage_mode')
 WHEN kind='rule' THEN jsonb_build_object('unit_id',value->'unit_id','sector_id',value->'sector_id','doctor_id',value->'doctor_id',
  'doctor',(SELECT d.name FROM public.doctors d WHERE d.id=value->>'doctor_id' AND d.organization_id=value->>'organization_id'),
  'status',value->'status','horizon_months',value->'horizon_months','revision',value->'revision','definition',value->'definition')
 ELSE jsonb_build_object('doctor_id',value->'doctor_id','doctor',(SELECT d.name FROM public.doctors d WHERE d.id=value->>'doctor_id' AND d.organization_id=value->>'organization_id'),
  'kind',value->'kind','start_date',value->'start_date','end_date',value->'end_date','start_time',value->'start_time','end_time',value->'end_time','status',value->'status') END;
$$;
CREATE FUNCTION nv_master_private.stage_schedule_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_value jsonb;new_value jsonb;scope jsonb;kind text:=TG_ARGV[0];actor uuid:=public.nv_session_actor();name text;role text;source text;id text;rule_id uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_value:=nv_master_private.schedule_snapshot(kind,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN new_value:=nv_master_private.schedule_snapshot(kind,to_jsonb(NEW)); END IF;
 IF TG_OP='UPDATE' AND ((kind='shift' AND to_jsonb(OLD)->'notes' IS DISTINCT FROM to_jsonb(NEW)->'notes') OR
  (kind='absence' AND to_jsonb(OLD)->'note' IS DISTINCT FROM to_jsonb(NEW)->'note')) THEN new_value:=new_value||jsonb_build_object('private_note_updated',true); END IF;
 IF old_value IS NOT DISTINCT FROM new_value THEN RETURN NULL; END IF;
 scope:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;id:=scope->>'id';
 IF kind='shift' THEN
  SELECT o.rule_id INTO rule_id FROM public.master_schedule_occurrences o WHERE o.shift_id=id;
  IF rule_id IS NOT NULL THEN
   IF old_value IS NOT NULL THEN old_value:=old_value||jsonb_build_object('rule_id',rule_id);END IF;
   IF new_value IS NOT NULL THEN new_value:=new_value||jsonb_build_object('rule_id',rule_id);END IF;
  END IF;
 END IF;
 SELECT u.name,u.role INTO name,role FROM public.user_accounts u WHERE u.auth_user_id=actor AND u.status='active' AND (u.organization_id=scope->>'organization_id' OR u.type='saas_admin') LIMIT 1;
 SELECT c.origin INTO source FROM nv_master_private.write_context c WHERE c.pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.shift_id=id;
 source:=CASE WHEN source='import' THEN 'import' WHEN actor IS NULL AND source='master' THEN 'cron'
  WHEN source='master' THEN 'master' WHEN actor IS NOT NULL AND name IS NULL THEN 'portal'
  WHEN actor IS NULL THEN 'database' ELSE 'manual' END;
 IF EXISTS(SELECT FROM nv_master_private.write_context c WHERE c.pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.shift_id='__master_cron__' AND c.origin='cron') THEN source:='cron';actor:=NULL;name:=NULL;role:=NULL; END IF;
 IF source='portal' THEN SELECT d.name,e.portal_role INTO name,role FROM public.doctor_enrollments e JOIN public.doctors d ON d.id=e.doctor_id WHERE e.auth_user_id=actor AND e.organization_id=scope->>'organization_id' LIMIT 1; END IF;
 INSERT INTO nv_master_private.audit_pending VALUES(txid_current(),kind,id,scope->>'organization_id',old_value,new_value,actor,name,role,source,clock_timestamp())
 ON CONFLICT(transaction_id,entity_kind,entity_id) DO UPDATE SET next=EXCLUDED.next;
 RETURN NULL;
END $$;
CREATE FUNCTION nv_master_private.flush_schedule_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p nv_master_private.audit_pending;kind text:=TG_ARGV[0];target_key text;event text;scope jsonb;
BEGIN
 target_key:=CASE WHEN TG_OP='DELETE' THEN OLD.id::text ELSE NEW.id::text END;
 DELETE FROM nv_master_private.audit_pending a WHERE a.transaction_id=txid_current() AND a.entity_kind=kind AND a.entity_id=target_key RETURNING * INTO p;
 IF NOT FOUND OR p.previous IS NOT DISTINCT FROM p.next THEN RETURN NULL; END IF;
 IF kind='shift' AND EXISTS(SELECT FROM public.shift_opportunities o WHERE o.shift_id=target_key AND o.status='selected' AND o.decided_at>=transaction_timestamp() AND o.selected_doctor_id=p.next->>'doctor_id') THEN p.origin:='approval'; END IF;
 scope:=coalesce(p.next,p.previous);
 event:=CASE WHEN kind='shift' THEN CASE WHEN p.previous IS NULL THEN 'shift_created' WHEN p.next IS NULL THEN 'shift_deleted'
   WHEN p.next->>'status'='cancelled' AND p.previous->>'status'<>'cancelled' THEN 'shift_cancelled'
   WHEN p.previous->>'doctor_id' IS NULL AND p.next->>'doctor_id' IS NOT NULL THEN 'vacancy_filled'
   WHEN p.previous->>'doctor_id' IS NOT NULL AND p.next->>'doctor_id' IS NULL THEN 'vacancy_opened'
   WHEN p.previous->>'doctor_id' IS DISTINCT FROM p.next->>'doctor_id' THEN 'doctor_replaced' ELSE 'shift_edited' END
 WHEN kind='rule' THEN CASE WHEN p.previous IS NULL THEN 'rule_created' WHEN p.next->>'status' IS DISTINCT FROM p.previous->>'status' THEN 'rule_'||(p.next->>'status') ELSE 'rule_edited' END
 ELSE CASE WHEN p.previous IS NULL THEN 'absence_created' WHEN p.next->>'status'='cancelled' AND p.previous->>'status'<>'cancelled' THEN 'absence_cancelled' ELSE 'absence_edited' END END;
 INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,unit_id,sector_id,shift_date,actor_name,actor_role,origin,previous,next,created_at)
 VALUES(p.organization_id,target_key,CASE WHEN kind='shift' THEN target_key END,event,p.actor_id,scope->>'unit_id',scope->>'sector_id',
  CASE WHEN kind='shift' THEN (scope->>'date')::date END,p.actor_name,p.actor_role,p.origin,p.previous,p.next,p.occurred_at);
 -- Absences can affect more than one unit. Keep one canonical record and scope
 -- its visibility through the doctor's recurrence/affected-shift links in the RPC.
 RETURN NULL;
END $$;
CREATE TRIGGER zz_nv_schedule_audit_stage AFTER INSERT OR UPDATE OR DELETE ON public.shifts FOR EACH ROW EXECUTE FUNCTION nv_master_private.stage_schedule_audit('shift');
CREATE CONSTRAINT TRIGGER zzzz_nv_schedule_audit_flush AFTER INSERT OR UPDATE OR DELETE ON public.shifts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nv_master_private.flush_schedule_audit('shift');
CREATE TRIGGER zz_nv_master_rule_audit_stage AFTER INSERT OR UPDATE ON public.master_schedule_rules FOR EACH ROW EXECUTE FUNCTION nv_master_private.stage_schedule_audit('rule');
CREATE CONSTRAINT TRIGGER zzzz_nv_master_rule_audit_flush AFTER INSERT OR UPDATE ON public.master_schedule_rules DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nv_master_private.flush_schedule_audit('rule');
CREATE TRIGGER zz_nv_absence_audit_stage AFTER INSERT OR UPDATE ON public.doctor_absences FOR EACH ROW EXECUTE FUNCTION nv_master_private.stage_schedule_audit('absence');
CREATE CONSTRAINT TRIGGER zzzz_nv_absence_audit_flush AFTER INSERT OR UPDATE ON public.doctor_absences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nv_master_private.flush_schedule_audit('absence');

CREATE OR REPLACE FUNCTION nv_master_private.audit(org text,entity text,event text,shift text DEFAULT NULL,details jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=public.nv_session_actor();name text;role text;unit text;sector text;day date;
BEGIN
 IF EXISTS(SELECT FROM nv_master_private.write_context c WHERE c.pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.shift_id='__master_cron__' AND c.origin='cron') THEN actor:=NULL; END IF;
 IF event='occurrence_generated' THEN
  UPDATE nv_master_private.audit_pending a SET next=a.next||jsonb_build_object('rule_id',entity)
   WHERE a.transaction_id=txid_current() AND a.entity_kind='shift' AND a.entity_id=shift AND a.organization_id=org;
 END IF;
 IF event IN('occurrence_generated','occurrence_manual','occurrence_retired','coverage_changed','absence_coverage_opened','absence_assignment_restored',
  'rule_created','rule_edited','rule_active','rule_suspended','rule_ended','absence_created','absence_edited','absence_cancelled') THEN RETURN; END IF;
 SELECT u.name,u.role INTO name,role FROM public.user_accounts u WHERE u.auth_user_id=actor AND (u.organization_id=org OR u.type='saas_admin') LIMIT 1;
 SELECT s.unit_id,s.sector_id,s.date INTO unit,sector,day FROM public.shifts s WHERE s.id=shift AND s.organization_id=org;
 IF unit IS NULL THEN SELECT r.unit_id,r.sector_id INTO unit,sector FROM public.master_schedule_rules r WHERE r.id::text=entity AND r.organization_id=org; END IF;
 INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,unit_id,sector_id,shift_date,actor_name,actor_role,origin,details,created_at)
 VALUES(org,entity,shift,event,actor,unit,sector,day,name,role,CASE WHEN actor IS NULL THEN 'cron' ELSE 'manual' END,details,clock_timestamp());
END $$;

CREATE FUNCTION public.nv_schedule_history(org text,unit_filter text DEFAULT NULL,sector_filters text[] DEFAULT NULL,
 from_date date DEFAULT NULL,until_date date DEFAULT NULL,actor_filter uuid DEFAULT NULL,action_filter text DEFAULT NULL,
 shift_filter text DEFAULT NULL,before_id bigint DEFAULT NULL,page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE items jsonb;actors jsonb;more boolean;
BEGIN
 PERFORM nv_master_private.require_access(org,'history');
 IF page_size IS NULL OR page_size NOT BETWEEN 1 AND 100 OR cardinality(sector_filters)>200 OR from_date>until_date THEN RAISE EXCEPTION 'Filtros de histórico inválidos.' USING ERRCODE='22023'; END IF;
 IF unit_filter IS NOT NULL AND NOT EXISTS(SELECT FROM public.units u WHERE u.id=unit_filter AND u.organization_id=org) THEN RAISE EXCEPTION 'Unidade indisponível.' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT FROM unnest(sector_filters) selected(id) WHERE NOT EXISTS(SELECT FROM public.sectors s WHERE s.id=selected.id AND s.organization_id=org AND (unit_filter IS NULL OR s.unit_id=unit_filter))) THEN RAISE EXCEPTION 'Setor indisponível.' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]') INTO items FROM (
  SELECT a.id,a.entity_id,a.shift_id,a.action,a.actor_id,a.actor_name,a.actor_role,a.origin,a.previous,a.next,a.created_at,a.shift_date,
   u.name AS unit,s.name AS sector FROM public.master_schedule_audit a LEFT JOIN public.units u ON u.id=a.unit_id AND u.organization_id=org
   LEFT JOIN public.sectors s ON s.id=a.sector_id AND s.organization_id=org
  WHERE a.organization_id=org AND (before_id IS NULL OR a.id<before_id)
   AND (unit_filter IS NULL OR a.unit_id=unit_filter OR a.previous->>'unit_id'=unit_filter OR (a.action LIKE 'absence_%' AND EXISTS(SELECT FROM public.master_schedule_rules r WHERE r.organization_id=org AND r.doctor_id=coalesce(a.next->>'doctor_id',a.previous->>'doctor_id') AND r.unit_id=unit_filter AND (sector_filters IS NULL OR r.sector_id=ANY(sector_filters)))))
   AND (sector_filters IS NULL OR a.sector_id=ANY(sector_filters) OR a.previous->>'sector_id'=ANY(sector_filters) OR (a.action LIKE 'absence_%' AND EXISTS(SELECT FROM public.master_schedule_rules r WHERE r.organization_id=org AND r.doctor_id=coalesce(a.next->>'doctor_id',a.previous->>'doctor_id') AND r.sector_id=ANY(sector_filters))))
   AND (from_date IS NULL OR a.created_at>=from_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND (until_date IS NULL OR a.created_at<(until_date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND (actor_filter IS NULL OR a.actor_id=actor_filter) AND (action_filter IS NULL OR a.action=action_filter) AND (shift_filter IS NULL OR a.shift_id=shift_filter)
  ORDER BY a.id DESC LIMIT page_size+1
 ) x;
 more:=jsonb_array_length(items)>page_size;
 IF more THEN items:=items-page_size; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO actors FROM (SELECT DISTINCT a.actor_id AS id,a.actor_name AS name FROM public.master_schedule_audit a WHERE a.organization_id=org AND a.actor_id IS NOT NULL AND (unit_filter IS NULL OR a.unit_id=unit_filter) ORDER BY a.actor_name LIMIT 200) x;
 RETURN jsonb_build_object('items',items,'actors',actors,'has_more',more);
END $$;

-- Scoped wrappers reuse the existing operational logic; no queries per calendar cell.
CREATE FUNCTION public.nv_master_overview_scoped(org text,unit_filter text,sector_filters text[] DEFAULT NULL,doctor_filter text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE data jsonb;rules jsonb;
BEGIN
 PERFORM nv_master_private.require_access(org,'view');
 IF NOT EXISTS(SELECT FROM public.units u WHERE u.id=unit_filter AND u.organization_id=org) OR cardinality(sector_filters)>200
  OR EXISTS(SELECT FROM unnest(sector_filters) selected(id) WHERE NOT EXISTS(SELECT FROM public.sectors s WHERE s.id=selected.id AND s.unit_id=unit_filter AND s.organization_id=org)) THEN RAISE EXCEPTION 'Seleção indisponível.' USING ERRCODE='42501'; END IF;
 data:=public.nv_master_overview(org,unit_filter,NULL,doctor_filter);
 SELECT coalesce(jsonb_agg(r),'[]') INTO rules FROM jsonb_array_elements(data->'rules') r WHERE sector_filters IS NULL OR r->>'sector_id'=ANY(sector_filters);
 data:=jsonb_set(data,'{rules}',rules);
 data:=jsonb_set(data,'{occurrences}',(SELECT coalesce(jsonb_agg(o),'[]') FROM jsonb_array_elements(data->'occurrences') o WHERE EXISTS(SELECT FROM jsonb_array_elements(rules) r WHERE r->>'id'=o->>'rule_id')));
 data:=jsonb_set(data,'{affected}',(SELECT coalesce(jsonb_agg(a),'[]') FROM jsonb_array_elements(data->'affected') a WHERE a->>'unit_id'=unit_filter AND (sector_filters IS NULL OR a->>'sector_id'=ANY(sector_filters))));
 data:=jsonb_set(data,'{absences}',(SELECT coalesce(jsonb_agg(a),'[]') FROM jsonb_array_elements(data->'absences') a WHERE EXISTS(SELECT FROM jsonb_array_elements(rules) r WHERE r->>'doctor_id'=a->>'doctor_id')));
 RETURN data;
END $$;
CREATE FUNCTION public.nv_master_generate_scoped(org text,unit_filter text,sector_filters text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report jsonb;rule uuid;total jsonb:='{"generated":0,"coverage":0,"blocked":0,"preserved":0}';k text;
BEGIN
 PERFORM nv_master_private.require_access(org,'create');
 PERFORM public.nv_master_overview_scoped(org,unit_filter,sector_filters);
 FOR rule IN SELECT r.id FROM public.master_schedule_rules r WHERE r.organization_id=org AND r.unit_id=unit_filter AND (sector_filters IS NULL OR r.sector_id=ANY(sector_filters)) ORDER BY r.id LOOP
  report:=nv_master_private.generate_rule(rule);
  FOREACH k IN ARRAY ARRAY['generated','coverage','blocked','preserved'] LOOP total:=jsonb_set(total,ARRAY[k],to_jsonb((total->>k)::integer+(report->>k)::integer)); END LOOP;
 END LOOP;
 RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.nv_master_overview(org text, unit_filter text DEFAULT NULL, sector_filter text DEFAULT NULL, doctor_filter text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rules jsonb; absences jsonb; occurrences jsonb; audit jsonb; affected jsonb; cron_enabled boolean:=false;
BEGIN
 PERFORM nv_master_private.require_access(org,'view');
 SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('effective_from',v.effective_from,
  'finance',CASE WHEN public.nv_can_read_finance(org) THEN v.finance ELSE NULL END) ORDER BY r.updated_at DESC),'[]') INTO rules
 FROM public.master_schedule_rules r CROSS JOIN LATERAL (SELECT x.* FROM public.master_schedule_versions x WHERE x.rule_id=r.id ORDER BY x.effective_from DESC,x.revision DESC LIMIT 1) v
 WHERE r.organization_id=org AND (unit_filter IS NULL OR r.unit_id=unit_filter) AND (sector_filter IS NULL OR r.sector_id=sector_filter) AND (doctor_filter IS NULL OR r.doctor_id=doctor_filter);
 SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.start_date DESC),'[]') INTO absences FROM public.doctor_absences a
 WHERE a.organization_id=org AND (doctor_filter IS NULL OR a.doctor_id=doctor_filter)
 AND (public.nv_can_action(org,'escala','edit') AND public.nv_can_action(org,'escala','approve'))
 AND EXISTS(SELECT FROM jsonb_array_elements(rules) r WHERE r->>'doctor_id'=a.doctor_id);
 SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('published',coalesce(p.enabled,false)) ORDER BY o.date),'[]') INTO occurrences FROM public.master_schedule_occurrences o
 LEFT JOIN public.master_coverage_publication p ON p.shift_id=o.shift_id
 WHERE o.date>=nv_master_private.today()-90 AND EXISTS(SELECT FROM jsonb_array_elements(rules) r WHERE r->>'id'=o.rule_id::text);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]') INTO audit FROM
  (SELECT a.id,a.action,a.entity_id,a.created_at FROM public.master_schedule_audit a WHERE a.organization_id=org AND public.nv_can_action(org,'escala','history')
   AND (EXISTS(SELECT FROM jsonb_array_elements(rules) r WHERE r->>'id'=a.entity_id)
    OR EXISTS(SELECT FROM jsonb_array_elements(absences) x WHERE x->>'id'=a.entity_id)
    OR EXISTS(SELECT FROM public.master_schedule_occurrences o WHERE o.shift_id=a.shift_id
     AND EXISTS(SELECT FROM jsonb_array_elements(rules) r WHERE r->>'id'=o.rule_id::text))) ORDER BY a.id DESC LIMIT 100) x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('absence_id',l.absence_id,'shift_id',s.id,'date',s.date,'unit_id',s.unit_id,
  'sector_id',s.sector_id,'state',l.state,'published',coalesce(p.enabled,false)) ORDER BY s.date),'[]') INTO affected
 FROM public.doctor_absence_shifts l JOIN public.shifts s ON s.id=l.shift_id LEFT JOIN public.master_coverage_publication p ON p.shift_id=s.id
 WHERE s.organization_id=org AND EXISTS(SELECT FROM jsonb_array_elements(absences) a WHERE a->>'id'=l.absence_id::text);
 IF to_regclass('cron.job') IS NOT NULL THEN EXECUTE 'SELECT EXISTS(SELECT FROM cron.job WHERE jobname=''nvmed-master-daily'' AND active)' INTO cron_enabled; END IF;
 RETURN jsonb_build_object('rules',rules,'absences',absences,'occurrences',occurrences,'audit',audit,'affected',affected,'cron_enabled',cron_enabled);
END $$;
CREATE OR REPLACE FUNCTION public.nv_master_shift_context(ids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF cardinality(ids)>500 OR cardinality(ids) IS NULL THEN RAISE EXCEPTION 'Seleção inválida.' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('shift_id',s.id,'rule_id',r.id,'state',coalesce(o.state,CASE WHEN r.id IS NOT NULL THEN 'retired' ELSE 'manual' END),
  'original_doctor_id',r.doctor_id,'original_doctor_name',d.name,'unit_id',r.unit_id,'sector_id',r.sector_id,'coverage',EXISTS(SELECT FROM public.doctor_absence_shifts a WHERE a.shift_id=s.id AND a.state IN('open','covered','preserved','blocked')),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM (SELECT a.action,a.created_at FROM public.master_schedule_audit a
    WHERE a.organization_id=s.organization_id AND public.nv_can_action(s.organization_id,'escala','history') AND a.shift_id=s.id ORDER BY a.id DESC LIMIT 20) h))),'[]') INTO result
 FROM public.shifts s LEFT JOIN public.master_schedule_occurrences o ON o.shift_id=s.id LEFT JOIN public.master_schedule_rules r ON r.id=coalesce(o.rule_id,
  (SELECT candidate.rule_id FROM (
    SELECT previous.id AS rule_id,a.id AS sequence FROM public.master_schedule_audit a JOIN public.master_schedule_rules previous
     ON previous.id::text=CASE WHEN a.action='occurrence_generated' THEN a.entity_id ELSE coalesce(a.next->>'rule_id',a.previous->>'rule_id') END
     WHERE a.organization_id=s.organization_id AND a.shift_id=s.id
    UNION ALL
    SELECT previous.id,9223372036854775807::bigint FROM nv_master_private.audit_pending a JOIN public.master_schedule_rules previous
     ON previous.id::text=coalesce(a.next->>'rule_id',a.previous->>'rule_id')
     WHERE a.transaction_id=txid_current() AND a.organization_id=s.organization_id AND a.entity_kind='shift' AND a.entity_id=s.id
   ) candidate ORDER BY candidate.sequence DESC LIMIT 1))
 LEFT JOIN public.doctors d ON d.id=r.doctor_id WHERE s.id=ANY(ids) AND public.nv_org_access(s.organization_id) AND public.nv_can_action(s.organization_id,'escala','view')
 AND (r.id IS NOT NULL OR EXISTS(SELECT FROM public.doctor_absence_shifts a WHERE a.shift_id=s.id));
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.nv_master_generate_scheduled()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.master_schedule_rules; report jsonb; count integer:=0;
BEGIN
 INSERT INTO nv_master_private.write_context(pid,transaction_id,shift_id,finance,origin) VALUES(pg_backend_pid(),txid_current(),'__master_cron__',NULL,'cron');
 UPDATE public.doctor_absences SET status=CASE WHEN end_date<nv_master_private.today() THEN 'ended' ELSE 'active' END
 WHERE status IN('scheduled','active') AND start_date<=nv_master_private.today();
 FOR r IN SELECT * FROM public.master_schedule_rules WHERE status='active' ORDER BY id LOOP
  BEGIN
   report:=nv_master_private.generate_rule(r.id); count:=count+1;
   PERFORM nv_master_private.audit(r.organization_id,r.id::text,'generation_scheduled',NULL,report);
  EXCEPTION WHEN OTHERS THEN
   PERFORM nv_master_private.audit(r.organization_id,r.id::text,'generation_failed');
  END;
 END LOOP;
 DELETE FROM nv_master_private.write_context WHERE pid=pg_backend_pid() AND transaction_id=txid_current() AND shift_id='__master_cron__';
 RETURN jsonb_build_object('rules',count);
END $$;
CREATE OR REPLACE FUNCTION public.nv_shift_history(target text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'at', h.created_at,
    'previous', previous.name, 'next', next.name, 'actor', staff.name, 'previous_employment', h.previous_employment_type,
    'next_employment', h.next_employment_type) ORDER BY h.created_at DESC, h.id DESC), '[]'::jsonb)
  FROM public.shift_assignment_history h LEFT JOIN public.doctors previous ON previous.id = h.previous_doctor_id
  LEFT JOIN public.doctors next ON next.id = h.next_doctor_id LEFT JOIN public.user_accounts staff ON staff.auth_user_id = h.actor_id
  WHERE h.shift_id = target AND public.nv_can_action(h.organization_id,'escala','history');
$$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='nv_master_private' OR (n.nspname='public' AND p.proname IN('nv_schedule_history','nv_master_overview_scoped','nv_master_generate_scoped')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
REVOKE ALL ON public.master_schedule_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_schedule_history(text,text,text[],date,date,uuid,text,text,bigint,integer),
 public.nv_master_overview_scoped(text,text,text[],text),public.nv_master_generate_scoped(text,text,text[]) TO authenticated;
NOTIFY pgrst,'reload schema';
-- Read-only batch projection of the existing application eligibility conditions.
-- An unoccupied planned post is not necessarily published for applications.
CREATE FUNCTION public.nv_schedule_available_vacancies(org text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM nv_master_private.require_access(org,'view');
 RETURN (SELECT coalesce(jsonb_agg(s.id ORDER BY s.id),'[]'::jsonb) FROM public.shifts s
  WHERE s.organization_id=org AND s.status='open' AND s.doctor_id IS NULL
   AND public.nv_shift_starts(s)>now() AND s.payment_status IS DISTINCT FROM 'paid'
   AND NOT EXISTS(SELECT FROM public.master_coverage_publication p WHERE p.shift_id=s.id AND NOT p.enabled));
END $$;
REVOKE ALL ON FUNCTION public.nv_schedule_available_vacancies(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.nv_schedule_available_vacancies(text) TO authenticated;
COMMIT;
