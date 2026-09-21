-- NV Med: per-user permission exceptions in addition to role-based access.
-- Apply after 11_finance_module.sql.
BEGIN;

ALTER TABLE public.user_accounts
  ADD COLUMN IF NOT EXISTS additional_permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.nv_valid_additional_permissions(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each_text(value) AS permission(key, level)
      WHERE permission.key NOT IN ('medicos','unidades','documentos','escala','financeiro','relatorios','configuracoes')
         OR permission.level NOT IN ('view','edit')
    );
$$;

ALTER TABLE public.user_accounts DROP CONSTRAINT IF EXISTS user_accounts_additional_permissions_check;
ALTER TABLE public.user_accounts ADD CONSTRAINT user_accounts_additional_permissions_check
  CHECK (public.nv_valid_additional_permissions(additional_permissions));

COMMENT ON COLUMN public.user_accounts.additional_permissions IS
  'Individual view/edit grants that supplement, but never reduce, permissions inherited from the role.';

CREATE OR REPLACE FUNCTION public.nv_can_write(org text, resource text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'
      AND (
        (u.type = 'saas_admin' AND (
          u.role IN ('CEO','Gerente') OR
          (u.role IN ('Coordenador','Administrativo') AND resource IN ('doctors','units','sectors','shifts')) OR
          (u.role = 'Jurídico' AND resource = 'medical_documents')
        ))
        OR
        (u.type = 'tenant_user' AND u.organization_id = org AND (
          u.role = 'Diretor' OR
          (u.role IN ('Gerente','Coordenador de Escalas','Escalista') AND resource IN ('doctors','units','sectors','shifts','medical_documents')) OR
          (u.role = 'Jurídico' AND resource = 'medical_documents') OR
          u.additional_permissions ->> CASE resource
            WHEN 'doctors' THEN 'medicos'
            WHEN 'units' THEN 'unidades'
            WHEN 'sectors' THEN 'unidades'
            WHEN 'shifts' THEN 'escala'
            WHEN 'medical_documents' THEN 'documentos'
            WHEN 'organizations' THEN 'configuracoes'
            ELSE resource
          END = 'edit'
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.nv_can_write(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_can_write(text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.nv_can_finance(org text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_accounts u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.status = 'active'
      AND (
        (u.type = 'saas_admin' AND u.role IN ('CEO','Gerente','Financeiro'))
        OR
        (u.type = 'tenant_user' AND u.organization_id = org AND (
          u.role IN ('Diretor','Gerente','Financeiro')
          OR u.additional_permissions ->> 'financeiro' = 'edit'
        ))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.nv_can_finance(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nv_can_finance(text) TO authenticated;

COMMIT;
