-- Separate current approval from execution. NULL identifies rows that predate this migration.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.units ADD COLUMN time_zone text NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE public.shifts ADD COLUMN approval_source text
  CHECK (approval_source IN ('pending','doctor','administrative','automatic','legacy')),
  ADD COLUMN approval_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN shift_time_zone text NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE public.shifts ALTER COLUMN approval_source SET DEFAULT 'pending';

CREATE FUNCTION nv_master_private.validate_unit_time_zone()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.time_zone)
    OR NEW.time_zone LIKE 'posix/%' OR NEW.time_zone LIKE 'right/%' THEN
    RAISE EXCEPTION 'Informe um fuso horário IANA válido.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER nv_validate_unit_time_zone BEFORE INSERT OR UPDATE OF time_zone ON public.units
FOR EACH ROW EXECUTE FUNCTION nv_master_private.validate_unit_time_zone();

CREATE OR REPLACE FUNCTION public.nv_shift_starts(shift public.shifts)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (shift.date + shift.start_time::time) AT TIME ZONE shift.shift_time_zone;
$$;
CREATE OR REPLACE FUNCTION public.nv_shift_ends(shift public.shifts)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (shift.date + shift.end_time::time + CASE WHEN shift.end_time::time < shift.start_time::time
    THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE shift.shift_time_zone;
$$;

CREATE FUNCTION nv_master_private.snapshot_shift_time_zone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    SELECT u.time_zone INTO NEW.shift_time_zone FROM public.units u WHERE u.id = NEW.unit_id;
  ELSE
    NEW.shift_time_zone := OLD.shift_time_zone;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aa_nv_snapshot_shift_time_zone BEFORE INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION nv_master_private.snapshot_shift_time_zone();

CREATE FUNCTION nv_master_private.approval_state(item public.shifts)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(item.approval_source, CASE WHEN item.status IN ('confirmed','completed') THEN 'legacy' ELSE 'pending' END);
$$;

CREATE OR REPLACE FUNCTION public.nv_permission_actions()
RETURNS TABLE(module text,action text) LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT * FROM public.nv_permission_actions_before_doctor_access()
  UNION ALL SELECT 'portal_medico',unnest(ARRAY['view','edit'])
  UNION ALL SELECT 'escala',unnest(ARRAY['history','approve_shift','edit_past']);
$$;
CREATE OR REPLACE FUNCTION public.nv_role_action(account_type text,account_role text,module text,action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN module = 'escala' AND action = 'history' THEN
    CASE WHEN account_type = 'saas_admin' THEN account_role IN ('CEO','Gerente','Coordenador')
    ELSE account_role IN ('Diretor','Gerente','Coordenador de Escalas') END
  WHEN module = 'escala' AND action IN ('approve_shift','edit_past') THEN
    CASE WHEN account_type = 'saas_admin' THEN account_role IN ('CEO','Gerente','Coordenador','Administrativo')
    WHEN account_type = 'tenant_user' THEN account_role IN ('Diretor','Gerente','Coordenador de Escalas','Escalista') ELSE false END
  WHEN module = 'portal_medico' THEN action IN ('view','edit') AND
    CASE WHEN account_type = 'saas_admin' THEN account_role IN ('CEO','Gerente') ELSE account_role IN ('Diretor','Gerente') END
  ELSE public.nv_role_action_before_doctor_access(account_type,account_role,module,action) END;
$$;

-- Capability scoped to a single transaction and shift, inaccessible to API roles.
CREATE TABLE nv_master_private.shift_approval_context (
  transaction_id bigint NOT NULL,
  shift_id text NOT NULL,
  source text,
  reason text,
  PRIMARY KEY(transaction_id, shift_id)
);
REVOKE ALL ON nv_master_private.shift_approval_context FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION nv_master_private.log_shift_approval(item public.shifts, event text, source text,
  before_state jsonb, after_state jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := public.nv_session_actor(); actor_name text; actor_role text;
BEGIN
  IF source = 'automatic' THEN
    actor := NULL;
  ELSIF source = 'doctor' THEN
    SELECT d.name, e.portal_role INTO actor_name, actor_role
    FROM public.doctor_enrollments e JOIN public.doctors d ON d.id = e.doctor_id
    WHERE e.doctor_id = item.doctor_id AND e.auth_user_id = actor;
  ELSE
    SELECT u.name, u.role INTO actor_name, actor_role FROM public.user_accounts u
    WHERE u.auth_user_id = actor AND u.status = 'active'
      AND (u.organization_id = item.organization_id OR u.type = 'saas_admin') LIMIT 1;
  END IF;
  INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,
    unit_id,sector_id,shift_date,actor_name,actor_role,origin,previous,next,created_at)
  VALUES (item.organization_id,item.id,item.id,event,actor,item.unit_id,item.sector_id,
    item.date,actor_name,actor_role,source,before_state,after_state,clock_timestamp());
END $$;

CREATE FUNCTION nv_master_private.guard_shift_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prior text;
  relevant boolean;
  operational boolean;
  ended boolean;
  active_settlement boolean;
  formal_adjustment boolean;
  context nv_master_private.shift_approval_context%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.approval_source := 'pending';
    NEW.approval_revision := 0;
    IF NEW.status = 'confirmed' THEN NEW.status := 'pending'; END IF;
    RETURN NEW;
  END IF;

  prior := nv_master_private.approval_state(OLD);
  ended := public.nv_shift_ends(OLD) <= statement_timestamp();
  active_settlement := public.nv_shift_has_settlement(OLD);
  IF TG_OP = 'DELETE' THEN
    IF active_settlement OR (ended AND (prior IN ('doctor','legacy') OR OLD.doctor_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'Use o fluxo de ajuste para preservar o histórico deste plantão encerrado.' USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO context FROM nv_master_private.shift_approval_context c
  WHERE c.transaction_id = txid_current() AND c.shift_id = OLD.id;
  NEW.approval_source := OLD.approval_source;
  NEW.approval_revision := OLD.approval_revision;

  relevant := (NEW.doctor_id,NEW.date,NEW.start_time,NEW.end_time,NEW.unit_id,NEW.sector_id,NEW.specialty,NEW.payment_amount)
    IS DISTINCT FROM (OLD.doctor_id,OLD.date,OLD.start_time,OLD.end_time,OLD.unit_id,OLD.sector_id,OLD.specialty,OLD.payment_amount);
  operational := relevant OR
    (NEW.type,NEW.notes,NEW.employment_type,NEW.employer_name,NEW.coverage_mode,NEW.coverage_reason,NEW.status = 'cancelled')
    IS DISTINCT FROM
    (OLD.type,OLD.notes,OLD.employment_type,OLD.employer_name,OLD.coverage_mode,OLD.coverage_reason,OLD.status = 'cancelled');
  formal_adjustment := active_settlement AND NEW.payment_amount IS DISTINCT FROM OLD.payment_amount
    AND NEW.payment_agreement IS DISTINCT FROM OLD.payment_agreement
    AND coalesce(NEW.payment_agreement->>'kind' = 'paid_adjustment',false)
    AND public.nv_can_finance(OLD.organization_id) AND public.nv_can_action(OLD.organization_id,'configuracoes','edit')
    AND (NEW.doctor_id,NEW.date,NEW.start_time,NEW.end_time,NEW.unit_id,NEW.sector_id,NEW.specialty,
      NEW.type,NEW.notes,NEW.employment_type,NEW.employer_name,NEW.coverage_mode,NEW.coverage_reason,NEW.status)
     IS NOT DISTINCT FROM (OLD.doctor_id,OLD.date,OLD.start_time,OLD.end_time,OLD.unit_id,OLD.sector_id,OLD.specialty,
      OLD.type,OLD.notes,OLD.employment_type,OLD.employer_name,OLD.coverage_mode,OLD.coverage_reason,OLD.status);
  IF ended AND operational AND NOT formal_adjustment THEN
    IF prior IN ('doctor','legacy') THEN
      RAISE EXCEPTION 'Os dados operacionais deste plantão encerrado estão protegidos pela confirmação.' USING ERRCODE = '22023';
    END IF;
    IF active_settlement THEN
      RAISE EXCEPTION 'Use o ajuste ou estorno financeiro antes de alterar um plantão com pagamento registrado.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.nv_can_action(OLD.organization_id,'escala','edit')
      OR NOT public.nv_can_action(OLD.organization_id,'escala','edit_past') THEN
      RAISE EXCEPTION 'Seu acesso não permite editar um plantão encerrado.' USING ERRCODE = '42501';
    END IF;
    IF coalesce(length(context.reason),0) NOT BETWEEN 3 AND 1000 OR context.source IS NOT NULL THEN
      RAISE EXCEPTION 'Informe uma justificativa de 3 a 1000 caracteres para editar o plantão encerrado.' USING ERRCODE = '22023';
    END IF;
    PERFORM nv_master_private.log_shift_approval(NEW,'shift_retroactively_edited','manual',
      nv_master_private.schedule_snapshot('shift',to_jsonb(OLD)),
      nv_master_private.schedule_snapshot('shift',to_jsonb(NEW)) || jsonb_build_object('reason',context.reason,
        'private_note_updated',NEW.notes IS DISTINCT FROM OLD.notes));
  END IF;

  IF relevant OR (NEW.status = 'cancelled' AND OLD.status <> 'cancelled') THEN
    NEW.approval_revision := OLD.approval_revision + 1;
    IF NOT ended OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.status = 'cancelled' THEN
      NEW.approval_source := 'pending';
      IF NEW.status = 'confirmed' AND NEW.doctor_id IS NOT NULL THEN NEW.status := 'pending'; END IF;
      IF prior <> 'pending' THEN
        PERFORM nv_master_private.log_shift_approval(NEW,'shift_approval_invalidated','manual',
          jsonb_build_object('approval_source',prior,'doctor_id',OLD.doctor_id,'revision',OLD.approval_revision),
          jsonb_build_object('approval_source','pending','doctor_id',NEW.doctor_id,'revision',NEW.approval_revision));
      END IF;
    END IF;
  END IF;

  IF context.source IS NOT NULL THEN
    IF operational OR NEW.doctor_id IS NULL OR NEW.status IN ('open','cancelled') THEN
      RAISE EXCEPTION 'Os dados do plantão foram alterados. Confira os detalhes e tente novamente.' USING ERRCODE = '22023';
    END IF;
    NEW.approval_source := context.source;
    PERFORM nv_master_private.log_shift_approval(NEW,'shift_approved',context.source,
      jsonb_build_object('approval_source',prior,'doctor_id',OLD.doctor_id,'revision',OLD.approval_revision),
      jsonb_strip_nulls(jsonb_build_object('approval_source',context.source,'doctor_id',NEW.doctor_id,
        'revision',NEW.approval_revision,'reason',context.reason)));
  ELSIF OLD.approval_source IS NULL AND NEW.approval_source IS NULL THEN
    NEW.approval_source := prior;
  END IF;
  IF NEW.doctor_id IS NOT NULL AND NEW.status IN ('pending','confirmed') THEN
    NEW.status := CASE WHEN NEW.approval_source = 'pending' THEN 'pending' ELSE 'confirmed' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zzz_nv_guard_shift_approval BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION nv_master_private.guard_shift_approval();

ALTER FUNCTION public.nv_save_operational_shifts(jsonb) RENAME TO nv_save_operational_shifts_base;
REVOKE ALL ON FUNCTION public.nv_save_operational_shifts_base(jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.nv_save_operational_shifts(records jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE output jsonb;
BEGIN
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'Envie de 1 a 5000 plantões por operação.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO nv_master_private.shift_approval_context(transaction_id,shift_id,reason)
  SELECT txid_current(), value->>'id', btrim(value->>'retro_reason') FROM jsonb_array_elements(records)
  WHERE value->>'id' IS NOT NULL AND value->>'retro_reason' IS NOT NULL
  ON CONFLICT DO NOTHING;
  output := public.nv_save_operational_shifts_base(records);
  DELETE FROM nv_master_private.shift_approval_context WHERE transaction_id = txid_current();
  RETURN output;
END $$;

CREATE FUNCTION public.nv_approve_shift(target text, revision integer, administrative boolean, note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item public.shifts; source text; prior text;
BEGIN
  SELECT * INTO item FROM public.shifts s WHERE s.id = target FOR UPDATE;
  IF NOT FOUND OR administrative IS NULL OR NOT (CASE WHEN administrative
    THEN public.nv_can_action(item.organization_id,'escala','edit') AND public.nv_can_action(item.organization_id,'escala','approve_shift')
    ELSE public.nv_owns_doctor(item.organization_id,item.doctor_id) END) THEN
    RAISE EXCEPTION 'Plantão indisponível para confirmação.' USING ERRCODE = '42501';
  END IF;
  IF item.approval_revision IS DISTINCT FROM revision OR item.doctor_id IS NULL OR item.status IN ('open','cancelled') THEN
    RAISE EXCEPTION 'Confira os dados atuais do plantão antes de confirmar.' USING ERRCODE = '22023';
  END IF;
  prior := nv_master_private.approval_state(item);
  source := CASE WHEN administrative THEN 'administrative' ELSE 'doctor' END;
  IF prior = source THEN RETURN; END IF;
  IF administrative AND prior <> 'pending' THEN
    RAISE EXCEPTION 'Este plantão já possui uma aprovação.' USING ERRCODE = '22023';
  END IF;
  note := CASE WHEN administrative THEN btrim(note) END;
  IF administrative AND coalesce(length(note),0) NOT BETWEEN 3 AND 1000 THEN
    RAISE EXCEPTION 'Informe uma justificativa de 3 a 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO nv_master_private.shift_approval_context VALUES(txid_current(),target,source,note);
  UPDATE public.shifts SET status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END WHERE id = target;
  DELETE FROM nv_master_private.shift_approval_context WHERE transaction_id = txid_current() AND shift_id = target;
END $$;

CREATE OR REPLACE FUNCTION public.nv_validate_shift() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE starts timestamptz; ends timestamptz; canonical_sector text;
BEGIN
 SELECT sec.name INTO canonical_sector FROM public.sectors sec
 WHERE sec.id=NEW.sector_id AND sec.unit_id=NEW.unit_id AND sec.organization_id=NEW.organization_id;
 IF canonical_sector IS NULL AND NOT (NEW.sector_id IS NULL AND NEW.coverage_mode='adhoc') THEN RAISE EXCEPTION 'Selecione um setor válido desta unidade.'; END IF;
 NEW.sector := canonical_sector;
 IF NEW.specialty IS NOT NULL THEN NEW.specialty := nullif(trim(NEW.specialty),''); END IF;
 IF NEW.doctor_id IS NULL THEN
   NEW.status := CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'open' END;
 ELSE
   IF NEW.status='open' THEN NEW.status := 'pending'; END IF;
   IF NEW.employment_type IS NULL AND (TG_OP = 'INSERT' OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR OLD.employment_type IS NOT NULL) THEN RAISE EXCEPTION 'Informe o vínculo de trabalho.'; END IF;
   IF NEW.employment_type='pj' AND coalesce(length(trim(NEW.employer_name)),0)=0 THEN RAISE EXCEPTION 'Informe a empresa PJ.'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.doctors WHERE id=NEW.doctor_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE EXCEPTION 'Selecione um médico ativo da mesma empresa.'; END IF;
 END IF;
 IF length(NEW.employer_name)>150 THEN RAISE EXCEPTION 'Nome do empregador muito longo.'; END IF;
 IF NEW.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.start_time=NEW.end_time THEN RAISE EXCEPTION 'Informe horários válidos e diferentes.'; END IF;
 IF TG_OP='UPDATE' AND NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'Não é permitido transferir registros entre empresas.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.units WHERE id=NEW.unit_id AND organization_id=NEW.organization_id AND status='active') THEN RAISE EXCEPTION 'Selecione uma unidade ativa da mesma empresa.'; END IF;
 IF NEW.doctor_id IS NOT NULL AND NEW.status<>'cancelled' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.organization_id || ':' || NEW.doctor_id,0));
   starts := public.nv_shift_starts(NEW);
   ends := public.nv_shift_ends(NEW);
   IF EXISTS(SELECT 1 FROM public.shifts s WHERE s.doctor_id=NEW.doctor_id AND s.id<>NEW.id AND s.status<>'cancelled' AND s.organization_id=NEW.organization_id AND
     public.nv_shift_starts(s) < ends AND public.nv_shift_ends(s) > starts) THEN
     RAISE EXCEPTION 'Este médico já está escalado em um horário sobreposto.';
   END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.nv_calculate_shift_due(shift public.shifts)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  terms public.organization_payment_terms%ROWTYPE;
  month_start date;
  month_end date;
  due date;
BEGIN
  IF shift.payment_frequency = 'on_delivery' THEN
    RETURN (public.nv_shift_ends(shift) AT TIME ZONE shift.shift_time_zone)::date;
  END IF;
  SELECT * INTO terms FROM public.organization_payment_terms WHERE organization_id = shift.organization_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  month_start := (date_trunc('month', shift.date::timestamp) + make_interval(months => terms.month_offset))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  due := month_start + terms.payment_day - 1;
  IF due > month_end THEN
    due := month_end + CASE WHEN terms.short_month = 'next_month' THEN 1 ELSE 0 END;
  END IF;
  IF terms.business_adjustment <> 'none' THEN
    WHILE extract(isodow FROM due) >= 6 OR due = ANY(terms.holidays) LOOP
      due := due + CASE WHEN terms.business_adjustment = 'next' THEN 1 ELSE -1 END;
    END LOOP;
  END IF;
  RETURN due;
END;
$$;

CREATE OR REPLACE FUNCTION public.nv_select_shift_candidate(target uuid, candidate text, employment text, employer text, agreement jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  shift public.shifts%ROWTYPE;
  opportunity public.shift_opportunities%ROWTYPE;
  updated public.shifts%ROWTYPE;
BEGIN
  SELECT s.* INTO shift FROM public.shifts s JOIN public.shift_opportunities o ON o.shift_id = s.id
  WHERE o.id = target FOR UPDATE OF s;
  IF NOT FOUND OR NOT public.nv_coordinator(shift.organization_id) THEN
    RAISE EXCEPTION 'Oportunidade indisponível.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO opportunity FROM public.shift_opportunities WHERE id = target;
  IF NOT FOUND OR opportunity.status <> 'open' OR public.nv_shift_starts(shift) <= now()
    OR shift.doctor_id IS DISTINCT FROM opportunity.original_doctor_id
    OR shift.status <> (CASE WHEN opportunity.kind = 'vacancy' THEN 'open' ELSE 'confirmed' END)
    OR NOT EXISTS (SELECT 1 FROM public.shift_applications WHERE opportunity_id = target AND doctor_id = candidate AND status = 'pending') THEN
    RAISE EXCEPTION 'Esta candidatura já foi encerrada ou perdeu a validade.' USING ERRCODE = '22023';
  END IF;
  IF employment IS NULL OR employment NOT IN ('clt','concursado','pj')
    OR (employment = 'pj' AND coalesce(length(btrim(employer)),0) = 0) OR length(employer) > 150 THEN
    RAISE EXCEPTION 'Informe o vínculo e o empregador do médico selecionado.' USING ERRCODE = '22023';
  END IF;
  updated := shift;
  updated.doctor_id := candidate;
  updated.employment_type := employment;
  updated := public.nv_prepare_shift_employment(updated, shift, nullif(agreement,'null'::jsonb));
  PERFORM public.nv_close_shift_opportunity(target, candidate);
  -- The assignment trigger revalidates credentials, availability and overlap under a physician lock.
  UPDATE public.shifts SET doctor_id = candidate, status = 'pending', employment_type = employment,
    employer_name = nullif(btrim(employer), ''), payment_amount = updated.payment_amount,
    payment_frequency = updated.payment_frequency, payment_agreement = updated.payment_agreement,
    payment_note = updated.payment_note WHERE id = shift.id;
  INSERT INTO nv_master_private.shift_approval_context
  VALUES(txid_current(),shift.id,'administrative','Candidatura ou substituição aprovada pela coordenação.');
  UPDATE public.shifts SET status = 'confirmed' WHERE id = shift.id;
  DELETE FROM nv_master_private.shift_approval_context WHERE transaction_id = txid_current() AND shift_id = shift.id;
END;
$$;

CREATE INDEX nv_shift_expiring_approval_idx ON public.shifts(date,id)
WHERE status = 'pending' AND doctor_id IS NOT NULL AND (approval_source IS NULL OR approval_source = 'pending');

CREATE FUNCTION nv_master_private.auto_approve_expired_shifts(organization_scope text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_ids text[];
BEGIN
  SELECT array_agg(x.id) INTO target_ids FROM (
    SELECT s.id FROM public.shifts s JOIN public.doctors d ON d.id = s.doctor_id AND d.organization_id = s.organization_id
    JOIN public.organizations o ON o.id = s.organization_id
    JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
    WHERE s.status = 'pending' AND s.doctor_id IS NOT NULL AND (s.approval_source IS NULL OR s.approval_source = 'pending')
      AND (organization_scope IS NULL OR s.organization_id = organization_scope)
      AND s.date <= (statement_timestamp() AT TIME ZONE 'UTC')::date + 1
      AND public.nv_shift_ends(s) <= statement_timestamp()
      AND d.status = 'active' AND o.status = 'active' AND u.status = 'active'
    ORDER BY s.date,s.id LIMIT 200 FOR UPDATE OF s SKIP LOCKED
  ) x;
  IF target_ids IS NULL THEN RETURN 0; END IF;
  INSERT INTO nv_master_private.shift_approval_context
  SELECT txid_current(), id, 'automatic', 'Plantão aprovado automaticamente por expiração do prazo de confirmação.'
  FROM unnest(target_ids) ids(id);
  UPDATE public.shifts SET status = 'confirmed' WHERE id = ANY(target_ids);
  DELETE FROM nv_master_private.shift_approval_context WHERE transaction_id = txid_current();
  RETURN cardinality(target_ids);
END $$;

-- The recurring job uses this entry point. Release verification can invoke
-- the same implementation scoped to its synthetic organization as DB owner.
CREATE FUNCTION public.nv_auto_approve_expired_shifts()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT nv_master_private.auto_approve_expired_shifts(NULL);
$$;

CREATE OR REPLACE FUNCTION public.nv_portal_schedule(from_date date, to_date date, mine boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(
    item || CASE WHEN item->>'assigned_to_me' = 'true' THEN jsonb_build_object(
      'approval_source',nv_master_private.approval_state(s),'approval_revision',s.approval_revision)
      ELSE '{}'::jsonb END ORDER BY s.date,s.start_time,s.id),'[]')
  FROM jsonb_array_elements(public.nv_master_portal_schedule_base(from_date,to_date,mine)) item
  JOIN public.shifts s ON s.id = item->>'id'
  WHERE mine IS TRUE OR NOT EXISTS(SELECT FROM public.master_coverage_publication p WHERE p.shift_id = s.id AND NOT p.enabled);
$$;

CREATE OR REPLACE VIEW public.nv_staff_shifts WITH (security_barrier = true) AS
WITH organization_access AS MATERIALIZED (
  SELECT o.id,public.nv_can_action(o.id,'escala','view') AS can_view_schedule,
    public.nv_can_read_finance(o.id) AS can_read_finance FROM public.organizations o
)
SELECT s.id,s.organization_id,s.doctor_id,s.unit_id,s.sector_id,s.sector,s.specialty,s.date,
  s.start_time,s.end_time,s.type,s.status,s.notes,s.employment_type,s.employer_name,s.coverage_mode,s.coverage_reason,
  CASE WHEN access.can_read_finance THEN s.payment_amount END payment_amount,
  CASE WHEN access.can_read_finance THEN s.payment_frequency END payment_frequency,
  CASE WHEN access.can_read_finance THEN s.payment_status END payment_status,
  CASE WHEN access.can_read_finance THEN s.paid_at END paid_at,
  CASE WHEN access.can_read_finance THEN s.paid_amount END paid_amount,
  CASE WHEN access.can_read_finance THEN s.payment_due_date END payment_due_date,
  CASE WHEN access.can_read_finance THEN s.payment_note END payment_note,
  CASE WHEN access.can_read_finance THEN s.payment_agreement END payment_agreement,
  nv_master_private.approval_state(s) approval_source,s.approval_revision,public.nv_shift_ends(s) approval_ended_at
FROM public.shifts s JOIN organization_access access ON access.id = s.organization_id
WHERE access.can_view_schedule OR access.can_read_finance;

REVOKE ALL ON FUNCTION nv_master_private.validate_unit_time_zone(),nv_master_private.snapshot_shift_time_zone(),
  nv_master_private.approval_state(public.shifts),nv_master_private.guard_shift_approval(),
  nv_master_private.log_shift_approval(public.shifts,text,text,jsonb,jsonb),
  public.nv_save_operational_shifts(jsonb),public.nv_approve_shift(text,integer,boolean,text),
  nv_master_private.auto_approve_expired_shifts(text),
  public.nv_auto_approve_expired_shifts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_save_operational_shifts(jsonb),public.nv_approve_shift(text,integer,boolean,text) TO authenticated;
-- The view invokes functions under the caller's ACL. Expose only the projection helpers.
GRANT EXECUTE ON FUNCTION nv_master_private.approval_state(public.shifts),public.nv_shift_starts(public.shifts),public.nv_shift_ends(public.shifts) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
