-- Run as the database owner after migration 58. Existing pg_cron jobs are preserved.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule('nvmed-storage-usage', '*/30 * * * *', 'SELECT public.nv_refresh_storage_usage();');
COMMIT;
