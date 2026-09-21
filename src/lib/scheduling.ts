import type { Shift } from '../types/index.ts';
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
export const employmentLabels = { clt: 'CLT', concursado: 'Concursado (prefeitura)', pj: 'PJ' };
export const paymentFrequencyLabels = { on_delivery: 'À vista', monthly: 'Mensal' };
