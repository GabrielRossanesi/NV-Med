-- NV Med: atomic organization deletion for the trusted server endpoint.
BEGIN;

CREATE OR REPLACE FUNCTION public.nv_delete_organization(target_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = target_id) THEN
    RAISE EXCEPTION 'Empresa não encontrada.';
  END IF;

  SELECT jsonb_build_object(
    'auth_user_ids', coalesce(jsonb_agg(DISTINCT auth_user_id::text) FILTER (WHERE auth_user_id IS NOT NULL), '[]'::jsonb),
    'avatar_paths', coalesce(jsonb_agg(DISTINCT avatar) FILTER (WHERE coalesce(avatar, '') <> ''), '[]'::jsonb)
  ) INTO result
  FROM public.user_accounts
  WHERE organization_id = target_id;

  result := result || jsonb_build_object(
    'document_paths', coalesce((
      SELECT jsonb_agg(DISTINCT file_path) FILTER (WHERE coalesce(file_path, '') <> '')
      FROM public.medical_documents
      WHERE organization_id = target_id
    ), '[]'::jsonb)
  );

  DELETE FROM public.shifts WHERE organization_id = target_id;
  DELETE FROM public.medical_documents WHERE organization_id = target_id;
  DELETE FROM public.sectors WHERE organization_id = target_id;
  DELETE FROM public.doctors WHERE organization_id = target_id;
  DELETE FROM public.units WHERE organization_id = target_id;
  DELETE FROM public.user_accounts WHERE organization_id = target_id;
  DELETE FROM public.organizations WHERE id = target_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.nv_delete_organization(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nv_delete_organization(text) TO service_role;

COMMIT;
