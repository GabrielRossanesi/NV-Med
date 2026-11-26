-- Retired entry point. Keep an explicit error for bookmarks and old runbooks.
DO $$ BEGIN
  RAISE EXCEPTION 'O instalador de demonstração foi desativado. Siga supabase/README.md para provisionar o NV Med.';
END $$;
