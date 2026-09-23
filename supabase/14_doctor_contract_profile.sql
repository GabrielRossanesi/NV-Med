-- NV Med: professional registry and contract controls for doctors.
-- Apply after 13_document_governance.sql.
BEGIN;

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS rqe text,
  ADD COLUMN IF NOT EXISTS contract_model text NOT NULL DEFAULT 'pf',
  ADD COLUMN IF NOT EXISTS contract_signed boolean NOT NULL DEFAULT false;

ALTER TABLE public.doctors DROP CONSTRAINT IF EXISTS doctors_rqe_format;
ALTER TABLE public.doctors ADD CONSTRAINT doctors_rqe_format
  CHECK (rqe IS NULL OR rqe ~ '^[0-9]{1,20}$');

ALTER TABLE public.doctors DROP CONSTRAINT IF EXISTS doctors_contract_model_check;
ALTER TABLE public.doctors ADD CONSTRAINT doctors_contract_model_check
  CHECK (contract_model IN ('scp', 'pj', 'pf'));

COMMENT ON COLUMN public.doctors.rqe IS
  'Optional Registro de Qualificação de Especialista (RQE).';
COMMENT ON COLUMN public.doctors.contract_model IS
  'Commercial participation model: SCP, legal entity (PJ), or individual (PF).';
COMMENT ON COLUMN public.doctors.contract_signed IS
  'Whether the physician contract has already been formally signed.';

COMMIT;
