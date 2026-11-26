-- Post demand is independent from shifts, which remain the unit of assignment,
-- publication, approval, attendance and settlement. Existing shifts are adopted on demand.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.shift_coverage_posts (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  unit_id text NOT NULL,
  sector_id text,
  specialty text,
  operational_date date NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  time_zone text NOT NULL,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 20),
  type text NOT NULL CHECK (type IN ('onsite','oncall','telemedicine')),
  coverage_mode text NOT NULL CHECK (coverage_mode IN ('regular','adhoc')),
  coverage_reason text,
  cancelled_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (organization_id,id)
);
ALTER TABLE public.shift_coverage_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shift_coverage_posts FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX shift_coverage_posts_schedule_idx ON public.shift_coverage_posts(organization_id,sector_id,operational_date)
  WHERE cancelled_at IS NULL;
ALTER TABLE public.shifts ADD COLUMN coverage_post_id text,
  ADD CONSTRAINT shifts_coverage_post_fk FOREIGN KEY (organization_id,coverage_post_id)
    REFERENCES public.shift_coverage_posts(organization_id,id);
CREATE INDEX shifts_coverage_post_idx ON public.shifts(coverage_post_id) WHERE coverage_post_id IS NOT NULL;

CREATE TABLE nv_master_private.coverage_write (
  transaction_id bigint NOT NULL, shift_id text NOT NULL, post_id text NOT NULL,
  generated boolean NOT NULL DEFAULT false,
  hourly_cents bigint,
  PRIMARY KEY (transaction_id,shift_id)
);
REVOKE ALL ON nv_master_private.coverage_write FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION nv_master_private.coverage_time(day date, clock text, zone text, next_day boolean DEFAULT false)
RETURNS timestamptz LANGUAGE plpgsql STABLE STRICT SET search_path='' AS $$
DECLARE local_time timestamp; instant timestamptz;
BEGIN
  IF clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    RAISE EXCEPTION 'Informe um horário entre 00:00 e 23:59.' USING ERRCODE='22023';
  END IF;
  local_time := (day + CASE WHEN next_day THEN 1 ELSE 0 END) + clock::time;
  instant := local_time AT TIME ZONE zone;
  IF instant AT TIME ZONE zone <> local_time THEN
    RAISE EXCEPTION 'Esse horário não existe no fuso da unidade nessa data.' USING ERRCODE='22023';
  END IF;
  RETURN instant;
END $$;

CREATE OR REPLACE FUNCTION public.nv_shift_ends(shift public.shifts)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT (shift.date + shift.end_time::time + CASE WHEN shift.end_time < shift.start_time
    OR (shift.coverage_post_id IS NOT NULL AND shift.end_time = shift.start_time)
    THEN interval '1 day' ELSE interval '0 days' END) AT TIME ZONE shift.shift_time_zone;
$$;

CREATE FUNCTION nv_master_private.lock_coverage(target text)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  -- Existing candidate selection first locks the shift row. Reject a conflicting
  -- mutation instead of waiting on a lock in the opposite order.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('nv-coverage:'||target,0)) THEN
    RAISE EXCEPTION 'Este posto está sendo atualizado. Reabra a ficha e tente novamente.' USING ERRCODE='40001';
  END IF;
END $$;

CREATE FUNCTION nv_master_private.guard_coverage_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  post public.shift_coverage_posts;
  context nv_master_private.coverage_write;
  target text;
  starts timestamptz;
  ends timestamptz;
  old_starts timestamptz;
  old_ends timestamptz;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.coverage_post_id IS NULL THEN RETURN OLD; END IF;
    PERFORM nv_master_private.lock_coverage(OLD.coverage_post_id);
    RAISE EXCEPTION 'Remova a cobertura pela ficha para preservar a alocação e seu histórico.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO context FROM nv_master_private.coverage_write c WHERE c.transaction_id=txid_current() AND c.shift_id=NEW.id;
  target := coalesce(context.post_id,CASE WHEN TG_OP='UPDATE' THEN OLD.coverage_post_id END);
  IF NEW.coverage_post_id IS NOT NULL AND NEW.coverage_post_id IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'O posto da alocação é definido pelo servidor.' USING ERRCODE='42501';
  END IF;
  IF target IS NULL THEN RETURN NEW; END IF;
  NEW.coverage_post_id := target;
  IF context.hourly_cents IS NOT NULL THEN
    NEW.payment_agreement := NEW.payment_agreement || jsonb_build_object('hourly_rate_cents',context.hourly_cents);
  ELSIF TG_OP='UPDATE' AND NEW.doctor_id IS NOT NULL AND NEW.status<>'cancelled'
    AND OLD.payment_agreement->>'hourly_rate_cents' IS NOT NULL
    AND NEW.payment_agreement IS NOT DISTINCT FROM OLD.payment_agreement
    AND (NEW.date,NEW.start_time,NEW.end_time) IS DISTINCT FROM (OLD.date,OLD.start_time,OLD.end_time) THEN
    RAISE EXCEPTION 'Recalcule o acordo por hora antes de alterar o intervalo.' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND OLD.coverage_post_id=target AND
    (NEW.doctor_id,NEW.status='cancelled',NEW.date,NEW.start_time,NEW.end_time,NEW.organization_id,
      NEW.unit_id,NEW.sector_id,NEW.specialty,NEW.type,NEW.coverage_mode,NEW.coverage_reason)
      IS NOT DISTINCT FROM
    (OLD.doctor_id,OLD.status='cancelled',OLD.date,OLD.start_time,OLD.end_time,OLD.organization_id,
      OLD.unit_id,OLD.sector_id,OLD.specialty,OLD.type,OLD.coverage_mode,OLD.coverage_reason) THEN
    RETURN NEW;
  END IF;
  PERFORM nv_master_private.lock_coverage(target);
  SELECT * INTO STRICT post FROM public.shift_coverage_posts WHERE id=target;
  IF post.cancelled_at IS NOT NULL AND NEW.status<>'cancelled' THEN
    RAISE EXCEPTION 'Este posto foi cancelado.' USING ERRCODE='22023';
  END IF;
  IF (NEW.organization_id,NEW.unit_id,NEW.sector_id,NEW.specialty,NEW.type,NEW.coverage_mode,NEW.coverage_reason)
    IS DISTINCT FROM (post.organization_id,post.unit_id,post.sector_id,post.specialty,post.type,post.coverage_mode,post.coverage_reason) THEN
    RAISE EXCEPTION 'A alocação deve manter os vínculos do posto previsto.' USING ERRCODE='22023';
  END IF;
  NEW.shift_time_zone := post.time_zone;
  starts := nv_master_private.coverage_time(NEW.date,NEW.start_time,post.time_zone);
  ends := nv_master_private.coverage_time(NEW.date,NEW.end_time,post.time_zone,NEW.end_time<=NEW.start_time);
  IF (NEW.status<>'cancelled' OR NOT coalesce(context.generated,false))
    AND (starts IS NULL OR ends IS NULL OR ends<=starts OR starts<post.starts_at OR ends>post.ends_at) THEN
    RAISE EXCEPTION 'O intervalo deve estar dentro do posto previsto.' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND OLD.coverage_post_id=target AND NOT coalesce(context.generated,false) THEN
    IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN
      RAISE EXCEPTION 'Este intervalo foi encerrado. Selecione uma vaga disponível na cobertura atual.' USING ERRCODE='22023';
    END IF;
    IF OLD.doctor_id IS NULL AND OLD.status<>'cancelled' THEN
      old_starts := public.nv_shift_starts(OLD);
      old_ends := public.nv_shift_ends(OLD);
      IF NEW.status='cancelled' OR starts<old_starts OR ends>old_ends
        OR (NEW.doctor_id IS NULL AND (starts,ends) IS DISTINCT FROM (old_starts,old_ends)) THEN
        RAISE EXCEPTION 'Selecione um médico e mantenha o intervalo dentro da vaga.' USING ERRCODE='22023';
      END IF;
    END IF;
  END IF;
  IF NEW.doctor_id IS NOT NULL AND NEW.status<>'cancelled' AND EXISTS (
    WITH spans AS MATERIALIZED (
      SELECT public.nv_shift_starts(s) a,public.nv_shift_ends(s) b FROM public.shifts s
      WHERE s.coverage_post_id=target AND s.id<>NEW.id AND s.doctor_id IS NOT NULL AND s.status<>'cancelled'
    )
    SELECT FROM (SELECT starts AS point UNION SELECT a FROM spans WHERE starts<a AND a<ends) ticks
    WHERE (SELECT count(*) FROM spans WHERE a<=point AND b>point)>=post.capacity
  ) THEN
    RAISE EXCEPTION 'A capacidade do posto já está preenchida em parte desse intervalo.' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ab_nv_guard_fractional_coverage BEFORE INSERT OR UPDATE OR DELETE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION nv_master_private.guard_coverage_shift();

