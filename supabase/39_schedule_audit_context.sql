-- Incremental after 38. Reuse the existing audit/staging; do not rewrite history.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Owner-only context for future authorized imports. It carries no write capability
-- and cannot bypass the shift validators or Master exception handling.
CREATE FUNCTION nv_master_private.begin_schedule_import(org text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM public.organizations o WHERE o.id=org) THEN RAISE EXCEPTION 'Empresa indisponível.' USING ERRCODE='22023';END IF;
 SET CONSTRAINTS nv_master_private.zzzz_nv_import_audit_cleanup DEFERRED;
 INSERT INTO nv_master_private.audit_pending(transaction_id,entity_kind,entity_id,organization_id,origin,occurred_at)
 VALUES(txid_current(),'import_operation',org,org,'import',clock_timestamp()) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION nv_master_private.finish_schedule_import()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 DELETE FROM nv_master_private.audit_pending a WHERE a.transaction_id=NEW.transaction_id AND a.entity_kind='import_operation' AND a.entity_id=NEW.entity_id;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER zzzz_nv_import_audit_cleanup AFTER INSERT ON nv_master_private.audit_pending
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.entity_kind='import_operation') EXECUTE FUNCTION nv_master_private.finish_schedule_import();

CREATE OR REPLACE FUNCTION nv_master_private.stage_schedule_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_value jsonb;new_value jsonb;scope jsonb;kind text:=TG_ARGV[0];actor uuid:=public.nv_session_actor();name text;role text;source text;id text;rule_id uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_value:=nv_master_private.schedule_snapshot(kind,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN new_value:=nv_master_private.schedule_snapshot(kind,to_jsonb(NEW)); END IF;
 IF TG_OP='UPDATE' AND ((kind='shift' AND to_jsonb(OLD)->'notes' IS DISTINCT FROM to_jsonb(NEW)->'notes') OR
  (kind='absence' AND to_jsonb(OLD)->'note' IS DISTINCT FROM to_jsonb(NEW)->'note')) THEN new_value:=new_value||jsonb_build_object('private_note_updated',true); END IF;
 IF TG_OP='UPDATE' AND kind='shift' AND to_jsonb(OLD)->'coverage_reason' IS DISTINCT FROM to_jsonb(NEW)->'coverage_reason' THEN new_value:=new_value||jsonb_build_object('coverage_reason_updated',true);END IF;
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
 IF EXISTS(SELECT FROM nv_master_private.audit_pending a WHERE a.transaction_id=txid_current() AND a.entity_kind='import_operation' AND a.entity_id=scope->>'organization_id') THEN source:='import';END IF;
 IF EXISTS(SELECT FROM nv_master_private.write_context c WHERE c.pid=pg_backend_pid() AND c.transaction_id=txid_current() AND c.shift_id='__master_cron__' AND c.origin='cron') THEN source:='cron';actor:=NULL;name:=NULL;role:=NULL; END IF;
 IF source='portal' THEN SELECT d.name,e.portal_role INTO name,role FROM public.doctor_enrollments e JOIN public.doctors d ON d.id=e.doctor_id WHERE e.auth_user_id=actor AND e.organization_id=scope->>'organization_id' LIMIT 1; END IF;
 INSERT INTO nv_master_private.audit_pending VALUES(txid_current(),kind,id,scope->>'organization_id',old_value,new_value,actor,name,role,source,clock_timestamp())
 ON CONFLICT(transaction_id,entity_kind,entity_id) DO UPDATE SET next=EXCLUDED.next;
 RETURN NULL;
END $$;
-- Every new event, including legacy helper paths, receives server-generated
-- correlation and immutable display context. Existing records are untouched.
CREATE FUNCTION nv_master_private.schedule_audit_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company_name text;unit_name text;sector_name text;scopes jsonb;
BEGIN
 SELECT o.name INTO company_name FROM public.organizations o WHERE o.id=NEW.organization_id;
 SELECT u.name INTO unit_name FROM public.units u WHERE u.id=NEW.unit_id AND u.organization_id=NEW.organization_id;
 SELECT s.name INTO sector_name FROM public.sectors s WHERE s.id=NEW.sector_id AND s.organization_id=NEW.organization_id;
 IF NEW.action LIKE 'absence_%' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO scopes FROM (
   SELECT r.unit_id,r.sector_id FROM public.master_schedule_rules r WHERE r.organization_id=NEW.organization_id AND r.doctor_id=coalesce(NEW.next->>'doctor_id',NEW.previous->>'doctor_id')
   UNION SELECT s.unit_id,s.sector_id FROM public.doctor_absence_shifts l JOIN public.shifts s ON s.id=l.shift_id WHERE l.absence_id::text=NEW.entity_id AND s.organization_id=NEW.organization_id
  ) x;
 END IF;
 NEW.details:=coalesce(NEW.details,'{}')||jsonb_strip_nulls(jsonb_build_object('correlation_id',txid_current()::text,
  'organization',company_name,'unit',unit_name,'sector',sector_name,'scopes',scopes));
 IF NEW.origin IS DISTINCT FROM 'cron' AND EXISTS(SELECT FROM nv_master_private.audit_pending a WHERE a.transaction_id=txid_current() AND a.entity_kind='import_operation' AND a.entity_id=NEW.organization_id) THEN NEW.origin:='import';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nv_schedule_audit_metadata BEFORE INSERT ON public.master_schedule_audit FOR EACH ROW EXECUTE FUNCTION nv_master_private.schedule_audit_metadata();

CREATE OR REPLACE FUNCTION public.nv_schedule_history(org text,unit_filter text DEFAULT NULL,sector_filters text[] DEFAULT NULL,
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
  SELECT a.id,a.entity_id,a.shift_id,a.action,a.actor_id,a.actor_name,a.actor_role,a.origin,a.previous,a.next,a.created_at,a.shift_date,a.organization_id,a.details->>'correlation_id' AS correlation_id,
   coalesce(a.details->>'organization',company.name) AS organization,coalesce(a.details->>'unit',u.name) AS unit,coalesce(a.details->>'sector',s.name) AS sector FROM public.master_schedule_audit a JOIN public.organizations company ON company.id=a.organization_id LEFT JOIN public.units u ON u.id=a.unit_id AND u.organization_id=org
   LEFT JOIN public.sectors s ON s.id=a.sector_id AND s.organization_id=org
  WHERE a.organization_id=org AND (before_id IS NULL OR a.id<before_id)
   AND (unit_filter IS NULL OR a.unit_id=unit_filter OR a.previous->>'unit_id'=unit_filter OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(a.details->'scopes','[]')) scope WHERE scope->>'unit_id'=unit_filter AND (sector_filters IS NULL OR scope->>'sector_id'=ANY(sector_filters))) OR (a.details->'scopes' IS NULL AND a.action LIKE 'absence_%' AND EXISTS(SELECT FROM public.master_schedule_rules r WHERE r.organization_id=org AND r.doctor_id=coalesce(a.next->>'doctor_id',a.previous->>'doctor_id') AND r.unit_id=unit_filter AND (sector_filters IS NULL OR r.sector_id=ANY(sector_filters)))))
   AND (sector_filters IS NULL OR a.sector_id=ANY(sector_filters) OR a.previous->>'sector_id'=ANY(sector_filters) OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(a.details->'scopes','[]')) scope WHERE scope->>'sector_id'=ANY(sector_filters) AND (unit_filter IS NULL OR scope->>'unit_id'=unit_filter)) OR (a.details->'scopes' IS NULL AND a.action LIKE 'absence_%' AND EXISTS(SELECT FROM public.master_schedule_rules r WHERE r.organization_id=org AND r.doctor_id=coalesce(a.next->>'doctor_id',a.previous->>'doctor_id') AND r.sector_id=ANY(sector_filters))))
   AND (from_date IS NULL OR a.created_at>=from_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND (until_date IS NULL OR a.created_at<(until_date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
   AND (actor_filter IS NULL OR a.actor_id=actor_filter) AND (action_filter IS NULL OR a.action=action_filter) AND (shift_filter IS NULL OR a.shift_id=shift_filter)
  ORDER BY a.id DESC LIMIT page_size+1
 ) x;
 more:=jsonb_array_length(items)>page_size;
 IF more THEN items:=items-page_size; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name,x.id),'[]') INTO actors FROM (
  SELECT * FROM (SELECT DISTINCT ON(a.actor_id) a.actor_id AS id,a.actor_name AS name FROM public.master_schedule_audit a
   WHERE a.organization_id=org AND a.actor_id IS NOT NULL
    AND (unit_filter IS NULL OR a.unit_id=unit_filter OR a.previous->>'unit_id'=unit_filter OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(a.details->'scopes','[]')) scope WHERE scope->>'unit_id'=unit_filter))
    AND (sector_filters IS NULL OR a.sector_id=ANY(sector_filters) OR a.previous->>'sector_id'=ANY(sector_filters) OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(a.details->'scopes','[]')) scope WHERE scope->>'sector_id'=ANY(sector_filters)))
    AND (shift_filter IS NULL OR a.shift_id=shift_filter)
   ORDER BY a.actor_id,a.id DESC) latest ORDER BY latest.name,latest.id LIMIT 200
 ) x;
 RETURN jsonb_build_object('items',items,'actors',actors,'has_more',more);
END $$;

REVOKE ALL ON FUNCTION nv_master_private.begin_schedule_import(text),nv_master_private.finish_schedule_import(),
 nv_master_private.schedule_audit_metadata() FROM PUBLIC,anon,authenticated,service_role;
-- CREATE OR REPLACE preserves the prior ACLs of the stage and history functions.
NOTIFY pgrst,'reload schema';
COMMIT;
