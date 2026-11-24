-- Keep authorized units and specialty changes behind the existing credential RPCs.
BEGIN;

REVOKE INSERT, UPDATE ON TABLE public.doctors FROM PUBLIC, anon, authenticated;
-- Existing column grants are independent from table grants.
REVOKE INSERT (linked_units), UPDATE (linked_units, specialty)
  ON TABLE public.doctors FROM PUBLIC, anon, authenticated;

GRANT INSERT (id, organization_id, name, crm, crm_uf, rqe, cpf, phone, email,
  specialty, address, status, contract_model, contract_signed, created_at, updated_at)
  ON TABLE public.doctors TO authenticated;
GRANT UPDATE (id, organization_id, name, crm, crm_uf, rqe, cpf, phone, email,
  address, status, contract_model, contract_signed, created_at, updated_at)
  ON TABLE public.doctors TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