CREATE FUNCTION nv_master_private.coverage_gaps(target text)
RETURNS TABLE(starts_at timestamptz,ends_at timestamptz) LANGUAGE sql STABLE SET search_path='' AS $$
  WITH post AS (SELECT * FROM public.shift_coverage_posts p WHERE p.id=target),
  spans AS MATERIALIZED (
    SELECT public.nv_shift_starts(s) AS a,public.nv_shift_ends(s) AS b
    FROM public.shifts s WHERE s.coverage_post_id=target AND s.doctor_id IS NOT NULL AND s.status<>'cancelled'
  ), ticks AS (
    SELECT p.starts_at AS point FROM post p UNION SELECT p.ends_at FROM post p
    UNION SELECT a FROM spans UNION SELECT b FROM spans
  ), slices AS (
    SELECT point AS a,lead(point) OVER (ORDER BY point) AS b FROM ticks
  ), deficits AS (
    SELECT slices.*,lane FROM slices CROSS JOIN post
    CROSS JOIN LATERAL generate_series(1,post.capacity-(SELECT count(*)::integer FROM spans WHERE spans.a<=slices.a AND spans.b>slices.a)) lane
    WHERE slices.b IS NOT NULL
  ), runs AS (
    SELECT *,sum(new_run) OVER (PARTITION BY lane ORDER BY a) AS run FROM (
      SELECT *,CASE WHEN lag(b) OVER (PARTITION BY lane ORDER BY a)=a THEN 0 ELSE 1 END AS new_run FROM deficits
    ) boundaries
  )
  SELECT min(a),max(b) FROM runs GROUP BY lane,run ORDER BY min(a),max(b),lane;
$$;

