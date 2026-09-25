import type { Sector, SectorCoveragePeriod, Shift } from '../types/index.ts';
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftTouchesDay(shift: Shift, date: string) {
  if (shift.date === date) return true;
  if (shift.endTime >= shift.startTime || shift.endTime === '00:00') return false;
  const next = new Date(shift.date + 'T12:00:00'); next.setDate(next.getDate() + 1);
  return localDate(next) === date;
}
export function countDoctors(shifts: Shift[]) {
  return new Set(shifts.filter(s => s.status !== 'cancelled' && s.doctorId).map(s => s.doctorId)).size;
}
export function shiftInterval(shift: Pick<Shift, 'date' | 'startTime' | 'endTime'>) {
  const start = new Date(shift.date + 'T' + shift.startTime);
  const end = new Date(shift.date + 'T' + shift.endTime);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
}
export function hasConflict(candidate: Shift, shifts: Shift[]) {
  if (candidate.status === 'cancelled' || !candidate.doctorId) return false;
  const a = shiftInterval(candidate);
  return shifts.some(s => {
    if (s.id === candidate.id || s.doctorId !== candidate.doctorId || s.status === 'cancelled') return false;
    const b = shiftInterval(s); return a.start < b.end && b.start < a.end;
  });
}
export type ShiftRecurrence = 'once' | 'weekly' | 'fortnightly' | 'monthly';

function parseLocalDate(value: string) {
  return new Date(value + 'T12:00:00');
}

function sameOrdinalWeekday(date: Date, weekday: number, ordinal: number) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + ((ordinal - 1) * 7);
  if (day > new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) return null;
  return new Date(date.getFullYear(), date.getMonth(), day, 12);
}

export function buildRecurringDates(startDate: string, untilDate: string, recurrence: ShiftRecurrence) {
  if (recurrence === 'once' || !untilDate || untilDate < startDate) return [startDate];
  const start = parseLocalDate(startDate);
  const until = parseLocalDate(untilDate);
  const dates: string[] = [];
  if (recurrence === 'monthly') {
    const weekday = start.getDay();
    const ordinal = Math.floor((start.getDate() - 1) / 7) + 1;
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
    while (cursor <= until && dates.length < 120) {
      const occurrence = sameOrdinalWeekday(cursor, weekday, ordinal);
      if (occurrence && occurrence >= start && occurrence <= until) dates.push(localDate(occurrence));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return dates;
  }
  const interval = recurrence === 'fortnightly' ? 14 : 7;
  const cursor = new Date(start);
  while (cursor <= until && dates.length < 120) {
    dates.push(localDate(cursor));
    cursor.setDate(cursor.getDate() + interval);
  }
  return dates;
}

export function sectorCoveragePeriods(sector: Pick<Sector, 'coveragePeriods' | 'defaultStartTime' | 'defaultEndTime' | 'requiredDoctors'>): SectorCoveragePeriod[] {
  if (sector.coveragePeriods?.length) return sector.coveragePeriods;
  const night = sector.defaultEndTime < sector.defaultStartTime;
  return [{ kind: night ? 'night' : 'day', startTime: sector.defaultStartTime, endTime: sector.defaultEndTime, requiredDoctors: sector.requiredDoctors }];
}

export function coveragePeriodLabel(kind: SectorCoveragePeriod['kind']) {
  return kind === 'day' ? 'Diurno' : 'Noturno';
}

export interface CoveragePeriodSummary {
  period: SectorCoveragePeriod;
  items: Shift[];
  assigned: Shift[];
  vacancies: Shift[];
  required: number;
  created: number;
  filled: number;
  open: number;
  uncreated: number;
  deficit: number;
}

export interface SectorCoverageSummary {
  periods: CoveragePeriodSummary[];
  items: Shift[];
  required: number;
  created: number;
  filled: number;
  open: number;
  uncreated: number;
  deficit: number;
}

function inferredCoverageKind(startTime: string): SectorCoveragePeriod['kind'] {
  return startTime >= '18:00' || startTime < '06:00' ? 'night' : 'day';
}

export function coverageKindForShift(shift: Pick<Shift, 'startTime' | 'endTime'>, periods: SectorCoveragePeriod[]) {
  const exact = periods.find(period => period.startTime === shift.startTime && period.endTime === shift.endTime);
  if (exact) return exact.kind;
  const inferred = inferredCoverageKind(shift.startTime);
  return periods.some(period => period.kind === inferred) ? inferred : periods[0]?.kind ?? inferred;
}

export function summarizeSectorCoverage(
  sector: Pick<Sector, 'coveragePeriods' | 'defaultStartTime' | 'defaultEndTime' | 'requiredDoctors'>,
  shifts: Shift[],
): SectorCoverageSummary {
  const periods = sectorCoveragePeriods(sector);
  const activeItems = shifts.filter(shift => shift.status !== 'cancelled');
  const summaries = periods.map(period => {
    const items = activeItems.filter(shift => coverageKindForShift(shift, periods) === period.kind);
    const assigned = items.filter(shift => Boolean(shift.doctorId));
    const vacancies = items.filter(shift => !shift.doctorId);
    return {
      period,
      items,
      assigned,
      vacancies,
      required: period.requiredDoctors,
      created: items.length,
      filled: assigned.length,
      open: vacancies.length,
      uncreated: Math.max(period.requiredDoctors - items.length, 0),
      deficit: Math.max(period.requiredDoctors - assigned.length, 0),
    };
  });

  return summaries.reduce<SectorCoverageSummary>((total, summary) => ({
    periods: [...total.periods, summary],
    items: [...total.items, ...summary.items],
    required: total.required + summary.required,
    created: total.created + summary.created,
    filled: total.filled + summary.filled,
    open: total.open + summary.open,
    uncreated: total.uncreated + summary.uncreated,
    deficit: total.deficit + summary.deficit,
  }), { periods: [], items: [], required: 0, created: 0, filled: 0, open: 0, uncreated: 0, deficit: 0 });
}
export const employmentLabels = { clt: 'CLT', concursado: 'Concursado (prefeitura)', pj: 'PJ' };
export const paymentFrequencyLabels = { on_delivery: 'À vista', monthly: 'Mensal' };
