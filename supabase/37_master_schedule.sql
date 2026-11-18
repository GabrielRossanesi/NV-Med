-- Recurrence is a source of ordinary shifts, never a second operational roster.
-- Additive migration after 36. No conversion of imported or existing assignments.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE SCHEMA nv_master_private;
REVOKE ALL ON SCHEMA nv_master_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.master_schedule_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 doctor_id text NOT NULL REFERENCES public.doctors(id), unit_id text NOT NULL REFERENCES public.units(id),
 sector_id text NOT NULL REFERENCES public.sectors(id), definition jsonb NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended','ended')),
 horizon_months integer NOT NULL DEFAULT 3 CHECK(horizon_months BETWEEN 1 AND 12),
 revision integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES auth.users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.master_schedule_versions (
 rule_id uuid NOT NULL REFERENCES public.master_schedule_rules(id), revision integer NOT NULL,
 effective_from date NOT NULL, definition jsonb NOT NULL, finance jsonb, authorized_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(rule_id,revision)
);
CREATE INDEX master_rules_scope_idx ON public.master_schedule_rules(organization_id,unit_id,sector_id,doctor_id);
CREATE INDEX master_versions_date_idx ON public.master_schedule_versions(rule_id,effective_from DESC,revision DESC);
CREATE TABLE public.master_schedule_occurrences (
 rule_id uuid NOT NULL REFERENCES public.master_schedule_rules(id), date date NOT NULL,
 shift_id text UNIQUE REFERENCES public.shifts(id) ON DELETE SET NULL, rule_revision integer NOT NULL,
 state text NOT NULL CHECK(state IN('generated','coverage','manual','retired','blocked')),
 created_post boolean NOT NULL DEFAULT false, issue text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(rule_id,date)
);
CREATE TABLE public.master_schedule_exceptions (
 rule_id uuid NOT NULL, date date NOT NULL, kind text NOT NULL CHECK(kind IN('manual','deleted')),
 actor_id uuid, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(rule_id,date),
 FOREIGN KEY(rule_id,date) REFERENCES public.master_schedule_occurrences(rule_id,date)
);
CREATE TABLE public.doctor_absences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id text NOT NULL REFERENCES public.organizations(id),
 doctor_id text NOT NULL REFERENCES public.doctors(id),
 kind text NOT NULL CHECK(kind IN('vacation','leave','license','unavailable','other')),
 start_date date NOT NULL, end_date date NOT NULL, start_time text, end_time text, note text CHECK(length(note)<=1000),
 status text NOT NULL CHECK(status IN('scheduled','active','ended','cancelled')), revision integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES auth.users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(end_date>=start_date AND end_date-start_date<=730),
 CHECK((start_time IS NULL AND end_time IS NULL) OR
  (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND start_time<>end_time))
);
CREATE INDEX doctor_absences_scope_idx ON public.doctor_absences(organization_id,doctor_id,start_date,end_date);
CREATE TABLE public.doctor_absence_shifts (
 absence_id uuid NOT NULL REFERENCES public.doctor_absences(id), shift_id text NOT NULL REFERENCES public.shifts(id),
 original_doctor_id text NOT NULL REFERENCES public.doctors(id), snapshot jsonb NOT NULL,
 state text NOT NULL CHECK(state IN('open','covered','restored','preserved','blocked')),
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(absence_id,shift_id)
);
CREATE TABLE public.master_coverage_publication (
 shift_id text PRIMARY KEY REFERENCES public.shifts(id), enabled boolean NOT NULL DEFAULT false,
 updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doctor_absence_shifts_shift_idx ON public.doctor_absence_shifts(shift_id);
CREATE TABLE public.master_schedule_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, organization_id text NOT NULL REFERENCES public.organizations(id),
 entity_id text NOT NULL, shift_id text, action text NOT NULL, actor_id uuid, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX master_audit_scope_idx ON public.master_schedule_audit(organization_id,id DESC);
CREATE INDEX master_audit_shift_idx ON public.master_schedule_audit(shift_id,id DESC) WHERE shift_id IS NOT NULL;
REVOKE ALL ON SEQUENCE public.master_schedule_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;
-- A transaction-scoped, non-forgeable capability. A client-set GUC is not an authorization boundary.
CREATE TABLE nv_master_private.write_context (
 pid integer NOT NULL, transaction_id bigint NOT NULL, shift_id text NOT NULL, finance jsonb,
 PRIMARY KEY(pid,transaction_id,shift_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['master_schedule_rules','master_schedule_versions','master_schedule_occurrences',
 'master_schedule_exceptions','doctor_absences','doctor_absence_shifts','master_schedule_audit','master_coverage_publication'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
END $$;
-- All data access goes through narrowly scoped RPCs below. No table is exposed through a permissive policy.

CREATE FUNCTION nv_master_private.today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;
CREATE FUNCTION nv_master_private.require_access(org text, action text, approval boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.nv_org_access(org) OR NOT public.nv_can_action(org,'escala',action)
  OR (approval AND NOT public.nv_can_action(org,'escala','approve')) THEN
  RAISE EXCEPTION 'Operação indisponível para este acesso.' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION nv_master_private.actor_allowed(actor uuid, org text, finance boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.user_accounts u JOIN auth.users a ON a.id=u.auth_user_id
 WHERE u.auth_user_id=actor AND u.status='active' AND (u.organization_id=org OR u.type='saas_admin')
 AND a.deleted_at IS NULL AND (a.banned_until IS NULL OR a.banned_until<=now())
 AND a.raw_app_meta_data->>'must_change_password' IS DISTINCT FROM 'true'
 AND public.nv_profile_action(u.type,u.role,u.additional_permissions,'escala','create')
 AND (NOT finance OR public.nv_profile_action(u.type,u.role,u.additional_permissions,'financeiro','edit')));
$$;
CREATE FUNCTION nv_master_private.matches(spec jsonb, day date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT day>=(spec->>'start_date')::date AND day>=(spec->>'anchor_date')::date
 AND (nullif(spec->>'end_date','') IS NULL OR day<=(spec->>'end_date')::date)
 AND (spec->'weekdays') @> to_jsonb(ARRAY[extract(dow FROM day)::integer])
 AND CASE WHEN spec->>'frequency'='monthly' THEN
  (extract(day FROM day)::integer-1)/7=(extract(day FROM (spec->>'anchor_date')::date)::integer-1)/7
 ELSE ((day-((spec->>'anchor_date')::date-((extract(dow FROM (spec->>'anchor_date')::date)::integer+6)%7)))/7)
  % (spec->>'interval_weeks')::integer=0 END;
$$;
CREATE FUNCTION nv_master_private.version_at(target uuid, day date)
RETURNS public.master_schedule_versions LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT v FROM public.master_schedule_versions v WHERE v.rule_id=target AND v.effective_from<=day
 ORDER BY v.effective_from DESC,v.revision DESC LIMIT 1;
$$;
CREATE FUNCTION nv_master_private.overlaps(a public.doctor_absences, starts timestamptz, ends timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT a.status<>'cancelled' AND CASE WHEN a.start_time IS NULL THEN
  starts<((a.end_date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo') AND ends>(a.start_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
 ELSE EXISTS(SELECT FROM generate_series(greatest(a.start_date,(starts AT TIME ZONE 'America/Sao_Paulo')::date-1)::timestamp,
   least(a.end_date,(ends AT TIME ZONE 'America/Sao_Paulo')::date)::timestamp,interval '1 day') d
  WHERE starts<((d::date+a.end_time::time+CASE WHEN a.end_time<a.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'America/Sao_Paulo')
   AND ends>((d::date+a.start_time::time) AT TIME ZONE 'America/Sao_Paulo')) END;
$$;
CREATE FUNCTION nv_master_private.unavailable(org text, doctor text, item public.shifts)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM public.doctor_absences a WHERE a.organization_id=org AND a.doctor_id=doctor
  AND nv_master_private.overlaps(a,public.nv_shift_starts(item),public.nv_shift_ends(item)));
$$;
CREATE FUNCTION nv_master_private.protected(item public.shifts)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.nv_shift_starts(item)<=now() OR item.status='completed' OR public.nv_shift_has_settlement(item)
 OR EXISTS(SELECT FROM public.shift_attendance a WHERE a.shift_id=item.id);
$$;
CREATE FUNCTION nv_master_private.internal_write(target text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT FROM nv_master_private.write_context c WHERE c.pid=pg_backend_pid()
 AND c.transaction_id=txid_current() AND c.shift_id=target);
$$;
CREATE FUNCTION nv_master_private.audit(org text, entity text, event text, shift text DEFAULT NULL, details jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,details)
 VALUES(org,entity,shift,event,public.nv_session_actor(),details);
$$;
CREATE FUNCTION nv_master_private.validate_definition(org text, spec jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.shifts; days integer[]; result jsonb;
BEGIN
 IF jsonb_typeof(spec)<>'object' OR jsonb_typeof(spec->'weekdays') IS DISTINCT FROM 'array'
 OR jsonb_array_length(spec->'weekdays') NOT BETWEEN 1 AND 7
 OR (spec->>'frequency' IN('weeks','monthly')) IS NOT TRUE
 OR ((spec->>'interval_weeks')::integer BETWEEN 1 AND 52) IS NOT TRUE
 OR (spec->>'start_date')::date<(spec->>'anchor_date')::date
 OR nullif(spec->>'end_date','')::date<(spec->>'start_date')::date
 OR coalesce(length(spec->>'employer_name'),0)>150 THEN
  RAISE EXCEPTION 'Confira a frequência, os dias e as datas da recorrência.' USING ERRCODE='22023';
 END IF;
 SELECT array_agg(DISTINCT value::integer ORDER BY value::integer) INTO days FROM jsonb_array_elements_text(spec->'weekdays');
 IF EXISTS(SELECT FROM unnest(days) n WHERE n NOT BETWEEN 0 AND 6) THEN RAISE EXCEPTION 'Dias inválidos.' USING ERRCODE='22023'; END IF;
 item:=jsonb_populate_record(NULL::public.shifts,spec||jsonb_build_object('id',gen_random_uuid()::text,
 'organization_id',org,'date',spec->>'start_date','status','pending','coverage_mode','regular'));
 IF item.doctor_id IS NULL OR item.unit_id IS NULL OR item.sector_id IS NULL OR item.specialty IS NULL
 OR item.date IS NULL OR spec->>'anchor_date' IS NULL
 OR (item.employment_type IN('clt','pj','concursado')) IS NOT TRUE
 OR (item.type IN('onsite','oncall','telemedicine')) IS NOT TRUE
 OR item.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR item.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 OR item.start_time IS NULL OR item.end_time IS NULL OR item.start_time=item.end_time
 OR (item.employment_type='pj' AND coalesce(length(trim(item.employer_name)),0)=0)
 OR NOT public.nv_credentialed_for_shift(item.doctor_id,item) OR NOT public.nv_shift_documents_clear(item.doctor_id,item)
 OR NOT EXISTS(SELECT FROM public.sectors s WHERE s.id=item.sector_id AND s.unit_id=item.unit_id
 AND s.organization_id=org AND s.primary_specialty=item.specialty) THEN
  RAISE EXCEPTION 'Confira o médico credenciado, os vínculos, a especialidade, o horário e a contratação.' USING ERRCODE='22023';
 END IF;
 result:=jsonb_build_object('doctor_id',item.doctor_id,'unit_id',item.unit_id,'sector_id',item.sector_id,'specialty',item.specialty,
 'start_time',item.start_time,'end_time',item.end_time,'type',item.type,'employment_type',item.employment_type,
 'employer_name',item.employer_name,'frequency',spec->>'frequency','interval_weeks',(spec->>'interval_weeks')::integer,
 'weekdays',days,'start_date',(spec->>'start_date')::date,'anchor_date',(spec->>'anchor_date')::date,'end_date',nullif(spec->>'end_date','')::date);
 RETURN result;
END $$;

-- Existing RPCs, applications and portal confirmations all pass through this trigger.
CREATE FUNCTION nv_master_private.assignment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.doctor_id IS NOT NULL AND NEW.status<>'cancelled' AND (TG_OP='INSERT'
 OR (NEW.doctor_id,NEW.date,NEW.start_time,NEW.end_time,NEW.status) IS DISTINCT FROM (OLD.doctor_id,OLD.date,OLD.start_time,OLD.end_time,OLD.status)) THEN
  -- Serialize with absence approval and refresh the availability snapshot after waiting.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id||':'||NEW.doctor_id,0));
  IF nv_master_private.unavailable(NEW.organization_id,NEW.doctor_id,NEW) THEN
   RAISE EXCEPTION 'O médico possui indisponibilidade aprovada neste horário.' USING ERRCODE='22023';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nv_master_absence_guard BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION nv_master_private.assignment_guard();

CREATE FUNCTION nv_master_private.financial_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c nv_master_private.write_context;
BEGIN
 SELECT * INTO c FROM nv_master_private.write_context x WHERE x.pid=pg_backend_pid() AND x.transaction_id=txid_current() AND x.shift_id=NEW.id;
 IF FOUND AND NEW.employment_type='pj' AND c.finance IS NOT NULL THEN
  -- Only a template approved through nv_prepare_shift_employment is accepted by the private writer.
  IF TG_OP='UPDATE' AND public.nv_shift_has_settlement(OLD) THEN
   RAISE EXCEPTION 'O histórico financeiro consolidado deve ser preservado.' USING ERRCODE='22023';
  END IF;
  NEW.payment_amount:=(c.finance->>'payment_amount')::numeric;
  NEW.payment_frequency:=coalesce(c.finance->>'payment_frequency','on_delivery');
  NEW.payment_agreement:=c.finance->'payment_agreement';
  NEW.payment_note:=c.finance->>'payment_note';
  NEW.payment_due_date:=CASE WHEN NEW.doctor_id IS NOT NULL AND NEW.payment_amount IS NOT NULL THEN public.nv_calculate_shift_due(NEW) END;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_nv_master_finance_snapshot BEFORE INSERT OR UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION nv_master_private.financial_snapshot();

CREATE FUNCTION nv_master_private.manual_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE occurrence public.master_schedule_occurrences; changed boolean; operational_changed boolean;
BEGIN
 IF nv_master_private.internal_write(OLD.id) THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 SELECT * INTO occurrence FROM public.master_schedule_occurrences o WHERE o.shift_id=OLD.id FOR UPDATE;
 IF TG_OP='DELETE' THEN changed:=true; operational_changed:=true;
 ELSE
  operational_changed:=(NEW.doctor_id,NEW.unit_id,NEW.sector_id,NEW.date,NEW.start_time,NEW.end_time,NEW.type,NEW.employment_type,NEW.specialty,NEW.employer_name)
   IS DISTINCT FROM (OLD.doctor_id,OLD.unit_id,OLD.sector_id,OLD.date,OLD.start_time,OLD.end_time,OLD.type,OLD.employment_type,OLD.specialty,OLD.employer_name)
   OR (NEW.status='cancelled' AND OLD.status<>'cancelled');
  changed:=operational_changed OR (NEW.notes,NEW.payment_amount,NEW.payment_frequency,NEW.payment_agreement,NEW.payment_note)
   IS DISTINCT FROM (OLD.notes,OLD.payment_amount,OLD.payment_frequency,OLD.payment_agreement,OLD.payment_note);
 END IF;
 IF occurrence.rule_id IS NOT NULL AND changed THEN
  IF operational_changed AND nv_master_private.protected(OLD) THEN RAISE EXCEPTION 'O plantão realizado ou consolidado deve ser preservado.' USING ERRCODE='22023'; END IF;
  INSERT INTO public.master_schedule_exceptions(rule_id,date,kind,actor_id)
  VALUES(occurrence.rule_id,occurrence.date,CASE WHEN TG_OP='DELETE' THEN 'deleted' ELSE 'manual' END,public.nv_session_actor())
  ON CONFLICT(rule_id,date) DO NOTHING;
  UPDATE public.master_schedule_occurrences SET state='manual',updated_at=now() WHERE rule_id=occurrence.rule_id AND date=occurrence.date;
  PERFORM nv_master_private.audit(OLD.organization_id,occurrence.rule_id::text,'occurrence_manual',OLD.id);
 END IF;
 IF TG_OP='UPDATE' AND NEW.doctor_id IS DISTINCT FROM OLD.doctor_id THEN
  UPDATE public.doctor_absence_shifts l SET state=CASE WHEN NEW.doctor_id IS NULL THEN 'open'
    WHEN NEW.doctor_id=l.original_doctor_id THEN 'restored' ELSE 'covered' END,updated_at=now() WHERE l.shift_id=OLD.id;
  IF EXISTS(SELECT FROM public.doctor_absence_shifts l WHERE l.shift_id=OLD.id) THEN
   PERFORM nv_master_private.audit(OLD.organization_id,OLD.id,'coverage_changed',OLD.id,
    jsonb_build_object('previous_doctor_id',OLD.doctor_id,'next_doctor_id',NEW.doctor_id));
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER nv_master_manual_change BEFORE UPDATE OR DELETE ON public.shifts FOR EACH ROW EXECUTE FUNCTION nv_master_private.manual_change();

CREATE FUNCTION nv_master_private.write_shift(item public.shifts, finance jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO nv_master_private.write_context VALUES(pg_backend_pid(),txid_current(),item.id,finance);
 IF EXISTS(SELECT FROM public.shifts s WHERE s.id=item.id) THEN
  UPDATE public.shifts SET doctor_id=item.doctor_id,status=item.status,employment_type=item.employment_type,
   employer_name=item.employer_name,payment_amount=item.payment_amount,payment_frequency=coalesce(item.payment_frequency,'on_delivery'),
   payment_agreement=item.payment_agreement,payment_note=item.payment_note
  WHERE id=item.id;
 ELSE
  INSERT INTO public.shifts(id,organization_id,doctor_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,
   employment_type,employer_name,coverage_mode,payment_amount,payment_frequency,payment_status,payment_agreement,notes)
  VALUES(item.id,item.organization_id,item.doctor_id,item.unit_id,item.sector_id,item.specialty,item.date,item.start_time,item.end_time,
   item.type,item.status,item.employment_type,item.employer_name,'regular',item.payment_amount,coalesce(item.payment_frequency,'on_delivery'),
   'pending',item.payment_agreement,item.notes);
 END IF;
 DELETE FROM nv_master_private.write_context WHERE pid=pg_backend_pid() AND transaction_id=txid_current() AND shift_id=item.id;
END $$;

CREATE FUNCTION nv_master_private.generate_rule(target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.master_schedule_rules; v public.master_schedule_versions; o public.master_schedule_occurrences;
 item public.shifts; original public.shifts; vacancy public.shifts; a public.doctor_absences; day date; cutoff date;
 generated integer:=0; preserved integer:=0; covered integer:=0; blocked integer:=0; demand integer; slots integer; why text;
BEGIN
 SELECT * INTO r FROM public.master_schedule_rules WHERE id=target;
 IF NOT FOUND THEN RETURN '{"generated":0,"preserved":0,"coverage":0,"blocked":0}'::jsonb; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(r.organization_id||':'||r.doctor_id,0));
 IF NOT pg_try_advisory_xact_lock(hashtextextended('nv-master:'||target::text,0)) THEN RETURN '{"generated":0,"preserved":0,"coverage":0,"blocked":0}'::jsonb; END IF;
 SELECT * INTO r FROM public.master_schedule_rules WHERE id=target FOR UPDATE;
 IF NOT FOUND OR r.status<>'active' THEN RETURN '{"generated":0,"preserved":0,"coverage":0,"blocked":0}'::jsonb; END IF;
 cutoff:=(date_trunc('month',nv_master_private.today())+make_interval(months=>r.horizon_months+1)-interval '1 day')::date;
 FOR day IN SELECT d::date FROM generate_series(nv_master_private.today()::timestamp,cutoff::timestamp,interval '1 day') d LOOP
  v:=nv_master_private.version_at(r.id,day);
  IF v.rule_id IS NULL OR NOT nv_master_private.matches(v.definition,day) THEN CONTINUE; END IF;
  SELECT * INTO o FROM public.master_schedule_occurrences x WHERE x.rule_id=r.id AND x.date=day FOR UPDATE;
  IF FOUND AND (o.state IN('generated','coverage','manual') OR EXISTS(SELECT FROM public.master_schedule_exceptions e WHERE e.rule_id=r.id AND e.date=day)) THEN
   preserved:=preserved+1; CONTINUE;
  END IF;
  BEGIN
   IF NOT nv_master_private.actor_allowed(v.authorized_by,r.organization_id,v.definition->>'employment_type'='pj') THEN
    RAISE EXCEPTION 'A autorização da recorrência precisa ser renovada.' USING ERRCODE='22023';
   END IF;
   item:=jsonb_populate_record(NULL::public.shifts,v.definition||coalesce(v.finance,'{}')||jsonb_build_object('id',gen_random_uuid()::text,
    'organization_id',r.organization_id,'date',day,'status','pending','coverage_mode','regular','payment_status','pending'));
   original:=item;
   IF public.nv_shift_starts(item)<=now() THEN CONTINUE; END IF;
   -- An identical occupied legacy assignment is already providing this coverage.
   -- Do not adopt it silently or create another post for the same assignment.
   IF EXISTS(SELECT FROM public.shifts s WHERE s.organization_id=item.organization_id AND s.doctor_id=item.doctor_id
    AND s.unit_id=item.unit_id AND s.sector_id=item.sector_id AND s.date=item.date AND s.start_time=item.start_time
    AND s.end_time=item.end_time AND s.status<>'cancelled' AND s.coverage_mode='regular') THEN
    INSERT INTO public.master_schedule_occurrences(rule_id,date,rule_revision,state,issue)
    VALUES(r.id,day,v.revision,'blocked','Já existe uma atribuição neste posto e horário. Confira a vigência da regra; o plantão existente foi preservado.')
    ON CONFLICT(rule_id,date) DO UPDATE SET state='blocked',issue=EXCLUDED.issue,updated_at=now();
    blocked:=blocked+1; CONTINUE;
   END IF;
   why:=NULL;
   IF nv_master_private.unavailable(r.organization_id,r.doctor_id,item) THEN why:='Cobertura necessária';
   ELSIF NOT public.nv_credentialed_for_shift(r.doctor_id,item) OR NOT public.nv_shift_documents_clear(r.doctor_id,item) THEN why:='Revisar elegibilidade do médico fixo';
   ELSIF EXISTS(SELECT FROM public.shifts s WHERE s.organization_id=r.organization_id AND s.doctor_id=r.doctor_id AND s.status<>'cancelled'
    AND public.nv_shift_starts(s)<public.nv_shift_ends(item) AND public.nv_shift_ends(s)>public.nv_shift_starts(item))
    OR EXISTS(SELECT FROM public.doctor_enrollments e WHERE e.doctor_id=r.doctor_id AND e.auth_user_id IS NOT NULL AND public.nv_portal_conflict(e.auth_user_id,item))
    THEN why:='Revisar conflito do médico fixo'; END IF;
   IF why IS NOT NULL THEN item.doctor_id:=NULL; item.status:='open'; END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('nv-master-post:'||item.sector_id||':'||day::text,0));
   SELECT * INTO vacancy FROM public.shifts s WHERE s.organization_id=r.organization_id AND s.unit_id=item.unit_id AND s.sector_id=item.sector_id
    AND s.date=day AND s.start_time=item.start_time AND s.end_time=item.end_time AND s.specialty=item.specialty
    AND s.doctor_id IS NULL AND s.status='open' AND s.coverage_mode='regular'
    AND (s.employment_type IS NULL OR s.employment_type=item.employment_type)
    AND (s.payment_amount IS NULL OR (s.payment_amount IS NOT DISTINCT FROM item.payment_amount AND s.payment_frequency IS NOT DISTINCT FROM item.payment_frequency))
    AND NOT EXISTS(SELECT FROM public.master_schedule_occurrences other WHERE other.shift_id=s.id AND (other.rule_id<>r.id OR other.date<>day OR other.state<>'retired'))
    AND NOT EXISTS(SELECT FROM public.shift_opportunities p WHERE p.shift_id=s.id)
    AND NOT EXISTS(SELECT FROM public.shift_assignment_history h WHERE h.shift_id=s.id)
    AND NOT nv_master_private.protected(s) ORDER BY s.id LIMIT 1 FOR UPDATE OF s;
   IF vacancy.id IS NOT NULL THEN item.id:=vacancy.id; item.notes:=vacancy.notes;
   ELSE
    SELECT coalesce(sum((p->>'requiredDoctors')::integer),0) INTO demand FROM public.sectors sec,
     LATERAL jsonb_array_elements(sec.coverage_periods) p WHERE sec.id=item.sector_id
     AND p->>'kind'=CASE WHEN item.start_time>='18:00' OR item.start_time<'06:00' THEN 'night' ELSE 'day' END;
    IF demand=0 THEN SELECT required_doctors INTO demand FROM public.sectors WHERE id=item.sector_id; END IF;
    SELECT count(*) INTO slots FROM public.shifts s WHERE s.organization_id=r.organization_id AND s.sector_id=item.sector_id
     AND s.date=day AND s.status<>'cancelled' AND s.coverage_mode='regular'
     AND (s.start_time>='18:00' OR s.start_time<'06:00')=(item.start_time>='18:00' OR item.start_time<'06:00');
    IF slots>=demand THEN RAISE EXCEPTION 'Não há posto compatível disponível para esta recorrência.' USING ERRCODE='22023'; END IF;
   END IF;
   PERFORM nv_master_private.write_shift(item,v.finance);
   INSERT INTO public.master_schedule_occurrences(rule_id,date,shift_id,rule_revision,state,created_post,issue)
   VALUES(r.id,day,item.id,v.revision,CASE WHEN why IS NULL THEN 'generated' ELSE 'coverage' END,vacancy.id IS NULL,why)
   ON CONFLICT(rule_id,date) DO UPDATE SET shift_id=EXCLUDED.shift_id,rule_revision=EXCLUDED.rule_revision,state=EXCLUDED.state,
    created_post=EXCLUDED.created_post,issue=EXCLUDED.issue,updated_at=now();
   IF why IS NULL THEN generated:=generated+1; ELSE
    covered:=covered+1;
    INSERT INTO public.master_coverage_publication(shift_id) VALUES(item.id) ON CONFLICT DO NOTHING;
   END IF;
   FOR a IN SELECT * FROM public.doctor_absences absence WHERE absence.organization_id=r.organization_id AND absence.doctor_id=r.doctor_id
    AND nv_master_private.overlaps(absence,public.nv_shift_starts(original),public.nv_shift_ends(original)) LOOP
    INSERT INTO public.doctor_absence_shifts(absence_id,shift_id,original_doctor_id,snapshot,state)
    VALUES(a.id,item.id,r.doctor_id,to_jsonb(original),'open') ON CONFLICT DO NOTHING;
   END LOOP;
   PERFORM nv_master_private.audit(r.organization_id,r.id::text,'occurrence_generated',item.id,jsonb_build_object('date',day,'version',v.revision,'coverage',why IS NOT NULL));
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' OR unique_violation OR insufficient_privilege THEN
   INSERT INTO public.master_schedule_occurrences(rule_id,date,rule_revision,state,issue)
   VALUES(r.id,day,v.revision,'blocked','Confira os postos, as autorizações e os vínculos da recorrência.')
   ON CONFLICT(rule_id,date) DO UPDATE SET state='blocked',issue=EXCLUDED.issue,updated_at=now();
   blocked:=blocked+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('generated',generated,'preserved',preserved,'coverage',covered,'blocked',blocked);
END $$;

CREATE FUNCTION nv_master_private.release_future(target uuid, since date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.master_schedule_occurrences; item public.shifts; preserved integer:=0;
BEGIN
 FOR o IN SELECT * FROM public.master_schedule_occurrences x WHERE x.rule_id=target AND x.date>=since AND x.state IN('generated','coverage') ORDER BY x.date FOR UPDATE LOOP
  SELECT * INTO item FROM public.shifts s WHERE s.id=o.shift_id FOR UPDATE;
  IF NOT FOUND OR nv_master_private.protected(item) OR EXISTS(SELECT FROM public.master_schedule_exceptions e WHERE e.rule_id=o.rule_id AND e.date=o.date)
   OR EXISTS(SELECT FROM public.doctor_absence_shifts a WHERE a.shift_id=item.id)
   OR EXISTS(SELECT FROM public.shift_opportunities p WHERE p.shift_id=item.id) THEN preserved:=preserved+1; CONTINUE; END IF;
  IF item.employment_type='pj' AND item.payment_amount IS NOT NULL AND NOT public.nv_can_finance(item.organization_id) THEN
   RAISE EXCEPTION 'A revisão de plantões PJ exige edição financeira.' USING ERRCODE='42501'; END IF;
  IF o.created_post THEN item.status:='cancelled';
  ELSE item.doctor_id:=NULL; item.status:='open'; item.payment_amount:=NULL; item.payment_agreement:=NULL; item.payment_note:=NULL; END IF;
  PERFORM nv_master_private.write_shift(item,NULL);
  UPDATE public.master_schedule_occurrences SET state='retired',updated_at=now() WHERE rule_id=o.rule_id AND date=o.date;
  PERFORM nv_master_private.audit(item.organization_id,target::text,'occurrence_retired',item.id);
 END LOOP;
 RETURN preserved;
END $$;

CREATE FUNCTION public.nv_master_generate(org text, target uuid DEFAULT NULL, unit_filter text DEFAULT NULL, sector_filter text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rule uuid; report jsonb; total jsonb:='{"generated":0,"preserved":0,"coverage":0,"blocked":0}'; k text;
BEGIN
 PERFORM nv_master_private.require_access(org,'create');
 IF target IS NOT NULL AND NOT EXISTS(SELECT FROM public.master_schedule_rules r WHERE r.id=target AND r.organization_id=org) THEN RAISE EXCEPTION 'Recorrência indisponível.' USING ERRCODE='42501'; END IF;
 FOR rule IN SELECT r.id FROM public.master_schedule_rules r WHERE r.organization_id=org AND (target IS NULL OR r.id=target)
  AND (unit_filter IS NULL OR r.unit_id=unit_filter) AND (sector_filter IS NULL OR r.sector_id=sector_filter) ORDER BY r.id LOOP
  report:=nv_master_private.generate_rule(rule);
  FOREACH k IN ARRAY ARRAY['generated','preserved','coverage','blocked'] LOOP total:=jsonb_set(total,ARRAY[k],to_jsonb((total->>k)::integer+(report->>k)::integer)); END LOOP;
 END LOOP;
 RETURN total;
END $$;
CREATE FUNCTION public.nv_master_generate_scheduled()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.master_schedule_rules; report jsonb; count integer:=0;
BEGIN
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
 RETURN jsonb_build_object('rules',count);
END $$;

CREATE FUNCTION public.nv_master_save_rule(org text, target uuid, spec jsonb, expected_revision integer,
 effective_from date, horizon integer, agreement jsonb DEFAULT NULL, confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.master_schedule_rules; item public.shifts; normalized jsonb; finance jsonb; v public.master_schedule_versions;
 since date:=greatest(effective_from,nv_master_private.today()); preserved integer:=0; id uuid; report jsonb;
BEGIN
 PERFORM nv_master_private.require_access(org,CASE WHEN target IS NULL THEN 'create' ELSE 'edit' END);
 PERFORM nv_master_private.require_access(org,'create');
 IF horizon NOT BETWEEN 1 AND 12 OR effective_from IS NULL THEN RAISE EXCEPTION 'Confira o horizonte e a data da alteração.' USING ERRCODE='22023'; END IF;
 normalized:=nv_master_private.validate_definition(org,spec);
 IF target IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('nv-master:'||target::text,0));
  SELECT * INTO r FROM public.master_schedule_rules x WHERE x.id=target AND x.organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência indisponível.' USING ERRCODE='42501'; END IF;
  IF r.status='ended' OR r.revision<>expected_revision THEN RAISE EXCEPTION 'A recorrência mudou. Reabra os dados.' USING ERRCODE='PT409'; END IF;
  IF r.doctor_id<>normalized->>'doctor_id' THEN RAISE EXCEPTION 'Encerre a regra e cadastre outra para trocar o médico fixo.' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT FROM public.master_schedule_versions x WHERE x.rule_id=target AND x.effective_from>since) THEN
   RAISE EXCEPTION 'Há uma revisão futura. Edite a partir da última revisão agendada.' USING ERRCODE='22023'; END IF;
  IF NOT confirmed THEN RAISE EXCEPTION 'Confirme a revisão das ocorrências futuras. Históricos e substituições serão preservados.' USING ERRCODE='22023'; END IF;
 END IF;
 item:=jsonb_populate_record(NULL::public.shifts,normalized||jsonb_build_object('id',gen_random_uuid()::text,'organization_id',org,'date',greatest(since,(normalized->>'start_date')::date),'status','pending','coverage_mode','regular'));
 IF item.employment_type='pj' AND NOT public.nv_can_finance(org) THEN RAISE EXCEPTION 'O acordo PJ exige edição financeira.' USING ERRCODE='42501'; END IF;
 item:=public.nv_prepare_shift_employment(item,NULL::public.shifts,agreement);
 finance:=jsonb_build_object('payment_amount',item.payment_amount,'payment_frequency',item.payment_frequency,'payment_agreement',item.payment_agreement,'payment_note',item.payment_note);
 IF target IS NULL THEN
  INSERT INTO public.master_schedule_rules(organization_id,doctor_id,unit_id,sector_id,definition,horizon_months,created_by)
  VALUES(org,item.doctor_id,item.unit_id,item.sector_id,normalized,horizon,public.nv_session_actor()) RETURNING * INTO r;
  since:=(normalized->>'start_date')::date;
 ELSE
  preserved:=nv_master_private.release_future(target,since);
  UPDATE public.master_schedule_rules x SET unit_id=item.unit_id,sector_id=item.sector_id,definition=normalized,horizon_months=horizon,revision=x.revision+1,updated_at=now()
  WHERE x.id=target RETURNING * INTO r;
 END IF;
 INSERT INTO public.master_schedule_versions(rule_id,revision,effective_from,definition,finance,authorized_by)
 VALUES(r.id,r.revision,since,normalized,finance,public.nv_session_actor());
 PERFORM nv_master_private.audit(org,r.id::text,CASE WHEN target IS NULL THEN 'rule_created' ELSE 'rule_edited' END,NULL,jsonb_build_object('revision',r.revision,'effective_from',since,'preserved',preserved));
 report:=nv_master_private.generate_rule(r.id);
 RETURN jsonb_build_object('id',r.id,'generation',report,'preserved_on_edit',preserved);
END $$;
CREATE FUNCTION public.nv_master_rule_status(target uuid, next_state text, expected_revision integer,
 future_decision text DEFAULT 'keep', confirmed boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.master_schedule_rules;
BEGIN
 SELECT * INTO r FROM public.master_schedule_rules WHERE id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recorrência indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.require_access(r.organization_id,'edit');
 IF r.revision<>expected_revision THEN RAISE EXCEPTION 'Reabra a recorrência atualizada.' USING ERRCODE='PT409'; END IF;
 IF r.status='ended' OR next_state NOT IN('active','suspended','ended') OR future_decision NOT IN('keep','open') OR NOT confirmed THEN
  RAISE EXCEPTION 'Confira o estado e confirme o tratamento das ocorrências futuras.' USING ERRCODE='22023'; END IF;
 IF future_decision='open' THEN PERFORM nv_master_private.release_future(target,nv_master_private.today()); END IF;
 UPDATE public.master_schedule_rules SET status=next_state,revision=revision+1,updated_at=now() WHERE id=target;
 PERFORM nv_master_private.audit(r.organization_id,r.id::text,'rule_'||next_state,NULL,jsonb_build_object('future_decision',future_decision));
 IF next_state='active' THEN PERFORM nv_master_private.generate_rule(target); END IF;
END $$;

CREATE FUNCTION nv_master_private.absence_spec(org text, spec jsonb, target uuid, cancelling boolean)
RETURNS public.doctor_absences LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.doctor_absences; previous public.doctor_absences;
BEGIN
 IF target IS NOT NULL THEN
  SELECT * INTO previous FROM public.doctor_absences x WHERE x.id=target AND x.organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ausência indisponível.' USING ERRCODE='42501'; END IF;
 END IF;
 IF cancelling THEN a:=previous;
 ELSE a:=jsonb_populate_record(NULL::public.doctor_absences,spec); END IF;
 a.id:=target; a.organization_id:=org; a.created_by:=coalesce(previous.created_by,public.nv_session_actor());
 a.revision:=coalesce(previous.revision,1); a.updated_at:=NULL;
 IF a.doctor_id IS NULL OR (previous.id IS NOT NULL AND a.doctor_id<>previous.doctor_id)
 OR NOT EXISTS(SELECT FROM public.master_schedule_rules r WHERE r.organization_id=org AND r.doctor_id=a.doctor_id)
 OR (a.kind IN('vacation','leave','license','unavailable','other')) IS NOT TRUE
 OR a.start_date IS NULL OR a.end_date IS NULL OR a.end_date<a.start_date OR a.end_date-a.start_date>730
 OR (a.start_time IS NULL)<>(a.end_time IS NULL) OR coalesce(length(a.note),0)>1000
 OR (a.start_time IS NOT NULL AND (a.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 OR a.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR a.start_time=a.end_time)) THEN
  RAISE EXCEPTION 'Confira o médico fixo, o tipo, as datas e o horário da ausência.' USING ERRCODE='22023'; END IF;
 a.status:=CASE WHEN cancelling THEN 'cancelled' WHEN a.end_date<nv_master_private.today() THEN 'ended'
  WHEN a.start_date<=nv_master_private.today() THEN 'active' ELSE 'scheduled' END;
 RETURN a;
END $$;
CREATE FUNCTION nv_master_private.absence_impacts(a public.doctor_absences, cancelling boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.shifts; r public.master_schedule_rules; v public.master_schedule_versions; day date; action text;
 span public.doctor_absences:=a; result jsonb:='[]';
BEGIN
 span.status:='scheduled';
 FOR s IN SELECT shift.* FROM public.shifts shift WHERE shift.organization_id=a.organization_id AND shift.status<>'cancelled'
  AND shift.date BETWEEN a.start_date-1 AND a.end_date
  AND (shift.doctor_id=a.doctor_id OR EXISTS(SELECT FROM public.master_schedule_occurrences o
   JOIN public.master_schedule_rules rule ON rule.id=o.rule_id WHERE o.shift_id=shift.id AND rule.doctor_id=a.doctor_id)
   OR EXISTS(SELECT FROM public.doctor_absence_shifts l WHERE l.shift_id=shift.id AND l.absence_id=a.id))
  AND nv_master_private.overlaps(span,public.nv_shift_starts(shift),public.nv_shift_ends(shift)) ORDER BY shift.date,shift.id LOOP
  action:=CASE WHEN nv_master_private.protected(s) THEN 'protected'
   WHEN s.doctor_id IS NOT NULL AND s.doctor_id<>a.doctor_id THEN 'preserve'
   WHEN cancelling AND s.doctor_id IS NULL THEN 'restore'
   WHEN cancelling THEN 'preserve' ELSE 'open' END;
  result:=result||jsonb_build_array(jsonb_build_object('shift_id',s.id,'rule_id',(SELECT o.rule_id FROM public.master_schedule_occurrences o WHERE o.shift_id=s.id),
   'date',s.date,'start_time',s.start_time,'end_time',s.end_time,'doctor_id',s.doctor_id,'action',action));
 END LOOP;
 IF NOT cancelling THEN
  FOR r IN SELECT * FROM public.master_schedule_rules rule WHERE rule.organization_id=a.organization_id AND rule.doctor_id=a.doctor_id AND rule.status='active' LOOP
   FOR day IN SELECT d::date FROM generate_series(greatest(a.start_date-1,nv_master_private.today())::timestamp,a.end_date::timestamp,interval '1 day') d LOOP
    v:=nv_master_private.version_at(r.id,day);
    IF v.rule_id IS NULL OR NOT nv_master_private.matches(v.definition,day)
     OR EXISTS(SELECT FROM public.master_schedule_occurrences o WHERE o.rule_id=r.id AND o.date=day AND o.state<>'blocked') THEN CONTINUE; END IF;
    s:=jsonb_populate_record(NULL::public.shifts,v.definition||jsonb_build_object('date',day));
    IF nv_master_private.overlaps(span,public.nv_shift_starts(s),public.nv_shift_ends(s)) THEN
     result:=result||jsonb_build_array(jsonb_build_object('shift_id',NULL,'rule_id',r.id,'date',day,'start_time',s.start_time,'end_time',s.end_time,'doctor_id',a.doctor_id,'action','planned'));
    END IF;
   END LOOP;
  END LOOP;
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION nv_master_private.absence_preview(org text, spec jsonb, target uuid, cancelling boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.doctor_absences; old public.doctor_absences; impacts jsonb; fingerprint text;
BEGIN
 a:=nv_master_private.absence_spec(org,spec,target,cancelling);
 impacts:=nv_master_private.absence_impacts(a,cancelling);
 IF target IS NOT NULL AND NOT cancelling THEN
  SELECT * INTO old FROM public.doctor_absences WHERE id=target;
  impacts:=impacts||nv_master_private.absence_impacts(old,true);
  -- Prefer the new impact when a shift occurs in both the previous and revised interval.
  SELECT coalesce(jsonb_agg(x.value ORDER BY x.position),'[]') INTO impacts FROM (
   SELECT DISTINCT ON(coalesce(i.value->>'shift_id',(i.value->>'rule_id')||':'||(i.value->>'date'))) i.value,i.position
   FROM jsonb_array_elements(impacts) WITH ORDINALITY i(value,position)
   ORDER BY coalesce(i.value->>'shift_id',(i.value->>'rule_id')||':'||(i.value->>'date')),i.position
  ) x;
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'[]') INTO fingerprint FROM public.shifts s
  WHERE EXISTS(SELECT FROM jsonb_array_elements(impacts) i WHERE i->>'shift_id'=s.id);
 RETURN jsonb_build_object('candidate',to_jsonb(a),'impacts',impacts,'token',md5(to_jsonb(a)::text||impacts::text||fingerprint));
END $$;
CREATE FUNCTION public.nv_master_preview_absence(org text, spec jsonb, target uuid DEFAULT NULL, cancelling boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM nv_master_private.require_access(org,'edit',true);
 RETURN nv_master_private.absence_preview(org,spec,target,cancelling)-'candidate';
END $$;

CREATE FUNCTION nv_master_private.restore_absence(target uuid, keep_absence public.doctor_absences DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.doctor_absence_shifts; item public.shifts; saved public.shifts; opportunity uuid;
 restored integer:=0; preserved integer:=0; blocked integer:=0;
BEGIN
 FOR l IN SELECT * FROM public.doctor_absence_shifts x WHERE x.absence_id=target ORDER BY x.shift_id FOR UPDATE LOOP
  SELECT * INTO item FROM public.shifts s WHERE s.id=l.shift_id FOR UPDATE;
  IF NOT FOUND THEN CONTINUE; END IF;
  -- Editing an interval must not briefly restore and reopen its unchanged overlap.
  IF keep_absence.doctor_id IS NOT NULL AND keep_absence.status<>'cancelled'
   AND nv_master_private.overlaps(keep_absence,public.nv_shift_starts(item),public.nv_shift_ends(item)) THEN CONTINUE; END IF;
  IF item.doctor_id IS NOT NULL OR l.state IN('covered','preserved') THEN
   preserved:=preserved+1; CONTINUE;
  END IF;
  IF nv_master_private.protected(item) OR item.status='cancelled'
   OR nv_master_private.unavailable(item.organization_id,l.original_doctor_id,item)
   OR EXISTS(SELECT FROM public.master_schedule_occurrences o JOIN public.master_schedule_exceptions e USING(rule_id,date) WHERE o.shift_id=item.id)
   OR ((l.snapshot->>'employment_type')='pj' AND NOT public.nv_can_finance(item.organization_id)) THEN
   UPDATE public.doctor_absence_shifts SET state='blocked',updated_at=now() WHERE absence_id=target AND shift_id=item.id;
   blocked:=blocked+1; CONTINUE;
  END IF;
  BEGIN
   SELECT id INTO opportunity FROM public.shift_opportunities p WHERE p.shift_id=item.id AND p.status='open' FOR UPDATE;
   IF opportunity IS NOT NULL THEN PERFORM public.nv_close_shift_opportunity(opportunity,NULL); END IF;
   saved:=jsonb_populate_record(NULL::public.shifts,l.snapshot);
   item.doctor_id:=l.original_doctor_id; item.status:='pending'; item.employment_type:=saved.employment_type; item.employer_name:=saved.employer_name;
   item.payment_amount:=saved.payment_amount; item.payment_frequency:=saved.payment_frequency; item.payment_agreement:=saved.payment_agreement; item.payment_note:=saved.payment_note;
   PERFORM nv_master_private.write_shift(item,l.snapshot);
   UPDATE public.doctor_absence_shifts SET state='restored',updated_at=now() WHERE absence_id=target AND shift_id=item.id;
   UPDATE public.master_schedule_occurrences SET state='generated',issue=NULL,updated_at=now() WHERE shift_id=item.id AND state='coverage';
   PERFORM nv_master_private.audit(item.organization_id,target::text,'absence_assignment_restored',item.id);
   restored:=restored+1;
  EXCEPTION WHEN SQLSTATE '22023' OR SQLSTATE 'P0001' OR insufficient_privilege THEN
   UPDATE public.doctor_absence_shifts SET state='blocked',updated_at=now() WHERE absence_id=target AND shift_id=item.id;
   blocked:=blocked+1;
  END;
 END LOOP;
 RETURN jsonb_build_object('changed',restored,'preserved',preserved,'blocked',blocked);
END $$;
CREATE FUNCTION public.nv_master_apply_absence(org text, spec jsonb, target uuid, expected_revision integer,
 preview_token text, cancelling boolean DEFAULT false, confirmed boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE preview jsonb; a public.doctor_absences; old public.doctor_absences; item public.shifts; snapshot jsonb;
 result jsonb; opportunity uuid; changed integer:=0; preserved integer:=0; blocked integer:=0;
BEGIN
 PERFORM nv_master_private.require_access(org,'edit',true);
 a:=nv_master_private.absence_spec(org,spec,target,cancelling);
 PERFORM pg_advisory_xact_lock(hashtextextended(org||':'||a.doctor_id,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('nv-master-absence:'||org||':'||a.doctor_id,0));
 IF target IS NOT NULL THEN
  SELECT * INTO old FROM public.doctor_absences x WHERE x.id=target AND x.organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ausência indisponível.' USING ERRCODE='42501'; END IF;
  IF old.revision<>expected_revision OR old.status='cancelled' THEN RAISE EXCEPTION 'A ausência mudou. Reabra a prévia.' USING ERRCODE='PT409'; END IF;
 END IF;
 -- Lock the actual assignments before checking the preview fingerprint.
 PERFORM 1 FROM public.shifts s WHERE s.organization_id=org AND s.date BETWEEN
  least(coalesce((spec->>'start_date')::date,old.start_date),coalesce(old.start_date,(spec->>'start_date')::date))-1
  AND greatest(coalesce((spec->>'end_date')::date,old.end_date),coalesce(old.end_date,(spec->>'end_date')::date)) ORDER BY s.id FOR UPDATE;
 preview:=nv_master_private.absence_preview(org,spec,target,cancelling);
 IF NOT confirmed OR preview_token IS DISTINCT FROM preview->>'token' THEN RAISE EXCEPTION 'A escala mudou. Confira e confirme uma nova prévia.' USING ERRCODE='PT409'; END IF;
 a:=jsonb_populate_record(NULL::public.doctor_absences,preview->'candidate');
 IF target IS NOT NULL THEN
  UPDATE public.doctor_absences SET status='cancelled' WHERE id=target;
  result:=nv_master_private.restore_absence(target,a);
  changed:=(result->>'changed')::integer; preserved:=(result->>'preserved')::integer; blocked:=(result->>'blocked')::integer;
  UPDATE public.doctor_absences SET kind=a.kind,start_date=a.start_date,end_date=a.end_date,start_time=a.start_time,end_time=a.end_time,
   note=a.note,status=a.status,revision=revision+1,updated_at=now() WHERE id=target RETURNING * INTO a;
 ELSE
  INSERT INTO public.doctor_absences(organization_id,doctor_id,kind,start_date,end_date,start_time,end_time,note,status,created_by)
  VALUES(org,a.doctor_id,a.kind,a.start_date,a.end_date,a.start_time,a.end_time,a.note,a.status,public.nv_session_actor()) RETURNING * INTO a;
 END IF;
 IF NOT cancelling THEN
  FOR item IN SELECT s.* FROM public.shifts s WHERE s.organization_id=org AND s.status<>'cancelled'
   AND s.date BETWEEN a.start_date-1 AND a.end_date
   AND (s.doctor_id=a.doctor_id OR EXISTS(SELECT FROM public.master_schedule_occurrences o JOIN public.master_schedule_rules r ON r.id=o.rule_id WHERE o.shift_id=s.id AND r.doctor_id=a.doctor_id))
   AND nv_master_private.overlaps(a,public.nv_shift_starts(s),public.nv_shift_ends(s)) ORDER BY s.date,s.id FOR UPDATE OF s LOOP
   SELECT l.snapshot INTO snapshot FROM public.doctor_absence_shifts l WHERE l.shift_id=item.id AND l.original_doctor_id=a.doctor_id ORDER BY l.updated_at LIMIT 1;
   snapshot:=coalesce(snapshot,to_jsonb(item));
   IF item.doctor_id IS NOT NULL AND item.doctor_id<>a.doctor_id THEN
    INSERT INTO public.doctor_absence_shifts VALUES(a.id,item.id,a.doctor_id,snapshot,'preserved',now()) ON CONFLICT DO NOTHING;
    preserved:=preserved+1; CONTINUE;
   END IF;
   IF nv_master_private.protected(item) OR (item.employment_type='pj' AND item.payment_amount IS NOT NULL AND NOT public.nv_can_finance(org)) THEN
    INSERT INTO public.doctor_absence_shifts VALUES(a.id,item.id,a.doctor_id,snapshot,'blocked',now()) ON CONFLICT DO NOTHING;
    blocked:=blocked+1; CONTINUE;
   END IF;
   SELECT id INTO opportunity FROM public.shift_opportunities p WHERE p.shift_id=item.id AND p.status='open' FOR UPDATE;
   IF opportunity IS NOT NULL THEN PERFORM public.nv_close_shift_opportunity(opportunity,NULL); END IF;
   IF item.doctor_id=a.doctor_id THEN
    item.doctor_id:=NULL; item.status:='open'; item.payment_amount:=NULL; item.payment_agreement:=NULL; item.payment_note:=NULL;
    PERFORM nv_master_private.write_shift(item,NULL);
    changed:=changed+1;
   END IF;
   INSERT INTO public.doctor_absence_shifts VALUES(a.id,item.id,a.doctor_id,snapshot,'open',now())
   ON CONFLICT(absence_id,shift_id) DO UPDATE SET state='open',updated_at=now();
   INSERT INTO public.master_coverage_publication(shift_id) VALUES(item.id) ON CONFLICT(shift_id) DO UPDATE SET enabled=false,updated_at=now();
   UPDATE public.master_schedule_occurrences SET state='coverage',issue='Cobertura necessária',updated_at=now() WHERE shift_id=item.id AND state<>'manual';
   PERFORM nv_master_private.audit(org,a.id::text,'absence_coverage_opened',item.id);
  END LOOP;
 END IF;
 PERFORM nv_master_private.audit(org,a.id::text,CASE WHEN cancelling THEN 'absence_cancelled' WHEN target IS NULL THEN 'absence_created' ELSE 'absence_edited' END,NULL,
  jsonb_build_object('doctor_id',a.doctor_id,'start_date',a.start_date,'end_date',a.end_date,'changed',changed,'preserved',preserved,'blocked',blocked));
 RETURN jsonb_build_object('id',a.id,'changed',changed,'preserved',preserved,'blocked',blocked);
END $$;

CREATE FUNCTION public.nv_master_overview(org text, unit_filter text DEFAULT NULL, sector_filter text DEFAULT NULL, doctor_filter text DEFAULT NULL)
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
  (SELECT a.id,a.action,a.entity_id,a.created_at FROM public.master_schedule_audit a WHERE a.organization_id=org
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
CREATE FUNCTION public.nv_master_shift_context(ids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF cardinality(ids)>500 OR cardinality(ids) IS NULL THEN RAISE EXCEPTION 'Seleção inválida.' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('shift_id',s.id,'rule_id',r.id,'state',coalesce(o.state,CASE WHEN r.id IS NOT NULL THEN 'retired' ELSE 'manual' END),
  'original_doctor_id',r.doctor_id,'original_doctor_name',d.name,'unit_id',r.unit_id,'sector_id',r.sector_id,'coverage',EXISTS(SELECT FROM public.doctor_absence_shifts a WHERE a.shift_id=s.id AND a.state IN('open','covered','preserved','blocked')),
  'history',(SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]') FROM (SELECT a.action,a.created_at FROM public.master_schedule_audit a
    WHERE a.organization_id=s.organization_id AND a.shift_id=s.id ORDER BY a.id DESC LIMIT 20) h))),'[]') INTO result
 FROM public.shifts s LEFT JOIN public.master_schedule_occurrences o ON o.shift_id=s.id LEFT JOIN public.master_schedule_rules r ON r.id=coalesce(o.rule_id,
  (SELECT previous.id FROM public.master_schedule_audit a JOIN public.master_schedule_rules previous ON previous.id::text=a.entity_id
   WHERE a.organization_id=s.organization_id AND a.shift_id=s.id AND a.action='occurrence_generated' ORDER BY a.id DESC LIMIT 1))
 LEFT JOIN public.doctors d ON d.id=r.doctor_id WHERE s.id=ANY(ids) AND public.nv_org_access(s.organization_id) AND public.nv_can_action(s.organization_id,'escala','view')
 AND (r.id IS NOT NULL OR EXISTS(SELECT FROM public.doctor_absence_shifts a WHERE a.shift_id=s.id));
 RETURN result;
END $$;
CREATE FUNCTION public.nv_master_my_absences()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('shifts',
  (SELECT coalesce(jsonb_agg(jsonb_build_object('shift_id',s.id,'date',s.date,'state',l.state) ORDER BY s.date),'[]')
   FROM public.doctor_absence_shifts l JOIN public.shifts s ON s.id=l.shift_id WHERE l.absence_id=a.id)) ORDER BY a.start_date DESC),'[]')
 FROM public.doctor_absences a WHERE public.nv_owns_doctor(a.organization_id,a.doctor_id);
$$;

-- Pending coverage is distinct from publishing an offer. Preserve the existing portal projection.
ALTER FUNCTION public.nv_portal_schedule(date,date,boolean) RENAME TO nv_master_portal_schedule_base;
CREATE FUNCTION public.nv_portal_schedule(from_date date, to_date date, mine boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(item),'[]') FROM jsonb_array_elements(public.nv_master_portal_schedule_base(from_date,to_date,mine)) item
 WHERE mine IS TRUE OR NOT EXISTS(SELECT FROM public.master_coverage_publication p WHERE p.shift_id=item->>'id' AND NOT p.enabled);
$$;
REVOKE ALL ON FUNCTION public.nv_portal_schedule(date,date,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.nv_portal_schedule(date,date,boolean) TO authenticated;
CREATE FUNCTION nv_master_private.application_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.shifts;
BEGIN
 SELECT s.* INTO item FROM public.shifts s JOIN public.shift_opportunities o ON o.shift_id=s.id WHERE o.id=NEW.opportunity_id;
 IF NEW.status='pending' AND (EXISTS(SELECT FROM public.master_coverage_publication p WHERE p.shift_id=item.id AND NOT p.enabled)
  OR nv_master_private.unavailable(item.organization_id,NEW.doctor_id,item)) THEN
  RAISE EXCEPTION 'Este plantão não está disponível para candidatura.' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER nv_master_application_guard BEFORE INSERT OR UPDATE ON public.shift_applications FOR EACH ROW EXECUTE FUNCTION nv_master_private.application_guard();
CREATE FUNCTION public.nv_master_publish_coverage(target text, enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.shifts; opportunity uuid;
BEGIN
 SELECT * INTO item FROM public.shifts s WHERE s.id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.require_access(item.organization_id,'edit',true);
 IF item.doctor_id IS NOT NULL OR item.status<>'open' OR nv_master_private.protected(item)
  OR NOT EXISTS(SELECT FROM public.master_coverage_publication p WHERE p.shift_id=item.id) THEN
  RAISE EXCEPTION 'A cobertura não está disponível para publicação.' USING ERRCODE='22023'; END IF;
 IF enabled IS NULL THEN RAISE EXCEPTION 'Informe a situação da oferta.' USING ERRCODE='22023'; END IF;
 UPDATE public.master_coverage_publication p SET enabled=nv_master_publish_coverage.enabled,updated_by=public.nv_session_actor(),updated_at=now() WHERE p.shift_id=item.id;
 IF enabled THEN
  INSERT INTO public.shift_opportunities(shift_id,kind) VALUES(item.id,'vacancy')
  ON CONFLICT(shift_id) WHERE status='open' DO NOTHING;
  INSERT INTO public.portal_notifications(recipient_id,event_key,message)
  SELECT e.auth_user_id,'offer:master:'||item.id,'Há uma vaga disponível em uma das suas unidades.'
  FROM public.doctor_enrollments e WHERE e.auth_user_id IS NOT NULL AND e.status='approved' AND e.organization_id=item.organization_id
   AND public.nv_credentialed_for_shift(e.doctor_id,item) AND public.nv_shift_documents_clear(e.doctor_id,item)
   AND NOT nv_master_private.unavailable(item.organization_id,e.doctor_id,item) ON CONFLICT DO NOTHING;
 ELSE
  SELECT id INTO opportunity FROM public.shift_opportunities p WHERE p.shift_id=item.id AND p.status='open';
  IF opportunity IS NOT NULL THEN PERFORM public.nv_close_shift_opportunity(opportunity,NULL); END IF;
 END IF;
 PERFORM nv_master_private.audit(item.organization_id,item.id,CASE WHEN enabled THEN 'coverage_published' ELSE 'coverage_pending' END,item.id);
END $$;

-- Revoke inherited default grants, including those from Supabase's default privileges.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='nv_master_private' OR (n.nspname='public' AND p.proname LIKE 'nv_master_%') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.nv_master_overview(text,text,text,text), public.nv_master_generate(text,uuid,text,text),
 public.nv_master_save_rule(text,uuid,jsonb,integer,date,integer,jsonb,boolean),public.nv_master_rule_status(uuid,text,integer,text,boolean),
 public.nv_master_preview_absence(text,jsonb,uuid,boolean),public.nv_master_apply_absence(text,jsonb,uuid,integer,text,boolean,boolean),
 public.nv_master_shift_context(text[]),public.nv_master_my_absences(),public.nv_master_publish_coverage(text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nv_master_generate_scheduled() TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA nv_master_private FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF EXISTS(SELECT FROM pg_extension WHERE extname='pg_cron') THEN
  PERFORM cron.schedule('nvmed-master-daily','0 5 * * *','SELECT public.nv_master_generate_scheduled();');
 ELSE
  RAISE NOTICE 'Habilite Supabase Cron e execute master-schedule-cron.setup.sql antes de ativar a geração diária.';
 END IF;
END $$;
COMMIT;