CREATE FUNCTION nv_master_private.reconcile_coverage(target text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE post public.shift_coverage_posts; gap record; item public.shifts; keep text[] := '{}'; gap_id text;
BEGIN
  PERFORM nv_master_private.lock_coverage(target);
  SELECT * INTO STRICT post FROM public.shift_coverage_posts WHERE id=target;
  IF post.cancelled_at IS NOT NULL THEN RETURN; END IF;
  FOR gap IN SELECT * FROM nv_master_private.coverage_gaps(target) LOOP
    SELECT s.* INTO item FROM public.shifts s
    WHERE s.coverage_post_id=target AND s.doctor_id IS NULL AND s.status='open'
      AND NOT (s.id=ANY(keep))
      AND (public.nv_shift_starts(s),public.nv_shift_ends(s))=(gap.starts_at,gap.ends_at)
    ORDER BY s.id LIMIT 1;
    IF FOUND THEN
      keep := array_append(keep,item.id);
    ELSE
      gap_id := gen_random_uuid()::text;
      INSERT INTO nv_master_private.coverage_write VALUES(txid_current(),gap_id,target,true);
      INSERT INTO public.shifts(id,organization_id,unit_id,sector_id,specialty,date,start_time,end_time,type,status,coverage_mode,coverage_reason)
      VALUES(gap_id,post.organization_id,post.unit_id,post.sector_id,post.specialty,
        (gap.starts_at AT TIME ZONE post.time_zone)::date,
        to_char(gap.starts_at AT TIME ZONE post.time_zone,'HH24:MI'),
        to_char(gap.ends_at AT TIME ZONE post.time_zone,'HH24:MI'),post.type,'open',post.coverage_mode,post.coverage_reason);
      DELETE FROM nv_master_private.coverage_write WHERE transaction_id=txid_current() AND shift_id=gap_id;
      keep := array_append(keep,gap_id);
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM public.shifts s WHERE s.coverage_post_id=target
    AND s.doctor_id IS NULL AND s.status='open' AND NOT (s.id=ANY(keep)) ORDER BY id LOOP
    INSERT INTO nv_master_private.coverage_write VALUES(txid_current(),item.id,target,true);
    UPDATE public.shifts SET status='cancelled' WHERE id=item.id;
    DELETE FROM nv_master_private.coverage_write WHERE transaction_id=txid_current() AND shift_id=item.id;
  END LOOP;
  UPDATE public.shift_coverage_posts SET revision=revision+1 WHERE id=target;
END $$;

CREATE FUNCTION nv_master_private.sync_coverage_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.coverage_post_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.status='open' AND NEW.doctor_id IS NULL AND (TG_OP='INSERT' OR OLD.doctor_id IS NOT NULL) THEN
    INSERT INTO public.master_coverage_publication(shift_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  IF EXISTS (SELECT FROM nv_master_private.coverage_write c WHERE c.transaction_id=txid_current() AND c.shift_id=NEW.id AND c.generated) THEN
    INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,unit_id,sector_id,shift_date,origin,previous,next)
    VALUES(NEW.organization_id,NEW.coverage_post_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'coverage_gap_created' ELSE 'coverage_gap_retired' END,
      public.nv_session_actor(),NEW.unit_id,NEW.sector_id,NEW.date,'database',
      CASE WHEN TG_OP='UPDATE' THEN nv_master_private.schedule_snapshot('shift',to_jsonb(OLD)) END,
      nv_master_private.schedule_snapshot('shift',to_jsonb(NEW)));
  ELSIF TG_OP='INSERT' OR (NEW.coverage_post_id,NEW.doctor_id,NEW.status='cancelled',NEW.date,NEW.start_time,NEW.end_time)
      IS DISTINCT FROM (OLD.coverage_post_id,OLD.doctor_id,OLD.status='cancelled',OLD.date,OLD.start_time,OLD.end_time) THEN
    PERFORM nv_master_private.reconcile_coverage(NEW.coverage_post_id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER nv_coverage_sync AFTER INSERT OR UPDATE ON public.shifts
FOR EACH ROW EXECUTE FUNCTION nv_master_private.sync_coverage_shift();

CREATE FUNCTION public.nv_save_fractional_coverage(record jsonb, planned jsonb, expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.shifts; previous public.shifts; post public.shift_coverage_posts; zone text;
  hourly_cents bigint; rate public.organization_shift_rates; starts timestamptz; ends timestamptz; resized boolean := false;
BEGIN
  item := jsonb_populate_record(NULL::public.shifts,record);
  IF item.id IS NULL OR length(item.id)>100 OR
     public.nv_can_action(item.organization_id,'escala','edit') IS NOT TRUE
     OR public.nv_can_action(item.organization_id,'escala','view') IS NOT TRUE THEN
    RAISE EXCEPTION 'Plantão indisponível.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO previous FROM public.shifts WHERE id=item.id AND organization_id=item.organization_id FOR UPDATE;
  IF previous.coverage_post_id IS NOT NULL THEN
    PERFORM nv_master_private.lock_coverage(previous.coverage_post_id);
    SELECT * INTO STRICT post FROM public.shift_coverage_posts WHERE id=previous.coverage_post_id;
    IF post.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'Este posto foi cancelado.' USING ERRCODE='22023'; END IF;
    IF post.revision IS DISTINCT FROM expected_revision THEN
      RAISE EXCEPTION 'A cobertura mudou. Reabra a ficha antes de salvar.' USING ERRCODE='40001';
    END IF;
    IF jsonb_typeof(planned)='object' THEN
      starts := nv_master_private.coverage_time(post.operational_date,planned->>'start_time',post.time_zone);
      ends := nv_master_private.coverage_time(post.operational_date,planned->>'end_time',post.time_zone,
        (planned->>'end_time')<=(planned->>'start_time'));
      IF starts IS NULL OR ends IS NULL OR starts>=ends OR (planned->>'capacity') IS NULL
        OR (planned->>'capacity')::integer NOT BETWEEN 1 AND 20 THEN
        RAISE EXCEPTION 'Confira o horário e a capacidade do posto previsto.' USING ERRCODE='22023';
      END IF;
      PERFORM nv_master_private.lock_billing_month(post.organization_id,nv_master_private.billing_month(post.operational_date),true);
      IF EXISTS(
        WITH spans AS MATERIALIZED (
          SELECT public.nv_shift_starts(s) a,public.nv_shift_ends(s) b FROM public.shifts s
          WHERE s.coverage_post_id=post.id AND s.id<>item.id AND s.doctor_id IS NOT NULL AND s.status<>'cancelled'
        )
        SELECT FROM spans x WHERE x.a<starts OR x.b>ends
          OR (SELECT count(*) FROM spans y WHERE y.a<=x.a AND y.b>x.a)>(planned->>'capacity')::integer
      ) THEN
        RAISE EXCEPTION 'O novo período deve preservar os horários e a capacidade das outras alocações.' USING ERRCODE='22023';
      END IF;
      IF (starts,ends,(planned->>'capacity')::integer) IS DISTINCT FROM (post.starts_at,post.ends_at,post.capacity) THEN
        UPDATE public.shift_coverage_posts SET starts_at=starts,ends_at=ends,start_time=planned->>'start_time',
          end_time=planned->>'end_time',capacity=(planned->>'capacity')::integer WHERE id=post.id;
        INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,unit_id,sector_id,shift_date,origin,previous,next)
        SELECT post.organization_id,post.id,item.id,'coverage_plan_changed',public.nv_session_actor(),
          post.unit_id,post.sector_id,post.operational_date,'manual',to_jsonb(post)-'coverage_reason',to_jsonb(p)-'coverage_reason'
        FROM public.shift_coverage_posts p WHERE p.id=post.id;
        resized := true;
      END IF;
    END IF;
  ELSE
    IF expected_revision IS NOT NULL OR previous.status='cancelled' OR jsonb_typeof(planned) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Confira o período previsto do posto.' USING ERRCODE='22023';
    END IF;
    IF previous.id IS NULL THEN
      IF public.nv_can_action(item.organization_id,'escala','create') IS NOT TRUE THEN
        RAISE EXCEPTION 'Seu acesso não permite criar postos.' USING ERRCODE='42501';
      END IF;
      SELECT time_zone INTO zone FROM public.units u WHERE u.id=item.unit_id AND u.organization_id=item.organization_id AND u.status='active';
    ELSE
      IF public.nv_shift_has_settlement(previous) OR EXISTS(SELECT FROM public.shift_billing b WHERE b.shift_id=previous.id AND b.assessed_at IS NOT NULL)
        OR public.nv_shift_ends(previous)<=statement_timestamp() THEN
        RAISE EXCEPTION 'Use os fluxos de ajuste para plantões encerrados ou apurados.' USING ERRCODE='22023';
      END IF;
      zone := previous.shift_time_zone;
      planned := planned || jsonb_build_object('date',previous.date,'start_time',previous.start_time,'end_time',previous.end_time);
    END IF;
    IF zone IS NULL THEN RAISE EXCEPTION 'Selecione uma unidade ativa.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.shift_coverage_posts(id,organization_id,unit_id,sector_id,specialty,operational_date,start_time,end_time,
      starts_at,ends_at,time_zone,capacity,type,coverage_mode,coverage_reason)
    VALUES(item.id,item.organization_id,coalesce(previous.unit_id,item.unit_id),
      CASE WHEN previous.id IS NULL THEN item.sector_id ELSE previous.sector_id END,
      CASE WHEN previous.id IS NULL THEN item.specialty ELSE previous.specialty END,
      (planned->>'date')::date,planned->>'start_time',planned->>'end_time',
      nv_master_private.coverage_time((planned->>'date')::date,planned->>'start_time',zone),
      nv_master_private.coverage_time((planned->>'date')::date,planned->>'end_time',zone,(planned->>'end_time')<=(planned->>'start_time')),
      zone,(planned->>'capacity')::integer,coalesce(previous.type,item.type),coalesce(previous.coverage_mode,item.coverage_mode,'regular'),
      CASE WHEN previous.id IS NULL THEN item.coverage_reason ELSE previous.coverage_reason END)
    RETURNING * INTO post;
    INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,unit_id,sector_id,shift_date,origin,next)
    VALUES(post.organization_id,post.id,item.id,'coverage_post_created',public.nv_session_actor(),post.unit_id,post.sector_id,
      post.operational_date,'manual',to_jsonb(post)-'coverage_reason');
    INSERT INTO nv_master_private.coverage_write VALUES(txid_current(),item.id,post.id,false);
  END IF;
  IF record->>'hourly_rate_cents' IS NOT NULL THEN
    IF record->>'hourly_rate_cents' !~ '^[0-9]{1,10}$' OR item.doctor_id IS NULL OR item.employment_type IS DISTINCT FROM 'pj'
      OR public.nv_can_finance(item.organization_id) IS NOT TRUE THEN
      RAISE EXCEPTION 'Confira o valor por hora e a autorização financeira.' USING ERRCODE='42501';
    END IF;
    IF (record->>'expected_hourly_agreement_at') IS DISTINCT FROM (previous.payment_agreement->>'changed_at') THEN
      RAISE EXCEPTION 'O acordo financeiro mudou. Reabra a ficha.' USING ERRCODE='40001';
    END IF;
    hourly_cents := (record->>'hourly_rate_cents')::bigint;
    starts := nv_master_private.coverage_time(item.date,item.start_time,post.time_zone);
    ends := nv_master_private.coverage_time(item.date,item.end_time,post.time_zone,item.end_time<=item.start_time);
    rate := public.nv_resolve_shift_rate(item);
    record := record || jsonb_build_object('agreement',jsonb_build_object(
      'mode',CASE WHEN rate.id IS NULL THEN 'manual' ELSE 'override' END,
      'rate_id',rate.id,'rate_cents',rate.amount_cents,'frequency',coalesce(record->'agreement'->>'frequency',item.payment_frequency,'on_delivery'),
      'amount_cents',round(hourly_cents*extract(epoch FROM ends-starts)/3600)::bigint,
      'override_reason','Acordo por hora da alocação.','reason','Acordo por hora da alocação.',
      'expected_amount_cents',CASE WHEN previous.payment_amount IS NOT NULL THEN (previous.payment_amount*100)::bigint END,
      'expected_frequency',previous.payment_frequency,'expected_changed_at',previous.payment_agreement->>'changed_at'));
    INSERT INTO nv_master_private.coverage_write(transaction_id,shift_id,post_id,hourly_cents)
      VALUES(txid_current(),item.id,post.id,hourly_cents)
      ON CONFLICT(transaction_id,shift_id) DO UPDATE SET hourly_cents=EXCLUDED.hourly_cents;
  END IF;
  PERFORM public.nv_save_operational_shifts(jsonb_build_array(record));
  DELETE FROM nv_master_private.coverage_write WHERE transaction_id=txid_current() AND shift_id=item.id;
  IF resized AND EXISTS(SELECT FROM public.shift_coverage_posts p WHERE p.id=post.id AND p.revision=expected_revision) THEN
    PERFORM nv_master_private.reconcile_coverage(post.id);
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.date,s.start_time,s.id),'[]')
    FROM public.nv_staff_shifts s WHERE s.organization_id=item.organization_id AND s.coverage_post->>'id'=post.id);
