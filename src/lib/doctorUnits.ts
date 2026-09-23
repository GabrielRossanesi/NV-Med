import type { Shift } from '@/types';

export function getDoctorOperationalUnitIds(shifts: Shift[], doctorId: string) {
  return [...new Set(shifts
    .filter(shift => shift.doctorId === doctorId && shift.status !== 'cancelled')
    .map(shift => shift.unitId))];
}

export function doctorHasOperationalUnit(shifts: Shift[], doctorId: string, unitId: string) {
  return !unitId || shifts.some(shift => shift.doctorId === doctorId && shift.unitId === unitId && shift.status !== 'cancelled');
}
