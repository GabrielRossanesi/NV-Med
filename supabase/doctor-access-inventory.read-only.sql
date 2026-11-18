-- Run with a privileged SQL connection in the confirmed target, before 36.
-- Read-only: does not create accounts, update records or dispatch email.
BEGIN READ ONLY;
SELECT d.organization_id,count(*) total_doctors,
 count(*) FILTER(WHERE e.doctor_id IS NULL) without_enrollment,
 count(*) FILTER(WHERE e.auth_user_id IS NULL) without_auth_link,
 count(*) FILTER(WHERE e.auth_user_id IS NOT NULL AND a.id IS NULL) missing_auth_user,
 count(*) FILTER(WHERE e.auth_user_id IS NOT NULL AND lower(btrim(d.email)) IS DISTINCT FROM lower(a.email)) divergent_email,
 count(*) FILTER(WHERE coalesce(d.email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') invalid_email
FROM public.doctors d LEFT JOIN public.doctor_enrollments e ON e.doctor_id=d.id
LEFT JOIN auth.users a ON a.id=e.auth_user_id GROUP BY d.organization_id ORDER BY d.organization_id;

-- Duplicate destinations must be regularized individually before invitation.
SELECT organization_id,count(*) duplicate_email_groups FROM(
 SELECT organization_id,lower(btrim(email)) FROM public.doctors WHERE coalesce(btrim(email),'')<>''
 GROUP BY organization_id,lower(btrim(email)) HAVING count(*)>1
) duplicates GROUP BY organization_id ORDER BY organization_id;

-- Find existing credentials which have not been associated; never claim these
-- automatically. A confirmed administrative release validates staff collisions.
SELECT d.organization_id,count(*) records_matching_unlinked_auth
FROM public.doctors d JOIN auth.users a ON lower(a.email)=lower(btrim(d.email)) AND a.deleted_at IS NULL
LEFT JOIN public.doctor_enrollments e ON e.doctor_id=d.id
WHERE e.auth_user_id IS NULL GROUP BY d.organization_id ORDER BY d.organization_id;

SELECT count(*) shared_auth_accounts FROM(
 SELECT auth_user_id FROM public.doctor_enrollments WHERE auth_user_id IS NOT NULL GROUP BY auth_user_id HAVING count(*)>1
) shared_accounts;
COMMIT;