END $$;

CREATE FUNCTION public.nv_cancel_fractional_coverage(target text, expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE post public.shift_coverage_posts; item public.shifts;
BEGIN
  SELECT * INTO post FROM public.shift_coverage_posts WHERE id=target;
  IF NOT FOUND OR public.nv_can_action(post.organization_id,'escala','view') IS NOT TRUE
    OR public.nv_can_action(post.organization_id,'escala','delete') IS NOT TRUE
    OR public.nv_can_action(post.organization_id,'escala','edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'Posto indisponível.' USING ERRCODE='42501';
  END IF;
  PERFORM nv_master_private.lock_coverage(target);
  SELECT * INTO STRICT post FROM public.shift_coverage_posts WHERE id=target;
  IF post.revision IS DISTINCT FROM expected_revision OR post.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'A cobertura mudou. Reabra a ficha.' USING ERRCODE='40001';
  END IF;
  UPDATE public.shift_coverage_posts SET cancelled_at=statement_timestamp(),revision=revision+1 WHERE id=target;
  FOR item IN SELECT * FROM public.shifts s WHERE s.coverage_post_id=target AND s.status<>'cancelled' ORDER BY s.id FOR UPDATE NOWAIT LOOP
    IF item.doctor_id IS NULL THEN
      INSERT INTO nv_master_private.coverage_write VALUES(txid_current(),item.id,target,true);
    END IF;
    UPDATE public.shifts SET status='cancelled' WHERE id=item.id;
    DELETE FROM nv_master_private.coverage_write WHERE transaction_id=txid_current() AND shift_id=item.id;
  END LOOP;
  INSERT INTO public.master_schedule_audit(organization_id,entity_id,action,actor_id,unit_id,sector_id,shift_date,origin,previous,next)
  SELECT post.organization_id,target,'coverage_post_cancelled',public.nv_session_actor(),post.unit_id,post.sector_id,
    post.operational_date,'manual',to_jsonb(post)-'coverage_reason',to_jsonb(p)-'coverage_reason'
  FROM public.shift_coverage_posts p WHERE p.id=target;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.date,s.start_time,s.id),'[]')
    FROM public.nv_staff_shifts s WHERE s.organization_id=post.organization_id AND s.coverage_post->>'id'=target);
