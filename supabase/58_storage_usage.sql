BEGIN;

CREATE TABLE public.storage_usage_snapshot (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  limit_bytes bigint NOT NULL DEFAULT 1000000000 CHECK (limit_bytes > 0 AND limit_bytes <= 1000000000000000),
  snapshot jsonb NOT NULL DEFAULT '{}',
  refreshed_at timestamptz,
  alert_level integer NOT NULL DEFAULT 0 CHECK (alert_level BETWEEN 0 AND 4),
  alert_sequence bigint NOT NULL DEFAULT 0
);
INSERT INTO public.storage_usage_snapshot DEFAULT VALUES;
ALTER TABLE public.storage_usage_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.storage_usage_snapshot FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.nv_storage_alert_level(used_bytes bigint, limit_bytes bigint)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN used_bytes::numeric * 100 >= limit_bytes::numeric * 100 THEN 4
              WHEN used_bytes::numeric * 100 >= limit_bytes::numeric * 95 THEN 3
              WHEN used_bytes::numeric * 100 >= limit_bytes::numeric * 85 THEN 2
              WHEN used_bytes::numeric * 100 >= limit_bytes::numeric * 70 THEN 1 ELSE 0 END;
$$;

CREATE FUNCTION public.nv_refresh_storage_usage(manual boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  previous public.storage_usage_snapshot;
  actual jsonb;
  level integer;
  sequence bigint;
  observed_at timestamptz;
  cooldown interval := CASE WHEN manual THEN interval '1 minute' ELSE interval '25 minutes' END;
BEGIN
  PERFORM pg_advisory_xact_lock(478668, 58);
  SELECT * INTO STRICT previous FROM public.storage_usage_snapshot WHERE id;
  IF previous.refreshed_at >= clock_timestamp() - cooldown
    AND previous.snapshot->>'limit_bytes' = previous.limit_bytes::text THEN
    RETURN previous.snapshot;
  END IF;

  WITH avatar_owners AS (
    SELECT avatar, CASE WHEN count(DISTINCT organization_id) = 1 AND bool_and(organization_id IS NOT NULL)
      THEN min(organization_id) END AS organization_id
    FROM public.user_accounts WHERE avatar IS NOT NULL GROUP BY avatar
  ), catalog AS MATERIALIZED (
    SELECT o.bucket_id AS bucket, o.name,
      CASE WHEN details->>'size' ~ '^[0-9]{1,15}$' THEN (details->>'size')::bigint END AS bytes,
      CASE WHEN o.name ~ '\.[a-zA-Z0-9]{1,10}$' THEN lower(substring(o.name FROM '\.([a-zA-Z0-9]{1,10})$')) ELSE 'Outros' END AS format,
      coalesce(org.id, avatar_org.id) AS company_id, coalesce(org.name, avatar_org.name) AS company,
      CASE WHEN o.bucket_id = 'medical-documents' AND user_details->>'nvOptimization' = 'webp-v1'
        AND user_details->>'nvOriginalFormat' IN ('jpg', 'png') AND user_details->>'nvOriginalBytes' ~ '^[0-9]{1,8}$'
        THEN least((user_details->>'nvOriginalBytes')::bigint, 12000000) END AS declared_bytes
    FROM storage.objects o
    LEFT JOIN public.organizations org ON o.bucket_id IN ('medical-documents', 'finance-receipts') AND org.id = split_part(o.name, '/', 1)
    LEFT JOIN avatar_owners owner ON o.bucket_id = 'profile-avatars' AND owner.avatar = o.name
    LEFT JOIN public.organizations avatar_org ON avatar_org.id = owner.organization_id
    CROSS JOIN LATERAL (SELECT to_jsonb(o)->'metadata' AS details, to_jsonb(o)->'user_metadata' AS user_details) metadata
    WHERE o.name IS NOT NULL AND o.name NOT LIKE '%/.emptyFolderPlaceholder' AND o.name <> '.emptyFolderPlaceholder'
  ), grouped AS (
    SELECT 'bucket' AS dimension, b.id AS key, b.id AS label, count(c.name) AS files, coalesce(sum(c.bytes), 0) AS bytes
      FROM storage.buckets b LEFT JOIN catalog c ON c.bucket = b.id GROUP BY b.id
    UNION ALL SELECT 'format', CASE WHEN format IN ('jpeg', 'jpg') THEN 'JPEG' ELSE upper(format) END,
      CASE WHEN format IN ('jpeg', 'jpg') THEN 'JPEG' ELSE upper(format) END,
      count(*), coalesce(sum(bytes), 0) FROM catalog GROUP BY 2
    UNION ALL SELECT 'company', coalesce(company_id, ''), coalesce(company, 'Sem empresa identificada'),
      count(*), coalesce(sum(bytes), 0) FROM catalog GROUP BY 2, 3
  )
  SELECT jsonb_build_object(
    'used_bytes', coalesce(sum(bytes), 0), 'files', count(*), 'unknown_sizes', count(*) FILTER (WHERE bytes IS NULL),
    'reported_savings', coalesce(sum(declared_bytes - bytes) FILTER (WHERE declared_bytes > bytes AND format = 'webp'), 0),
    'confirmed_savings', coalesce((SELECT sum(r.original_bytes - r.stored_bytes) FROM public.medical_storage_replacements r
      WHERE EXISTS (SELECT FROM catalog c WHERE c.bucket = 'medical-documents' AND c.name = r.stored_path)
        AND NOT EXISTS (SELECT FROM catalog c WHERE c.bucket = 'medical-documents' AND c.name = r.source_path)), 0),
    'breakdown', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.dimension, g.bytes DESC, g.label), '[]') FROM grouped g)
  ) INTO actual FROM catalog;

  observed_at := clock_timestamp();
  level := public.nv_storage_alert_level((actual->>'used_bytes')::bigint, previous.limit_bytes);
  sequence := previous.alert_sequence;
  IF level > previous.alert_level THEN
    sequence := sequence + 1;
    INSERT INTO public.portal_notifications(recipient_id, event_key, message)
    SELECT u.auth_user_id, 'storage-capacity:' || sequence,
      'Armazenamento ' || (ARRAY['em atenção', 'em alerta', 'crítico', 'no limite'])[level] || '. '
      || to_char((actual->>'used_bytes')::numeric * 100 / previous.limit_bytes, 'FM999999999990D0') || '% do limite estimado em uso.'
    FROM public.user_accounts u
    WHERE u.type = 'saas_admin' AND u.status = 'active' AND u.auth_user_id IS NOT NULL
    ON CONFLICT (recipient_id, event_key) DO NOTHING;
  END IF;

  actual := actual || jsonb_build_object('limit_bytes', previous.limit_bytes, 'level', level, 'refreshed_at', observed_at);
  UPDATE public.storage_usage_snapshot SET snapshot = actual, refreshed_at = observed_at,
    alert_level = level, alert_sequence = sequence WHERE id;
  RETURN actual;
END;
$$;

CREATE FUNCTION public.nv_storage_usage(refresh boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cached public.storage_usage_snapshot;
BEGIN
  IF NOT public.nv_admin() THEN RAISE EXCEPTION 'Acesso reservado à administração SaaS.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO STRICT cached FROM public.storage_usage_snapshot WHERE id;
  IF refresh OR cached.refreshed_at IS NULL OR cached.refreshed_at < clock_timestamp() - interval '30 minutes' THEN
    RETURN public.nv_refresh_storage_usage(refresh);
  END IF;
  RETURN cached.snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_storage_alert_level(bigint,bigint), public.nv_refresh_storage_usage(boolean),
  public.nv_storage_usage(boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nv_storage_usage(boolean) TO authenticated;

COMMIT;
