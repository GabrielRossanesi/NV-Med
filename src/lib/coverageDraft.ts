import type { CoveragePlan, Shift } from '../types/index.ts';
import { calculateFractionalCoverage, coveragePlanInterval, type CoverageSpan } from './fractionalCoverage.ts';

export interface CoverageDraftSegment extends CoverageSpan {
  key: string;
  shift?: Shift;
}

export function coverageClock(at: number, timeZone: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

export function coverageLocalDate(at: number, timeZone: string) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function coverageDraftInterval(startTime: string, endTime: string, limits: CoverageSpan, timeZone: string) {
  const first = coverageLocalDate(limits.start, timeZone);
  const last = coverageLocalDate(limits.end - 1, timeZone);
  return [...new Set([first, last])].flatMap(date => {
    const span = coveragePlanInterval({ date, startTime, endTime }, timeZone);
    return span && span.start >= limits.start && span.end <= limits.end ? [{ ...span, date, startTime, endTime }] : [];
  })[0];
}

export function editCoverageSegment(planned: CoveragePlan, timeZone: string, shifts: Shift[]) {
  const span = coveragePlanInterval(planned, timeZone);
  if (!span) return null;
  const allocations: CoverageDraftSegment[] = [];
  const vacancies: CoverageDraftSegment[] = [];
  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const span = coveragePlanInterval(shift, timeZone);
    if (span) (shift.doctorId ? allocations : vacancies).push({ ...span, key: shift.id, shift });
  }
  const totals = calculateFractionalCoverage(span, planned.capacity, allocations);
  if (!totals) return null;
  const gaps = totals.gaps.map<CoverageDraftSegment>((gap, index) => {
    const existing = vacancies.findIndex(item => item.start <= gap.start && item.end >= gap.end);
    return existing === -1 ? { ...gap, key: `gap-${gap.start}-${gap.end}-${index}` }
      : { ...gap, key: vacancies[existing].key, shift: vacancies.splice(existing, 1)[0].shift };
  });
  return { span, totals, segments: [...allocations, ...gaps].sort((a, b) => a.start - b.start || a.end - b.end) };
}

export function mergeCoverageDraft<T extends Shift>(original: Shift[], edits: T[]) {
  const editedIds = new Set(edits.map(item => item.id));
  return [...original.filter(item => !editedIds.has(item.id)), ...edits];
}

export function coverageAssignmentChanged(before: Shift | undefined, after: Shift) {
  return !before || before.doctorId !== after.doctorId || before.date !== after.date || before.startTime !== after.startTime
    || before.endTime !== after.endTime || before.status !== after.status;
}
