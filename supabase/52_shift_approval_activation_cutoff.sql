-- Store a fixed opt-in boundary for scheduled approval. Existing shifts and
-- previous approvals keep their recorded state when this migration is applied.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE nv_master_private.shift_approval_schedule (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  activated_at timestamptz NOT NULL CHECK (isfinite(activated_at))
);
REVOKE ALL ON nv_master_private.shift_approval_schedule FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION nv_master_private.auto_approve_expired_shifts(organization_scope text, deadline_after timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_ids text[];
BEGIN
  IF deadline_after IS NULL THEN RETURN 0; END IF;
  SELECT array_agg(x.id) INTO target_ids FROM (
    SELECT s.id FROM public.shifts s JOIN public.doctors d ON d.id = s.doctor_id AND d.organization_id = s.organization_id
    JOIN public.organizations o ON o.id = s.organization_id
    JOIN public.units u ON u.id = s.unit_id AND u.organization_id = s.organization_id
    WHERE s.status = 'pending' AND s.doctor_id IS NOT NULL AND (s.approval_source IS NULL OR s.approval_source = 'pending')
      AND (organization_scope IS NULL OR s.organization_id = organization_scope)
      AND s.date BETWEEN (deadline_after AT TIME ZONE 'UTC')::date - 2
        AND (statement_timestamp() AT TIME ZONE 'UTC')::date + 1
      AND public.nv_shift_ends(s) > deadline_after
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

-- Keep the compatibility entry for synthetic organization checks.
CREATE OR REPLACE FUNCTION nv_master_private.auto_approve_expired_shifts(organization_scope text)
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN organization_scope IS NULL THEN 0
         ELSE nv_master_private.auto_approve_expired_shifts(organization_scope, '-infinity'::timestamptz) END;
$$;

-- This is the only entry point used by the recurring production job.
CREATE OR REPLACE FUNCTION public.nv_auto_approve_expired_shifts()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT nv_master_private.auto_approve_expired_shifts(NULL, s.activated_at)
    FROM nv_master_private.shift_approval_schedule s WHERE s.singleton), 0);
$$;

REVOKE ALL ON FUNCTION nv_master_private.auto_approve_expired_shifts(text,timestamptz),
  nv_master_private.auto_approve_expired_shifts(text), public.nv_auto_approve_expired_shifts()
  FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
