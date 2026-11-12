'use client';

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowRightLeft, ChevronLeft, ChevronRight, Clock3, Copy, List, LoaderCircle, Moon, Plus, Repeat2, Sun, Trash2, UserRoundPlus, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import EmploymentBadge from '@/components/schedule/EmploymentBadge';
import ScheduleCalendarView from '@/components/schedule/ScheduleCalendarView';
import MobileScheduleMonth, { type MobileDay } from '@/components/schedule/MobileScheduleMonth';
import ScheduleDoctorView from '@/components/schedule/ScheduleDoctorView';
import ScheduleSpecialtyView from '@/components/schedule/ScheduleSpecialtyView';
import SectorEditorDialog from '@/components/schedule/SectorEditorDialog';
import { reconcileShiftDoctor, scopedSpecialties, selectShiftSector } from '@/lib/sectorSpecialties';
import { moveScheduleMonth } from '@/lib/scheduleMonth';
import ScheduleDeleteDialog from '@/components/schedule/ScheduleDeleteDialog';
import ShiftSelectionPanel from '@/components/schedule/ShiftSelectionPanel';
import PresencePanel from '@/components/schedule/PresencePanel';
import { ShiftAgreementFields, ShiftFinancialDetails, ShiftPaymentHistory, useShiftRates } from '@/components/schedule/ShiftFinancialDetails';
import ShiftRecordSummary, { shiftRecordStatusLabels as statusLabels } from '@/components/schedule/ShiftRecordSummary';
import { createClient } from '@/lib/supabase/client';
import { fetchInitialDataFromSupabase, fetchShiftRates } from '@/services/supabaseService';
import type { ScheduleDeletionScope, ScheduleDeletionSelection } from '@/lib/scheduleDeletion';
import { buildRecurringDates, copyableRegularShifts, coverageKindForShift, coveragePeriodLabel, employmentLabels, hasConflict, localDate, paymentFrequencyLabels, sectorCoveragePeriods, statusAfterDoctorSelection, summarizeSectorCoverage, type ShiftRecurrence } from '@/lib/scheduling';
import { buildAgreementSelection, buildRequiredPjAgreement, chooseShiftRate, formatShiftMoney, formatShiftMoneyInput, initialAgreementDraft, sectorFinanceDefaults, shiftTypeLabels as typeLabels } from '@/lib/shiftPricing';
import { canEditPermission, canPerformAction, canViewPermission } from '@/lib/permissions';
import { doctorScheduleCompliance } from '@/lib/documentGovernance';
import { useStore } from '@/store/useStore';
import type { CoveragePeriodKind, Doctor, EmploymentType, Sector, Shift, ShiftWrite, Unit } from '@/types';

type ViewMode = 'week' | 'month' | 'doctor' | 'specialty' | 'list';
type CoverageFilter = 'all' | 'deficit' | 'open' | 'conflict' | 'pending' | 'complete';
const mobileViewKey = 'nvmed:mobile-schedule-view';
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
function readMobileView() {
  try { return window.localStorage.getItem(mobileViewKey) === 'list' ? 'list' : 'month'; } catch { return 'month'; }
}

function addDays(value: string, amount: number) { const date = new Date(value + 'T12:00:00'); date.setDate(date.getDate() + amount); return localDate(date); }
function endOfMonth(value: string) { const day = new Date(value + 'T12:00:00'); return localDate(new Date(day.getFullYear(), day.getMonth() + 1, 0, 12)); }
function mondayOf(value: string) { const date = new Date(value + 'T12:00:00'); const distance = (date.getDay() + 6) % 7; date.setDate(date.getDate() - distance); return localDate(date); }
function formatDay(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''); }
function recurrenceDescription(startDate: string, recurrence: ShiftRecurrence) {
  const date = new Date(startDate + 'T12:00:00');
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
  if (recurrence === 'daily') return 'todos os dias';
  if (recurrence === 'weekdays') return 'de segunda a sexta';
  if (recurrence === 'every_other_day') return 'a cada 48 horas (12x36)';
  if (recurrence === 'custom') return 'nos dias selecionados';
  if (recurrence === 'weekly') return `toda ${weekday}`;
  if (recurrence === 'fortnightly') return `a cada 2 semanas, às ${weekday}s`;
  const ordinal = Math.floor((date.getDate() - 1) / 7) + 1;
  return `na ${ordinal}ª ${weekday} de cada mês`;
}
function toNewShift(shift: ShiftWrite): Omit<ShiftWrite, 'id' | 'organizationId'> {
  return { coverageMode: shift.coverageMode || 'regular', coverageReason: shift.coverageReason, sectorId: shift.sectorId, sector: shift.sector, specialty: shift.specialty, employmentType: shift.employmentType, employerName: shift.employerName, paymentAmount: shift.paymentAmount, paymentStatus: shift.paymentStatus, paymentFrequency: shift.paymentFrequency, paidAt: shift.paidAt, agreement: shift.agreement, doctorId: shift.doctorId, unitId: shift.unitId, date: shift.date, startTime: shift.startTime, endTime: shift.endTime, type: shift.type, status: shift.status, notes: shift.notes };
}