END $$;

REVOKE ALL ON FUNCTION nv_master_private.coverage_time(date,text,text,boolean),nv_master_private.lock_coverage(text),
  nv_master_private.guard_coverage_shift(),nv_master_private.coverage_gaps(text),nv_master_private.reconcile_coverage(text),
  nv_master_private.sync_coverage_shift(),public.nv_save_fractional_coverage(jsonb,jsonb,integer),public.nv_cancel_fractional_coverage(text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_save_fractional_coverage(jsonb,jsonb,integer),public.nv_cancel_fractional_coverage(text,integer) TO authenticated;

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
 IF NEW.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR NEW.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (NEW.start_time=NEW.end_time AND NEW.coverage_post_id IS NULL) THEN RAISE EXCEPTION 'Informe horários válidos e diferentes.'; END IF;
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

CREATE OR REPLACE FUNCTION public.nv_notify_shift_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.coverage_post_id IS NULL AND NEW.status = 'open' AND NEW.specialty IS NOT NULL AND public.nv_shift_starts(NEW) > now()
    AND (TG_OP = 'INSERT' OR OLD.status <> 'open') THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT e.auth_user_id, 'vacancy:' || NEW.id || ':' || NEW.updated_at::text,
      'Uma vaga de plantão foi publicada em uma das suas unidades.'
    FROM public.doctor_enrollments e WHERE e.organization_id = NEW.organization_id AND e.status = 'approved'
      AND public.nv_credentialed_for_shift(e.doctor_id, NEW)
    ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.doctor_id, NEW.status, NEW.date, NEW.start_time, NEW.end_time, NEW.unit_id, NEW.sector_id)
    IS DISTINCT FROM (OLD.doctor_id, OLD.status, OLD.date, OLD.start_time, OLD.end_time, OLD.unit_id, OLD.sector_id)
    AND NEW.status <> 'completed'
    AND NOT EXISTS (SELECT 1 FROM public.shift_opportunities op WHERE op.shift_id = NEW.id AND op.status = 'selected' AND op.decided_at = now()) THEN
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT DISTINCT e.auth_user_id, 'shift:' || NEW.id || ':' || NEW.updated_at::text, 'Um plantão na sua escala foi alterado.'
    FROM public.doctor_enrollments e WHERE e.auth_user_id IS NOT NULL AND e.doctor_id IN (OLD.doctor_id, NEW.doctor_id)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
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
  nv_master_private.approval_state(s) approval_source,s.approval_revision,public.nv_shift_ends(s) approval_ended_at,
  CASE WHEN post.id IS NOT NULL THEN jsonb_build_object(
    'id',post.id,'date',post.operational_date,'startTime',post.start_time,'endTime',post.end_time,
    'startsAt',post.starts_at,'endsAt',post.ends_at,'timeZone',post.time_zone,'capacity',post.capacity,'revision',post.revision,
    'segmentStartsAt',public.nv_shift_starts(s),'segmentEndsAt',public.nv_shift_ends(s),
    'segmentDate',s.date,'segmentStartTime',s.start_time,'segmentEndTime',s.end_time,
    'published',coalesce(publication.enabled,true),'cancelled',post.cancelled_at IS NOT NULL) END AS coverage_post
FROM public.shifts s JOIN organization_access access ON access.id = s.organization_id
LEFT JOIN public.shift_coverage_posts post ON post.id=s.coverage_post_id AND post.organization_id=s.organization_id
LEFT JOIN public.master_coverage_publication publication ON publication.shift_id=s.id
WHERE access.can_view_schedule OR access.can_read_finance;

