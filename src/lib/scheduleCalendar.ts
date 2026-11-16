import { hasConflict, shiftInterval, type CoveragePeriodSummary } from './scheduling.ts';
import type { Shift } from '../types/index.ts';

export type ScheduleCoverageFilter = 'all' | 'deficit' | 'open' | 'conflict' | 'pending' | 'complete' | 'critical';
export type DoctorScheduleWarning = { warning: boolean; blocked: boolean };

// Compare only assignments for the same doctor, including shifts in other units/days.
export function scheduleConflictIds(shifts: Shift[]) {
  const byDoctor = new Map<string, Shift[]>();
  for (const shift of shifts) {
    if (!shift.doctorId || shift.status === 'cancelled') continue;
    const items = byDoctor.get(shift.doctorId) || [];
    items.push(shift);
    byDoctor.set(shift.doctorId, items);
  }
  const conflicts = new Set<string>();
  for (const items of byDoctor.values()) {
    for (const shift of items) if (hasConflict(shift, items)) conflicts.add(shift.id);
  }
  return conflicts;
}

export function assignmentConfirmation(status: Shift['status']) {
  if (status === 'confirmed') return { label: 'Confirmado', tone: 'success' as const };
  if (status === 'completed') return { label: 'Concluído', tone: 'success' as const };
  if (status === 'pending') return { label: 'Aguardando confirmação', tone: 'warning' as const };
  return { label: 'Confirmação não definida', tone: 'neutral' as const };
}

export function isCriticalCoverage(period: CoveragePeriodSummary, day: string, conflicts: Set<string>, warnings: Map<string, DoctorScheduleWarning>, now: number) {
  if (period.assigned.some(shift => conflicts.has(shift.id) || warnings.get(shift.doctorId || '')?.blocked)) return true;
  const start = shiftInterval({ date: day, startTime: period.period.startTime, endTime: period.period.endTime }).start;
  return period.deficit > 0 && start >= now && start <= now + 86_400_000;
}
