-- Run as database owner after validating migrations 48 and 52.
-- Reapplying this setup keeps the first activation boundary.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $extension$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'Instale a extensão pg_cron antes de ativar a aprovação automática.';
  END IF;
END
$extension$;
INSERT INTO nv_master_private.shift_approval_schedule (activated_at)
VALUES (statement_timestamp()) ON CONFLICT (singleton) DO NOTHING;
SELECT cron.schedule('nvmed-shift-approval','*/5 * * * *','SELECT public.nv_auto_approve_expired_shifts();');
COMMIT;
SELECT j.jobid,j.jobname,j.schedule,j.active,s.activated_at
FROM cron.job j CROSS JOIN nv_master_private.shift_approval_schedule s
WHERE j.jobname = 'nvmed-shift-approval';
