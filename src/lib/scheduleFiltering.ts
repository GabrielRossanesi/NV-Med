import { shiftInterval, type CoveragePeriodSummary } from './scheduling.ts';
import { isCriticalCoverage, type DoctorScheduleWarning, type ScheduleCoverageFilter } from './scheduleCalendar.ts';
import type { CoveragePeriodKind, EmploymentType, Sector, Shift } from '../types/index.ts';

export type ScheduleFilters = {
  statusFilter: Shift['status'] | 'all' | 'exchange'; coverageFilter: ScheduleCoverageFilter;
  employment: EmploymentType | ''; doctorId: string; periodKind: CoveragePeriodKind | '';
  documentFilter: 'all' | 'regular' | 'pending'; specialty?: string; coverageMode?: 'all' | 'regular' | 'adhoc';
};
export type ScheduleFilterContext = {
  availableVacancyIds: ReadonlySet<string>; conflicts: Set<string>;
  warnings: Map<string, DoctorScheduleWarning>; now: number;
};
export function isAvailableScheduleVacancy(shift: Shift, context: ScheduleFilterContext) {
  return !shift.doctorId && shift.status === 'open' && shift.paymentStatus !== 'paid'
    && shiftInterval(shift).start > context.now && context.availableVacancyIds.has(shift.id);
}
export function scheduleHasFilters(filters: ScheduleFilters) {
  return filters.statusFilter !== 'all' || filters.coverageFilter !== 'all' || Boolean(filters.employment || filters.doctorId || filters.periodKind || filters.specialty)
    || filters.documentFilter !== 'all' || Boolean(filters.coverageMode && filters.coverageMode !== 'all');
}
export function scheduleShiftMatches(shift: Shift, sector: Sector, period: CoveragePeriodSummary, filters: ScheduleFilters, context: ScheduleFilterContext) {
  if (shift.status === 'cancelled' && filters.statusFilter !== 'cancelled') return false;
  if (filters.statusFilter === 'all' ? shift.status === 'cancelled'
    : filters.statusFilter === 'open' ? !isAvailableScheduleVacancy(shift, context)
    : filters.statusFilter === 'exchange' ? !shift.exchangeRequested : shift.status !== filters.statusFilter) return false;
  if (filters.periodKind && period.period.kind !== filters.periodKind) return false;
  if (filters.employment && shift.employmentType !== filters.employment) return false;
  if (filters.doctorId && shift.doctorId !== filters.doctorId) return false;
  if (filters.specialty && (shift.specialty || sector.primarySpecialty || sector.specialties[0]) !== filters.specialty) return false;
  if (filters.coverageMode && filters.coverageMode !== 'all' && (shift.coverageMode || 'regular') !== filters.coverageMode) return false;
  if (filters.documentFilter !== 'all' && (!shift.doctorId || (filters.documentFilter === 'pending') !== Boolean(context.warnings.get(shift.doctorId)?.warning))) return false;
  switch (filters.coverageFilter) {
    case 'open': return isAvailableScheduleVacancy(shift, context);
    case 'pending': return Boolean(shift.doctorId) && shift.status === 'pending';
    case 'conflict': return context.conflicts.has(shift.id);
    case 'deficit': return period.deficit > 0;
    case 'complete': return period.required > 0 && period.deficit === 0;
    case 'critical': return isCriticalCoverage(period, shift.date, context.conflicts, context.warnings, context.now);
    default: return true;
  }
}
// Keep the operational denominator intact; only the displayed items are filtered.
export function filterSchedulePeriod(period: CoveragePeriodSummary, sector: Sector, day: string, filters: ScheduleFilters, context: ScheduleFilterContext): CoveragePeriodSummary {
  const items = period.items.filter(shift => scheduleShiftMatches(shift, sector, period, filters, context));
  const hasItemFilters = filters.statusFilter !== 'all' || Boolean(filters.employment || filters.doctorId || filters.specialty)
    || filters.documentFilter !== 'all' || filters.coverageMode === 'adhoc' || ['open', 'pending', 'conflict'].includes(filters.coverageFilter);
  const showPlanned = !hasItemFilters && (!filters.periodKind || period.period.kind === filters.periodKind)
    && (filters.coverageFilter === 'all' || filters.coverageFilter === 'deficit' && period.deficit > 0
      || filters.coverageFilter === 'critical' && isCriticalCoverage(period, day, context.conflicts, context.warnings, context.now));
  return { ...period, items, assigned: items.filter(shift => Boolean(shift.doctorId)), vacancies: items.filter(shift => !shift.doctorId), uncreated: showPlanned ? period.uncreated : 0 };
}
