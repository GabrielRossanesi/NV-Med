-- Resolve staff permissions once per organization, rather than for every
-- shift and each of its eight masked financial fields. Keep the existing
-- security barrier, view columns, grants and permission functions unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE VIEW public.nv_staff_shifts WITH (security_barrier = true) AS
WITH organization_access AS MATERIALIZED (
  SELECT o.id,
    public.nv_can_action(o.id, 'escala', 'view') AS can_view_schedule,
    public.nv_can_read_finance(o.id) AS can_read_finance
  FROM public.organizations o
)
SELECT s.id, s.organization_id, s.doctor_id, s.unit_id, s.sector_id, s.sector, s.specialty, s.date,
  s.start_time, s.end_time, s.type, s.status, s.notes, s.employment_type, s.employer_name, s.coverage_mode, s.coverage_reason,
  CASE WHEN access.can_read_finance THEN s.payment_amount END payment_amount,
  CASE WHEN access.can_read_finance THEN s.payment_frequency END payment_frequency,
  CASE WHEN access.can_read_finance THEN s.payment_status END payment_status,
  CASE WHEN access.can_read_finance THEN s.paid_at END paid_at,
  CASE WHEN access.can_read_finance THEN s.paid_amount END paid_amount,
  CASE WHEN access.can_read_finance THEN s.payment_due_date END payment_due_date,
  CASE WHEN access.can_read_finance THEN s.payment_note END payment_note,
  CASE WHEN access.can_read_finance THEN s.payment_agreement END payment_agreement
FROM public.shifts s
JOIN organization_access access ON access.id = s.organization_id
WHERE access.can_view_schedule OR access.can_read_finance;

COMMIT;
