import { localDate, shiftInterval } from './scheduling.ts';

export interface MasterDefinition {
  coverage_plan?: { start_time: string; end_time: string; capacity: number };
  doctor_id: string; unit_id: string; sector_id: string; specialty: string;
  start_time: string; end_time: string; start_date: string; anchor_date: string; end_date: string | null;
  frequency: 'weeks' | 'monthly'; interval_weeks: number; weekdays: number[];
  employment_type: 'clt' | 'pj' | 'concursado'; employer_name: string | null;
  type: 'onsite' | 'oncall' | 'telemedicine';
}
export interface MasterRule {
  id: string; organization_id: string; definition: MasterDefinition; status: 'active' | 'suspended' | 'ended';
  horizon_months: number; revision: number; finance?: Record<string, unknown> | null; effective_from: string;
}
export interface DoctorAbsence {
  id: string; organization_id: string; doctor_id: string;
  kind: 'vacation' | 'leave' | 'license' | 'unavailable' | 'other';
  start_date: string; end_date: string; start_time: string | null; end_time: string | null;
  note: string | null; status: 'scheduled' | 'active' | 'ended' | 'cancelled'; revision: number;
}
export interface AbsenceImpact {
  shift_id: string | null; rule_id: string | null; date: string; start_time: string; end_time: string;
  doctor_id: string | null; action: 'open' | 'preserve' | 'protected' | 'planned' | 'restore';
}
export interface MasterOverview {
  rules: MasterRule[]; absences: DoctorAbsence[];
  occurrences: { rule_id: string; date: string; shift_id: string | null; state: string; issue: string | null; published: boolean }[];
  audit: { id: number; action: string; entity_id: string; created_at: string }[];
  affected: { absence_id: string; shift_id: string; date: string; unit_id: string; sector_id: string | null; state: string; published: boolean }[];
  cron_enabled: boolean;
}
export interface MasterShiftContext {
  shift_id: string; rule_id: string | null; original_doctor_id: string | null; original_doctor_name: string | null;
  unit_id: string | null; sector_id: string | null;
  state: string; coverage: boolean; history: { action: string; created_at: string }[];
}
export const absenceKindLabels = { vacation: 'Férias', leave: 'Afastamento', license: 'Licença', unavailable: 'Indisponibilidade', other: 'Outro' };
export const absenceStatusLabels = { scheduled: 'Programada', active: 'Ativa', ended: 'Encerrada', cancelled: 'Cancelada' };
export const masterStatusLabels = { active: 'Ativa', suspended: 'Suspensa', ended: 'Encerrada' };
const dayMs = 86_400_000;
function ordinalDay(value: string) { return Math.floor(Date.parse(`${value}T12:00:00Z`) / dayMs); }

export function masterDates(rule: MasterDefinition, from: string, until: string) {
  if (!rule.weekdays.length || rule.interval_weeks < 1 || rule.interval_weeks > 52) return [];
  const anchor = new Date(`${rule.anchor_date}T12:00:00Z`);
  const anchorOrdinal = Math.floor((anchor.getUTCDate() - 1) / 7);
  const anchorWeek = ordinalDay(rule.anchor_date) - (anchor.getUTCDay() + 6) % 7;
  const start = Math.max(ordinalDay(from), ordinalDay(rule.start_date), ordinalDay(rule.anchor_date));
  const end = Math.min(ordinalDay(until), rule.end_date ? ordinalDay(rule.end_date) : Infinity);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start > 730) return [];
  const result: string[] = [];
  for (let current = start; current <= end; current++) {
    const date = new Date(current * dayMs + 12 * 3_600_000);
    if (!rule.weekdays.includes(date.getUTCDay())) continue;
    const matches = rule.frequency === 'monthly'
      ? Math.floor((date.getUTCDate() - 1) / 7) === anchorOrdinal
      : Math.floor((current - anchorWeek) / 7) % rule.interval_weeks === 0;
    if (matches) result.push(date.toISOString().slice(0, 10));
  }
  return result;
}

export function absenceOverlaps(absence: Pick<DoctorAbsence, 'start_date' | 'end_date' | 'start_time' | 'end_time' | 'status'>, shift: { date: string; startTime: string; endTime: string }) {
  if (absence.status === 'cancelled') return false;
  const interval = shiftInterval(shift);
  if (!absence.start_time || !absence.end_time) {
    const end = new Date(`${absence.end_date}T00:00:00`); end.setDate(end.getDate() + 1);
    return interval.start < end.getTime() && interval.end > new Date(`${absence.start_date}T00:00:00`).getTime();
  }
  const previous = new Date(`${shift.date}T12:00:00`); previous.setDate(previous.getDate() - 1);
  for (let index = 0; index < 3; index++) {
    const day = localDate(previous);
    if (day >= absence.start_date && day <= absence.end_date) {
      const window = shiftInterval({ date: day, startTime: absence.start_time, endTime: absence.end_time });
      if (interval.start < window.end && interval.end > window.start) return true;
    }
    previous.setDate(previous.getDate() + 1);
  }
  return false;
}
