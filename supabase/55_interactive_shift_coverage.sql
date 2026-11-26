BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE nv_master_private.coverage_batch (
  transaction_id bigint NOT NULL,
  post_id text NOT NULL,
  PRIMARY KEY (transaction_id,post_id)
);
REVOKE ALL ON nv_master_private.coverage_batch FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION nv_master_private.sync_coverage_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.coverage_post_id IS NULL THEN RETURN NULL; END IF;
  IF NEW.status='open' AND NEW.doctor_id IS NULL AND (TG_OP='INSERT' OR OLD.doctor_id IS NOT NULL) THEN
    INSERT INTO public.master_coverage_publication(shift_id) VALUES(NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  IF EXISTS (SELECT FROM nv_master_private.coverage_write c
    WHERE c.transaction_id=txid_current() AND c.shift_id=NEW.id AND c.generated) THEN
    INSERT INTO public.master_schedule_audit(organization_id,entity_id,shift_id,action,actor_id,unit_id,sector_id,shift_date,origin,previous,next)
    VALUES(NEW.organization_id,NEW.coverage_post_id,NEW.id,
      CASE WHEN TG_OP='INSERT' THEN 'coverage_gap_created' ELSE 'coverage_gap_retired' END,
      public.nv_session_actor(),NEW.unit_id,NEW.sector_id,NEW.date,'database',
      CASE WHEN TG_OP='UPDATE' THEN nv_master_private.schedule_snapshot('shift',to_jsonb(OLD)) END,
      nv_master_private.schedule_snapshot('shift',to_jsonb(NEW)));
  ELSIF (TG_OP='INSERT' OR (NEW.coverage_post_id,NEW.doctor_id,NEW.status='cancelled',NEW.date,NEW.start_time,NEW.end_time)
      IS DISTINCT FROM (OLD.coverage_post_id,OLD.doctor_id,OLD.status='cancelled',OLD.date,OLD.start_time,OLD.end_time))
    AND NOT EXISTS (SELECT FROM nv_master_private.coverage_batch b
      WHERE b.transaction_id=txid_current() AND b.post_id=NEW.coverage_post_id) THEN
    PERFORM nv_master_private.reconcile_coverage(NEW.coverage_post_id);
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION nv_master_private.coverage_edit_agreement(record jsonb, previous public.shifts, planned jsonb, zone text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item public.shifts := jsonb_populate_record(NULL::public.shifts,record);
  full_shift public.shifts;
  rate public.organization_shift_rates;
  full_rate public.organization_shift_rates;
  minutes numeric;
  reference_minutes numeric;
  amount bigint;
  same_doctor boolean := previous.id IS NOT NULL AND previous.doctor_id=item.doctor_id;
BEGIN
  IF item.doctor_id IS NULL OR item.status='cancelled' OR item.employment_type IS DISTINCT FROM 'pj'
    OR jsonb_typeof(record->'agreement')='object' OR record->>'hourly_rate_cents' IS NOT NULL THEN RETURN record; END IF;
  IF same_doctor AND (previous.date,previous.start_time,previous.end_time)=(item.date,item.start_time,item.end_time) THEN
    RETURN record;
  END IF;
  IF public.nv_can_finance(item.organization_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'A alteração do acordo PJ exige permissão financeira.' USING ERRCODE='42501';
  END IF;
  IF same_doctor AND previous.payment_agreement->>'hourly_rate_cents' IS NOT NULL THEN
    RETURN record || jsonb_build_object('hourly_rate_cents',previous.payment_agreement->>'hourly_rate_cents',
      'expected_hourly_agreement_at',previous.payment_agreement->>'changed_at');
  END IF;
  minutes := extract(epoch FROM (nv_master_private.coverage_time(item.date,item.end_time,zone,item.end_time<=item.start_time)
    - nv_master_private.coverage_time(item.date,item.start_time,zone)))/60;
  rate := public.nv_resolve_shift_rate(item);
  IF same_doctor THEN
    IF previous.payment_amount IS NULL THEN RETURN record; END IF;
    reference_minutes := extract(epoch FROM (public.nv_shift_ends(previous)-public.nv_shift_starts(previous)))/60;
    amount := round(previous.payment_amount*100*minutes/nullif(reference_minutes,0));
  ELSIF rate.id IS NOT NULL AND rate.duration_minutes IS NOT NULL THEN
    amount := rate.amount_cents;
  ELSE
    full_shift := item;
    full_shift.date := (planned->>'date')::date;
    full_shift.start_time := planned->>'start_time';
    full_shift.end_time := planned->>'end_time';
    full_rate := public.nv_resolve_shift_rate(full_shift);
    reference_minutes := extract(epoch FROM (nv_master_private.coverage_time(full_shift.date,full_shift.end_time,zone,full_shift.end_time<=full_shift.start_time)
      - nv_master_private.coverage_time(full_shift.date,full_shift.start_time,zone)))/60;
    amount := round(coalesce(full_rate.amount_cents,rate.amount_cents)*minutes/nullif(reference_minutes,0));
  END IF;
  IF amount IS NULL OR amount<0 THEN
    RAISE EXCEPTION 'Configure um valor padrão para o posto antes de salvar a alocação PJ.' USING ERRCODE='22023';
  END IF;
  RETURN record || jsonb_build_object('agreement',jsonb_build_object(
    'mode',CASE WHEN rate.id IS NULL THEN 'manual' ELSE 'override' END,'rate_id',rate.id,'rate_cents',rate.amount_cents,
    'amount_cents',amount,'frequency',coalesce(previous.payment_frequency,item.payment_frequency,'on_delivery'),
    'override_reason','Valor proporcional à cobertura.','reason','Ajuste do intervalo de cobertura.',
    'expected_amount_cents',CASE WHEN previous.payment_amount IS NOT NULL THEN (previous.payment_amount*100)::bigint END,
    'expected_frequency',previous.payment_frequency,'expected_changed_at',previous.payment_agreement->>'changed_at'));
END $$;

CREATE FUNCTION public.nv_save_coverage_draft(anchor jsonb, records jsonb, planned jsonb, expected_revision integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE root public.shifts := jsonb_populate_record(NULL::public.shifts,anchor);
  original public.shifts;
  previous public.shifts;
  item public.shifts;
  post public.shift_coverage_posts;
  entry jsonb;
  post_id text;
  zone text;
BEGIN
  IF root.id IS NULL OR length(root.id)>100 OR public.nv_can_action(root.organization_id,'escala','view') IS NOT TRUE
    OR public.nv_can_action(root.organization_id,'escala','edit') IS NOT TRUE THEN
    RAISE EXCEPTION 'Cobertura indisponível.' USING ERRCODE='42501';
  END IF;
  IF jsonb_typeof(records) IS DISTINCT FROM 'array' OR jsonb_array_length(records) NOT BETWEEN 1 AND 100
    OR jsonb_typeof(planned) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Confira as alterações e o período do posto.' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(records))<>jsonb_array_length(records) THEN
    RAISE EXCEPTION 'Cada alocação pode aparecer uma vez na gravação.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO original FROM public.shifts WHERE id=root.id AND organization_id=root.organization_id;
  post_id := coalesce(original.coverage_post_id,root.id);
  PERFORM nv_master_private.lock_coverage(post_id);
  SELECT * INTO post FROM public.shift_coverage_posts p WHERE p.id=post_id AND p.organization_id=root.organization_id;
  IF original.coverage_post_id IS NOT NULL THEN
    IF post.revision IS DISTINCT FROM expected_revision OR post.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'A cobertura mudou. Reabra a ficha antes de salvar.' USING ERRCODE='40001';
    END IF;
    planned := jsonb_build_object('date',post.operational_date,'start_time',post.start_time,'end_time',post.end_time,'capacity',post.capacity);
    zone := post.time_zone;
  ELSE
    IF expected_revision IS NOT NULL THEN RAISE EXCEPTION 'A cobertura mudou. Reabra a ficha antes de salvar.' USING ERRCODE='40001'; END IF;
    SELECT coalesce(original.shift_time_zone,u.time_zone) INTO zone FROM public.units u
    WHERE u.id=root.unit_id AND u.organization_id=root.organization_id AND u.status='active';
    IF original.id IS NOT NULL THEN
      planned := planned || jsonb_build_object('date',original.date,'start_time',original.start_time,'end_time',original.end_time);
    END IF;
  END IF;

  INSERT INTO nv_master_private.coverage_batch VALUES(txid_current(),post_id);
  IF original.coverage_post_id IS NULL THEN
    SELECT value INTO entry FROM jsonb_array_elements(records) WHERE value->>'id'=root.id;
    entry := coalesce(entry,anchor);
    item := jsonb_populate_record(NULL::public.shifts,entry);
    IF item.organization_id IS DISTINCT FROM root.organization_id OR item.unit_id IS DISTINCT FROM root.unit_id THEN
      RAISE EXCEPTION 'A alocação deve manter os vínculos do posto previsto.' USING ERRCODE='42501';
    END IF;
    IF item.status='cancelled' AND public.nv_can_action(root.organization_id,'escala','delete') IS NOT TRUE THEN
      RAISE EXCEPTION 'Seu acesso não permite remover alocações.' USING ERRCODE='42501';
    END IF;
    PERFORM public.nv_save_fractional_coverage(nv_master_private.coverage_edit_agreement(entry,original,planned,zone),planned,NULL);
    SELECT * INTO STRICT post FROM public.shift_coverage_posts p WHERE p.id=post_id AND p.organization_id=root.organization_id;
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(records) WITH ORDINALITY AS items(value,position)
    WHERE original.coverage_post_id IS NOT NULL OR value->>'id' IS DISTINCT FROM root.id
    ORDER BY (value->>'status'='cancelled') DESC,position
  LOOP
    item := jsonb_populate_record(NULL::public.shifts,entry);
    IF item.id IS NULL OR length(item.id)>100 OR item.organization_id IS DISTINCT FROM post.organization_id
      OR (item.unit_id,item.sector_id,item.specialty,item.type,coalesce(item.coverage_mode,'regular'),item.coverage_reason)
         IS DISTINCT FROM (post.unit_id,post.sector_id,post.specialty,post.type,post.coverage_mode,post.coverage_reason) THEN
      RAISE EXCEPTION 'A alocação deve manter os vínculos do posto previsto.' USING ERRCODE='42501';
    END IF;
    SELECT * INTO previous FROM public.shifts WHERE id=item.id FOR UPDATE NOWAIT;
    IF previous.id IS NOT NULL AND (previous.coverage_post_id IS DISTINCT FROM post.id OR previous.status='cancelled') THEN
      RAISE EXCEPTION 'O intervalo não está disponível neste posto.' USING ERRCODE='42501';
    END IF;
    IF previous.id IS NOT NULL AND (public.nv_shift_has_settlement(previous) OR previous.status='completed'
       OR public.nv_shift_ends(previous)<=statement_timestamp()) THEN
      RAISE EXCEPTION 'Use a ficha do intervalo para ajustar um plantão encerrado ou pago.' USING ERRCODE='22023';
    END IF;
    IF item.status='cancelled' AND (previous.doctor_id IS NULL OR public.nv_can_action(root.organization_id,'escala','delete') IS NOT TRUE) THEN
      RAISE EXCEPTION 'Seu acesso não permite remover esta alocação.' USING ERRCODE='42501';
    END IF;
    entry := nv_master_private.coverage_edit_agreement(entry,previous,planned,zone);
    IF previous.id IS NOT NULL THEN
      PERFORM public.nv_save_fractional_coverage(entry,NULL,post.revision);
    ELSE
      IF item.doctor_id IS NULL OR item.status='cancelled' OR public.nv_can_action(root.organization_id,'escala','create') IS NOT TRUE THEN
        RAISE EXCEPTION 'Seu acesso não permite criar esta alocação.' USING ERRCODE='42501';
      END IF;
      INSERT INTO nv_master_private.coverage_write(transaction_id,shift_id,post_id,generated)
      VALUES(txid_current(),item.id,post.id,false);
      PERFORM public.nv_save_operational_shifts(jsonb_build_array(entry));
      DELETE FROM nv_master_private.coverage_write WHERE transaction_id=txid_current() AND shift_id=item.id;
    END IF;
  END LOOP;
  DELETE FROM nv_master_private.coverage_batch b WHERE b.transaction_id=txid_current() AND b.post_id=post.id;
  PERFORM nv_master_private.reconcile_coverage(post.id);
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.date,s.start_time,s.id),'[]')
    FROM public.nv_staff_shifts s WHERE s.organization_id=post.organization_id AND s.coverage_post->>'id'=post.id);
END $$;

REVOKE ALL ON FUNCTION nv_master_private.coverage_edit_agreement(jsonb,public.shifts,jsonb,text),
  public.nv_save_coverage_draft(jsonb,jsonb,jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.nv_save_coverage_draft(jsonb,jsonb,jsonb,integer) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
