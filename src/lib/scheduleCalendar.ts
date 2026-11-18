import { hasConflict, shiftInterval, type CoveragePeriodSummary } from './scheduling.ts';
import type { Doctor, Sector, Shift, Unit } from '../types/index.ts';

export type ScheduleCoverageFilter = 'all' | 'deficit' | 'open' | 'conflict' | 'pending' | 'complete' | 'critical';
export type DoctorScheduleWarning = { warning: boolean; blocked: boolean };

export function selectedScheduleSector(unitId: string, sectorId: string, units: Unit[], sectors: Sector[]) {
  const unit = units.find(item => item.id === unitId && item.status === 'active');
  return unit && sectors.find(item => item.id === sectorId && item.unitId === unit.id
    && item.organizationId === unit.organizationId && item.status === 'active');
}

export type ScheduleAllocation = {
  id: string;
  name: string;
  vacant: boolean;
  vacancyState?: 'available' | 'unpublished' | 'planned';
  sectorName?: string;
  kind: CoveragePeriodSummary['period']['kind'];
  startTime: string;
  endTime: string;
};

// Both calendar views use the existing coverage summary; administrative state stays in the inspector.
export function scheduleAllocations(period: CoveragePeriodSummary, doctors: Map<string, Pick<Doctor, 'name'>>, availableVacancyIds: ReadonlySet<string> = new Set()): ScheduleAllocation[] {
  const time = { kind: period.period.kind, startTime: period.period.startTime, endTime: period.period.endTime };
  return [
    ...period.assigned.map(shift => ({ ...time, startTime: shift.startTime, endTime: shift.endTime,
      id: shift.id, name: doctors.get(shift.doctorId || '')?.name || 'Médico escalado', vacant: false })),
    ...period.vacancies.map(shift => ({ ...time, startTime: shift.startTime, endTime: shift.endTime,
      id: shift.id, name: availableVacancyIds.has(shift.id) ? 'Vaga aberta' : 'Posto sem médico', vacant: true, vacancyState: availableVacancyIds.has(shift.id) ? 'available' as const : 'unpublished' as const })),
    ...Array.from({ length: period.uncreated }, (_, index) => ({ ...time,
      id: `uncreated-${time.kind}-${index}`, name: 'Posto previsto por criar', vacant: true, vacancyState: 'planned' as const })),
  ].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.id.localeCompare(b.id));
}

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
