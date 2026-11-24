BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE public.billing_clients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 150),
 UNIQUE(organization_id,name)
);
CREATE TABLE public.billing_contracts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 client_id uuid NOT NULL REFERENCES public.billing_clients(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
 UNIQUE(client_id,name)
);
CREATE TABLE public.billing_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL REFERENCES public.billing_contracts(id),
 unit_id text REFERENCES public.units(id),
 sector_id text REFERENCES public.sectors(id),
 specialty text,
 shift_type text CHECK(shift_type IN ('onsite','oncall','telemedicine')),
 shift_period text CHECK(shift_period IN ('day','night')),
 day_kind text CHECK(day_kind IN ('weekday','weekend','holiday')),
 valid_from date NOT NULL,
 valid_until date CHECK(valid_until >= valid_from),
 revenue_rate numeric(12,4) NOT NULL CHECK(revenue_rate BETWEEN 0 AND 99999999.9999),
 medical_rate numeric(12,4) NOT NULL CHECK(medical_rate BETWEEN 0 AND 99999999.9999),
 revenue_premium numeric(12,4) NOT NULL DEFAULT 0 CHECK(revenue_premium BETWEEN 0 AND 99999999.9999),
 medical_premium numeric(12,4) NOT NULL DEFAULT 0 CHECK(medical_premium BETWEEN 0 AND 99999999.9999),
 CHECK(sector_id IS NULL OR unit_id IS NOT NULL)
);
CREATE INDEX nv_billing_rate_lookup ON public.billing_rates(organization_id,valid_from,valid_until);
CREATE TABLE public.billing_periods (
 organization_id text NOT NULL REFERENCES public.organizations(id),
 month date NOT NULL CHECK(extract(day FROM month)=1),
 closed_at timestamptz,
 PRIMARY KEY(organization_id,month)
);
CREATE TABLE public.shift_billing (
 shift_id text PRIMARY KEY REFERENCES public.shifts(id) ON DELETE CASCADE,
 organization_id text NOT NULL REFERENCES public.organizations(id),
 contract_id uuid NOT NULL REFERENCES public.billing_contracts(id),
 rate_snapshot jsonb NOT NULL,
 revenue_rate numeric(13,4) NOT NULL CHECK(revenue_rate >= 0),
 medical_rate numeric(13,4) NOT NULL CHECK(medical_rate >= 0),
 planned_minutes integer NOT NULL CHECK(planned_minutes > 0),
 worked_minutes integer CHECK(worked_minutes BETWEEN 0 AND 2880),
 payable_minutes integer CHECK(payable_minutes BETWEEN 0 AND 2880),
 billable_minutes integer CHECK(billable_minutes BETWEEN 0 AND 2880),
 assessed_at timestamptz,
 CHECK((assessed_at IS NULL AND worked_minutes IS NULL AND payable_minutes IS NULL AND billable_minutes IS NULL)
   OR (assessed_at IS NOT NULL AND worked_minutes IS NOT NULL AND payable_minutes IS NOT NULL AND billable_minutes IS NOT NULL))
);
CREATE TABLE public.billing_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL,
 month date NOT NULL,
 contract_id uuid NOT NULL REFERENCES public.billing_contracts(id),
 unit_id text NOT NULL REFERENCES public.units(id),
 sector_id text REFERENCES public.sectors(id),
 due_on date NOT NULL,
 issued_on date,
 document_ref text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(organization_id,month) REFERENCES public.billing_periods(organization_id,month),
 UNIQUE NULLS NOT DISTINCT(organization_id,month,contract_id,unit_id,sector_id)
);
CREATE TABLE public.billing_invoice_lines (
 shift_id text PRIMARY KEY REFERENCES public.shift_billing(shift_id) ON DELETE RESTRICT,
 invoice_id uuid NOT NULL REFERENCES public.billing_invoices(id),
 billable_minutes integer NOT NULL,
 payable_minutes integer NOT NULL,
 revenue numeric(16,2) NOT NULL,
 medical_cost numeric(16,2) NOT NULL
);
CREATE INDEX nv_invoice_lines_invoice_idx ON public.billing_invoice_lines(invoice_id);
CREATE TABLE public.billing_movements (
 id uuid PRIMARY KEY,
 invoice_id uuid NOT NULL REFERENCES public.billing_invoices(id),
 kind text NOT NULL CHECK(kind IN ('receipt','discount','deduction','adjustment','reversal')),
 amount numeric(16,2) NOT NULL CHECK(amount <> 0),
 posted_on date NOT NULL,
 note text CHECK(length(note)<=1000),
 receipt_path text,
 reverses uuid UNIQUE REFERENCES public.billing_movements(id),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind='reversal')=(reverses IS NOT NULL))
);
CREATE INDEX nv_billing_movement_invoice ON public.billing_movements(invoice_id,posted_on);
CREATE TABLE public.billing_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id text NOT NULL REFERENCES public.organizations(id),
 entity text NOT NULL,
 target text NOT NULL,
 action text NOT NULL,
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 previous jsonb,
 next jsonb,
 reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX nv_billing_audit_entity ON public.billing_audit(organization_id,entity,target,id DESC);

DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['billing_clients','billing_contracts','billing_rates','billing_periods',
   'shift_billing','billing_invoices','billing_invoice_lines','billing_movements','billing_audit'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',relation);
 END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.billing_audit_id_seq FROM PUBLIC,anon,authenticated,service_role;

ALTER FUNCTION public.nv_permission_actions() RENAME TO nv_permission_actions_before_billing;
ALTER FUNCTION public.nv_role_action(text,text,text,text) RENAME TO nv_role_action_before_billing;
CREATE FUNCTION public.nv_permission_actions()
RETURNS TABLE(module text,action text) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT * FROM public.nv_permission_actions_before_billing()
 UNION ALL SELECT 'financeiro',unnest(ARRAY['rates_view','rates_edit','billing_view','billing_manage',
  'receipt','adjustment','period_close','period_reopen','export']);
$$;
CREATE FUNCTION public.nv_role_action(account_type text,account_role text,module text,action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN module='financeiro' AND action IN ('rates_view','rates_edit','billing_view','billing_manage',
    'receipt','adjustment','period_close','period_reopen','export') THEN
  CASE WHEN account_type='saas_admin' THEN account_role IN ('CEO','Gerente')
    OR (account_role='Financeiro' AND action NOT IN ('adjustment','period_reopen'))
  WHEN account_type='tenant_user' THEN account_role IN ('Diretor','Gerente')
    OR (account_role='Financeiro' AND action NOT IN ('adjustment','period_reopen')) ELSE false END
 ELSE public.nv_role_action_before_billing(account_type,account_role,module,action) END;
$$;
REVOKE ALL ON FUNCTION public.nv_permission_actions(),public.nv_role_action(text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION nv_master_private.require_billing(org text, action text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.nv_can_action(org,'financeiro',action)
  OR NOT EXISTS(SELECT FROM public.user_accounts u WHERE u.auth_user_id=public.nv_session_actor()
    AND u.status='active' AND (u.type='saas_admin' OR u.organization_id=org)
    AND public.nv_schedule_administrative_role(u.type,u.role))
  OR NOT EXISTS(SELECT FROM public.organizations o WHERE o.id=org AND o.status='active') THEN
  RAISE EXCEPTION 'Seu acesso não permite esta operação financeira.' USING ERRCODE='42501';
 END IF;
END $$;

CREATE FUNCTION nv_master_private.billing_log(org text, entity text, target text, action text, prior jsonb, next jsonb, reason text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.billing_audit(organization_id,entity,target,action,actor_id,previous,next,reason)
 VALUES(org,entity,target,action,public.nv_session_actor(),prior,next,reason);
$$;

CREATE FUNCTION nv_master_private.billing_month(day date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT date_trunc('month',day::timestamp)::date;
$$;

CREATE FUNCTION nv_master_private.lock_billing_month(org text, month date, check_open boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('nv-billing:'||org||':'||month,0));
 IF check_open AND EXISTS(SELECT FROM public.billing_periods p
   WHERE p.organization_id=org AND p.month=lock_billing_month.month AND p.closed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Competência encerrada. Use o fluxo de reabertura ou ajuste.' USING ERRCODE='22023';
 END IF;
END $$;

CREATE FUNCTION public.nv_billing_catalog(org text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM nv_master_private.require_billing(org,CASE WHEN public.nv_can_action(org,'financeiro','rates_view')
   THEN 'rates_view' ELSE 'billing_view' END);
 RETURN jsonb_build_object(
  'clients',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.name),'[]') FROM public.billing_clients c WHERE c.organization_id=org),
  'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.name),'[]') FROM public.billing_contracts c WHERE c.organization_id=org),
  'rates',CASE WHEN public.nv_can_action(org,'financeiro','rates_view') THEN
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.valid_from DESC,r.id),'[]') FROM public.billing_rates r WHERE r.organization_id=org) END);
END $$;

CREATE FUNCTION public.nv_save_billing_client(org text, target uuid, name text, client uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; prior jsonb;
BEGIN
 PERFORM nv_master_private.require_billing(org,'rates_edit');
 name := btrim(name);
 IF coalesce(length(name),0) NOT BETWEEN 1 AND 150 THEN
  RAISE EXCEPTION 'Informe o nome da contratante ou do contrato.' USING ERRCODE='22023';
 END IF;
 IF client IS NULL THEN
  IF target IS NULL THEN
   INSERT INTO public.billing_clients(organization_id,name) VALUES(org,name) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(c) INTO prior FROM public.billing_clients c WHERE c.id=target AND c.organization_id=org FOR UPDATE;
   UPDATE public.billing_clients SET name=nv_save_billing_client.name WHERE organization_id=org AND id=target RETURNING id INTO result;
  END IF;
 ELSE
  IF NOT EXISTS(SELECT FROM public.billing_clients c WHERE c.id=client AND c.organization_id=org) THEN
   RAISE EXCEPTION 'Contratante indisponível.' USING ERRCODE='42501';
  END IF;
  IF target IS NULL THEN
   INSERT INTO public.billing_contracts(organization_id,client_id,name) VALUES(org,client,name) RETURNING id INTO result;
  ELSE
   SELECT to_jsonb(c) INTO prior FROM public.billing_contracts c WHERE c.id=target AND c.organization_id=org AND c.client_id=client FOR UPDATE;
   UPDATE public.billing_contracts SET name=nv_save_billing_client.name WHERE organization_id=org AND client_id=client AND id=target RETURNING id INTO result;
  END IF;
 END IF;
 IF result IS NULL THEN RAISE EXCEPTION 'Cadastro indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.billing_log(org,CASE WHEN client IS NULL THEN 'client' ELSE 'contract' END,result::text,'saved',prior,jsonb_build_object('name',name),NULL);
 RETURN result;
END $$;

CREATE FUNCTION public.nv_save_billing_rate(org text, target uuid, spec jsonb, reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.billing_rates; prior public.billing_rates;
BEGIN
 PERFORM nv_master_private.require_billing(org,'rates_edit');
 reason := btrim(reason);
 IF coalesce(length(reason),0) NOT BETWEEN 3 AND 1000 OR jsonb_typeof(spec) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Informe a justificativa e os dados da regra.' USING ERRCODE='22023';
 END IF;
 item := jsonb_populate_record(NULL::public.billing_rates,spec);
 IF NOT EXISTS(SELECT FROM public.billing_contracts c WHERE c.id=item.contract_id AND c.organization_id=org)
   OR (item.unit_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.units u WHERE u.id=item.unit_id AND u.organization_id=org))
   OR (item.sector_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.sectors s WHERE s.id=item.sector_id AND s.organization_id=org AND s.unit_id=item.unit_id))
   OR (item.specialty IS NOT NULL AND NOT EXISTS(SELECT FROM public.organizations o WHERE o.id=org AND o.settings->'specialties' ? item.specialty)) THEN
  RAISE EXCEPTION 'Confira o contrato e o escopo da regra.' USING ERRCODE='22023';
 END IF;
 item.revenue_premium := coalesce(item.revenue_premium,0);
 item.medical_premium := coalesce(item.medical_premium,0);
 IF item.valid_from IS NULL OR item.valid_until<item.valid_from OR item.revenue_rate IS NULL OR item.medical_rate IS NULL THEN
  RAISE EXCEPTION 'Informe a vigência e os dois valores por hora.' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('nv-rates:'||org,0));
 IF target IS NOT NULL THEN
  SELECT * INTO prior FROM public.billing_rates r WHERE r.id=target AND r.organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Regra indisponível.' USING ERRCODE='42501'; END IF;
 END IF;
 IF EXISTS(SELECT FROM public.billing_rates r WHERE r.organization_id=org AND r.id IS DISTINCT FROM target
   AND (r.unit_id,r.sector_id,r.specialty,r.shift_type,r.shift_period,r.day_kind)
    IS NOT DISTINCT FROM (item.unit_id,item.sector_id,item.specialty,item.shift_type,item.shift_period,item.day_kind)
   AND daterange(r.valid_from,r.valid_until,'[]') && daterange(item.valid_from,item.valid_until,'[]')) THEN
  RAISE EXCEPTION 'Já existe uma regra para este escopo com vigência sobreposta.' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.billing_rates(id,organization_id,contract_id,unit_id,sector_id,specialty,shift_type,shift_period,day_kind,
   valid_from,valid_until,revenue_rate,medical_rate,revenue_premium,medical_premium)
 VALUES(coalesce(target,gen_random_uuid()),org,item.contract_id,item.unit_id,item.sector_id,item.specialty,item.shift_type,
   item.shift_period,item.day_kind,item.valid_from,item.valid_until,item.revenue_rate,item.medical_rate,item.revenue_premium,item.medical_premium)
 ON CONFLICT(id) DO UPDATE SET contract_id=EXCLUDED.contract_id,unit_id=EXCLUDED.unit_id,sector_id=EXCLUDED.sector_id,
  specialty=EXCLUDED.specialty,shift_type=EXCLUDED.shift_type,shift_period=EXCLUDED.shift_period,day_kind=EXCLUDED.day_kind,
  valid_from=EXCLUDED.valid_from,valid_until=EXCLUDED.valid_until,revenue_rate=EXCLUDED.revenue_rate,
  medical_rate=EXCLUDED.medical_rate,revenue_premium=EXCLUDED.revenue_premium,medical_premium=EXCLUDED.medical_premium
 RETURNING * INTO item;
 PERFORM nv_master_private.billing_log(org,'rate',item.id::text,'saved',CASE WHEN prior.id IS NOT NULL THEN to_jsonb(prior) END,to_jsonb(item),reason);
 RETURN item.id;
EXCEPTION WHEN integrity_constraint_violation OR numeric_value_out_of_range THEN
 RAISE EXCEPTION 'Confira a vigência, os adicionais e os valores por hora.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION nv_master_private.resolve_billing_rate(item public.shifts)
RETURNS public.billing_rates LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT r.* FROM public.billing_rates r
 LEFT JOIN public.organization_payment_terms calendar ON calendar.organization_id=item.organization_id
 LEFT JOIN public.sectors s ON s.id=item.sector_id
 WHERE r.organization_id=item.organization_id AND item.date BETWEEN r.valid_from AND coalesce(r.valid_until,'infinity'::date)
   AND (r.unit_id IS NULL OR r.unit_id=item.unit_id)
   AND (r.sector_id IS NULL OR r.sector_id=item.sector_id)
   AND (r.specialty IS NULL OR r.specialty=item.specialty)
   AND (r.shift_type IS NULL OR r.shift_type=item.type)
   AND (r.shift_period IS NULL OR r.shift_period=coalesce((SELECT p->>'kind'
     FROM jsonb_array_elements(s.coverage_periods) p WHERE p->>'startTime'=item.start_time LIMIT 1),
     CASE WHEN item.start_time>='18:00' OR item.start_time<'06:00' THEN 'night' ELSE 'day' END))
   AND (r.day_kind IS NULL OR r.day_kind=CASE WHEN item.date=ANY(calendar.holidays) THEN 'holiday'
     WHEN extract(isodow FROM item.date)>=6 THEN 'weekend' ELSE 'weekday' END)
 ORDER BY (r.sector_id IS NOT NULL) DESC,(r.unit_id IS NOT NULL) DESC,(r.specialty IS NOT NULL) DESC,
   (r.shift_type IS NOT NULL) DESC,(r.shift_period IS NOT NULL) DESC,(r.day_kind IS NOT NULL) DESC,
   r.valid_from DESC,r.id LIMIT 1;
$$;

CREATE FUNCTION nv_master_private.shift_planned_minutes(item public.shifts)
RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT round(extract(epoch FROM public.nv_shift_ends(item)-public.nv_shift_starts(item))/60)::integer;
$$;

CREATE FUNCTION nv_master_private.hour_value(minutes integer, rate numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT round(minutes::numeric * rate / 60,2);
$$;

CREATE FUNCTION nv_master_private.store_billing_snapshot(item public.shifts, rule public.billing_rates)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.shift_billing(shift_id,organization_id,contract_id,rate_snapshot,revenue_rate,medical_rate,planned_minutes)
 VALUES(item.id,item.organization_id,rule.contract_id,to_jsonb(rule),rule.revenue_rate+rule.revenue_premium,
   rule.medical_rate+rule.medical_premium,nv_master_private.shift_planned_minutes(item))
 ON CONFLICT(shift_id) DO UPDATE SET contract_id=EXCLUDED.contract_id,rate_snapshot=EXCLUDED.rate_snapshot,
  revenue_rate=EXCLUDED.revenue_rate,medical_rate=EXCLUDED.medical_rate,planned_minutes=EXCLUDED.planned_minutes;
$$;

CREATE FUNCTION nv_master_private.protect_shift_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_month date; next_month date;
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM nv_master_private.lock_billing_month(NEW.organization_id,nv_master_private.billing_month(NEW.date),true);
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND (OLD.doctor_id,OLD.date,OLD.start_time,OLD.end_time,OLD.unit_id,OLD.sector_id,OLD.specialty,
   OLD.type,OLD.employment_type,OLD.employer_name,OLD.payment_amount,OLD.status='cancelled') IS NOT DISTINCT FROM
  (NEW.doctor_id,NEW.date,NEW.start_time,NEW.end_time,NEW.unit_id,NEW.sector_id,NEW.specialty,
   NEW.type,NEW.employment_type,NEW.employer_name,NEW.payment_amount,NEW.status='cancelled') THEN
  RETURN NEW;
 END IF;
 old_month:=nv_master_private.billing_month(OLD.date);
 next_month:=CASE WHEN TG_OP='UPDATE' THEN nv_master_private.billing_month(NEW.date) ELSE old_month END;
 PERFORM nv_master_private.lock_billing_month(OLD.organization_id,least(old_month,next_month),true);
 IF old_month<>next_month THEN PERFORM nv_master_private.lock_billing_month(OLD.organization_id,greatest(old_month,next_month),true); END IF;
 IF EXISTS(SELECT FROM public.billing_invoice_lines l WHERE l.shift_id=OLD.id) THEN
  RAISE EXCEPTION 'Plantão consolidado. Registre o ajuste no faturamento.' USING ERRCODE='22023';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF EXISTS(SELECT FROM public.shift_billing b WHERE b.shift_id=OLD.id AND b.assessed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'Desfaça a apuração com justificativa antes de alterar este plantão.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zzzz_nv_protect_shift_billing BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION nv_master_private.protect_shift_billing();

CREATE FUNCTION nv_master_private.snapshot_shift_billing()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rule public.billing_rates;
BEGIN
 IF NEW.status='cancelled' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.date,OLD.start_time,OLD.end_time,OLD.unit_id,OLD.sector_id,OLD.specialty,OLD.type) IS NOT DISTINCT FROM
    (NEW.date,NEW.start_time,NEW.end_time,NEW.unit_id,NEW.sector_id,NEW.specialty,NEW.type) THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT FROM public.shift_billing b WHERE b.shift_id=OLD.id) THEN RETURN NULL; END IF;
 END IF;
 rule := nv_master_private.resolve_billing_rate(NEW);
 IF rule.id IS NOT NULL THEN
  PERFORM nv_master_private.store_billing_snapshot(NEW,rule);
 ELSIF TG_OP='UPDATE' THEN
  DELETE FROM public.shift_billing b WHERE b.shift_id=NEW.id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER zy_nv_shift_billing_snapshot AFTER INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION nv_master_private.snapshot_shift_billing();

CREATE FUNCTION public.nv_assess_shift_billing(target text, worked integer, payable integer, billable integer,
  reason text, rate_id uuid DEFAULT NULL, revenue_override numeric DEFAULT NULL, medical_override numeric DEFAULT NULL,
  reset_assessment boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.shifts; prior public.shift_billing; result public.shift_billing; rule public.billing_rates;
BEGIN
 SELECT * INTO item FROM public.shifts s WHERE s.id=target FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.require_billing(item.organization_id,'billing_manage');
 PERFORM nv_master_private.lock_billing_month(item.organization_id,nv_master_private.billing_month(item.date),true);
 reason := btrim(reason);
 IF coalesce(length(reason),0) NOT BETWEEN 3 AND 1000 THEN
  RAISE EXCEPTION 'Informe a justificativa da apuração.' USING ERRCODE='22023';
 END IF;
 IF item.doctor_id IS NULL OR item.status='cancelled' OR public.nv_shift_ends(item)>statement_timestamp()
   OR EXISTS(SELECT FROM public.billing_invoice_lines l WHERE l.shift_id=target) THEN
  RAISE EXCEPTION 'A apuração exige um plantão encerrado, alocado e disponível para faturar.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO prior FROM public.shift_billing b WHERE b.shift_id=target;
 IF reset_assessment THEN
  UPDATE public.shift_billing SET worked_minutes=NULL,payable_minutes=NULL,billable_minutes=NULL,assessed_at=NULL WHERE shift_id=target RETURNING * INTO result;
 ELSE
  IF (worked BETWEEN 0 AND 2880 AND payable BETWEEN 0 AND 2880 AND billable BETWEEN 0 AND 2880) IS NOT TRUE THEN
   RAISE EXCEPTION 'Informe os minutos realizados, remuneráveis e faturáveis.' USING ERRCODE='22023';
  END IF;
  IF prior.shift_id IS NULL THEN
   SELECT * INTO rule FROM public.billing_rates r WHERE r.id=rate_id AND r.organization_id=item.organization_id;
   IF NOT FOUND OR rule.id IS DISTINCT FROM (nv_master_private.resolve_billing_rate(item)).id THEN
    RAISE EXCEPTION 'Confirme a regra contratual vigente para regularizar o plantão.' USING ERRCODE='22023';
   END IF;
   PERFORM nv_master_private.store_billing_snapshot(item,rule);
  END IF;
  IF revenue_override IS NOT NULL OR medical_override IS NOT NULL THEN
   PERFORM nv_master_private.require_billing(item.organization_id,'rates_edit');
   IF coalesce(revenue_override,0) NOT BETWEEN 0 AND 99999999.9999
     OR coalesce(medical_override,0) NOT BETWEEN 0 AND 99999999.9999 THEN
    RAISE EXCEPTION 'Confira os valores excepcionais por hora.' USING ERRCODE='22023';
   END IF;
  END IF;
  UPDATE public.shift_billing SET worked_minutes=worked,payable_minutes=payable,billable_minutes=billable,
   assessed_at=clock_timestamp(),revenue_rate=coalesce(revenue_override,revenue_rate),medical_rate=coalesce(medical_override,medical_rate)
  WHERE shift_id=target RETURNING * INTO result;
 END IF;
 IF result.shift_id IS NOT NULL THEN
  PERFORM nv_master_private.billing_log(item.organization_id,'shift',target,CASE WHEN reset_assessment THEN 'reopened' ELSE 'assessed' END,
    CASE WHEN prior.shift_id IS NOT NULL THEN to_jsonb(prior) END,to_jsonb(result),reason);
 END IF;
END $$;
CREATE FUNCTION public.nv_consolidate_billing(org text, month date, shift_ids text[], due_on date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item record; invoice public.billing_invoices; tally integer:=0;
BEGIN
 PERFORM nv_master_private.require_billing(org,'billing_manage');
 IF month IS NULL OR extract(day FROM month)<>1 OR due_on IS NULL OR due_on<month OR due_on>month+interval '2 years'
   OR coalesce(cardinality(shift_ids),0) NOT BETWEEN 1 AND 5000 THEN
  RAISE EXCEPTION 'Confira a competência, os plantões e o vencimento.' USING ERRCODE='22023';
 END IF;
 PERFORM nv_master_private.lock_billing_month(org,month,true);
 INSERT INTO public.billing_periods(organization_id,month) VALUES(org,month) ON CONFLICT DO NOTHING;
 FOR item IN SELECT s.id,s.unit_id,s.sector_id,b.contract_id,b.billable_minutes,b.payable_minutes,b.revenue_rate,b.medical_rate
   FROM public.shifts s JOIN public.shift_billing b ON b.shift_id=s.id
   WHERE s.organization_id=org AND s.id=ANY(shift_ids) AND s.status<>'cancelled' AND s.doctor_id IS NOT NULL
     AND s.date>=month AND s.date<month+interval '1 month' AND b.assessed_at IS NOT NULL
   ORDER BY s.id
 LOOP
  SELECT i.* INTO invoice FROM public.billing_invoices i WHERE i.organization_id=org AND i.month=nv_consolidate_billing.month
    AND (i.contract_id,i.unit_id,i.sector_id) IS NOT DISTINCT FROM (item.contract_id,item.unit_id,item.sector_id);
  IF FOUND THEN
   IF invoice.issued_on IS NOT NULL OR invoice.due_on<>due_on THEN
    RAISE EXCEPTION 'O grupo já foi faturado ou tem outro vencimento.' USING ERRCODE='22023';
   END IF;
  ELSE
   INSERT INTO public.billing_invoices(organization_id,month,contract_id,unit_id,sector_id,due_on)
   VALUES(org,month,item.contract_id,item.unit_id,item.sector_id,due_on) RETURNING * INTO invoice;
  END IF;
  INSERT INTO public.billing_invoice_lines(shift_id,invoice_id,billable_minutes,payable_minutes,revenue,medical_cost)
  VALUES(item.id,invoice.id,item.billable_minutes,item.payable_minutes,
    nv_master_private.hour_value(item.billable_minutes,item.revenue_rate),nv_master_private.hour_value(item.payable_minutes,item.medical_rate));
  PERFORM nv_master_private.billing_log(org,'invoice',invoice.id::text,'shift_consolidated',NULL,jsonb_build_object('shift_id',item.id),NULL);
  tally:=tally+1;
 END LOOP;
 IF tally<>cardinality(shift_ids) THEN
  RAISE EXCEPTION 'Há plantões fora da competência ou sem apuração.' USING ERRCODE='22023';
 END IF;
 RETURN tally;
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'Um dos plantões já foi consolidado.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.nv_issue_billing_invoice(target uuid, issued_on date, document_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invoice public.billing_invoices; result public.billing_invoices;
BEGIN
 SELECT * INTO invoice FROM public.billing_invoices i WHERE i.id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Faturamento indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.require_billing(invoice.organization_id,'billing_manage');
 PERFORM nv_master_private.lock_billing_month(invoice.organization_id,invoice.month,true);
 document_ref := btrim(document_ref);
 IF coalesce(length(document_ref),0) NOT BETWEEN 1 AND 150 OR issued_on IS NULL
   OR issued_on < invoice.month OR issued_on > (statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date THEN
  RAISE EXCEPTION 'Informe a data e a referência do documento emitido.' USING ERRCODE='22023';
 END IF;
 UPDATE public.billing_invoices i SET issued_on=nv_issue_billing_invoice.issued_on,document_ref=nv_issue_billing_invoice.document_ref
 WHERE i.id=target AND i.issued_on IS NULL AND EXISTS(SELECT FROM public.billing_invoice_lines l WHERE l.invoice_id=i.id)
 RETURNING * INTO result;
 IF NOT FOUND THEN RAISE EXCEPTION 'O faturamento já foi emitido ou está sem plantões.' USING ERRCODE='22023'; END IF;
 PERFORM nv_master_private.billing_log(invoice.organization_id,'invoice',target::text,'issued',to_jsonb(invoice),to_jsonb(result),NULL);
END $$;

CREATE FUNCTION nv_master_private.invoice_totals(target uuid)
RETURNS TABLE(billed numeric, medical_cost numeric, received numeric, discounts numeric, deductions numeric, adjustments numeric, balance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH lines AS (
  SELECT coalesce(sum(l.revenue),0) billed,coalesce(sum(l.medical_cost),0) medical_cost
  FROM public.billing_invoice_lines l WHERE l.invoice_id=target
 ), payments AS (
  SELECT coalesce(sum(m.amount) FILTER(WHERE coalesce(original.kind,m.kind)='receipt'),0) received,
   coalesce(sum(m.amount) FILTER(WHERE coalesce(original.kind,m.kind)='discount'),0) discounts,
   coalesce(sum(m.amount) FILTER(WHERE coalesce(original.kind,m.kind)='deduction'),0) deductions,
   coalesce(sum(m.amount) FILTER(WHERE coalesce(original.kind,m.kind)='adjustment'),0) adjustments
  FROM public.billing_movements m LEFT JOIN public.billing_movements original ON original.id=m.reverses WHERE m.invoice_id=target
 )
 SELECT l.billed,l.medical_cost,p.received,p.discounts,p.deductions,p.adjustments,
  l.billed-p.received-p.discounts-p.deductions+p.adjustments FROM lines l CROSS JOIN payments p;
$$;

CREATE FUNCTION public.nv_post_billing_movement(target uuid, request_id uuid, kind text, amount numeric, posted_on date,
  note text DEFAULT NULL, receipt text DEFAULT NULL, reverse_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invoice public.billing_invoices; movement public.billing_movements; original public.billing_movements; totals record;
BEGIN
 SELECT * INTO invoice FROM public.billing_invoices i WHERE i.id=target FOR UPDATE;
 IF NOT FOUND OR invoice.issued_on IS NULL THEN RAISE EXCEPTION 'Faturamento emitido indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.require_billing(invoice.organization_id,CASE WHEN kind='receipt' THEN 'receipt' ELSE 'adjustment' END);
 note:=nullif(btrim(note),'');
 IF request_id IS NULL OR posted_on IS NULL OR posted_on<invoice.issued_on
  OR posted_on>(statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date
  OR (kind IN ('receipt','discount','deduction','adjustment','reversal')) IS NOT TRUE
  OR coalesce(length(note),0)>1000 OR (kind<>'receipt' AND coalesce(length(note),0)<3) THEN
  RAISE EXCEPTION 'Confira o tipo, a data e a justificativa da movimentação.' USING ERRCODE='22023';
 END IF;
 IF kind='reversal' THEN
  SELECT * INTO original FROM public.billing_movements m WHERE m.id=reverse_id AND m.invoice_id=target AND m.kind<>'reversal';
  IF NOT FOUND OR posted_on<original.posted_on THEN RAISE EXCEPTION 'Confira a movimentação original e a data do estorno.' USING ERRCODE='22023'; END IF;
  amount:=-original.amount;
 ELSIF reverse_id IS NOT NULL OR amount IS NULL OR abs(amount) NOT BETWEEN 0.01 AND 99999999999999.99
    OR scale(trim_scale(amount))>2 OR (kind<>'adjustment' AND amount<0) THEN
  RAISE EXCEPTION 'Informe o valor da movimentação em reais.' USING ERRCODE='22023';
 END IF;
 IF receipt IS NOT NULL AND NOT EXISTS(SELECT FROM storage.objects o WHERE o.bucket_id='finance-receipts' AND o.name=receipt
   AND receipt IN (invoice.organization_id||'/'||request_id||'.pdf',invoice.organization_id||'/'||request_id||'.jpg',invoice.organization_id||'/'||request_id||'.png')) THEN
  RAISE EXCEPTION 'Comprovante indisponível.' USING ERRCODE='22023';
 END IF;
 SELECT * INTO movement FROM public.billing_movements m WHERE m.id=request_id;
 IF FOUND THEN
  IF (movement.invoice_id,movement.kind,movement.amount,movement.posted_on,movement.note,movement.receipt_path,movement.reverses)
    IS NOT DISTINCT FROM (target,kind,amount,posted_on,note,receipt,reverse_id) THEN RETURN; END IF;
  RAISE EXCEPTION 'Esta operação já foi utilizada.' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.billing_movements(id,invoice_id,kind,amount,posted_on,note,receipt_path,reverses,actor_id)
 VALUES(request_id,target,kind,amount,posted_on,note,receipt,reverse_id,public.nv_session_actor()) RETURNING * INTO movement;
 SELECT * INTO totals FROM nv_master_private.invoice_totals(target);
 IF totals.balance<0 THEN RAISE EXCEPTION 'A movimentação excede o saldo do faturamento.' USING ERRCODE='22023'; END IF;
 PERFORM nv_master_private.billing_log(invoice.organization_id,'invoice',target::text,kind,NULL,to_jsonb(movement),note);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'A movimentação já foi registrada ou estornada.' USING ERRCODE='22023';
END $$;

CREATE FUNCTION public.nv_close_billing_period(org text, month date, reopening boolean, reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.billing_periods; result public.billing_periods;
BEGIN
 PERFORM nv_master_private.require_billing(org,CASE WHEN reopening THEN 'period_reopen' ELSE 'period_close' END);
 reason:=btrim(reason);
 IF month IS NULL OR extract(day FROM month)<>1 OR reopening IS NULL OR coalesce(length(reason),0) NOT BETWEEN 3 AND 1000 THEN
  RAISE EXCEPTION 'Informe uma competência e a justificativa.' USING ERRCODE='22023';
 END IF;
 IF NOT reopening AND month>=nv_master_private.billing_month((statement_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date) THEN
  RAISE EXCEPTION 'A competência precisa ter terminado para ser fechada.' USING ERRCODE='22023';
 END IF;
 PERFORM nv_master_private.lock_billing_month(org,month,false);
 SELECT * INTO previous FROM public.billing_periods p WHERE p.organization_id=org AND p.month=nv_close_billing_period.month FOR UPDATE;
 IF reopening AND previous.closed_at IS NULL THEN RAISE EXCEPTION 'Esta competência está aberta.' USING ERRCODE='22023'; END IF;
 IF NOT reopening AND previous.closed_at IS NOT NULL THEN RETURN; END IF;
 IF NOT reopening AND EXISTS(SELECT FROM public.shifts s LEFT JOIN public.billing_invoice_lines l ON l.shift_id=s.id
   LEFT JOIN public.billing_invoices i ON i.id=l.invoice_id
   WHERE s.organization_id=org AND s.date>=nv_close_billing_period.month AND s.date<nv_close_billing_period.month+interval '1 month'
    AND s.doctor_id IS NOT NULL AND s.status<>'cancelled' AND i.issued_on IS NULL) THEN
  RAISE EXCEPTION 'Há plantões alocados sem faturamento emitido nesta competência.' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.billing_periods(organization_id,month,closed_at) VALUES(org,month,CASE WHEN NOT reopening THEN clock_timestamp() END)
 ON CONFLICT ON CONSTRAINT billing_periods_pkey DO UPDATE SET closed_at=EXCLUDED.closed_at RETURNING * INTO result;
 PERFORM nv_master_private.billing_log(org,'period',month::text,CASE WHEN reopening THEN 'reopened' ELSE 'closed' END,to_jsonb(previous),to_jsonb(result),reason);
END $$;

CREATE FUNCTION public.nv_billing_invoice_detail(target uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE invoice public.billing_invoices;
BEGIN
 SELECT * INTO invoice FROM public.billing_invoices i WHERE i.id=target;
 IF NOT FOUND THEN RAISE EXCEPTION 'Faturamento indisponível.' USING ERRCODE='42501'; END IF;
 PERFORM nv_master_private.require_billing(invoice.organization_id,'billing_view');
 RETURN to_jsonb(invoice) || jsonb_build_object(
  'totals',(SELECT to_jsonb(t) FROM nv_master_private.invoice_totals(target) t),
  'lines',(SELECT coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('date',s.date,'specialty',s.specialty,'doctor',d.name) ORDER BY s.date,s.start_time),'[]')
    FROM public.billing_invoice_lines l JOIN public.shifts s ON s.id=l.shift_id LEFT JOIN public.doctors d ON d.id=s.doctor_id WHERE l.invoice_id=target),
  'movements',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.posted_on,m.created_at),'[]') FROM public.billing_movements m WHERE m.invoice_id=target));
END $$;

CREATE FUNCTION public.nv_billing_period_work(org text, month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM nv_master_private.require_billing(org,'billing_view');
 IF month IS NULL OR extract(day FROM month)<>1 THEN RAISE EXCEPTION 'Confira a competência.' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object(
  'closed_at',(SELECT p.closed_at FROM public.billing_periods p WHERE p.organization_id=org AND p.month=nv_billing_period_work.month),
  'invoices',(SELECT coalesce(jsonb_agg(to_jsonb(i)||to_jsonb(t) ORDER BY i.due_on,i.id),'[]')
    FROM public.billing_invoices i CROSS JOIN LATERAL nv_master_private.invoice_totals(i.id) t
    WHERE i.organization_id=org AND i.month=nv_billing_period_work.month),
  'shifts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'date',s.date,'start_time',s.start_time,'end_time',s.end_time,
    'unit_id',s.unit_id,'sector_id',s.sector_id,'specialty',s.specialty,'doctor',d.name,'doctor_id',s.doctor_id,
    'ended',public.nv_shift_ends(s)<=statement_timestamp(),'contract_id',b.contract_id,
    'planned_minutes',coalesce(b.planned_minutes,nv_master_private.shift_planned_minutes(s)),'worked_minutes',b.worked_minutes,
    'payable_minutes',b.payable_minutes,'billable_minutes',b.billable_minutes,'assessed_at',b.assessed_at,'invoice_id',l.invoice_id,
    'expected_revenue',nv_master_private.hour_value(b.planned_minutes,b.revenue_rate),
    'assessed_revenue',nv_master_private.hour_value(b.billable_minutes,b.revenue_rate),
    'medical_cost',nv_master_private.hour_value(b.payable_minutes,b.medical_rate),
    'suggested_rate',CASE WHEN b.shift_id IS NULL AND public.nv_can_action(org,'financeiro','rates_view') THEN (nv_master_private.resolve_billing_rate(s)).id END)
    ORDER BY s.date,s.start_time,s.id),'[]') FROM public.shifts s
   JOIN public.doctors d ON d.id=s.doctor_id LEFT JOIN public.shift_billing b ON b.shift_id=s.id
   LEFT JOIN public.billing_invoice_lines l ON l.shift_id=s.id
   WHERE s.organization_id=org AND s.status<>'cancelled' AND s.date>=month AND s.date<month+interval '1 month'));
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE (n.nspname='nv_master_private' AND p.proname IN ('require_billing','billing_log','billing_month','lock_billing_month',
   'resolve_billing_rate','shift_planned_minutes','hour_value','store_billing_snapshot','protect_shift_billing','snapshot_shift_billing','invoice_totals'))
 OR (n.nspname='public' AND p.proname IN ('nv_billing_catalog','nv_save_billing_client','nv_save_billing_rate','nv_assess_shift_billing',
   'nv_consolidate_billing','nv_issue_billing_invoice','nv_post_billing_movement','nv_close_billing_period','nv_billing_invoice_detail','nv_billing_period_work'))
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature);
  IF f.nspname='public' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature); END IF;
 END LOOP;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