function ScheduleList({ days, shifts, units, sectors, doctors, doctorWarnings, onEdit, onDelete, compact = false }: { days: string[]; shifts: Shift[]; units: Unit[]; sectors: Sector[]; doctors: Doctor[]; doctorWarnings: Map<string, { warning: boolean; blocked: boolean }>; onEdit: (shift: Shift) => void; onDelete?: (shift: Shift) => void; compact?: boolean }) {
  if (compact) return shifts.length ? <div className="divide-y divide-border rounded-xl border border-border bg-card-bg">
    {shifts.map(item => {
      const doctor = doctors.find(value => value.id === item.doctorId);
      const sector = sectors.find(value => value.id === item.sectorId);
      const unit = units.find(value => value.id === item.unitId);
      const status = item.exchangeRequested ? 'Troca solicitada' : statusLabels[item.status];
      return <button key={item.id} type="button" onClick={() => onEdit(item)} className="flex min-h-16 w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left hover:bg-state-hover">
        <span className="shrink-0 text-xs font-semibold tabular-nums">{item.startTime}–{item.endTime}</span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold">{doctor?.name || (item.doctorId ? 'Médico escalado' : 'Vaga aberta')}</span>
          <span className="block break-words text-xs text-text-muted">{[unit?.name, sector?.name || item.sector, item.specialty].filter(Boolean).join(' · ')}</span>
          <span className="mt-0.5 inline-block"><EmploymentBadge employment={item.employmentType} provisional={!item.doctorId}/></span>
          {item.status !== 'open' && <span className="block text-xs font-medium text-primary">{status}</span>}
        </span><ChevronRight size={15} className="shrink-0 text-text-muted" aria-hidden="true"/>
      </button>;
    })}
  </div> : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">Nenhum plantão neste dia com os filtros selecionados.</p>;
  if (!days.length) return <div className="rounded-xl border border-dashed border-border py-16 text-center"><List className="mx-auto h-6 w-6 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum plantão individual neste período</p><p className="mt-1 text-xs text-text-muted">Crie um posto ou plantão avulso para as datas solicitadas.</p></div>;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold">Plantões individuais</h2><p className="mt-1 text-xs text-text-muted">Cada linha representa um posto salvo. Use a ação para preencher uma vaga ou substituir o médico.</p></div><span className="text-xs font-medium text-text-muted">{shifts.length} {shifts.length === 1 ? 'plantão criado' : 'plantões criados'}</span></div>
    <div className="@container overflow-hidden rounded-xl border border-border bg-card-bg">
      <div className="hidden grid-cols-[105px_110px_minmax(180px,1fr)_minmax(180px,1fr)_100px_125px_150px] gap-3 border-b border-border bg-surface-muted/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted @min-[68rem]:grid"><span>Plantão</span><span>Horário</span><span>Unidade · setor</span><span>Médico</span><span>Vínculo</span><span>Situação</span><span>Ação</span></div>
      {days.map(day => { const dayItems = shifts.filter(item => item.date === day); const assigned = dayItems.filter(item => item.doctorId).length; const vacancies = dayItems.length - assigned; return <section key={day} className="border-b border-border last:border-0">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-muted/25 px-4 py-3"><div><p className="text-sm font-semibold capitalize text-text-primary">{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p><p className="mt-0.5 text-[11px] text-text-muted">{dayItems.length} {dayItems.length === 1 ? 'plantão individual' : 'plantões individuais'}</p></div><div className="flex items-center gap-3 text-xs"><span className="flex items-center gap-1.5 text-success"><Users size={14}/>{assigned} escalado{assigned === 1 ? '' : 's'}</span>{vacancies > 0 && <span className="flex items-center gap-1.5 font-medium text-warning"><AlertTriangle size={14}/>{vacancies} {vacancies === 1 ? 'vaga aberta' : 'vagas abertas'}</span>}</div></div>
        <div className="divide-y divide-border">{dayItems.map(item => {
          const unit = units.find(value => value.id === item.unitId);
          const sector = sectors.find(value => value.id === item.sectorId);
          const doctor = doctors.find(value => value.id === item.doctorId);
          const peers = dayItems.filter(value => value.sectorId === item.sectorId && value.startTime === item.startTime && value.endTime === item.endTime);
          const sequence = peers.findIndex(value => value.id === item.id) + 1;
          const kind: CoveragePeriodKind = item.startTime >= '18:00' || item.startTime < '06:00' ? 'night' : 'day';
          const PeriodIcon = kind === 'day' ? Sun : Moon;
          const warning = doctor ? doctorWarnings.get(doctor.id) : undefined;
          return <div key={item.id} className="grid gap-3 px-4 py-4 transition hover:bg-state-hover @min-[68rem]:grid-cols-[105px_110px_minmax(180px,1fr)_minmax(180px,1fr)_100px_125px_150px] @min-[68rem]:items-center">
            <span className="flex items-center gap-2"><PeriodIcon size={14} className={kind === 'day' ? 'text-warning' : 'text-primary'}/><span><strong className="block text-xs text-text-primary">{item.coverageMode === 'adhoc' ? 'Avulso' : 'Plantão'} {String(sequence).padStart(2, '0')}</strong><span className="text-[10px] text-text-muted">{coveragePeriodLabel(kind)}</span></span></span>
            <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-text-secondary"><Clock3 size={13}/>{item.startTime}–{item.endTime}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-text-primary">{unit?.name || 'Unidade'}</span><span className="mt-0.5 block truncate text-xs text-text-muted">{sector?.name || item.sector || 'Setor'}{item.specialty ? ` · ${item.specialty}` : ''}</span>{item.coverageMode === 'adhoc' && <span className="mt-1 block text-xs text-primary">{item.coverageReason}</span>}</span>
            <span className={`flex min-w-0 items-center gap-1.5 truncate text-sm font-medium ${doctor ? 'text-text-primary' : 'text-warning'}`}>{doctor?.name || 'Vaga aberta'}{warning?.warning && <AlertTriangle size={13} className={warning.blocked ? 'shrink-0 text-danger' : 'shrink-0 text-warning'} aria-label="Pendência documental"/>}</span>
            <span><EmploymentBadge employment={item.employmentType} provisional={!item.doctorId}/></span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${item.exchangeRequested || item.status === 'pending' ? 'text-warning' : item.status === 'open' ? 'text-danger' : item.status === 'confirmed' ? 'text-success' : 'text-text-secondary'}`}>{item.exchangeRequested && <Repeat2 size={13}/>}
              {item.exchangeRequested ? 'Troca solicitada' : statusLabels[item.status]}</span>
            <span className="flex items-center gap-1"><button type="button" onClick={() => onEdit(item)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-xs font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/5">{doctor ? <ArrowRightLeft size={13}/> : <UserRoundPlus size={13}/>} {item.status === 'cancelled' ? 'Ver detalhes' : doctor ? 'Ver ficha' : 'Preencher'}</button>{onDelete && <button type="button" aria-label={`Excluir plantão ${sequence} de ${formatDay(day)}`} title="Excluir plantão" onClick={() => onDelete(item)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-danger/5 hover:text-danger"><Trash2 size={15}/></button>}</span>
          </div>;
        })}</div>
      </section>; })}
    </div>
  </section>;
}

function Schedule({ params }: { params: URLSearchParams }) {
  const store = useStore();
  const today = localDate();
  const requestedShiftId = params.get('shiftId');
  const requestedCoverage = params.get('coverage');
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date')! : today;
  const [date, setDate] = useState(initialDate);
  const [desktopView, setView] = useState<ViewMode>(requestedShiftId ? 'list' : params.get('view') === 'month' ? 'month' : 'week');
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia('(max-width: 767px)').matches, () => false);
  const savedMobileView = useSyncExternalStore(() => () => {}, readMobileView, () => 'month' as const);
  const [mobileChoice, setMobileChoice] = useState<'month' | 'list'>();
  const mobileView = mobileChoice ?? (requestedShiftId ? 'list' : savedMobileView);
  function changeMobileView(next: 'month' | 'list') {
    setMobileChoice(next);
    try { window.localStorage.setItem(mobileViewKey, next); } catch { /* Preference remains active on this page. */ }
  }
  const [unitId, setUnitId] = useState(params.get('unitId') || '');
  const [sectorId, setSectorId] = useState(params.get('sectorId') || '');
  const requestedEmployment = params.get('contratacao');
  const [employment, setEmployment] = useState<EmploymentType | ''>(requestedEmployment && Object.hasOwn(employmentLabels, requestedEmployment) ? requestedEmployment as EmploymentType : '');
  const [specialty, setSpecialty] = useState(params.get('specialty') || '');
  const [doctorId, setDoctorId] = useState('');
  const [periodKind, setPeriodKind] = useState<CoveragePeriodKind | ''>('');
  const [documentFilter, setDocumentFilter] = useState<'all' | 'regular' | 'pending'>('all');
  const [coverageModeFilter, setCoverageModeFilter] = useState<'all' | 'regular' | 'adhoc'>('all');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>(requestedCoverage === 'deficit' ? 'deficit' : 'all');
  const [statusFilter, setStatusFilter] = useState<Shift['status'] | 'all' | 'exchange'>('all');
  const view = mobile ? (mobileView === 'month' ? 'month' : requestedShiftId || statusFilter === 'cancelled' ? 'list' : 'week') : desktopView;
  const [form, setForm] = useState<Shift | null>(null);
  const [sectorEditorOpen, setSectorEditorOpen] = useState(false);
  const [sectorNotice, setSectorNotice] = useState('');
  const [openedShift, setOpenedShift] = useState<Shift>();
  const [agreementDraft, setAgreementDraft] = useState(() => initialAgreementDraft());
  const [eligibility, setEligibility] = useState<{ key: string; ids: string[]; error?: string }>();
  const [eligibilityRevision, setEligibilityRevision] = useState(0);
  const [exchangeState, setExchangeState] = useState<{ organization: string; ids: Set<string> } | null>(null);
  const [selectionShift, setSelectionShift] = useState<Shift | null>(null);
  const [opportunityRevision, setOpportunityRevision] = useState(0);
  const [vacancyCount, setVacancyCount] = useState(1);
  const [coverageKind, setCoverageKind] = useState<CoveragePeriodKind>('day');
  const [recurrence, setRecurrence] = useState<ShiftRecurrence>('once');
  const [customWeekdays, setCustomWeekdays] = useState<number[]>([]);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const [focusedTurn, setFocusedTurn] = useState<{ day: string; sectorId: string; kind: CoveragePeriodKind; nonce: number } | null>(null);
  const [referenceTime] = useState(Date.now);
  const [weekPreview, setWeekPreview] = useState<{ clones: Shift[]; sectors: number; turns: number; range: string; blocked: number; duplicates: number; conflicts: number } | null>(null);
  const [recurringPreview, setRecurringPreview] = useState<{ inputs: Omit<ShiftWrite, 'id' | 'organizationId'>[]; dates: string[]; countPerDate: number; cents?: number } | null>(null);
  const [recurringError, setRecurringError] = useState('');
  const [deleteRequest, setDeleteRequest] = useState<ScheduleDeletionSelection | null>(null);
  const orgId = store.activeOrganizationId;
  useEffect(() => {
    const client = createClient();
    let active = true;
    if (client && orgId) void client.rpc('nv_active_exchanges', { org: orgId }).then(({ data, error }) => {
      if (active && !error) setExchangeState({ organization: orgId, ids: new Set(data as string[]) });
    });
    return () => { active = false; };
  }, [orgId, opportunityRevision]);
  const eligibilityKey = form ? JSON.stringify({ id: form.id || '__draft__', organization_id: form.organizationId,
    doctor_id: form.doctorId || null, unit_id: form.unitId, sector_id: form.sectorId || null, specialty: form.specialty || null, coverage_mode: form.coverageMode || 'regular',
    date: form.date, start_time: form.startTime, end_time: form.endTime }) : '';
  const unchangedAssignment = Boolean(form && openedShift && ['unitId','sectorId','specialty','date','startTime','endTime','doctorId'].every(
    key => form[key as keyof Shift] === openedShift[key as keyof Shift]));
  useEffect(() => {
    if (!eligibilityKey) return;
    let live = true;
    const client = createClient();
    const load = async () => {
      try {
        if (!client) throw new Error('Conexão indisponível.');
        const candidate = JSON.parse(eligibilityKey);
        const { data, error } = await client.rpc('nv_eligible_shift_doctors', { candidate });
        if (!live) return;
        if (error) throw new Error('Não foi possível consultar os médicos elegíveis. Tente novamente.');
        const ids = (data || []) as string[];
        setEligibility({ key: eligibilityKey, ids });
        if (!unchangedAssignment && candidate.doctor_id && !ids.includes(candidate.doctor_id)) {
          setSectorNotice('Médico removido da seleção: não é elegível para o setor, unidade ou horário informado.');
        }
        if (!unchangedAssignment) setForm(current => {
          if (!current) return current;
          return reconcileShiftDoctor(current, ids);
        });
      } catch (error) {
        if (live) setEligibility({ key: eligibilityKey, ids: [], error: error instanceof Error ? error.message : 'Falha na consulta.' });
      }
    };
    void load();
    return () => { live = false; };
  }, [eligibilityKey, eligibilityRevision, unchangedAssignment, store.shifts]);
  const canSeeFinancial = canViewPermission(store.currentUser, 'financeiro');
  const canEditFinancial = canEditPermission(store.currentUser, 'financeiro');
  const canEditSchedule = canEditPermission(store.currentUser, 'escala');
  const canCreateSchedule = canPerformAction(store.currentUser, 'escala', 'create');
  const canDeleteSchedule = canPerformAction(store.currentUser, 'escala', 'delete');
  const canApproveSchedule = canPerformAction(store.currentUser, 'escala', 'approve');
  const canCreateSector = canPerformAction(store.currentUser, 'unidades', 'create');
  const canSaveShift = form?.id ? canEditSchedule : canCreateSchedule;
  const newPjAgreement = form?.employmentType === 'pj' && (!openedShift || openedShift.employmentType !== 'pj'
    || Boolean(form.doctorId && form.doctorId !== openedShift.doctorId));
  const showAgreementFields = canEditFinancial && canSaveShift && form?.employmentType === 'pj' && openedShift?.paymentStatus !== 'paid';
  const rateQuery = useShiftRates(orgId, canSeeFinancial && Boolean(form));
  const units = store.units.filter(item => item.organizationId === orgId && item.status === 'active');
  const sectors = store.sectors.filter(item => item.organizationId === orgId && item.status === 'active');
  const doctors = store.doctors.filter(item => item.organizationId === orgId && item.status === 'active');
  const myDoctor = doctors.find(item => item.email.toLowerCase() === store.currentUser?.email?.toLowerCase());
  const shifts = store.shifts.filter(item => item.organizationId === orgId).map(item => ({
    ...item, exchangeRequested: exchangeState?.organization === orgId && exchangeState.ids.has(item.id),
  }));
  const activeOrganization = store.organizations.find(item => item.id === orgId);
  const organizationDocuments = store.documents.filter(item => item.organizationId === orgId);
  const doctorDocumentState = new Map(doctors.map(doctor => [doctor.id, doctorScheduleCompliance(doctor, organizationDocuments, activeOrganization)]));
  const selectedSector = sectors.find(item => item.id === sectorId);
  const visibleSectors = sectors.filter(item => (!unitId || item.unitId === unitId) && (!sectorId || item.id === sectorId)
    && (!specialty || (mobile ? specialtyChoices(item.unitId, item).includes(specialty) : item.specialties.includes(specialty))));
  const visibleDoctors = doctors.filter(item => (!unitId || item.linkedUnits.includes(unitId) || shifts.some(shift => shift.doctorId === item.id && shift.unitId === unitId)) && (!specialty || item.specialty === specialty));
  const weekStart = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const month = date.slice(0, 7);
  const firstOfMonth = new Date(month + '-01T12:00:00');
  const daysInMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();

  const shiftsBySectorDay = new Map<string, Shift[]>();
  shifts.forEach(item => { if (item.status !== 'cancelled') { const key = `${item.sectorId}:${item.date}`; const items = shiftsBySectorDay.get(key) || []; items.push(item); shiftsBySectorDay.set(key, items); } });
  const shiftsFor = (sector: Sector, day: string) => shiftsBySectorDay.get(`${sector.id}:${day}`) || [];
  const coverageFor = (sector: Sector, day: string) => summarizeSectorCoverage(sector, shiftsFor(sector, day));
  const periodDays = view === 'week' ? week : Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const matchesAdvanced = (period: ReturnType<typeof coverageFor>['periods'][number]) => (!periodKind || period.period.kind === periodKind)
    && (!doctorId || period.assigned.some(item => item.doctorId === doctorId))
    && (!employment || period.items.some(item => item.employmentType === employment))
    && (documentFilter === 'all' || period.assigned.some(item => { const warning = doctorDocumentState.get(item.doctorId || '')?.warning || false; return documentFilter === 'pending' ? warning : !warning; }));
  const periodCoverage = visibleSectors.flatMap(sector => periodDays.flatMap(day => coverageFor(sector, day).periods.filter(matchesAdvanced).map(period => ({ sector, day, period }))));
  const required = periodCoverage.reduce((sum, item) => sum + item.period.required, 0);
  const filled = periodCoverage.reduce((sum, item) => sum + item.period.required - item.period.deficit, 0);
  const deficit = periodCoverage.filter(item => item.period.deficit > 0).length;
  const open = periodCoverage.reduce((sum, item) => sum + item.period.open, 0);
  const pending = periodCoverage.reduce((sum, item) => sum + item.period.assigned.filter(shift => shift.status === 'pending').length, 0);
  const conflicts = periodCoverage.filter(item => item.period.assigned.some(shift => hasConflict(shift, shifts))).length;
  const doctorsWithDocumentsPending = new Set(periodCoverage.flatMap(item => item.period.assigned.map(shift => shift.doctorId).filter((id): id is string => typeof id === 'string' && doctorDocumentState.get(id)?.warning === true))).size;
  const soon = periodCoverage.filter(item => { const start = new Date(`${item.day}T${item.period.period.startTime}:00`).getTime(); return item.period.deficit > 0 && start >= referenceTime && start <= referenceTime + 86_400_000; }).length;
  const coveragePercent = required ? Math.min(100, Math.round(filled / required * 100)) : 0;
  const attention = periodCoverage.filter(item => item.period.deficit > 0 || item.period.assigned.some(shift => hasConflict(shift, shifts)))
    .sort((a, b) => Number(b.day >= today) - Number(a.day >= today) || a.day.localeCompare(b.day) || b.period.deficit - a.period.deficit).slice(0, 4);
  const employers = [...new Set(shifts.map(item => item.employerName).filter(Boolean))] as string[];
  const listShifts = shifts
    .filter(item => !requestedShiftId || item.id === requestedShiftId)
    .filter(item => item.date.startsWith(month) && (statusFilter === 'all' ? item.status !== 'cancelled'
      : statusFilter === (item.exchangeRequested ? 'exchange' : item.status)))
    .filter(item => coverageModeFilter === 'all' || (item.coverageMode || 'regular') === coverageModeFilter)
    .filter(item => (!unitId || item.unitId === unitId) && (!sectorId || item.sectorId === sectorId))
    .filter(item => !employment || item.employmentType === employment)
    .filter(item => (!specialty || (item.specialty ? item.specialty === specialty : sectors.find(sector => sector.id === item.sectorId)?.specialties.includes(specialty))) && (!doctorId || item.doctorId === doctorId))
    .filter(item => !periodKind || (() => { const sector = sectors.find(value => value.id === item.sectorId); return sector && coverageKindForShift(item, sectorCoveragePeriods(sector)) === periodKind; })())
    .filter(item => documentFilter === 'all' || (item.doctorId && (documentFilter === 'pending' ? doctorDocumentState.get(item.doctorId)?.warning : !doctorDocumentState.get(item.doctorId)?.warning)))
    .filter(item => {
      if (coverageFilter === 'all') return true;
      if (coverageFilter === 'open') return !item.doctorId;
      if (coverageFilter === 'pending') return item.status === 'pending';
      if (coverageFilter === 'conflict') return hasConflict(item, shifts);
      const sector = visibleSectors.find(value => value.id === item.sectorId);
      const period = sector && coverageFor(sector, item.date).periods.find(value => value.items.some(shift => shift.id === item.id));
      return Boolean(period && (coverageFilter === 'deficit' ? period.deficit > 0 : period.deficit === 0));
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || (a.sector || '').localeCompare(b.sector || ''));
  const listDays = [...new Set(listShifts.map(item => item.date))];
  const mobileDays: MobileDay[] = mobile && view === 'month' ? periodDays.map(day => {
    const items = listShifts.filter(item => item.date === day && item.status !== 'cancelled');
    const matchingPeriods = periodCoverage.filter(item => item.day === day && (coverageFilter === 'all' || coverageFilter === 'deficit'
      || (coverageFilter === 'open' && item.period.open > 0)
      || items.some(shift => item.period.items.some(candidate => candidate.id === shift.id))));
    return {
      day, open: items.filter(item => !item.doctorId && item.status === 'open').length,
      deficit: ['all', 'open'].includes(statusFilter) && coverageFilter !== 'complete' ? matchingPeriods.filter(item => item.period.deficit > 0).length : 0,
      confirmed: items.filter(item => item.status === 'confirmed').length,
      critical: items.filter(item => item.exchangeRequested || hasConflict(item, shifts) || (item.doctorId && doctorDocumentState.get(item.doctorId)?.blocked)
        || (item.status === 'pending' && new Date(item.date + 'T' + item.startTime).getTime() <= referenceTime + 86_400_000)).length,
    };
  }) : [];

  function openDelete(scope: ScheduleDeletionScope, options: Partial<ScheduleDeletionSelection> = {}) {
    if (scope === 'doctor' ? !canEditSchedule : !canDeleteSchedule) return;
    setPageError('');
    setDeleteRequest({ scope, from: view === 'week' ? week[0] : `${month}-01`, to: view === 'week' ? week[6] : `${month}-${String(daysInMonth).padStart(2, '0')}`, unitId, sectorId, kind: periodKind, doctorId, shiftId: '', ...options });
  }

  async function confirmDelete(targets: Shift[], scope: ScheduleDeletionScope): Promise<string | null> {
    const ok = scope === 'doctor' ? await store.vacateShifts(targets.map(item => item.id)) : await store.deleteShifts(targets.map(item => item.id));
    return ok ? null : useStore.getState().error || 'Não foi possível concluir a ação.';
  }

  function navigate(amount: number) { setDate(view === 'week' ? addDays(date, amount * 7) : moveScheduleMonth(date, amount)); }
  function openShift(shift?: Shift, sector = selectedSector, day = date, requestedKind?: CoveragePeriodKind, suggestedCount = 1, adhoc = false) {
    if (!shift && !canCreateSchedule) return;
    store.clearFeedback(); setSectorNotice(''); setFormError(''); setPageError(''); setVacancyCount(Math.max(1, suggestedCount)); setRecurrence('once'); setCustomWeekdays([new Date(`${day}T12:00:00`).getDay()]); setRepeatUntil(adhoc ? endOfMonth(day) : addDays(day, 90));
    const resolvedSector = shift ? sectors.find(item => item.id === shift.sectorId) : sector;
    const resolvedUnit = shift?.unitId || resolvedSector?.unitId || unitId || units[0]?.id || '';
    const periods = resolvedSector ? sectorCoveragePeriods(resolvedSector) : [];
    const period = shift ? periods.find(item => item.startTime === shift.startTime && item.endTime === shift.endTime) || periods[0] : periods.find(item => item.kind === requestedKind) || periods[0];
    setCoverageKind(period?.kind || 'day');
    setOpenedShift(shift);
    setAgreementDraft(initialAgreementDraft(shift));
    setForm(shift || { coverageMode: adhoc ? 'adhoc' : 'regular', coverageReason: '', id: '', organizationId: orgId, unitId: resolvedUnit, sectorId: resolvedSector?.id || '', sector: resolvedSector?.name || '', specialty: resolvedSector?.primarySpecialty || '', doctorId: undefined, date: day, startTime: period?.startTime || resolvedSector?.defaultStartTime || '07:00', endTime: period?.endTime || resolvedSector?.defaultEndTime || '19:00', type: 'onsite', status: 'open', paymentStatus: 'pending', paymentFrequency: 'on_delivery', notes: '' });
  }
  function specialtyChoices(id: string, sector?: Sector) {
    const unit = units.find(item => item.id === id);
    if (!unit) return [];
    const company = activeOrganization?.settings.specialties || [];
    if (!company.length && !unit.specialties.length && !sector) {
      return scopedSpecialties(sectors.filter(item => item.unitId === id).flatMap(item => item.specialties), []);
    }
    return scopedSpecialties(company, unit.specialties, sector?.specialties);
  }
  function updateFormUnit(nextUnit: string) {
    if (!form) return;
    setSectorNotice('');
    const choices = specialtyChoices(nextUnit);
    setForm({ ...form, doctorId: undefined, status: 'open', unitId: nextUnit,
      sectorId: '', sector: '', specialty: choices.includes(form.specialty || '') ? form.specialty : choices.length === 1 ? choices[0] : '' });
  }
  function updateFormSector(nextSectorId: string) {
    if (!form) return;
    const sector = sectors.find(item => item.id === nextSectorId && item.unitId === form.unitId);
    const next = selectShiftSector(form, sector);
    setSectorNotice(form.doctorId ? 'A elegibilidade do médico será revalidada para o setor selecionado.' : '');
    setForm(next);
  }

  function updateFormSpecialty(next: string) {
    if (!form) return;
    const sector = sectors.find(item => item.id === form.sectorId);
    const compatible = sector && (!next || specialtyChoices(form.unitId, sector).includes(next));
    setForm({ ...form, specialty: next, sectorId: compatible ? sector.id : '', sector: compatible ? sector.name : '',
      doctorId: undefined, status: 'open' });
  }
  function selectCreatedSector(sector: Sector) {
    setForm(current => {
      if (!current || current.unitId !== sector.unitId || current.organizationId !== sector.organizationId) return current;
      const selected = sector.primarySpecialty || '';
      return { ...current, sectorId: sector.id, sector: sector.name, specialty: selected };
    });
    setSectorEditorOpen(false);
    if (canSeeFinancial) rateQuery.reload();
    setSectorNotice('Setor criado e selecionado. Revise a cobertura antes de salvar o plantão.');
  }
  function chooseCoverage(kind: CoveragePeriodKind) {
    if (!form) return;
    const sector = sectors.find(item => item.id === form.sectorId);
    const period = sector && sectorCoveragePeriods(sector).find(item => item.kind === kind);
    if (period) { setCoverageKind(kind); setForm({ ...form, startTime: period.startTime, endTime: period.endTime }); }
  }
  function updateDoctor(nextDoctorId: string) {
    if (!form) return;
    if ((form.doctorId || '') === nextDoctorId) return;
    if (!nextDoctorId) {
      setForm({ ...form, doctorId: undefined, employerName: '', status: 'open' });
      return;
    }
    setAgreementDraft(initialAgreementDraft());
    setForm({ ...form, doctorId: nextDoctorId, employmentType: undefined, employerName: '',
      status: statusAfterDoctorSelection(form.status, form.doctorId, nextDoctorId) });
  }
  function changeEmployment(employmentType: EmploymentType | undefined) {
    if (!form) return;
    const sameAgreement = employmentType === 'pj' && openedShift?.employmentType === 'pj' && openedShift.doctorId === form.doctorId;
    setAgreementDraft(initialAgreementDraft(sameAgreement ? openedShift : undefined));
    setForm({ ...form, employmentType, employerName: '' });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!form || !canSaveShift || store.saving) return;
    setFormError('');
    const sector = sectors.find(item => item.id === form.sectorId && item.unitId === form.unitId);
    if (!sector && !(form.coverageMode === 'adhoc' && !form.sectorId)) return setFormError('Selecione um setor válido desta unidade.');
    if (!form.id && sector && !sector.primarySpecialty) return setFormError('Configure a especialidade principal do setor antes de criar novos plantões.');
    const choices = specialtyChoices(form.unitId, sector);
    const unchangedScope = openedShift?.unitId === form.unitId && openedShift?.sectorId === form.sectorId && openedShift?.specialty === form.specialty;
    if (!unchangedScope && ((form.specialty && !choices.includes(form.specialty))
      || ((form.coverageMode === 'adhoc' || choices.length > 0) && !form.specialty))) {
      return setFormError('Selecione uma especialidade válida para a unidade e o setor.');
    }
    if (form.coverageMode === 'adhoc' && (form.coverageReason?.trim().length || 0) < 3) return setFormError('Informe o motivo da cobertura avulsa com pelo menos 3 caracteres.');
    if (form.doctorId && !unchangedAssignment && !eligibilityReady) return setFormError('Aguarde a consulta dos médicos elegíveis.');
    if (form.doctorId && !eligibleDoctors.some(doctor => doctor.id === form.doctorId)) return setFormError('Selecione um médico que atenda à especialidade escolhida.');
    if (form.startTime === form.endTime) return setFormError('Início e fim precisam ser diferentes.');
    if (!form.employmentType && (!openedShift || openedShift.employmentType || (form.doctorId && form.doctorId !== openedShift.doctorId))) {
      return setFormError('Confirme a modalidade de contratação do plantão.');
    }
    if (form.doctorId && form.employmentType === 'pj' && !form.employerName?.trim()) return setFormError('Informe a empresa PJ.');
    if (newPjAgreement && !canEditFinancial) return setFormError('A confirmação de um acordo PJ exige permissão financeira.');
    if (!form.id && recurrence !== 'once' && (!repeatUntil || repeatUntil < form.date)) return setFormError('Defina uma data final igual ou posterior ao primeiro plantão.');
    const normalized: ShiftWrite = { ...form, coverageMode: form.coverageMode || 'regular', coverageReason: form.coverageMode === 'adhoc' ? form.coverageReason?.trim() : undefined, sector: sector?.name, sectorId: sector?.id, status: form.doctorId ? (form.status === 'open' ? 'pending' : form.status) : 'open', employmentType: form.employmentType, employerName: form.employerName?.trim() || undefined };
    if (showAgreementFields) {
      const changing = effectiveDraft.mode !== 'keep' || effectiveDraft.frequency !== (openedShift?.paymentFrequency || 'on_delivery');
      if (changing && !rateQuery.ready) return setFormError('Aguarde a consulta dos valores padrão ou tente novamente.');
      try {
        normalized.agreement = newPjAgreement
          ? buildRequiredPjAgreement(effectiveDraft, formRate)
          : buildAgreementSelection(effectiveDraft, formRate, openedShift);
      }
      catch (error) { return setFormError(error instanceof Error ? error.message : 'Confira o acordo financeiro.'); }
    }
    const dates = !form.id ? buildRecurringDates(form.date, repeatUntil, recurrence, customWeekdays) : [form.date];
    if (!dates.length) return setFormError('Selecione pelo menos um dia da semana dentro do período.');
    if (!form.doctorId && dates.length * vacancyCount > 500) return setFormError('Crie até 500 vagas por vez. Reduza a quantidade ou o período.');
    const candidates = dates.map((candidateDate, index) => ({ ...normalized, id: normalized.id || `recurring-${index}`, date: candidateDate }));
    const duplicate = normalized.doctorId ? candidates.find(candidate => shifts.some(item => item.id !== candidate.id && item.status !== 'cancelled' && item.sectorId === candidate.sectorId && item.date === candidate.date && item.startTime === candidate.startTime && item.endTime === candidate.endTime && item.doctorId === candidate.doctorId)) : undefined;
    if (duplicate) return setFormError(`Já existe um plantão igual em ${new Date(duplicate.date + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
    const conflict = candidates.find(candidate => hasConflict(candidate, shifts));
    if (conflict) return setFormError(`O médico já está escalado em horário coincidente em ${new Date(conflict.date + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
    let ok: boolean;
    if (form.id) ok = await store.updateShift(normalized);
    else {
      const countPerDate = form.doctorId ? 1 : vacancyCount;
      const inputs = candidates.flatMap(candidate => Array.from({ length: countPerDate }, () => toNewShift(candidate)));
      if (dates.length > 1) {
        setRecurringError('');
        setRecurringPreview({ inputs, dates, countPerDate, cents: normalized.agreement?.mode === 'default' ? formRate?.amount_cents : normalized.agreement?.amount_cents });
        return;
      }
      ok = inputs.length > 1 ? await store.addShifts(inputs) : await store.addShift(inputs[0]);
    }
    if (ok) setForm(null); else setFormError(useStore.getState().error || 'Não foi possível salvar o posto.');
  }
  async function confirmRecurrence() {
    if (!recurringPreview || !canCreateSchedule || store.saving) return;
    setRecurringError('');
    if (await store.addShifts(recurringPreview.inputs)) {
      setRecurringPreview(null);
      setForm(null);
    } else setRecurringError(useStore.getState().error || 'Não foi possível salvar a recorrência.');
  }
  function previewWeek(sourceWeek: 'current' | 'previous') {
    setPageError('');
    const from = sourceWeek === 'current' ? week[0] : addDays(week[0], -7);
    const to = sourceWeek === 'current' ? week[6] : addDays(week[6], -7);
    const source = copyableRegularShifts(shifts).filter(item => item.date >= from && item.date <= to && item.status !== 'cancelled' && (!unitId || item.unitId === unitId) && (!sectorId || item.sectorId === sectorId));
    if (!source.length) return setPageError('Não há postos regulares na semana de origem para copiar. Plantões avulsos não são copiados.');
    const clones = source.map((item, index): Shift => ({ ...item, id: `preview-${index}`, organizationId: orgId, date: addDays(item.date, 7), status: item.doctorId ? 'pending' : 'open', paymentStatus: 'pending', paidAt: undefined }));
    const blocked = clones.filter(candidate => candidate.doctorId && doctorDocumentState.get(candidate.doctorId)?.blocked).length;
    const duplicates = clones.filter(candidate => shifts.some(item => item.sectorId === candidate.sectorId && item.date === candidate.date && item.startTime === candidate.startTime && item.endTime === candidate.endTime && item.doctorId === candidate.doctorId && item.status !== 'cancelled')).length;
    const conflicts = clones.filter(candidate => candidate.doctorId && hasConflict(candidate, [...shifts, ...clones])).length;
    const turns = new Set(source.map(item => `${item.sectorId}:${item.date}:${item.startTime}:${item.endTime}`)).size;
    setWeekPreview({ clones, sectors: new Set(source.map(item => item.sectorId)).size, turns, range: `${formatDay(addDays(from, 7))} – ${formatDay(addDays(to, 7))}`, blocked, duplicates, conflicts });
  }
  async function confirmWeekPreview() {
    if (!weekPreview || weekPreview.blocked || weekPreview.duplicates || weekPreview.conflicts) return;
    const ok = await saveCopiedShifts(weekPreview.clones);
    if (ok) setWeekPreview(null); else if (useStore.getState().error) setPageError(useStore.getState().error || 'Não foi possível copiar a semana.');
  }
  async function saveCopiedShifts(clones: Shift[]) {
    if (clones.some(item => !item.employmentType)) {
      setPageError('Classifique a modalidade dos plantões de origem antes de copiar.');
      return false;
    }
    const pj = clones.filter(item => item.employmentType === 'pj');
    if (pj.some(item => item.paymentAmount == null) || (pj.length && !canEditFinancial)) {
      setPageError('Copiar plantões PJ exige valores registrados e permissão financeira.');
      return false;
    }
    try {
      const rates = pj.length ? await fetchShiftRates(orgId) : [];
      return await store.addShifts(clones.map(item => {
        if (item.employmentType !== 'pj') return toNewShift(item);
        const rate = chooseShiftRate(rates, item, sectors.find(sector => sector.id === item.sectorId), doctors.find(doctor => doctor.id === item.doctorId)?.specialty);
        const cents = Math.round(item.paymentAmount! * 100);
        const draft = {
          ...initialAgreementDraft(), frequency: item.paymentFrequency || 'on_delivery' as const,
          amount: formatShiftMoneyInput(cents),
          mode: rate ? (rate.amount_cents === cents ? 'default' : 'override') : 'manual',
          overrideReason: item.paymentAgreement?.override_reason || 'Valor do plantão de origem confirmado na cópia.',
        } as const;
        return toNewShift({ ...item, agreement: buildRequiredPjAgreement(draft, rate) });
      }));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Não foi possível consultar os valores da cópia.');
      return false;
    }
  }
  async function copyPeriod(sector: Sector, sourceDay: string, targetDay: string, kind: CoveragePeriodKind): Promise<string> {
    const source = coverageFor(sector, sourceDay).periods.find(item => item.period.kind === kind);
    const target = coverageFor(sector, targetDay).periods.find(item => item.period.kind === kind);
    const regularSource = source ? copyableRegularShifts(source.items) : [];
    if (!regularSource.length || !target) return 'Não há postos regulares nesse turno para copiar. Plantões avulsos não são copiados.';
    if (target.items.filter(item => item.coverageMode !== 'adhoc').length + regularSource.length > target.period.requiredDoctors) return 'O destino não tem postos previstos suficientes para esta cópia.';
    const clones = regularSource.map((item, index): Shift => ({ ...item, id: `preview-period-${index}`, date: targetDay, status: item.doctorId ? 'pending' : 'open', paymentStatus: 'pending', paidAt: undefined }));
    if (clones.some(item => item.doctorId && doctorDocumentState.get(item.doctorId)?.blocked)) return 'Há médico bloqueado por pendência documental nesse turno.';
    if (clones.some(item => item.doctorId && hasConflict(item, [...shifts, ...clones]))) return 'A cópia criaria conflito de horário para um médico.';
    const ok = await saveCopiedShifts(clones);
    return ok ? `${clones.length} ${clones.length === 1 ? 'posto copiado' : 'postos copiados'} para ${formatDay(targetDay)}.` : useStore.getState().error || 'Não foi possível copiar o turno.';
  }

  const eligibilityReady = Boolean(form && eligibility?.key === eligibilityKey && !eligibility.error);
  const eligibleDoctors = form ? doctors.filter(doctor => (eligibilityReady && eligibility?.ids.includes(doctor.id))
    || (unchangedAssignment && doctor.id === form.doctorId)) : [];
  const formSector = form ? sectors.find(item => item.id === form.sectorId) : undefined;
  const formRate = form && showAgreementFields ? chooseShiftRate(rateQuery.rates, form, formSector, doctors.find(doctor => doctor.id === form.doctorId)?.specialty) : undefined;
  const postDefaults = sectorFinanceDefaults(rateQuery.rates, form?.sectorId);
  const effectiveDraft = newPjAgreement && !agreementDraft.frequencyEdited && postDefaults.frequency
    ? { ...agreementDraft, frequency: postDefaults.frequency } : agreementDraft;
  const formUnit = units.find(item => item.id === form?.unitId);
  const formSpecialties = form ? specialtyChoices(form.unitId) : [];
  const formSectors = form ? sectors.filter(item => item.unitId === form.unitId) : [];
  const formPeriods = formSector ? sectorCoveragePeriods(formSector) : [];
  const recurrenceDates = form && !form.id ? buildRecurringDates(form.date, repeatUntil, recurrence, customWeekdays) : [];
  const storedFormRate = openedShift && canSeeFinancial ? chooseShiftRate(rateQuery.rates, openedShift,
    sectors.find(item => item.id === openedShift.sectorId), doctors.find(item => item.id === openedShift.doctorId)?.specialty) : undefined;
  const originalFormShift = form?.id ? shifts.find(item => item.id === form.id) : undefined;
  const formDoctorChanged = Boolean(originalFormShift?.doctorId && originalFormShift.doctorId !== form?.doctorId);
  const formTitle = form?.id && openedShift?.doctorId ? 'Ficha do plantão' : form?.coverageMode === 'adhoc' ? 'Novo plantão avulso' : form?.id ? 'Ficha da vaga' : form?.doctorId ? 'Novo plantão' : 'Nova vaga';

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Operação e cobertura</p><h1 className="nv-page-title mt-1">Escala médica</h1><p className="mt-1 text-sm capitalize text-text-secondary">{view === 'week' ? `${formatDay(week[0])} – ${formatDay(week[6])} de ${new Date(`${week[6]}T12:00:00`).getFullYear()}` : firstOfMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p></div><div className="flex flex-wrap gap-2">{canApproveSchedule && <Link className="nv-button-secondary" href="/escala/candidaturas"><ArrowRightLeft size={16}/>Candidaturas e trocas</Link>}{canCreateSchedule && <><button className="nv-button-secondary" onClick={() => openShift(undefined, undefined, date, undefined, 1, true)} disabled={!units.length}><Plus size={16}/>Plantão avulso</button><button className="nv-button" onClick={() => openShift()} disabled={!units.length}><Plus size={16}/>Novo posto</button></>}</div></header>
    {mobile && <div className="space-y-3">
      <nav className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-card-bg p-1" aria-label="Visualização da escala no celular">
        {([['month', 'Calendário'], ['list', 'Lista']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mobileView === value}
          onClick={() => changeMobileView(value)} className={`min-h-10 rounded-lg text-sm font-semibold ${mobileView === value ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-state-hover'}`}>{label}</button>)}
      </nav>
      <details className="rounded-xl border border-border bg-card-bg px-3 py-2.5">
        <summary className="cursor-pointer text-sm font-semibold">Filtros da escala{unitId || sectorId || specialty || doctorId || statusFilter !== 'all' ? ' · ativos' : ''}</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="nv-label min-w-0">Unidade<select aria-label="Unidade" className="nv-input min-w-0" value={unitId} onChange={event => { setUnitId(event.target.value); setSectorId(''); setDoctorId(''); }}><option value="">Todas</option>{units.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="nv-label min-w-0">Posto<select aria-label="Posto" className="nv-input min-w-0" value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">Todos</option>{sectors.filter(item => !unitId || item.unitId === unitId).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="nv-label min-w-0">Especialidade<select aria-label="Especialidade" className="nv-input min-w-0" value={specialty} onChange={event => { setSpecialty(event.target.value); setSectorId(''); setDoctorId(''); }}><option value="">Todas</option>{[...new Set([...units.flatMap(item => specialtyChoices(item.id)), ...shifts.map(item => item.specialty || '')])].filter(Boolean).sort().map(item => <option key={item}>{item}</option>)}</select></label>
          <label className="nv-label min-w-0">Situação<select aria-label="Situação" className="nv-input min-w-0" value={statusFilter} onChange={event => { setStatusFilter(event.target.value as typeof statusFilter); setCoverageFilter('all'); }}><option value="all">Ativos</option><option value="exchange">Troca solicitada</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {myDoctor && <label className="col-span-2 flex min-h-9 items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={doctorId === myDoctor.id} onChange={event => setDoctorId(event.target.checked ? myDoctor.id : '')}/> Minhas escalas</label>}
        </div>
      </details>
      {view === 'month' ? <MobileScheduleMonth date={date} today={today} offset={firstOfMonth.getDay()} days={mobileDays} onSelect={setDate} onNavigate={navigate}>
        <ScheduleList compact days={[date]} shifts={listShifts.filter(item => item.date === date)} units={units} sectors={sectors} doctors={doctors} doctorWarnings={doctorDocumentState} onEdit={openShift}/>
      </MobileScheduleMonth> : <div className="flex items-center justify-between rounded-xl border border-border bg-card-bg px-2">
        <button type="button" aria-label={view === 'week' ? 'Semana anterior' : 'Mês anterior'} className="p-2.5" onClick={() => navigate(-1)}><ChevronLeft size={19}/></button>
        <button type="button" className="text-sm font-semibold capitalize" onClick={() => setDate(today)} title="Voltar para hoje">{view === 'week' ? `${formatDay(week[0])} – ${formatDay(week[6])}` : firstOfMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</button>
        <button type="button" aria-label={view === 'week' ? 'Próxima semana' : 'Próximo mês'} className="p-2.5" onClick={() => navigate(1)}><ChevronRight size={19}/></button>
      </div>}
    </div>}

    {(!units.length || !sectors.length) && <section className="rounded-xl border border-border bg-card-bg p-6"><h2 className="font-semibold">Configure a estrutura da escala</h2><p className="mt-2 text-sm text-text-secondary">Cadastre uma unidade e seus setores antes de criar postos.</p><Link className="nv-button-secondary mt-4" href="/unidades">Gerenciar unidades e setores</Link></section>}

    <section className="nv-panel hidden p-4 sm:p-5 md:block" aria-label="Resumo da cobertura">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="min-w-[210px] flex-1"><p className="text-xs font-medium text-text-muted">Cobertura do período</p><p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-text-primary">{coveragePercent}% <span className="text-sm font-normal text-text-muted">· {filled} de {required} postos</span></p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Cobertura do período" aria-valuenow={coveragePercent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${coveragePercent}%` }}/></div></div>
        <button type="button" onClick={() => setCoverageFilter('deficit')} className="text-left"><span className="block text-2xl font-semibold tabular-nums text-danger">{deficit}</span><span className="text-xs text-text-muted">turnos com déficit</span></button>
        <button type="button" onClick={() => setCoverageFilter('open')} className="text-left"><span className="block text-2xl font-semibold tabular-nums text-info">{open}</span><span className="text-xs text-text-muted">vagas abertas</span></button>
        <button type="button" onClick={() => setCoverageFilter('conflict')} className="text-left"><span className="block text-2xl font-semibold tabular-nums text-warning">{conflicts}</span><span className="text-xs text-text-muted">turnos com conflito</span></button>
        <button type="button" onClick={() => setCoverageFilter('pending')} className="text-left"><span className="block text-2xl font-semibold tabular-nums text-text-primary">{pending}</span><span className="text-xs text-text-muted">confirmações pendentes</span></button>
      </div>
    </section>

    <section className={`nv-panel flex-col gap-3 p-4 xl:flex-row xl:items-end ${mobile && view === 'week' ? 'flex' : 'hidden md:flex'}`} aria-label="Controles da escala">
      <div className="hidden min-w-0 flex-1 flex-col gap-3 sm:flex-row md:flex"><label className="nv-label min-w-0 flex-1">Unidade<select className="nv-input" value={unitId} onChange={event => { setUnitId(event.target.value); setSectorId(''); setDoctorId(''); }}><option value="">Todas as unidades</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="nv-label min-w-0 flex-1">Setor<select className="nv-input" value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">Todos os setores</option>{sectors.filter(item => !unitId || item.unitId === unitId).map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label></div>
      <div className="flex flex-wrap items-center gap-2"><button className="nv-button-secondary" onClick={() => previewWeek('previous')} disabled={!canCreateSchedule || view !== 'week' || store.saving}><Copy size={15}/>Copiar semana anterior</button><button className="nv-button-secondary" onClick={() => previewWeek('current')} disabled={!canCreateSchedule || view !== 'week' || store.saving}><Copy size={15}/>Replicar para a próxima</button>{canDeleteSchedule && <button type="button" onClick={() => openDelete('period')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-text-secondary transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger"><Trash2 size={15}/>Excluir da escala</button>}</div>
    </section>

    <details className="rounded-lg border border-border bg-card-bg px-4 py-3 text-sm"><summary className="cursor-pointer font-medium text-text-secondary">Filtros avançados{employment || specialty || doctorId || periodKind || documentFilter !== 'all' ? ' · ativos' : ''}</summary><div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-5"><label className="nv-label">Modalidade de contratação<select className="nv-input" value={employment} onChange={event => setEmployment(event.target.value as EmploymentType | '')}><option value="">Todos</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => { setSpecialty(event.target.value); setSectorId(''); setDoctorId(''); }}><option value="">Todas</option>{[...new Set([...sectors.flatMap(item => item.specialties), ...doctors.map(item => item.specialty)])].filter(Boolean).sort().map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="nv-label">Médico<select className="nv-input" value={doctorId} onChange={event => setDoctorId(event.target.value)}><option value="">Todos</option>{visibleDoctors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="nv-label">Turno<select className="nv-input" value={periodKind} onChange={event => setPeriodKind(event.target.value as CoveragePeriodKind | '')}><option value="">Todos</option><option value="day">Diurno</option><option value="night">Noturno</option></select></label><label className="nv-label">Documentação<select className="nv-input" value={documentFilter} onChange={event => setDocumentFilter(event.target.value as 'all' | 'regular' | 'pending')}><option value="all">Todas</option><option value="regular">Regular</option><option value="pending">Pendente</option></select></label></div></details>

    <div className="flex flex-wrap gap-2" aria-label="Filtros rápidos de cobertura">{([
      ['all', 'Todos', 0], ['deficit', 'Com déficit', deficit], ['open', 'Vagas abertas', open], ['conflict', 'Conflitos', conflicts], ['pending', 'Confirmação pendente', pending], ['complete', 'Completos', 0],
    ] as const).map(([filter, label, count]) => <button key={filter} type="button" aria-pressed={coverageFilter === filter} onClick={() => setCoverageFilter(filter)} className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${coverageFilter === filter ? 'border-primary bg-primary/10 text-primary' : filter === 'deficit' && deficit ? 'border-danger/30 text-danger hover:bg-danger/5' : 'border-border bg-card-bg text-text-secondary hover:bg-state-hover'}`}>{label}{count > 0 ? ` ${count}` : ''}</button>)}</div>

    {(attention.length > 0 || doctorsWithDocumentsPending > 0 || pending > 0) && <section id="schedule-attention" aria-label="Atenção necessária" className="hidden border-l-2 border-danger pl-4 md:block">
      <h2 className="text-sm font-semibold text-text-primary">Atenção necessária</h2>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs"><button type="button" onClick={() => { setCoverageFilter('deficit'); setView('week'); }} className="font-medium text-danger hover:underline">{deficit} turnos com déficit</button><button type="button" onClick={() => { setCoverageFilter('pending'); setView('week'); }} className="font-medium text-warning hover:underline">{pending} confirmações pendentes</button><button type="button" onClick={() => { setDocumentFilter('pending'); setCoverageFilter('all'); setView('week'); }} className="font-medium text-text-secondary hover:underline">{doctorsWithDocumentsPending} médicos com documentação pendente</button>{soon > 0 && <span className="font-medium text-danger">{soon} turnos incompletos começam em até 24h</span>}</div>
      <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">{attention.map(({ sector, day, period }) => <button key={`${sector.id}-${day}-${period.period.kind}`} type="button" onClick={() => { setDate(day); setUnitId(sector.unitId); setSectorId(sector.id); setDoctorId(''); setEmployment(''); setDocumentFilter('all'); setPeriodKind(''); setCoverageFilter(period.deficit ? 'deficit' : 'conflict'); setView('week'); setFocusedTurn(previous => ({ day, sectorId: sector.id, kind: period.period.kind, nonce: (previous?.nonce || 0) + 1 })); }} className="flex min-h-10 items-center justify-between gap-3 border-b border-border py-2 text-left text-xs hover:text-primary"><span className="min-w-0 truncate"><strong className="font-semibold">{sector.name}</strong><span className="text-text-muted"> · {formatDay(day)} · {coveragePeriodLabel(period.period.kind)}</span></span><span className="shrink-0 font-semibold text-danger">{period.deficit ? `${period.deficit} em falta` : 'Conflito'}</span></button>)}</div>
    </section>}

    <div className="hidden flex-wrap items-center justify-between gap-3 md:flex"><div className="inline-flex flex-wrap rounded-lg border border-border bg-card-bg p-1"><button className={`rounded-md px-3 py-2 text-sm font-medium ${view === 'week' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => { if (statusFilter === 'cancelled') setStatusFilter('all'); setView('week'); }}>Semana</button><button className={`rounded-md px-3 py-2 text-sm font-medium ${view === 'month' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => { if (statusFilter === 'cancelled') setStatusFilter('all'); setView('month'); }}>Mês</button><button className={`rounded-md px-3 py-2 text-sm font-medium ${view === 'doctor' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => setView('doctor')}>Por médico</button><button className={`rounded-md px-3 py-2 text-sm font-medium ${view === "specialty" ? "bg-primary text-text-inverse" : "text-text-secondary"}`} onClick={() => setView("specialty")}>Por especialidade</button><button className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${view === 'list' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => setView('list')}><List size={15}/>Plantões</button></div><div className="flex flex-wrap items-center gap-1"><button aria-label="Período anterior" className="p-2.5 text-text-muted hover:text-primary" onClick={() => navigate(-1)}><ChevronLeft/></button><button className="min-w-16 px-3 text-sm font-semibold" onClick={() => setDate(today)}>Hoje</button><button aria-label="Próximo período" className="p-2.5 text-text-muted hover:text-primary" onClick={() => navigate(1)}><ChevronRight/></button><input aria-label="Ir para data" title="Ir para data" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} className="nv-input ml-2 w-36 text-xs"/></div></div>
    {pageError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{pageError}</p>}

    <label className="nv-label mb-3 hidden max-w-64 md:flex">Situação do plantão<select className="nv-input" value={statusFilter} onChange={event => {
      const value = event.target.value as typeof statusFilter;
      setStatusFilter(value);
      setCoverageFilter('all');
      if (value === 'cancelled') setView('list');
    }}>
      <option value="all">Todos os plantões ativos</option><option value="exchange">Troca solicitada</option>
      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3"><span className="mr-1 text-xs text-text-muted">Plantões:</span>{([['all', 'Todos'], ['regular', 'Regulares'], ['adhoc', 'Avulsos']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={coverageModeFilter === value && view === 'list'} onClick={() => { setCoverageModeFilter(value); setView('list'); }} className={`min-h-9 rounded-lg px-3 text-xs font-medium transition ${coverageModeFilter === value && view === 'list' ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-state-hover'}`}>{label}</button>)}</div>
    {mobile && view === 'month' ? null : view === 'list' ? <div id="plantao" tabIndex={-1} className="space-y-3">
      {requestedShiftId && <Link className="nv-button-secondary" href={'/escala?' + new URLSearchParams({ date })}>Voltar para a escala do dia</Link>}
      <ScheduleList days={listDays} shifts={listShifts} units={units} sectors={sectors} doctors={doctors} doctorWarnings={doctorDocumentState} onEdit={openShift} onDelete={canDeleteSchedule ? item => openDelete('shift', { shiftId: item.id, from: item.date, to: item.date }) : undefined}/>
    </div> : view === 'doctor' ? <ScheduleDoctorView doctors={visibleDoctors} sectors={sectors} units={units} shifts={listShifts} allShifts={shifts} month={month} canSeeFinancial={canSeeFinancial} onEdit={openShift}/> : view === 'specialty' ? <ScheduleSpecialtyView doctors={doctors} shifts={listShifts} allShifts={shifts} month={month} onEdit={openShift}/> : <ScheduleCalendarView
      key={focusedTurn?.nonce || 0}
      view={view}
      date={date}
      week={week}
      month={month}
      firstDayOffset={firstOfMonth.getDay()}
      daysInMonth={daysInMonth}
      units={units}
      sectors={visibleSectors}
      doctors={doctors}
      shifts={shifts}
      employment={employment}
      doctorId={doctorId}
      periodKind={periodKind}
      documentFilter={documentFilter}
      focus={focusedTurn}
      coverageFilter={coverageFilter}
      statusFilter={statusFilter === 'cancelled' ? 'all' : statusFilter}
      doctorWarnings={doctorDocumentState}
      canSeeFinancial={canSeeFinancial}
      canEditSchedule={canEditSchedule}
      canCreateSchedule={canCreateSchedule}
      canDeleteSchedule={canDeleteSchedule}
      onSelectDate={setDate}
      onSelectSector={setSectorId}
      onOpenShift={(sector, shiftDate, kind, count) => openShift(undefined, sector, shiftDate, kind, count)}
      onEditShift={item => openShift(item)}
      onDeleteShift={item => openDelete('shift', { shiftId: item.id, from: item.date, to: item.date })}
      onDeleteTurn={(sector, day, kind) => openDelete('turn', { from: day, to: day, unitId: sector.unitId, sectorId: sector.id, kind })}
      onCopyPeriod={copyPeriod}
    />}
    {selectionShift && <Dialog title="Candidaturas e histórico do plantão" onClose={() => setSelectionShift(null)}>
      <ShiftSelectionPanel organization={orgId} shiftId={selectionShift.id} onChanged={() => {
        setOpportunityRevision(value => value + 1);
        void fetchInitialDataFromSupabase().then(store.syncWithCloud).catch(() => {
          setPageError('Decisão registrada. Recarregue a página para atualizar a escala.');
        });
      }}/>
      <PresencePanel shiftId={selectionShift.id}/>
    </Dialog>}
    {deleteRequest && <ScheduleDeleteDialog key={`${deleteRequest.scope}-${deleteRequest.shiftId}-${deleteRequest.from}-${deleteRequest.sectorId}`} initial={deleteRequest} organizationId={orgId} shifts={shifts} sectors={sectors} units={units} doctors={doctors} canSeeFinancial={canSeeFinancial} canEditFinancial={canEditFinancial} onClose={() => setDeleteRequest(null)} onConfirm={confirmDelete}/>}
    {weekPreview && <Dialog title="Prévia da semana" onClose={() => !store.saving && setWeekPreview(null)}><div className="space-y-4">
      <p className="text-xs text-text-muted">Somente postos regulares serão copiados. Novos plantões PJ manterão os valores do plantão de origem.</p><p className="text-sm text-text-secondary">Destino: <strong className="text-text-primary">{weekPreview.range}</strong></p>
      <div className="grid grid-cols-3 gap-3 border-y border-border py-4 text-center"><div><strong className="block text-xl tabular-nums">{weekPreview.sectors}</strong><span className="text-xs text-text-muted">setores</span></div><div><strong className="block text-xl tabular-nums">{weekPreview.turns}</strong><span className="text-xs text-text-muted">turnos</span></div><div><strong className="block text-xl tabular-nums">{weekPreview.clones.length}</strong><span className="text-xs text-text-muted">postos</span></div></div>
      <div className="space-y-1 text-xs"><p className={weekPreview.blocked ? 'text-danger' : 'text-success'}>{weekPreview.blocked} médicos bloqueados por documentos</p><p className={weekPreview.duplicates ? 'text-danger' : 'text-success'}>{weekPreview.duplicates} postos duplicados</p><p className={weekPreview.conflicts ? 'text-danger' : 'text-success'}>{weekPreview.conflicts} conflitos de horário</p></div>
      {weekPreview.blocked + weekPreview.duplicates + weekPreview.conflicts > 0 && <p role="alert" className="rounded-lg bg-danger/5 p-3 text-xs text-danger">Revise os impedimentos na semana de destino antes de copiar.</p>}
      {pageError && <p role="alert" className="text-xs text-danger">{pageError}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" onClick={() => setWeekPreview(null)} disabled={store.saving}>Cancelar</button><button type="button" className="nv-button" onClick={() => void confirmWeekPreview()} disabled={Boolean(weekPreview.blocked || weekPreview.duplicates || weekPreview.conflicts || store.saving)}>{store.saving ? 'Copiando…' : 'Copiar postos'}</button></div>
    </div></Dialog>}
    {form && <Dialog title={formTitle} onClose={() => !store.saving && setForm(null)} footer={<div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" onClick={() => setForm(null)} disabled={store.saving}>Cancelar</button><button type="submit" form="shift-entry-form" className="nv-button" disabled={store.saving || !canSaveShift}>{store.saving ? <><LoaderCircle size={15} className="animate-spin"/>Salvando plantão…</> : recurrenceDates.length > 1 ? 'Revisar recorrência' : form.doctorId ? 'Salvar plantão' : form.id ? 'Salvar vaga' : vacancyCount > 1 ? `Criar ${vacancyCount} vagas` : 'Criar vaga'}</button></div>}><form id="shift-entry-form" className="space-y-5" onSubmit={save} aria-busy={store.saving}>{form.id && (canApproveSchedule || canEditSchedule) && <button type="button" className="nv-button-secondary" onClick={() => { setSelectionShift(form); setForm(null); }}>{canApproveSchedule ? 'Candidaturas e histórico' : 'Histórico da contratação'}</button>}
      {openedShift && <ShiftRecordSummary shift={openedShift} organization={activeOrganization?.name}
        unit={units.find(item => item.id === openedShift.unitId)?.name}
        sector={sectors.find(item => item.id === openedShift.sectorId)?.name}
        doctor={doctors.find(item => item.id === openedShift.doctorId)?.name} />}
      <fieldset disabled={!canSaveShift} className="min-w-0 space-y-5">{form.coverageMode === 'adhoc' && <section className="space-y-3 border-l-2 border-primary pl-3"><p className="text-sm font-semibold text-primary">Cobertura temporária</p><p className="text-xs leading-5 text-text-muted">Vale apenas para as datas cadastradas. Não altera os postos fixos do setor e não entra na cópia de semanas.</p><label className="nv-label">Motivo da cobertura<input className="nv-input" required minLength={3} maxLength={200} placeholder="Ex.: Férias de profissional CLT em outubro" value={form.coverageReason || ''} onChange={event => setForm({ ...form, coverageReason: event.target.value })} /></label></section>}<div className="grid gap-4 sm:grid-cols-2">
        <label className="nv-label">Unidade<select aria-label="Unidade" className="nv-input" required value={form.unitId} onChange={event => updateFormUnit(event.target.value)}><option value="">Selecione</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <div className="sm:col-span-2"><div className="flex items-end gap-2">
          <label className="nv-label min-w-0 flex-1">Setor<select aria-label="Setor" className="nv-input" required={form.coverageMode !== 'adhoc'} value={form.sectorId || ''} onChange={event => updateFormSector(event.target.value)}><option value="">{form.coverageMode === 'adhoc' ? 'Sem setor (avulso)' : 'Selecione'}</option>{formSectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
          {canCreateSector && <button type="button" disabled={!formUnit || store.saving} className="nv-button-secondary shrink-0" onClick={() => { setSectorNotice(''); setSectorEditorOpen(true); }}><Plus size={15}/>Novo setor</button>}
        </div>
        {formUnit && !formSectors.length && <p className="mt-2 text-xs text-text-muted">Nenhum setor ativo atende ao contexto selecionado.</p>}
        {sectorNotice && <p role="status" className="mt-2 text-xs text-text-muted">{sectorNotice}</p>}
        </div>
        <label className="nv-label sm:col-span-2">Especialidade{formSector ? <>
          <input aria-label="Especialidade" className="nv-input" readOnly value={form.specialty || ''} placeholder="Vinculação pendente" />
          <span className="mt-1.5 block text-xs font-normal text-text-muted">{formSector.primarySpecialty ? 'Especialidade definida pelo setor.' : 'Configure a especialidade deste setor antes de criar novos plantões.'}</span>
          {!formSector.primarySpecialty && canEditPermission(store.currentUser, 'unidades') && <Link className="mt-2 inline-block text-xs text-primary underline" href={canViewPermission(store.currentUser, 'configuracoes') ? '/configuracoes#setores-especialidades' : `/unidades/${form.unitId}`}>Configurar setores e especialidades</Link>}
        </> : <select aria-label="Especialidade" className="nv-input" required value={form.specialty || ''} onChange={event => updateFormSpecialty(event.target.value)}><option value="">Selecione</option>{formSpecialties.map(item => <option key={item} value={item}>{item}</option>)}</select>}</label>
      </div>{formPeriods.length > 0 && <fieldset><legend className="nv-label">Período de cobertura</legend><div className="grid gap-2 sm:grid-cols-2">{formPeriods.map(period => { const Icon = period.kind === 'day' ? Sun : Moon; const selected = coverageKind === period.kind; return <button key={period.kind} type="button" onClick={() => chooseCoverage(period.kind)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'border-border hover:bg-state-hover'}`}><Icon size={18} className={period.kind === 'day' ? 'text-warning' : 'text-primary'}/><span className="min-w-0"><strong className="block text-sm text-text-primary">{coveragePeriodLabel(period.kind)}</strong><span className="text-xs tabular-nums text-text-muted">{period.startTime}–{period.endTime} · {period.requiredDoctors} médico{period.requiredDoctors === 1 ? '' : 's'}</span></span></button>; })}</div></fieldset>}<div><p className="nv-label">Data e horário</p><div className="grid gap-4 sm:grid-cols-3"><label className="nv-label font-normal">Data<input className="nv-input" type="date" required value={form.date} onChange={event => { setForm({ ...form, date: event.target.value }); if (repeatUntil < event.target.value) setRepeatUntil(form.coverageMode === 'adhoc' ? endOfMonth(event.target.value) : addDays(event.target.value, 90)); }}/></label><label className="nv-label font-normal">Início<input className="nv-input" type="time" required value={form.startTime} onChange={event => setForm({ ...form, startTime: event.target.value })}/></label><label className="nv-label font-normal">Fim<input className="nv-input" type="time" required value={form.endTime} onChange={event => setForm({ ...form, endTime: event.target.value })}/></label></div><p className="mt-1.5 text-xs text-text-muted">O período preenche o horário padrão. Você pode ajustar este médico sem alterar o setor.</p></div><label className="nv-label">{form.id ? 'Médico deste plantão' : 'Médico'}<select className="nv-input" disabled={!eligibilityReady} value={form.doctorId || ''} onChange={event => updateDoctor(event.target.value)}><option value="">Deixar como vaga aberta</option>{eligibleDoctors.map(doctor => { const compliance = doctorDocumentState.get(doctor.id); const recorded = unchangedAssignment && form.doctorId === doctor.id && !eligibility?.ids.includes(doctor.id); return <option key={doctor.id} value={doctor.id} disabled={recorded}>{doctor.name} · {form.specialty}{recorded ? ' · responsável registrado' : compliance?.warning ? ' · atenção documental' : ''}</option>; })}</select>{!eligibilityReady && <span role="status" className="mt-2 block text-xs text-text-muted">{eligibility?.key === eligibilityKey && eligibility.error ? <>{eligibility.error}<button type="button" className="ml-2 text-primary underline" onClick={() => setEligibilityRevision(value => value + 1)}>Tentar novamente</button></> : 'Consultando médicos elegíveis…'}</span>}{eligibilityReady && !eligibleDoctors.length && <span className="mt-2 block text-xs font-normal text-text-muted">Nenhum médico elegível encontrado para este setor. Você pode deixar a vaga em aberto.</span>}{formDoctorChanged && <span className="mt-1.5 block text-xs font-normal text-warning">O novo médico ficará aguardando confirmação após salvar.</span>}</label>{form.doctorId && doctorDocumentState.get(form.doctorId)?.warning && <div className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${doctorDocumentState.get(form.doctorId)?.blocked ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/30 bg-warning/5 text-warning'}`}><span className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0"/>Confira as pendências na pasta documental. As autorizações aplicáveis ao plantão são verificadas ao salvar.</span><Link href={`/documentos/${form.doctorId}`} className="shrink-0 font-semibold underline">Abrir pasta</Link></div>}{!form.id && <section className="rounded-xl border border-border bg-surface-muted/35 p-4"><div className="flex items-start gap-3"><Repeat2 size={18} className="mt-0.5 shrink-0 text-primary"/><div><h3 className="text-sm font-semibold">{form.coverageMode === 'adhoc' ? 'Datas da cobertura' : 'Repetição automática'}</h3><p className="mt-1 text-xs text-text-muted">Crie plantões ou vagas em vários dias. Revise a prévia antes de salvar.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="nv-label">Frequência<select aria-label="Frequência" className="nv-input" value={recurrence} onChange={event => setRecurrence(event.target.value as ShiftRecurrence)}><option value="once">Somente esta data</option><option value="daily">Todos os dias</option><option value="weekdays">Segunda a sexta</option><option value="every_other_day">12x36</option><option value="custom">Personalizado</option><option value="weekly">Semanal</option><option value="fortnightly">Quinzenal</option><option value="monthly">Mensal</option></select></label>{recurrence !== 'once' && <label className="nv-label">Repetir até<input className="nv-input" type="date" min={form.date} required value={repeatUntil} onChange={event => setRepeatUntil(event.target.value)}/></label>}</div>{recurrence === "custom" && <fieldset className="mt-3"><legend className="text-xs font-medium text-text-secondary">Dias da semana</legend><div className="mt-2 flex flex-wrap gap-1">{[["Dom", 0], ["Seg", 1], ["Ter", 2], ["Qua", 3], ["Qui", 4], ["Sex", 5], ["Sáb", 6]].map(([label, value]) => <button key={value} type="button" aria-pressed={customWeekdays.includes(Number(value))} onClick={() => setCustomWeekdays(days => days.includes(Number(value)) ? days.filter(day => day !== Number(value)) : [...days, Number(value)])} className={`min-h-9 rounded-lg border px-2.5 text-xs font-medium ${customWeekdays.includes(Number(value)) ? "border-primary bg-primary/10 text-primary" : "border-border text-text-secondary"}`}>{label}</button>)}</div></fieldset>}{recurrence !== "once" && recurrenceDates.length > 0 && <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-text-secondary"><strong className="text-text-primary">{recurrenceDates.length * (form.doctorId ? 1 : vacancyCount)} postos em {recurrenceDates.length} datas:</strong> {recurrenceDescription(form.date, recurrence)}, das {form.startTime} às {form.endTime}, até {new Date(repeatUntil + 'T12:00:00').toLocaleDateString('pt-BR')}.</p>}</section>}{!form.doctorId && !form.id && <label className="nv-label">Quantidade de vagas<input className="nv-input" type="number" min={1} max={20} value={vacancyCount} onChange={event => setVacancyCount(Math.max(1, Number(event.target.value)))}/></label>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="nv-label">{form.doctorId ? 'Modalidade de contratação' : 'Modalidade de contratação prevista'}
          <select aria-label={form.doctorId ? 'Modalidade de contratação' : 'Modalidade de contratação prevista'} className="nv-input" value={form.employmentType || ''} disabled={openedShift?.paymentStatus === 'paid'}
            required={!openedShift || Boolean(openedShift.employmentType || (form.doctorId && form.doctorId !== openedShift.doctorId))}
            onChange={event => changeEmployment(event.target.value as EmploymentType || undefined)}>
            <option value="">{openedShift ? 'Não definida' : 'Selecione'}</option>
            {Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {form.doctorId && <label className="nv-label">Situação
          <select className="nv-input" value={form.status} onChange={event => setForm({ ...form, status: event.target.value as Shift['status'] })}>
            <option value="pending">Aguardando confirmação</option><option value="confirmed">Confirmado</option>
            <option value="completed">Concluído</option><option value="cancelled">Cancelado</option>
          </select>
        </label>}
      </div>
      {form.employmentType && <label className="nv-label">{form.employmentType === 'pj' ? 'Empresa PJ' : form.employmentType === 'concursado' ? 'Prefeitura / órgão público' : 'Empregador'}
        <input className="nv-input" list="employer-options" required={Boolean(form.doctorId && form.employmentType === 'pj')} maxLength={150}
          value={form.employerName || ''} onChange={event => setForm({ ...form, employerName: event.target.value })}/>
        <datalist id="employer-options">{employers.map(item => <option key={item} value={item}/>)}</datalist>
      </label>}
      {form.employmentType && form.employmentType !== 'pj' && <p className="text-sm text-text-muted">Pagamento administrado pelo vínculo empregatício, fora dos repasses PJ.</p>}
      {newPjAgreement && !canEditFinancial && <p className="text-sm text-warning">A confirmação do valor PJ exige permissão financeira.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Modalidade<select className="nv-input" value={form.type} onChange={event => setForm({ ...form, type: event.target.value as Shift['type'] })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{form.endTime < form.startTime && <p className="self-end pb-3 text-xs text-primary">Termina no dia seguinte.</p>}</div><label className="nv-label">Observações<textarea className="nv-input" rows={2} maxLength={1000} value={form.notes || ''} onChange={event => setForm({ ...form, notes: event.target.value })}/></label>
      </fieldset>
      {canSeeFinancial && openedShift && (openedShift.employmentType === 'pj' || openedShift.paymentAgreement || openedShift.paymentAmount != null || openedShift.paidAt) && <>
        <ShiftFinancialDetails shift={openedShift} applicableRate={storedFormRate} />
        <ShiftPaymentHistory key={openedShift.id} shiftId={openedShift.id} />
        {openedShift.employmentType === 'pj' && (openedShift.doctorId || openedShift.paymentAgreement) && <Link className="nv-button-secondary" href={'/financeiro?' + new URLSearchParams({ period: 'all', shiftId: openedShift.id })}>Abrir ficha no financeiro</Link>}
      </>}
      {showAgreementFields && (rateQuery.ready
        ? <ShiftAgreementFields draft={effectiveDraft} onChange={setAgreementDraft} rate={formRate} previous={newPjAgreement ? undefined : openedShift} requireAmount={Boolean(newPjAgreement)} dueFor={form} />
        : <div className="space-y-1 text-sm text-text-muted" role="status">
          <p>{rateQuery.error || 'Consultando valores padrão…'}</p>
          {rateQuery.error && <button type="button" className="text-primary underline" onClick={rateQuery.reload}>Tentar novamente</button>}
        </div>)}
      {formError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{formError}</p>}{store.saving && <p role="status" className="flex items-center gap-2 text-xs text-text-muted"><LoaderCircle size={14} className="animate-spin"/>Confirmando o plantão no banco de dados…</p>}</form></Dialog>}
    {sectorEditorOpen && form && formUnit && <SectorEditorDialog unit={formUnit} organizationName={activeOrganization?.name || ''} specialties={formSpecialties}
      initialSpecialty={formSpecialties.includes(form.specialty || '') ? form.specialty : undefined}
      initialPeriod={{ kind: coverageKind, startTime: form.startTime, endTime: form.endTime, requiredDoctors: 1 }}
      onClose={() => setSectorEditorOpen(false)} onSaved={selectCreatedSector}/>}
    {recurringPreview && <Dialog title="Revisar plantões recorrentes" onClose={() => !store.saving && setRecurringPreview(null)}
      footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => setRecurringPreview(null)}>Voltar à edição</button><button type="button" className="nv-button" disabled={store.saving} onClick={() => void confirmRecurrence()}>{store.saving ? 'Salvando…' : 'Confirmar criação'}</button></div>}>
      <div className="space-y-3">
        <p className="text-sm font-semibold">{recurringPreview.inputs.length} postos em {recurringPreview.dates.length} datas</p>
        {canSeeFinancial && <p className="text-sm text-text-secondary">{recurringPreview.cents == null ? 'Sem valor combinado' : `${formatShiftMoney(recurringPreview.cents)} por plantão`}{recurringPreview.inputs[0]?.agreement && ` · ${paymentFrequencyLabels[recurringPreview.inputs[0].agreement.frequency]}`}. Cada plantão terá seu próprio registro.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">{recurringPreview.dates.map(day => <li key={day} className="rounded-lg border border-border px-3 py-2 text-sm"><strong>{formatDay(day)}</strong> <span className="text-text-muted">· {recurringPreview.countPerDate} {recurringPreview.countPerDate === 1 ? 'posto' : 'postos'}</span></li>)}</ul>
        {recurringError && <p role="alert" className="text-sm text-danger">{recurringError}</p>}
      </div>
    </Dialog>}

  </div>;
}

function ScheduleRoute() {
  const organization = useStore(state => state.activeOrganizationId);
  const params = useSearchParams();
  return <Schedule key={organization + '?' + params.toString()} params={params} />;
}

export default function SchedulePage() {
  return <AccessGuard requiredPermission="escala"><Suspense fallback={<p role="status">Carregando escala…</p>}><ScheduleRoute /></Suspense></AccessGuard>;
}
