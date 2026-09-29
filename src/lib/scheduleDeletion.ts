import { coverageKindForShift, sectorCoveragePeriods } from './scheduling.ts';
import type { CoveragePeriodKind, Sector, Shift } from '@/types';

export type ScheduleDeletionScope = 'shift' | 'turn' | 'period' | 'doctor';

export interface ScheduleDeletionSelection {
  scope: ScheduleDeletionScope;
  from: string;
  to: string;
  unitId: string;
  sectorId: string;
  kind: CoveragePeriodKind | '';
  doctorId: string;
  shiftId: string;
}

export function getScheduleDeletionTargets(
  shifts: Shift[],
  sectors: Sector[],
  organizationId: string,
  selection: ScheduleDeletionSelection,
): Shift[] {
  if (!organizationId) return [];
  if (selection.scope === 'shift') {
    return shifts.filter(shift => shift.organizationId === organizationId && shift.id === selection.shiftId);
  }
  if (!selection.from || !selection.to || selection.from > selection.to) return [];
  if (selection.scope === 'turn' && (!selection.sectorId || !selection.kind || selection.from !== selection.to)) return [];
  if (selection.scope === 'doctor' && !selection.doctorId) return [];

  const sectorById = new Map(sectors.map(sector => [sector.id, sector]));
  return shifts.filter(shift => {
    if (shift.organizationId !== organizationId || shift.date < selection.from || shift.date > selection.to) return false;
    if (selection.unitId && shift.unitId !== selection.unitId) return false;
    if (selection.sectorId && shift.sectorId !== selection.sectorId) return false;
    if (selection.scope === 'doctor') return shift.doctorId === selection.doctorId;
    if (selection.scope === 'turn') {
      const sector = sectorById.get(shift.sectorId || '');
      return Boolean(sector && coverageKindForShift(shift, sectorCoveragePeriods(sector)) === selection.kind);
    }
    return true;
  });
}

export function vacateShift(shift: Shift): Shift {
  return {
    ...shift,
    doctorId: undefined,
    employmentType: undefined,
    employerName: undefined,
    paymentAmount: 0,
    paymentStatus: 'pending',
    paymentFrequency: 'on_delivery',
    paidAt: undefined,
    status: 'open',
  };
}
