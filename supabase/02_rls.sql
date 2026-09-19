-- ==============================================================================
-- NV MED - ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- 1. HABILITAÇÃO DO RLS EM TODAS AS TABELAS
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- 2. POLÍTICAS PARA O SERVICE_ROLE (Vercel Backend / Server Components)
-- Nota: O service_role_key do Supabase bypassa o RLS nativamente no PostgreSQL, 
-- garantindo que rotas API / Server Actions na Vercel tenham acesso irrestrito.

-- 3. POLÍTICAS DE ACESSO (Anon / Authenticated)
-- Permite leitura e escrita para garantir o funcionamento com anon_key tanto no cliente quanto através da Vercel.

-- Organizations
DROP POLICY IF EXISTS "Allow public read access on organizations" ON public.organizations;
CREATE POLICY "Allow public read access on organizations"
ON public.organizations FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public write access on organizations" ON public.organizations;
CREATE POLICY "Allow public write access on organizations"
ON public.organizations FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- User Accounts
DROP POLICY IF EXISTS "Allow public read access on user_accounts" ON public.user_accounts;
CREATE POLICY "Allow public read access on user_accounts"
ON public.user_accounts FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public write access on user_accounts" ON public.user_accounts;
CREATE POLICY "Allow public write access on user_accounts"
ON public.user_accounts FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Doctors
DROP POLICY IF EXISTS "Allow public read access on doctors" ON public.doctors;
CREATE POLICY "Allow public read access on doctors"
ON public.doctors FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public write access on doctors" ON public.doctors;
CREATE POLICY "Allow public write access on doctors"
ON public.doctors FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Units
DROP POLICY IF EXISTS "Allow public read access on units" ON public.units;
CREATE POLICY "Allow public read access on units"
ON public.units FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public write access on units" ON public.units;
CREATE POLICY "Allow public write access on units"
ON public.units FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Medical Documents
DROP POLICY IF EXISTS "Allow public read access on medical_documents" ON public.medical_documents;
CREATE POLICY "Allow public read access on medical_documents"
ON public.medical_documents FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public write access on medical_documents" ON public.medical_documents;
CREATE POLICY "Allow public write access on medical_documents"
ON public.medical_documents FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

-- Shifts
DROP POLICY IF EXISTS "Allow public read access on shifts" ON public.shifts;
CREATE POLICY "Allow public read access on shifts"
ON public.shifts FOR SELECT
TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "Allow public write access on shifts" ON public.shifts;
CREATE POLICY "Allow public write access on shifts"
ON public.shifts FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);
