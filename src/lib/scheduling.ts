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
export const employmentLabels = { clt: 'CLT', concursado: 'Concursado (prefeitura)', pj: 'PJ' };
export const paymentFrequencyLabels = { on_delivery: 'À vista', monthly: 'Mensal' };
