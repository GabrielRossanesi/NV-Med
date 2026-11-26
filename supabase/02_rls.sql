-- The initial schema enables RLS in the same transaction that creates the tables.
-- This compatibility step removes only the old policies, preserving tenant policies.
BEGIN;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['organizations','user_accounts','doctors','units','medical_documents','shifts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow public read access on ' || relation, relation);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Allow public write access on ' || relation, relation);
  END LOOP;
END $$;

COMMIT;
