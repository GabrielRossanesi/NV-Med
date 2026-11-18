-- Read-only inventory: no names, private notes, credentials or mutations.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name, current_user AS database_role,
 current_setting('server_version') AS postgres_version;
SELECT to_regclass('public.nv_staff_shifts') AS staff_projection,
 to_regprocedure('public.nv_prepare_shift_employment(public.shifts,public.shifts,jsonb)') AS employment_rules,
 to_regprocedure('public.nv_credentialed_for_shift(text,public.shifts)') AS credential_rules,
 to_regclass('public.master_schedule_rules') AS master_rules,
 EXISTS(SELECT FROM pg_extension WHERE extname='pg_cron') AS cron_installed;
SELECT organization_id, count(*) AS existing_posts,
 count(*) FILTER(WHERE doctor_id IS NOT NULL) AS assigned_posts,
 count(*) FILTER(WHERE date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS current_future_posts,
 count(*) FILTER(WHERE public.nv_shift_has_settlement(s)) AS consolidated_posts
FROM public.shifts s GROUP BY organization_id ORDER BY organization_id;
SELECT organization_id, count(*) AS sectors_without_primary_specialty FROM public.sectors
WHERE primary_specialty IS NULL GROUP BY organization_id;
COMMIT;