CREATE OR REPLACE FUNCTION nv_master_private.validate_definition(org text, spec jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item public.shifts; days integer[]; result jsonb; plan jsonb; zone text; starts timestamptz; ends timestamptz;
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
 OR item.start_time IS NULL OR item.end_time IS NULL OR (item.start_time=item.end_time AND spec->'coverage_plan' IS NULL)
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
 plan:=nullif(spec->'coverage_plan','null'::jsonb);
 IF plan IS NOT NULL THEN
  IF jsonb_typeof(plan) IS DISTINCT FROM 'object' OR (plan->>'capacity') IS NULL
    OR (plan->>'capacity')::integer NOT BETWEEN 1 AND 20 THEN
   RAISE EXCEPTION 'Informe a capacidade simultânea do posto.' USING ERRCODE='22023';
  END IF;
  SELECT u.time_zone INTO zone FROM public.units u WHERE u.id=item.unit_id AND u.organization_id=org;
  starts:=nv_master_private.coverage_time(item.date,plan->>'start_time',zone);
  ends:=nv_master_private.coverage_time(item.date,plan->>'end_time',zone,(plan->>'end_time')<=(plan->>'start_time'));
  IF (plan->>'end_time')<=(plan->>'start_time') AND item.start_time<(plan->>'start_time') THEN
   item.date:=item.date+1;
  END IF;
  IF starts IS NULL OR ends IS NULL
   OR nv_master_private.coverage_time(item.date,item.start_time,zone)<starts
   OR nv_master_private.coverage_time(item.date,item.end_time,zone,item.end_time<=item.start_time)>ends THEN
   RAISE EXCEPTION 'A alocação recorrente deve caber no período previsto.' USING ERRCODE='22023';
  END IF;
  result:=result||jsonb_build_object('coverage_plan',jsonb_build_object('start_time',plan->>'start_time',
   'end_time',plan->>'end_time','capacity',(plan->>'capacity')::integer));
 END IF;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION nv_master_private.generate_rule(target uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.master_schedule_rules; v public.master_schedule_versions; o public.master_schedule_occurrences;
 item public.shifts; original public.shifts; vacancy public.shifts; a public.doctor_absences; day date; cutoff date;
 generated integer:=0; preserved integer:=0; covered integer:=0; blocked integer:=0; demand integer; slots integer; why text; plan jsonb; plan_start text; plan_end text;
 plan_capacity integer; zone text;
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
   plan:=v.definition->'coverage_plan';
   plan_start:=coalesce(plan->>'start_time',item.start_time);
   plan_end:=coalesce(plan->>'end_time',item.end_time);
   plan_capacity:=coalesce((plan->>'capacity')::integer,1);
   IF plan IS NOT NULL THEN
    SELECT u.time_zone INTO zone FROM public.units u WHERE u.id=item.unit_id AND u.organization_id=item.organization_id;
    item.shift_time_zone:=zone;
    item.coverage_post_id:=item.id;
    IF plan_end<=plan_start AND item.start_time<plan_start THEN item.date:=day+1; END IF;
   END IF;
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
   IF why IS NOT NULL THEN
    item.doctor_id:=NULL; item.status:='open';
    IF plan IS NOT NULL THEN item.date:=day; item.start_time:=plan_start; item.end_time:=plan_end; END IF;
   END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended('nv-master-post:'||item.sector_id||':'||day::text,0));
   SELECT * INTO vacancy FROM public.shifts s WHERE plan IS NULL AND s.coverage_post_id IS NULL AND s.organization_id=r.organization_id AND s.unit_id=item.unit_id AND s.sector_id=item.sector_id
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
     AND p->>'kind'=CASE WHEN plan_start>='18:00' OR plan_start<'06:00' THEN 'night' ELSE 'day' END;
    IF demand=0 THEN SELECT required_doctors INTO demand FROM public.sectors WHERE id=item.sector_id; END IF;
    SELECT count(*) INTO slots FROM public.shifts s WHERE s.organization_id=r.organization_id AND s.sector_id=item.sector_id
     AND s.date=day AND s.status<>'cancelled' AND s.coverage_mode='regular' AND s.coverage_post_id IS NULL
     AND (s.start_time>='18:00' OR s.start_time<'06:00')=(plan_start>='18:00' OR plan_start<'06:00');
    slots:=slots+coalesce((SELECT sum(p.capacity) FROM public.shift_coverage_posts p
     WHERE p.organization_id=r.organization_id AND p.sector_id=item.sector_id AND p.operational_date=day
      AND p.coverage_mode='regular' AND p.cancelled_at IS NULL AND (p.start_time>='18:00' OR p.start_time<'06:00')=(plan_start>='18:00' OR plan_start<'06:00')),0);
    IF slots+plan_capacity>demand THEN RAISE EXCEPTION 'Não há posto compatível disponível para esta recorrência.' USING ERRCODE='22023'; END IF;
   END IF;
   IF plan IS NOT NULL THEN
    INSERT INTO public.shift_coverage_posts(id,organization_id,unit_id,sector_id,specialty,operational_date,start_time,end_time,
      starts_at,ends_at,time_zone,capacity,type,coverage_mode)
    VALUES(item.id,item.organization_id,item.unit_id,item.sector_id,item.specialty,day,plan_start,plan_end,
      nv_master_private.coverage_time(day,plan_start,zone),nv_master_private.coverage_time(day,plan_end,zone,plan_end<=plan_start),
      zone,plan_capacity,item.type,'regular');
    INSERT INTO nv_master_private.coverage_write VALUES(txid_current(),item.id,item.id,false);
   END IF;
   PERFORM nv_master_private.write_shift(item,v.finance);
   IF plan IS NOT NULL THEN
    DELETE FROM nv_master_private.coverage_write WHERE transaction_id=txid_current() AND shift_id=item.id;
   END IF;
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

CREATE OR REPLACE FUNCTION nv_master_private.release_future(target uuid, since date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.master_schedule_occurrences; item public.shifts; preserved integer:=0;
BEGIN
 FOR o IN SELECT * FROM public.master_schedule_occurrences x WHERE x.rule_id=target AND x.date>=since AND x.state IN('generated','coverage') ORDER BY x.date FOR UPDATE LOOP
  SELECT * INTO item FROM public.shifts s WHERE s.id=o.shift_id FOR UPDATE;
  IF NOT FOUND OR item.coverage_post_id IS NOT NULL OR nv_master_private.protected(item) OR EXISTS(SELECT FROM public.master_schedule_exceptions e WHERE e.rule_id=o.rule_id AND e.date=o.date)
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

CREATE OR REPLACE FUNCTION nv_master_private.schedule_snapshot(kind text,value jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN value IS NULL THEN NULL WHEN kind='shift' THEN jsonb_build_object(
  'coverage_post_id',value->'coverage_post_id','doctor_id',value->'doctor_id','doctor',(SELECT d.name FROM public.doctors d WHERE d.id=value->>'doctor_id' AND d.organization_id=value->>'organization_id'),
  'unit_id',value->'unit_id','sector_id',value->'sector_id','date',value->'date','start_time',value->'start_time','end_time',value->'end_time',
  'status',value->'status','type',value->'type','specialty',value->'specialty','employment_type',value->'employment_type',
  'employer_name',value->'employer_name','coverage_mode',value->'coverage_mode')
 WHEN kind='rule' THEN jsonb_build_object('unit_id',value->'unit_id','sector_id',value->'sector_id','doctor_id',value->'doctor_id',
  'doctor',(SELECT d.name FROM public.doctors d WHERE d.id=value->>'doctor_id' AND d.organization_id=value->>'organization_id'),
  'status',value->'status','horizon_months',value->'horizon_months','revision',value->'revision','definition',value->'definition')
 ELSE jsonb_build_object('doctor_id',value->'doctor_id','doctor',(SELECT d.name FROM public.doctors d WHERE d.id=value->>'doctor_id' AND d.organization_id=value->>'organization_id'),
  'kind',value->'kind','start_date',value->'start_date','end_date',value->'end_date','start_time',value->'start_time','end_time',value->'end_time','status',value->'status') END;
$$;

CREATE OR REPLACE FUNCTION public.nv_schedule_history(org text,unit_filter text DEFAULT NULL,sector_filters text[] DEFAULT NULL,
 from_date date DEFAULT NULL,until_date date DEFAULT NULL,actor_filter uuid DEFAULT NULL,action_filter text DEFAULT NULL,
 shift_filter text DEFAULT NULL,before_id bigint DEFAULT NULL,page_size integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE items jsonb;actors jsonb;more boolean;coverage_id text;
BEGIN
 PERFORM nv_master_private.require_access(org,'history');
 SELECT s.coverage_post_id INTO coverage_id FROM public.shifts s WHERE s.id=shift_filter AND s.organization_id=org;
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
   AND (actor_filter IS NULL OR a.actor_id=actor_filter) AND (action_filter IS NULL OR a.action=action_filter) AND (shift_filter IS NULL OR a.shift_id=shift_filter OR (coverage_id IS NOT NULL AND
     (a.entity_id=coverage_id OR a.next->>'coverage_post_id'=coverage_id OR a.previous->>'coverage_post_id'=coverage_id
       OR EXISTS(SELECT FROM public.shifts sibling WHERE sibling.coverage_post_id=coverage_id AND sibling.id=a.shift_id))))
  ORDER BY a.id DESC LIMIT page_size+1
 ) x;
 more:=jsonb_array_length(items)>page_size;
 IF more THEN items:=items-page_size; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name,x.id),'[]') INTO actors FROM (
  SELECT * FROM (SELECT DISTINCT ON(a.actor_id) a.actor_id AS id,a.actor_name AS name FROM public.master_schedule_audit a
   WHERE a.organization_id=org AND a.actor_id IS NOT NULL
    AND (unit_filter IS NULL OR a.unit_id=unit_filter OR a.previous->>'unit_id'=unit_filter OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(a.details->'scopes','[]')) scope WHERE scope->>'unit_id'=unit_filter))
    AND (sector_filters IS NULL OR a.sector_id=ANY(sector_filters) OR a.previous->>'sector_id'=ANY(sector_filters) OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(a.details->'scopes','[]')) scope WHERE scope->>'sector_id'=ANY(sector_filters)))
    AND (shift_filter IS NULL OR a.shift_id=shift_filter OR (coverage_id IS NOT NULL AND
     (a.entity_id=coverage_id OR a.next->>'coverage_post_id'=coverage_id OR a.previous->>'coverage_post_id'=coverage_id
       OR EXISTS(SELECT FROM public.shifts sibling WHERE sibling.coverage_post_id=coverage_id AND sibling.id=a.shift_id))))
   ORDER BY a.actor_id,a.id DESC) latest ORDER BY latest.name,latest.id LIMIT 200
 ) x;
 RETURN jsonb_build_object('items',items,'actors',actors,'has_more',more);
