import { documentIsCritical, getDoctorCompliance } from './documentCompliance.ts';
import { applicableDocuments } from './documentGovernance.ts';
import { getDoctorOperationalUnitIds } from './doctorUnits.ts';
import { financeState } from './financeState.ts';
import { localDate, shiftTouchesDay, summarizeSectorCoverage } from './scheduling.ts';
import type { Doctor, DocumentRequirement, MedicalDocument, Sector, Shift } from '../types/index.ts';

export function shiftScheduleHref(shift: Pick<Shift, 'date' | 'id'>) {
  return '/escala?' + new URLSearchParams({ date: shift.date, shiftId: shift.id }) + '#plantao';
}

export type DashboardPeriod = 'today' | 'tomorrow' | 'week' | 'month';

function dayOffset(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return localDate(date);
}

export function moveDashboardMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00`);
  date.setMonth(date.getMonth() + offset);
  return localDate(date).slice(0, 7);
}

export function dashboardRange(today: string, period: DashboardPeriod, month = today.slice(0, 7)) {
  if (period === 'month') {
    const start = `${month}-01`;
    const end = dayOffset(`${moveDashboardMonth(month, 1)}-01`, -1);
    return { start, end, length: Number(end.slice(-2)) };
  }
  const start = period === 'tomorrow' ? dayOffset(today, 1) : today;
  const length = period === 'week' ? 7 : 1;
  return { start, end: dayOffset(start, length - 1), length };
}

export function dashboardShiftMatches(
  shift: Shift, unitId: string, specialty: string, doctors: ReadonlyMap<string, Doctor>, sectors: ReadonlyMap<string, Sector>,
) {
  if (unitId && shift.unitId !== unitId) return false;
  if (!specialty) return true;
  const sector = sectors.get(shift.sectorId || '');
  return specialty === (shift.specialty || doctors.get(shift.doctorId || '')?.specialty || (sector?.specialties.length === 1 ? sector.specialties[0] : undefined));
}

export function dashboardAgenda(shifts: Shift[], start: string, end: string, includeOvernight: boolean) {
  return shifts.filter(shift => shift.status === 'confirmed' && shift.doctorId
    && ((shift.date >= start && shift.date <= end) || (includeOvernight && shiftTouchesDay(shift, start))))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
}

export function coverageDays(today: string, sectors: Sector[], shifts: Shift[], length: number, registeredOnly = false) {
  const shiftsByTurn = new Map<string, Shift[]>();
  const shiftsByDay = new Map<string, Shift[]>();
  const end = dayOffset(today, length - 1);
  for (const shift of shifts) {
    if (shift.status === 'cancelled' || shift.date < today || shift.date > end) continue;
    if (registeredOnly) {
      const items = shiftsByDay.get(shift.date) || [];
      items.push(shift);
      shiftsByDay.set(shift.date, items);
      continue;
    }
    const key = `${shift.date}/${shift.sectorId}`;
    const items = shiftsByTurn.get(key) || [];
    items.push(shift);
    shiftsByTurn.set(key, items);
  }

  return Array.from({ length }, (_, offset) => {
    const day = dayOffset(today, offset);
    if (registeredOnly) {
      const items = shiftsByDay.get(day) || [];
      return { day, required: items.length, deficit: items.filter(item => !item.doctorId).length };
    }
    const totals = { day, required: 0, deficit: 0 };
    for (const sector of sectors) {
      const summary = summarizeSectorCoverage(sector, shiftsByTurn.get(`${day}/${sector.id}`) || []);
      totals.required += summary.required;
      totals.deficit += summary.deficit;
    }
    return totals;
  });
}

export function coverageWeeks(days: ReturnType<typeof coverageDays>) {
  const weeks: { day: string; end: string; required: number; deficit: number }[] = [];
  for (const day of days) {
    const week = weeks.at(-1);
    if (!week || new Date(`${day.day}T12:00:00`).getDay() === 1) weeks.push({ ...day, end: day.day });
    else {
      week.end = day.day;
      week.required += day.required;
      week.deficit += day.deficit;
    }
  }
  return weeks;
}

export function doctorsWithDocumentIssues(
  doctors: Doctor[], documents: MedicalDocument[], shifts: Shift[], reference: number,
  requirements: DocumentRequirement[] | undefined, alertDays: number,
) {
  const byDoctor = new Map<string, MedicalDocument[]>();
  const shiftsByDoctor = new Map<string, Shift[]>();
  for (const document of documents) {
    const items = byDoctor.get(document.doctorId) || [];
    items.push(document);
    byDoctor.set(document.doctorId, items);
  }
  for (const shift of shifts) {
    if (!shift.doctorId) continue;
    const items = shiftsByDoctor.get(shift.doctorId) || [];
    items.push(shift);
    shiftsByDoctor.set(shift.doctorId, items);
  }
  return doctors.flatMap(doctor => {
    const linkedUnits = getDoctorOperationalUnitIds(shiftsByDoctor.get(doctor.id) || [], doctor.id);
    const context = { ...doctor, linkedUnits };
    const scopedDocuments = applicableDocuments(context, byDoctor.get(doctor.id) || [], requirements);
    const summary = getDoctorCompliance(context, scopedDocuments, reference, requirements, alertDays);
    if (!summary.pending && !summary.nearExpiry) return [];
    const expired = scopedDocuments.filter(document => document.status === 'expired'
      || (document.status === 'approved' && documentIsCritical(document, reference))).length;
    return [{ doctor, linkedUnits, expired, ...summary }];
  }).sort((a, b) => b.critical - a.critical || b.pending - a.pending || a.doctor.name.localeCompare(b.doctor.name, 'pt-BR'));
}

export function dashboardPayments(shifts: Shift[], today: string) {
  const assigned = shifts.filter(shift => shift.employmentType === 'pj' && shift.doctorId && shift.paymentAmount != null && shift.status !== 'cancelled');
  const unpaid = assigned.filter(shift => shift.paymentStatus !== 'paid');
  const amount = (items: Shift[]) => items.reduce((total, shift) => total + (shift.paymentAmount || 0), 0);
  const onDelivery = unpaid.filter(shift => (shift.paymentFrequency || 'on_delivery') === 'on_delivery');
  const upcoming = new Map<string, number>();
  for (const shift of unpaid) {
    if (!shift.paymentDueDate || shift.paymentDueDate < today) continue;
    upcoming.set(shift.paymentDueDate, (upcoming.get(shift.paymentDueDate) || 0) + (shift.paymentAmount || 0));
  }
  const month = today.slice(0, 7);
  return {
    pending: amount(unpaid),
    overdue: amount(unpaid.filter(shift => financeState(shift, today) === 'overdue')),
    onDelivery: { count: onDelivery.length, amount: amount(onDelivery) },
    paidThisMonth: assigned.filter(shift => shift.paymentStatus === 'paid' && shift.date.startsWith(month)).length,
    nextDue: [...upcoming.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 2),
  };
}
