-- Read-only inventory. Execute in the explicitly authorized target before migration 48.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT current_setting('server_version_num')::integer >= 150000 AS supports_billing_index,
  EXISTS(SELECT FROM pg_extension WHERE extname='pg_cron') AS pg_cron_installed;
SELECT organization_id,unit_id,status,count(*) AS shifts
  FROM public.shifts
  WHERE date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date
  GROUP BY organization_id,unit_id,status ORDER BY organization_id,unit_id,status;
SELECT organization_id, count(*) FILTER (WHERE payment_status='paid' AND paid_amount<payment_amount) AS partial_legacy,
  count(*) FILTER (WHERE payment_status='paid' AND paid_at IS NULL) AS missing_cash_date
  FROM public.shifts GROUP BY organization_id ORDER BY organization_id;
ROLLBACK;