END $$;

CREATE OR REPLACE FUNCTION public.nv_portal_schedule(from_date date, to_date date, mine boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(
    item || jsonb_build_object('duration_minutes',nv_master_private.shift_planned_minutes(s)) || CASE WHEN item->>'assigned_to_me' = 'true' THEN jsonb_build_object(
      'approval_source',nv_master_private.approval_state(s),'approval_revision',s.approval_revision)
      ELSE '{}'::jsonb END ORDER BY s.date,s.start_time,s.id),'[]')
  FROM jsonb_array_elements(public.nv_master_portal_schedule_base(from_date,to_date,mine)) item
  JOIN public.shifts s ON s.id = item->>'id'
  WHERE mine IS TRUE OR NOT EXISTS(SELECT FROM public.master_coverage_publication p WHERE p.shift_id = s.id AND NOT p.enabled);
$$;

CREATE OR REPLACE FUNCTION public.nv_report_filtered_shifts(org text, from_date date, to_date date, filters jsonb, financial_only boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  finance boolean := public.nv_can_read_finance(org);
  attendance boolean := public.nv_coordinator(org);
  company text;
  wanted_unit text := filters->>'unit';
  wanted_sector text := filters->>'sector';
  wanted_doctor text := filters->>'doctor';
  wanted_specialty text := filters->>'specialty';
  wanted_state text := filters->>'state';
  wanted_presence text := filters->>'presence';
  wanted_payment text := filters->>'payment';
  wanted_frequency text := filters->>'frequency';
  wanted_period text := filters->>'period';
  wanted_employment text := filters->>'employment';
  wanted_shift text := filters->>'shift_id';
  start_hour time;
  end_hour time;
  due_from date;
  due_to date;
  paid_from date;
  paid_to date;
BEGIN
  SELECT name INTO company FROM public.organizations WHERE id = org;
  IF company IS NULL OR (CASE WHEN financial_only THEN finance ELSE public.nv_can_report(org) END) IS NOT TRUE
    OR (NOT finance AND filters ?| ARRAY['payment','frequency','due_from','due_to','paid_from','paid_to'])
    OR (NOT attendance AND wanted_presence IS NOT NULL) THEN
    RAISE EXCEPTION 'Relatório indisponível para este acesso ou filtro.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(filters) IS DISTINCT FROM 'object' OR from_date IS NULL OR to_date IS NULL OR from_date > to_date
    OR (NOT financial_only AND to_date - from_date > 365)
    OR EXISTS (SELECT 1 FROM jsonb_each_text(filters) entry WHERE length(entry.value) > 150)
    OR (wanted_state IS NOT NULL AND wanted_state NOT IN ('active','open','exchange','confirmed','pending','completed','cancelled'))
    OR (wanted_presence IS NOT NULL AND wanted_presence NOT IN ('pending','checked_in','checked_out'))
    OR (wanted_payment IS NOT NULL AND wanted_payment NOT IN ('pending','scheduled','overdue','unpaid','paid','partial','cancelled','unassigned'))
    OR (wanted_frequency IS NOT NULL AND wanted_frequency NOT IN ('monthly','on_delivery'))
    OR (wanted_employment IS NOT NULL AND wanted_employment NOT IN ('pj','clt','concursado','undefined'))
    OR (wanted_period IS NOT NULL AND wanted_period NOT IN ('day','night'))
    OR EXISTS (SELECT 1 FROM jsonb_each_text(filters) entry WHERE
      (entry.key IN ('start_hour','end_hour') AND entry.value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      OR (entry.key IN ('due_from','due_to','paid_from','paid_to') AND entry.value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) THEN
    RAISE EXCEPTION 'Confira o período e os filtros do relatório.' USING ERRCODE = '22023';
  END IF;
  start_hour := (filters->>'start_hour')::time;
  end_hour := (filters->>'end_hour')::time;
  due_from := (filters->>'due_from')::date;
  due_to := (filters->>'due_to')::date;
  paid_from := (filters->>'paid_from')::date;
  paid_to := (filters->>'paid_to')::date;
  IF due_from > due_to OR paid_from > paid_to THEN
    RAISE EXCEPTION 'Confira a ordem das datas de vencimento e pagamento.' USING ERRCODE = '22023';
  END IF;

  RETURN (
    SELECT jsonb_build_object('organization',company,'finance',finance,'attendance',attendance,
      'rows',coalesce(jsonb_agg(item ORDER BY item->>'date',item->>'start_time',item->>'id'),'[]'::jsonb))
    FROM (
      SELECT jsonb_build_object('id',s.id,'organization',company,'unit',u.name,'unit_id',u.id,'sector',s.sector,
        'doctor',d.name,'doctor_id',d.id,'employment',s.employment_type,'specialty',s.specialty,'date',s.date,'coverage_post_id',s.coverage_post_id,'coverage_date',post.operational_date,
        'segment_minutes',CASE WHEN s.coverage_post_id IS NOT NULL THEN nv_master_private.shift_planned_minutes(s) END,'start_time',s.start_time,'end_time',s.end_time,
        'period',stats.period,'status',stats.state,'presence',CASE WHEN attendance THEN stats.presence END,
        'check_in',CASE WHEN attendance THEN ci.recorded_at END,'check_out',CASE WHEN attendance THEN co.recorded_at END)
        || CASE WHEN finance AND s.employment_type = 'pj' AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) THEN jsonb_build_object(
          'payment',stats.payment,'frequency',s.payment_frequency,'agreed',s.payment_amount,'due',CASE WHEN s.doctor_id IS NOT NULL THEN s.payment_due_date END,
          'paid_on',stats.paid_on,'paid_amount',CASE WHEN s.payment_status = 'paid' THEN coalesce(s.paid_amount,s.payment_amount) END,
          'balance',CASE WHEN s.doctor_id IS NULL OR s.payment_amount IS NULL THEN NULL WHEN s.status = 'cancelled' THEN 0 ELSE greatest(s.payment_amount - coalesce(s.paid_amount,CASE WHEN s.payment_status='paid' THEN s.payment_amount END,0),0) END,
          'crm',concat_ws('-',d.crm,d.crm_uf),'employer',s.employer_name)
          ELSE '{}'::jsonb END item
      FROM public.shifts s LEFT JOIN public.shift_coverage_posts post ON post.id=s.coverage_post_id JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
      LEFT JOIN public.sectors sc ON sc.id = s.sector_id AND sc.unit_id = u.id AND sc.organization_id = s.organization_id
      LEFT JOIN public.doctors d ON d.id = s.doctor_id AND d.organization_id = s.organization_id
      LEFT JOIN public.shift_opportunities op ON op.shift_id = s.id AND op.status = 'open' AND op.kind = 'exchange' AND public.nv_shift_starts(s) > now()
      LEFT JOIN public.shift_attendance ci ON ci.shift_id = s.id AND ci.kind = 'check_in'
      LEFT JOIN public.shift_attendance co ON co.shift_id = s.id AND co.kind = 'check_out'
      CROSS JOIN LATERAL (SELECT CASE WHEN s.start_time >= '18:00' OR s.start_time < '06:00' THEN 'night' ELSE 'day' END inferred) clock
      CROSS JOIN LATERAL (SELECT CASE WHEN op.id IS NULL THEN s.status ELSE 'exchange' END state,
        CASE WHEN co.recorded_at IS NOT NULL THEN 'checked_out' WHEN ci.recorded_at IS NOT NULL THEN 'checked_in'
          WHEN s.type = 'onsite' AND s.status = 'confirmed' AND s.doctor_id IS NOT NULL THEN 'pending' END presence,
        CASE WHEN finance AND s.employment_type = 'pj' AND s.payment_amount IS NOT NULL THEN
          CASE WHEN s.doctor_id IS NULL AND s.status <> 'cancelled' THEN 'unassigned' ELSE public.nv_payment_state(s) END END payment,
        CASE WHEN finance AND s.employment_type = 'pj' THEN (s.paid_at AT TIME ZONE 'America/Sao_Paulo')::date END paid_on,
        coalesce((SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p
            WHERE p->>'startTime'=s.start_time AND p->>'endTime'=s.end_time LIMIT 1),
          (SELECT p->>'kind' FROM jsonb_array_elements(sc.coverage_periods) p WHERE p->>'kind'=clock.inferred LIMIT 1),
          sc.coverage_periods->0->>'kind',clock.inferred) period) stats
      WHERE s.organization_id = org AND (CASE WHEN financial_only THEN s.date ELSE coalesce(post.operational_date,s.date) END) BETWEEN from_date AND to_date
        AND (NOT financial_only OR (s.employment_type = 'pj' AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND (s.status <> 'cancelled' OR wanted_payment = 'cancelled')))
        AND (wanted_unit IS NULL OR s.unit_id = wanted_unit) AND (wanted_sector IS NULL OR s.sector_id = wanted_sector)
        AND (wanted_doctor IS NULL OR s.doctor_id = wanted_doctor) AND (wanted_specialty IS NULL OR s.specialty = wanted_specialty)
        AND (wanted_employment IS NULL OR coalesce(s.employment_type,'undefined') = wanted_employment)
        AND (wanted_shift IS NULL OR s.id = wanted_shift)
        AND (wanted_state IS NULL OR stats.state = wanted_state OR (wanted_state='active' AND stats.state <> 'cancelled'))
        AND (wanted_presence IS NULL OR stats.presence = wanted_presence)
        AND (wanted_payment IS NULL OR ((s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND (stats.payment = wanted_payment
          OR (wanted_payment='unpaid' AND stats.payment IN ('pending','scheduled','overdue','partial')))))
        AND (wanted_frequency IS NULL OR (s.employment_type = 'pj' AND (s.doctor_id IS NOT NULL OR s.payment_agreement IS NOT NULL) AND s.payment_frequency = wanted_frequency))
        AND (wanted_period IS NULL OR stats.period = wanted_period)
        AND (due_from IS NULL OR (s.employment_type = 'pj' AND s.doctor_id IS NOT NULL AND s.payment_due_date >= due_from))
        AND (due_to IS NULL OR (s.doctor_id IS NOT NULL AND s.payment_due_date <= due_to))
        AND (paid_from IS NULL OR stats.paid_on >= paid_from) AND (paid_to IS NULL OR stats.paid_on <= paid_to)
        AND public.nv_report_hour_match(s.start_time::time,s.end_time::time,start_hour,end_hour)
      ORDER BY s.date,s.start_time,s.id LIMIT 10001
    ) report
  );
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'Confira as datas e os horários do relatório.' USING ERRCODE = '22023';
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
