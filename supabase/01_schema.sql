-- ==============================================================================
-- NV MED - SUPABASE DATABASE SCHEMA (São Paulo / sa-east-1)
-- ==============================================================================

-- 1. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. FUNÇÃO DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------------------------
-- TABELA: organizations (Empresas / Operadoras / Tenants)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  razao_social TEXT,
  cnpj TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'SP',
  logo TEXT,
  plan TEXT DEFAULT 'silver' CHECK (plan IN ('bronze', 'silver', 'gold', 'platinum')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'setup', 'suspended', 'cancelled')),
  enabled_modules TEXT[] DEFAULT ARRAY['Dashboard', 'Médicos', 'Unidades', 'Documentos', 'Escala', 'Configurações'],
  settings JSONB DEFAULT '{"specialties": ["Clínico Geral", "Cardiologia", "Pediatria"], "requiredDocuments": [{"type": "rg_cnh", "name": "RG/CNH", "required": true}, {"type": "diploma_medicina", "name": "Diploma de Medicina", "required": true}]}'::jsonb,
  last_active TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER set_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------------------------
-- TABELA: user_accounts (Perfis de Acesso, RBAC e Vínculo de Empresa)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_accounts (
  id TEXT PRIMARY KEY,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  type TEXT NOT NULL DEFAULT 'tenant_user' CHECK (type IN ('saas_admin', 'tenant_user')),
  organization_id TEXT REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'Escalista',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'inactive')),
  avatar TEXT DEFAULT '',
  last_active TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_org ON public.user_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON public.user_accounts(email);

CREATE TRIGGER set_user_accounts_updated_at
BEFORE UPDATE ON public.user_accounts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------------------------
-- TABELA: doctors (Corpo Clínico)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  crm TEXT NOT NULL,
  crm_uf TEXT NOT NULL,
  cpf TEXT,
  phone TEXT,
  email TEXT,
  specialty TEXT NOT NULL,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'inactive')),
  linked_units TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_org ON public.doctors(organization_id);
CREATE INDEX IF NOT EXISTS idx_doctors_crm ON public.doctors(crm, crm_uf);

CREATE TRIGGER set_doctors_updated_at
BEFORE UPDATE ON public.doctors
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------------------------
-- TABELA: units (Unidades de Atendimento - Hospitais, Clínicas, UPAs, etc.)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.units (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cnpj TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  type TEXT NOT NULL DEFAULT 'clinic' CHECK (type IN ('hospital', 'clinic', 'er', 'upa', 'lab')),
  manager TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  specialties TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_org ON public.units(organization_id);

CREATE TRIGGER set_units_updated_at
BEFORE UPDATE ON public.units
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------------------------
-- TABELA: medical_documents (Documentos de Compliance Médico)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medical_documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'rg_cnh',
    'diploma_medicina',
    'diploma_residencia',
    'comprovante_residencia',
    'certidao_crm_etica',
    'certidao_crm_financeira'
  )),
  status TEXT NOT NULL DEFAULT 'not_sent' CHECK (status IN (
    'not_sent',
    'sent',
    'analyzing',
    'approved',
    'expired',
    'rejected'
  )),
  upload_date TEXT,
  expiry_date TEXT,
  file_name TEXT,
  file_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medical_docs_org ON public.medical_documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_medical_docs_doc ON public.medical_documents(doctor_id);
CREATE INDEX IF NOT EXISTS idx_medical_docs_status ON public.medical_documents(status);

CREATE TRIGGER set_medical_documents_updated_at
BEFORE UPDATE ON public.medical_documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------------------------
-- TABELA: shifts (Escalas e Plantões Médicos)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shifts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'onsite' CHECK (type IN ('onsite', 'oncall', 'telemedicine')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending', 'cancelled', 'completed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_org ON public.shifts(organization_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date ON public.shifts(date);
CREATE INDEX IF NOT EXISTS idx_shifts_doctor ON public.shifts(doctor_id);
CREATE INDEX IF NOT EXISTS idx_shifts_unit ON public.shifts(unit_id);

CREATE TRIGGER set_shifts_updated_at
BEFORE UPDATE ON public.shifts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
