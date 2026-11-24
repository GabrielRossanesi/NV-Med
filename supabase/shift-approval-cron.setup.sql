-- Run as database owner after validating migration 48 and reviewing the pending queue.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule('nvmed-shift-approval','*/5 * * * *','SELECT public.nv_auto_approve_expired_shifts();');
COMMIT;
SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname = 'nvmed-shift-approval';
