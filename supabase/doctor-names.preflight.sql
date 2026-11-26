-- Read-only. Export comparison only into access-controlled storage.
WITH changes AS MATERIALIZED (
  SELECT * FROM nv_doctor_names.preview()
), report AS (
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.source, c.organization_id, c.doctor_id), '[]') AS comparison
  FROM changes c
)
SELECT nv_doctor_names.preview_token(report.comparison) AS review_token,
  (SELECT count(*) FROM public.doctors) AS total_doctors,
  (SELECT count(*) FROM public.doctor_enrollments WHERE status IN ('pending', 'correction_requested')) AS open_enrollments,
  count(*) FILTER (WHERE c.source = 'doctors') AS doctors_to_review,
  count(*) FILTER (WHERE c.source = 'doctor_enrollments') AS enrollments_to_review,
  count(*) FILTER (WHERE c.valid AND c.duplicate_doctors <= 1) AS eligible_fields,
  count(*) FILTER (WHERE cardinality(c.numbers_found) > 0) AS numbered_fields,
  count(*) FILTER (WHERE c.duplicate_doctors > 1) AS possible_duplicate_fields,
  count(*) FILTER (WHERE NOT c.valid) AS invalid_fields
FROM report LEFT JOIN changes c ON true
GROUP BY report.comparison;
