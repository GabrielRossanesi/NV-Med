-- Run as database owner in the confirmed Supabase target, AFTER migration 37.
-- This file enables the daily job; it does not run the generator immediately.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;
SELECT cron.schedule('nvmed-master-daily','0 5 * * *','SELECT public.nv_master_generate_scheduled();');
COMMIT;
-- 05:00 UTC = 02:00 America/Sao_Paulo. The named schedule updates the existing job.
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname='nvmed-master-daily';
