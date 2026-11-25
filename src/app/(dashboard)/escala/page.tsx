'use client';

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, Clock3, Copy, History, List, LoaderCircle, Moon, Plus, Repeat2, Sun, Trash2, UserRoundPlus, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import EmploymentBadge from '@/components/schedule/EmploymentBadge';
import ScheduleCalendarView from '@/components/schedule/ScheduleCalendarView';
import { useAvailableScheduleVacancies } from '@/components/schedule/useAvailableScheduleVacancies';
import { scheduleShiftMatches, scheduleHasFilters, isAvailableScheduleVacancy, type ScheduleFilters } from '@/lib/scheduleFiltering';
import ScheduleMasterView, { type MasterEditRequest } from '@/components/schedule/ScheduleMasterView';
import MasterShiftOrigin from '@/components/schedule/MasterShiftOrigin';
import type { MasterShiftContext } from '@/lib/masterSchedule';
import ScheduleScopePicker from '@/components/schedule/ScheduleScopePicker';
import ScheduleHistory from '@/components/schedule/ScheduleHistory';
import { ScheduleEditBoundary, ScheduleEditControl, useScheduleEdit, useScheduleDraft } from '@/components/schedule/ScheduleEditGuard';
import { scheduleSectors, type SectorSelection } from '@/lib/scheduleScope';
import ScheduleDoctorView from '@/components/schedule/ScheduleDoctorView';
import ScheduleSpecialtyView from '@/components/schedule/ScheduleSpecialtyView';
import SectorEditorDialog from '@/components/schedule/SectorEditorDialog';
import { reconcileShiftDoctor, scopedSpecialties, selectShiftSector } from '@/lib/sectorSpecialties';
import { moveScheduleMonth } from '@/lib/scheduleMonth';
import { isCriticalCoverage, scheduleConflictIds, type ScheduleCoverageFilter as CoverageFilter } from '@/lib/scheduleCalendar';
import ScheduleDeleteDialog from '@/components/schedule/ScheduleDeleteDialog';
import ShiftSelectionPanel from '@/components/schedule/ShiftSelectionPanel';
import PresencePanel from '@/components/schedule/PresencePanel';
import { ShiftAgreementFields, ShiftFinancialDetails, ShiftPaymentHistory, useShiftRates } from '@/components/schedule/ShiftFinancialDetails';
import ShiftCashPaymentFields from '@/components/schedule/ShiftCashPaymentFields';
import { readCashPayment } from '@/lib/shiftCashPayment';
import ShiftApprovalDialog from '@/components/schedule/ShiftApprovalDialog';
import { automaticShiftApprovalMessage, shiftApprovalLabels, shiftEditRestriction } from '@/lib/shiftApproval';
import { notify } from '@/lib/notifications';
import ShiftCoverageTimeline from '@/components/schedule/ShiftCoverageTimeline';
import { calculateFractionalCoverage, coverageDate, coverageDuration, coverageMinutes, coveragePlanInterval, coverageSpan, fractionalWritePlan } from '@/lib/fractionalCoverage';
import { shiftRecordStatusLabels as statusLabels } from '@/components/schedule/ShiftRecordSummary';
import { createClient } from '@/lib/supabase/client';
import { fetchInitialDataFromSupabase, fetchShiftRates } from '@/services/supabaseService';
import type { ScheduleDeletionScope, ScheduleDeletionSelection } from '@/lib/scheduleDeletion';
import { buildRecurringDates, copyableRegularShifts, coverageKindForShift, coveragePeriodLabel, employmentLabels, hasConflict, localDate, paymentFrequencyLabels, sectorCoveragePeriods, shiftInterval, statusAfterDoctorSelection, summarizeSectorCoverage, type ShiftRecurrence } from '@/lib/scheduling';
import { buildAgreementSelection, buildRequiredPjAgreement, chooseShiftRate, formatShiftMoney, formatShiftMoneyInput, initialAgreementDraft, parseMoneyCents, sectorFinanceDefaults, shiftTypeLabels as typeLabels } from '@/lib/shiftPricing';
import { canEditPermission, canPerformAction, canViewPermission } from '@/lib/permissions';
import { doctorScheduleCompliance } from '@/lib/documentGovernance';
import { useStore } from '@/store/useStore';
import type { CoveragePeriodKind, CoveragePlan, Doctor, EmploymentType, Sector, Shift, ShiftWrite, Unit } from '@/types';

type ViewMode = 'week' | 'day' | 'month' | 'doctor' | 'specialty' | 'list';
type MobileViewMode = 'month' | 'week' | 'day' | 'list';
function ShiftFormSection({ title, children, sectionRef }: {
  title: string; children: React.ReactNode; sectionRef?: React.Ref<HTMLDetailsElement>;
}) {
  return <details ref={sectionRef} className="group border-t border-border">
    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded py-2 text-sm font-medium text-text-secondary hover:text-text-primary [&::-webkit-details-marker]:hidden">
      {title}<ChevronDown size={15} className="shrink-0 group-open:rotate-180" aria-hidden="true"/>
    </summary>
    <div className="space-y-3 pb-4 pt-1">{children}</div>
  </details>;
}
const mobileViewKey = 'nvmed:mobile-schedule-view';
function subscribeMobile(callback: () => void) {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
function readMobileView(): MobileViewMode {
  try {
    const saved = window.localStorage.getItem(mobileViewKey);
    return saved === 'month' || saved === 'day' || saved === 'list' ? saved : 'week';
  } catch { return 'week'; }
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
  return { coverageHourlyRateCents: shift.coverageHourlyRateCents, coveragePlan: shift.coveragePlan, coverageMode: shift.coverageMode || 'regular', coverageReason: shift.coverageReason, sectorId: shift.sectorId, sector: shift.sector, specialty: shift.specialty, employmentType: shift.employmentType, employerName: shift.employerName, paymentAmount: shift.paymentAmount, paymentStatus: shift.paymentStatus, paymentFrequency: shift.paymentFrequency, paidAt: shift.paidAt, agreement: shift.agreement, cashPayment: shift.cashPayment, doctorId: shift.doctorId, unitId: shift.unitId, date: shift.date, startTime: shift.startTime, endTime: shift.endTime, type: shift.type, status: shift.status, notes: shift.notes };
}

function ScheduleList({ days, shifts, units, sectors, doctors, doctorWarnings, onEdit, onDelete, compact = false, availableVacancyIds }: { availableVacancyIds: ReadonlySet<string>; days: string[]; shifts: Shift[]; units: Unit[]; sectors: Sector[]; doctors: Doctor[]; doctorWarnings: Map<string, { warning: boolean; blocked: boolean }>; onEdit: (shift: Shift) => void; onDelete?: (shift: Shift) => void; compact?: boolean }) {
  if (compact) return shifts.length ? <div className="divide-y divide-border rounded-xl border border-border bg-card-bg">
    {shifts.map(item => {
      const doctor = doctors.find(value => value.id === item.doctorId);
      const sector = sectors.find(value => value.id === item.sectorId);
      const unit = units.find(value => value.id === item.unitId);
      const status = item.exchangeRequested ? 'Troca solicitada' : statusLabels[item.status];
      const gap = !item.doctorId && item.status === 'open' && coverageSpan(item);
      return <button key={item.id} type="button" onClick={() => onEdit(item)} data-schedule-tone={gap ? 'available' : undefined}
        className={`flex min-h-16 w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left hover:bg-state-hover ${gap ? 'nv-schedule-entry' : ''}`}>
        <span className="shrink-0 text-xs font-semibold tabular-nums">{item.startTime}–{item.endTime}</span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold">{doctor?.name || (item.doctorId ? 'Médico escalado' : gap || availableVacancyIds.has(item.id) ? 'Vaga aberta' : 'Posto sem médico')}{gap && ` · ${coverageDuration(coverageMinutes(gap))}`}</span>
          <span className="block break-words text-xs text-text-muted">{[unit?.name, sector?.name || item.sector, item.specialty].filter(Boolean).join(' · ')}</span>
          <span className="mt-0.5 inline-block"><EmploymentBadge employment={item.employmentType} provisional={!item.doctorId}/></span>
          {item.status !== 'open' && <span className="block text-xs font-medium text-primary">{status}</span>}
        </span><ChevronRight size={15} className="shrink-0 text-text-muted" aria-hidden="true"/>
      </button>;
    })}
  </div> : <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">Nenhum plantão neste dia com os filtros selecionados.</p>;
  if (!days.length) return <div className="rounded-xl border border-dashed border-border py-16 text-center"><List className="mx-auto h-6 w-6 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum plantão individual neste período</p><p className="mt-1 text-xs text-text-muted">Crie um posto ou plantão avulso para as datas solicitadas.</p></div>;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-base font-semibold">Plantões individuais</h2><span className="text-xs font-medium text-text-muted">{shifts.length} {shifts.length === 1 ? 'plantão criado' : 'plantões criados'}</span></div>
    <div className="@container overflow-hidden rounded-xl border border-border bg-card-bg">
      <div className="hidden grid-cols-[105px_110px_minmax(180px,1fr)_minmax(180px,1fr)_100px_125px_150px] gap-3 border-b border-border bg-surface-muted/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted @min-[68rem]:grid"><span>Plantão</span><span>Horário</span><span>Unidade · setor</span><span>Médico</span><span>Vínculo</span><span>Situação</span><span>Ação</span></div>
      {days.map(day => { const dayItems = shifts.filter(item => coverageDate(item) === day); const assigned = dayItems.filter(item => item.doctorId).length; const vacancies = dayItems.length - assigned; return <section key={day} className="border-b border-border last:border-0">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-muted/25 px-4 py-3"><div><p className="text-sm font-semibold capitalize text-text-primary">{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p><p className="mt-0.5 text-[11px] text-text-muted">{dayItems.length} {dayItems.length === 1 ? 'plantão individual' : 'plantões individuais'}</p></div><div className="flex items-center gap-3 text-xs"><span className="flex items-center gap-1.5 text-success"><Users size={14}/>{assigned} escalado{assigned === 1 ? '' : 's'}</span>{vacancies > 0 && <span className="flex items-center gap-1.5 font-medium text-danger"><AlertTriangle size={14}/>{vacancies} {vacancies === 1 ? 'vaga aberta' : 'vagas abertas'}</span>}</div></div>
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
            <span title={doctor?.name || 'Posto sem médico'} className={`flex min-w-0 items-center gap-1.5 break-words text-sm font-medium ${doctor ? 'text-text-primary' : (item.coveragePost || availableVacancyIds.has(item.id)) ? 'text-danger' : 'text-text-secondary'}`}>{doctor?.name || (item.coveragePost ? 'Vaga descoberta' : availableVacancyIds.has(item.id) ? 'Vaga aberta' : 'Posto sem médico')}{warning?.warning && <AlertTriangle size={13} className={warning.blocked ? 'shrink-0 text-danger' : 'shrink-0 text-warning'} aria-label="Pendência documental"/>}</span>
            <span><EmploymentBadge employment={item.employmentType} provisional={!item.doctorId}/></span>
            <span className={`inline-flex items-center gap-1 text-xs font-medium ${item.exchangeRequested || item.status === 'pending' ? 'text-warning' : item.status === 'open' ? 'text-danger' : item.status === 'confirmed' ? 'text-success' : 'text-text-secondary'}`}>{item.exchangeRequested && <Repeat2 size={13}/>}
              {item.exchangeRequested ? 'Troca solicitada' : !item.doctorId && item.status === 'open' && !(item.coveragePost?.published || availableVacancyIds.has(item.id)) ? 'Indisponível para candidatura' : statusLabels[item.status]}</span>
            <span className="flex items-center gap-1"><button type="button" onClick={() => onEdit(item)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-xs font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/5">{doctor ? <ArrowRightLeft size={13}/> : <UserRoundPlus size={13}/>} {item.status === 'cancelled' ? 'Ver detalhes' : doctor ? 'Ver ficha' : 'Preencher'}</button>{onDelete && !item.coveragePost && <button type="button" aria-label={`Excluir plantão ${sequence} de ${formatDay(day)}`} title="Excluir plantão" onClick={() => onDelete(item)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-danger/5 hover:text-danger"><Trash2 size={15}/></button>}</span>
          </div>;
        })}</div>
      </section>; })}
    </div>
  </section>;
}

function Schedule({ params }: { params: URLSearchParams }) {
  const store = useStore();
  const editGuard = useScheduleEdit();
  const today = localDate();
  const requestedShiftId = params.get('shiftId');
  const requestedCoverage = params.get('coverage');
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date')! : today;
  const [date, setDate] = useState(initialDate);
  const [listRange, setListRange] = useState<'week' | 'day' | 'month'>(params.get('view') === 'month' ? 'month' : params.get('view') === 'day' ? 'day' : 'week');
  const [scheduleMode, setScheduleMode] = useState<'general' | 'master'>(params.get('mode') === 'master' ? 'master' : 'general');
  const [masterEditRequest, setMasterEditRequest] = useState<MasterEditRequest | null>(null);
  const preferredView = store.accountPreferences.scheduleView === 'list' ? 'list' : 'week';
  const explicitView = params.get('view');
  const initialView: MobileViewMode = requestedShiftId || explicitView === 'list' ? 'list'
    : explicitView === 'week' || explicitView === 'month' || explicitView === 'day' ? explicitView : preferredView;
  const [desktopView, setDesktopView] = useState<ViewMode>(initialView);
  const mobile = useSyncExternalStore(subscribeMobile, () => window.matchMedia('(max-width: 767px)').matches, () => false);
  const savedMobileView = useSyncExternalStore(() => () => {}, readMobileView, () => 'week' as const);
  const [mobileChoice, setMobileChoice] = useState<MobileViewMode>();
  const mobileView = mobileChoice ?? (requestedShiftId || explicitView || store.hasSavedAccountPreferences ? initialView : savedMobileView);
  function changeMobileView(next: MobileViewMode) {
    if (next === 'list' && mobileView !== 'list') setListRange(mobileView);
    setMobileChoice(next);
    try { window.localStorage.setItem(mobileViewKey, next); } catch { /* Preference remains active on this page. */ }
  }
  function setView(next: ViewMode) {
    if (next === 'list' && ['week', 'month', 'day'].includes(view)) setListRange(view as 'week' | 'month' | 'day');
    setDesktopView(next);
    if (mobile && next !== 'doctor' && next !== 'specialty') changeMobileView(next);
  }
  const requestedShift = store.shifts.find(item => item.id === requestedShiftId && item.organizationId === store.activeOrganizationId);
  const [unitId, setUnitId] = useState(params.get('unitId') || requestedShift?.unitId || '');
  const [sectorSelection, setSectorSelection] = useState<SectorSelection>(params.get('sectors') === 'all' ? 'all' : params.getAll('sectorId').length ? params.getAll('sectorId') : requestedShift?.sectorId ? [requestedShift.sectorId] : []);
  const setSectorId = (id: string) => setSectorSelection(id ? [id] : []);
  const requestedEmployment = params.get('contratacao');
  const [employment, setEmployment] = useState<EmploymentType | ''>(requestedEmployment && Object.hasOwn(employmentLabels, requestedEmployment) ? requestedEmployment as EmploymentType : '');
  const [specialty, setSpecialty] = useState(params.get('specialty') || '');
  const [doctorId, setDoctorId] = useState('');
  const [periodKind, setPeriodKind] = useState<CoveragePeriodKind | ''>('');
  const [documentFilter, setDocumentFilter] = useState<'all' | 'regular' | 'pending'>('all');
  const [coverageModeFilter, setCoverageModeFilter] = useState<'all' | 'regular' | 'adhoc'>('all');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>(requestedCoverage === 'deficit' ? 'deficit' : 'all');
  const [statusFilter, setStatusFilter] = useState<Shift['status'] | 'all' | 'exchange'>('all');
  const view = mobile ? (requestedShiftId || statusFilter === 'cancelled' ? 'list' : mobileView) : desktopView;
  const [form, setForm] = useState<Shift | null>(null);
  const [coveragePlan, setCoveragePlan] = useState<CoveragePlan | null>(null);
  const [coveragePanelOpen, setCoveragePanelOpen] = useState(false);
  const [previousGapPreview, setPreviousGapPreview] = useState(false);
  const [requestRetroReason, setRequestRetroReason] = useState(false);
  const coverageToggle = useRef<HTMLButtonElement>(null);
  const operationalSection = useRef<HTMLDetailsElement>(null);
  const financialSection = useRef<HTMLDetailsElement>(null);
  const draftShiftId = useRef('');
  const [hourlyRate, setHourlyRate] = useState('');
  const criticalDetails = useRef<HTMLDetailsElement>(null);
  const [historyTarget, setHistoryTarget] = useState<{ shiftId?: string } | null>(null);
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
  const [referenceTime, setReferenceTime] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setReferenceTime(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const [weekPreview, setWeekPreview] = useState<{ clones: Shift[]; sectors: number; turns: number; range: string; blocked: number; duplicates: number; conflicts: number } | null>(null);
  const [confirmAdministrative, setConfirmAdministrative] = useState<Shift | null>(null);
  const [retroReason, setRetroReason] = useState('');
  const [cashRequest, setCashRequest] = useState('');
  const [cashBusy, setCashBusy] = useState(false);
  const [recurringPreview, setRecurringPreview] = useState<{ inputs: Omit<ShiftWrite, 'id' | 'organizationId'>[]; dates: string[]; countPerDate: number; cents?: number } | null>(null);
  const [recurringError, setRecurringError] = useState('');
  const [deleteRequest, setDeleteRequest] = useState<ScheduleDeletionSelection | null>(null);
  const [cancelCoverageOpen, setCancelCoverageOpen] = useState(false);
  const orgId = store.activeOrganizationId;
  const availableVacancies = useAvailableScheduleVacancies(orgId, store.shifts, opportunityRevision);
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
  const canEditSchedule = editGuard.unlocked && canEditPermission(store.currentUser, 'escala');
  const canCreateSchedule = canEditSchedule && canPerformAction(store.currentUser, 'escala', 'create');
  const canDeleteSchedule = canEditSchedule && canPerformAction(store.currentUser, 'escala', 'delete');
  const canApproveSchedule = canEditSchedule && canPerformAction(store.currentUser, 'escala', 'approve');
  const canCreateSector = canEditSchedule && canPerformAction(store.currentUser, 'unidades', 'create');
  const endedShift = Boolean(openedShift?.approvalEndedAt && Date.parse(openedShift.approvalEndedAt) <= referenceTime);
  const editRestriction = shiftEditRestriction(openedShift, endedShift, canPerformAction(store.currentUser, 'escala', 'edit_past'));
  const canSaveShift = form?.id ? canEditSchedule && !editRestriction && !openedShift?.coveragePost?.cancelled : canCreateSchedule;
  const newPjAgreement = form?.employmentType === 'pj' && (!openedShift || openedShift.employmentType !== 'pj'
    || Boolean(form.doctorId && form.doctorId !== openedShift.doctorId));
  const showAgreementFields = canEditFinancial && canSaveShift && form?.employmentType === 'pj' && openedShift?.paymentStatus !== 'paid';
  const rateQuery = useShiftRates(orgId, canSeeFinancial && Boolean(form));
  const units = store.units.filter(item => item.organizationId === orgId && item.status === 'active');
  const sectors = store.sectors.filter(item => item.organizationId === orgId && item.status === 'active');
  const doctors = store.doctors.filter(item => item.organizationId === orgId);
  const myDoctor = doctors.find(item => item.email.toLowerCase() === store.currentUser?.email?.toLowerCase());
  const shifts = store.shifts.filter(item => item.organizationId === orgId).map(item => ({
    ...item, exchangeRequested: exchangeState?.organization === orgId && exchangeState.ids.has(item.id),
  }));
  const activeOrganization = store.organizations.find(item => item.id === orgId);
  const organizationDocuments = store.documents.filter(item => item.organizationId === orgId);
  const doctorDocumentState = new Map(doctors.map(doctor => [doctor.id, doctorScheduleCompliance(doctor, organizationDocuments, activeOrganization)]));
  const selectedSectors = scheduleSectors(unitId, sectorSelection, units, sectors);
  const sectorIds = selectedSectors.map(item => item.id);
  const sectorId = sectorIds.length === 1 ? sectorIds[0] : '';
  const selectedSector = selectedSectors.length === 1 ? selectedSectors[0] : undefined;
  const scopeReady = selectedSectors.length > 0;
  const visibleSectors = scopeReady ? selectedSectors : [];
  const visibleDoctors = doctors.filter(item => (!unitId || item.linkedUnits.includes(unitId) || shifts.some(shift => shift.doctorId === item.id && shift.unitId === unitId)) && (!specialty || item.specialty === specialty));
  const weekStart = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const month = date.slice(0, 7);
  const firstOfMonth = new Date(month + '-01T12:00:00');
  const daysInMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();

  const shiftsBySectorDay = new Map<string, Shift[]>();
  shifts.forEach(item => { if (item.status !== 'cancelled') { const key = `${item.sectorId}:${coverageDate(item)}`; const items = shiftsBySectorDay.get(key) || []; items.push(item); shiftsBySectorDay.set(key, items); } });
  const shiftsFor = (sector: Sector, day: string) => shiftsBySectorDay.get(`${sector.id}:${day}`) || [];
  const coverageFor = (sector: Sector, day: string) => summarizeSectorCoverage(sector, shiftsFor(sector, day));
  const conflictIds = scheduleConflictIds(scopeReady ? shifts : []);
  const isCritical = (period: ReturnType<typeof coverageFor>['periods'][number], day: string) => isCriticalCoverage(period, day, conflictIds, doctorDocumentState, referenceTime);
  const periodMode = view === 'list' ? listRange : view;
  const firstWeekYear = week[0].slice(0, 4);
  const lastWeekYear = week[6].slice(0, 4);
  const periodLabel = periodMode === 'day'
    ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { dateStyle: 'full' })
    : periodMode === 'week'
      ? `${formatDay(week[0])}${firstWeekYear === lastWeekYear ? '' : ` de ${firstWeekYear}`} a ${formatDay(week[6])} de ${lastWeekYear}`
      : firstOfMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const previousPeriodLabel = periodMode === 'day' ? 'Dia anterior' : periodMode === 'week' ? 'Semana anterior' : 'Mês anterior';
  const nextPeriodLabel = periodMode === 'day' ? 'Próximo dia' : periodMode === 'week' ? 'Próxima semana' : 'Próximo mês';
  const periodDays = !scopeReady ? [] : periodMode === 'day' ? [date] : periodMode === 'week' ? week : Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const filterContext = { availableVacancyIds: availableVacancies.ids, conflicts: conflictIds, warnings: doctorDocumentState, now: referenceTime };
  const filters: ScheduleFilters = { statusFilter, coverageFilter, employment, doctorId, periodKind, documentFilter, specialty, coverageMode: coverageModeFilter };
  const filtersActive = scheduleHasFilters(filters);
  // The operational summary deliberately covers the selected unit/sectors/turn,
  // while the shared item predicate controls every displayed shift.
  const periodCoverage = visibleSectors.flatMap(sector => periodDays.flatMap(day => coverageFor(sector, day).periods
    .filter(period => !periodKind || period.period.kind === periodKind).map(period => ({ sector, day, period }))));
  const required = periodCoverage.reduce((sum, item) => sum + item.period.required, 0);
  const filled = periodCoverage.reduce((sum, item) => sum + item.period.required - item.period.deficit, 0);
  const deficit = periodCoverage.filter(item => item.period.deficit > 0).length;
  const open = periodCoverage.reduce((sum, item) => sum + item.period.vacancies.filter(shift => isAvailableScheduleVacancy(shift, filterContext)).length, 0);
  const pending = periodCoverage.reduce((sum, item) => sum + item.period.assigned.filter(shift => shift.status === 'pending').length, 0);
  const conflicts = periodCoverage.filter(item => item.period.assigned.some(shift => conflictIds.has(shift.id))).length;
  const critical = periodCoverage.filter(item => isCritical(item.period, item.day)).length;
  const doctorsWithDocumentsPending = new Set(periodCoverage.flatMap(item => item.period.assigned.map(shift => shift.doctorId).filter((id): id is string => typeof id === 'string' && doctorDocumentState.get(id)?.warning === true))).size;
  const coveragePercent = required ? Math.min(100, Math.round(filled / required * 100)) : 0;
  const urgentPeriods = periodCoverage.filter(({ day, period }) => isCritical(period, day)
    && shiftInterval({ date: day, startTime: period.period.startTime, endTime: period.period.endTime }).end > referenceTime)
    .sort((a, b) => a.day.localeCompare(b.day) || a.period.period.startTime.localeCompare(b.period.period.startTime));
  const employers = [...new Set(shifts.map(item => item.employerName).filter(Boolean))] as string[];
  const listShifts = (scopeReady ? shifts : [])
    .filter(item => (!requestedShiftId || item.id === requestedShiftId) && periodDays.includes(coverageDate(item)) && item.unitId === unitId && sectorIds.includes(item.sectorId || ''))
    .filter(item => {
      const sector = sectors.find(value => value.id === item.sectorId);
      const period = sector && coverageFor(sector, coverageDate(item)).periods.find(value => value.period.kind === coverageKindForShift(item, sectorCoveragePeriods(sector)));
      return Boolean(sector && period && scheduleShiftMatches(item, sector, period, filters, filterContext));
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  const listDays = [...new Set(listShifts.map(coverageDate))];

  function clearFilters() {
    setStatusFilter('all');
    setCoverageFilter('all');
    setEmployment('');
    setDoctorId('');
    setPeriodKind('');
    setDocumentFilter('all');
    setSpecialty('');
    setCoverageModeFilter('all');
  }

  function openDelete(scope: ScheduleDeletionScope, options: Partial<ScheduleDeletionSelection> = {}) {
    if (scope === 'doctor' ? !canEditSchedule : !canDeleteSchedule) return;
    setPageError('');
    if (!editGuard.check()) return;
    setDeleteRequest({ scope, from: view === 'day' ? date : view === 'week' ? week[0] : `${month}-01`, to: view === 'day' ? date : view === 'week' ? week[6] : `${month}-${String(daysInMonth).padStart(2, '0')}`, unitId, sectorId, sectorIds, kind: periodKind, doctorId, shiftId: '', ...options });
  }

  async function confirmDelete(targets: Shift[], scope: ScheduleDeletionScope): Promise<string | null> {
    const ok = await editGuard.run(() => scope === 'doctor' ? store.vacateShifts(targets.map(item => item.id)) : store.deleteShifts(targets.map(item => item.id)));
    return ok ? null : useStore.getState().error || 'Não foi possível concluir a ação.';
  }

  function navigate(amount: number) { setDate(periodMode === 'day' ? addDays(date, amount) : periodMode === 'week' ? addDays(date, amount * 7) : moveScheduleMonth(date, amount)); }
  function openShift(shift?: Shift, sector = selectedSector, day = date, requestedKind?: CoveragePeriodKind, suggestedCount = 1, adhoc = false) {
    if (!shift && !canCreateSchedule) return;
    store.clearFeedback(); setSectorNotice(''); setFormError(''); setPageError(''); setVacancyCount(Math.max(1, suggestedCount)); setRecurrence('once'); setCustomWeekdays([new Date(`${day}T12:00:00`).getDay()]); setRepeatUntil(adhoc ? endOfMonth(day) : addDays(day, 90));
    const resolvedSector = shift ? sectors.find(item => item.id === shift.sectorId) : sector;
    const resolvedUnit = shift?.unitId || resolvedSector?.unitId || unitId || units[0]?.id || '';
    const periods = resolvedSector ? sectorCoveragePeriods(resolvedSector) : [];
    const period = periods.find(item => item.kind === (shift ? coverageKindForShift(shift, periods) : requestedKind)) || periods[0];
    setCoverageKind(shift ? coverageKindForShift(shift, periods) : period?.kind || 'day');
    setOpenedShift(shift);
    setCoveragePlan(null);
    setCoveragePanelOpen(false);
    setPreviousGapPreview(false);
    setRequestRetroReason(false);
    draftShiftId.current = shift ? '' : crypto.randomUUID();
    setHourlyRate(shift?.paymentAgreement?.hourly_rate_cents != null ? formatShiftMoneyInput(shift.paymentAgreement.hourly_rate_cents) : '');
    setAgreementDraft(initialAgreementDraft(shift));
    setRetroReason('');
    setCashRequest('');
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
    setCoveragePlan(null);
    const choices = specialtyChoices(nextUnit);
    setForm({ ...form, doctorId: undefined, status: 'open', unitId: nextUnit,
      sectorId: '', sector: '', specialty: choices.includes(form.specialty || '') ? form.specialty : choices.length === 1 ? choices[0] : '' });
  }
  function updateFormSector(nextSectorId: string) {
    if (!form) return;
    const sector = sectors.find(item => item.id === nextSectorId && item.unitId === form.unitId);
    const next = selectShiftSector(form, sector);
    setCoveragePlan(null);
    if (!form.id && sector) {
      const periods = sectorCoveragePeriods(sector);
      const period = periods.find(item => item.kind === coverageKind) || periods[0];
      if (period) {
        setCoverageKind(period.kind);
        next.startTime = period.startTime;
        next.endTime = period.endTime;
      }
    }
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
    if (period) {
      setCoverageKind(kind);
      setCoveragePlan(null);
      setForm({ ...form, startTime: period.startTime, endTime: period.endTime });
    }
  }
  function updateDoctor(nextDoctorId: string) {
    if (!form) return;
    if ((form.doctorId || '') === nextDoctorId) return;
    if (!nextDoctorId) {
      setForm({ ...form, doctorId: undefined, employerName: '', status: 'open' });
      return;
    }
    setAgreementDraft(initialAgreementDraft());
    setHourlyRate('');
    setForm({ ...form, doctorId: nextDoctorId, employmentType: undefined, employerName: '',
      status: statusAfterDoctorSelection(form.status, form.doctorId, nextDoctorId) });
  }
  function changeEmployment(employmentType: EmploymentType | undefined) {
    if (!form) return;
    const sameAgreement = employmentType === 'pj' && openedShift?.employmentType === 'pj' && openedShift.doctorId === form.doctorId;
    setAgreementDraft(initialAgreementDraft(sameAgreement ? openedShift : undefined));
    setForm({ ...form, employmentType, employerName: '' });
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form || !canSaveShift || store.saving || cashBusy) return;
    if (!editGuard.check()) return;
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
    if (!writePlan && !existingPost && form.startTime === form.endTime) return setFormError('Início e fim precisam ser diferentes.');
    if (!form.employmentType && (!openedShift || openedShift.employmentType || (form.doctorId && form.doctorId !== openedShift.doctorId))) {
      if (operationalSection.current) operationalSection.current.open = true;
      return setFormError('Confirme a modalidade de contratação do plantão.');
    }
    if (form.doctorId && form.employmentType === 'pj' && !form.employerName?.trim()) return setFormError('Informe a empresa PJ.');
    if (newPjAgreement && !canEditFinancial) return setFormError('A confirmação de um acordo PJ exige permissão financeira.');
    if (!form.id && recurrence !== 'once' && (!repeatUntil || repeatUntil < form.date)) return setFormError('Defina uma data final igual ou posterior ao primeiro plantão.');
    if (writePlan || existingPost) {
      if (writePlan && openedShift && !existingPost && (changedScope || openedShift.date !== form.date)) {
        return setFormError('Salve a mudança de unidade, setor, especialidade ou data antes de ajustar a cobertura.');
      }
      if (!plannedInterval || !draftInterval || draftInterval.start < plannedInterval.start || draftInterval.end > plannedInterval.end) {
        return setFormError('Informe um intervalo dentro do horário previsto do posto.');
      }
      if (!coverageTotals) return setFormError('Confira os horários e a capacidade simultânea do posto.');
      if (recurrence !== 'once' || (!form.doctorId && vacancyCount > 1)) return setFormError('Use uma única data e um único posto para salvar esta cobertura.');
    }
    const normalized: ShiftWrite = { ...form, coveragePlan: writePlan, coverageMode: form.coverageMode || 'regular', coverageReason: form.coverageMode === 'adhoc' ? form.coverageReason?.trim() : undefined, sector: sector?.name, sectorId: sector?.id, status: form.doctorId ? (form.status === 'open' ? 'pending' : form.status) : 'open', employmentType: form.employmentType, employerName: form.employerName?.trim() || undefined };
    if (openedShift && endedShift) normalized.retroReason = retroReason.trim();
    if (hasHourlyRate) {
      if (hourlyCents == null || hourlyCents > 9_999_999_999) {
        if (financialSection.current) financialSection.current.open = true;
        return setFormError('Informe um valor por hora válido.');
      }
      normalized.coverageHourlyRateCents = hourlyCents;
      normalized.paymentFrequency = effectiveDraft.frequency;
    } else if (showAgreementFields) {
      const changing = effectiveDraft.mode !== 'keep' || effectiveDraft.frequency !== (openedShift?.paymentFrequency || 'on_delivery');
      if (changing && !rateQuery.ready) {
        if (financialSection.current) financialSection.current.open = true;
        return setFormError('Aguarde a consulta dos valores padrão ou tente novamente.');
      }
      try {
        normalized.agreement = newPjAgreement
          ? buildRequiredPjAgreement(effectiveDraft, formRate)
          : buildAgreementSelection(effectiveDraft, formRate, openedShift);
      }
      catch (error) {
        if (financialSection.current) financialSection.current.open = true;
        return setFormError(error instanceof Error ? error.message : 'Confira o acordo financeiro.');
      }
    }
    if (openedShift && endedShift && retroReason.trim().length < 3) {
      const changed = (['doctorId', 'date', 'startTime', 'endTime', 'unitId', 'sectorId', 'specialty', 'type',
        'notes', 'employmentType', 'employerName', 'coverageMode', 'coverageReason'] as const)
        .some(key => (normalized[key] || '') !== (openedShift[key] || ''));
      if (changed || (normalized.status === 'cancelled') !== (openedShift.status === 'cancelled')) {
        setRequestRetroReason(true);
        return setFormError('Informe a justificativa para salvar a alteração retroativa.');
      }
    }
    const dates = !form.id ? buildRecurringDates(form.date, repeatUntil, recurrence, customWeekdays) : [form.date];
    if (!dates.length) return setFormError('Selecione pelo menos um dia da semana dentro do período.');
    if (!form.doctorId && dates.length * vacancyCount > 500) return setFormError('Crie até 500 vagas por vez. Reduza a quantidade ou o período.');
    const candidates = dates.map((candidateDate, index) => ({ ...normalized, id: normalized.id || `recurring-${index}`, date: candidateDate }));
    const duplicate = normalized.doctorId ? candidates.find(candidate => shifts.some(item => item.id !== candidate.id && item.status !== 'cancelled' && item.sectorId === candidate.sectorId && item.date === candidate.date && item.startTime === candidate.startTime && item.endTime === candidate.endTime && item.doctorId === candidate.doctorId)) : undefined;
    if (duplicate) return setFormError(`Já existe um plantão igual em ${new Date(duplicate.date + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
    const conflict = candidates.find(candidate => hasConflict(candidate, shifts));
    if (conflict) return setFormError(`O médico já está escalado em horário coincidente em ${new Date(conflict.date + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
    if (cashEligible && cashRequest) {
      setCashBusy(true);
      try {
        const payment = await readCashPayment(new FormData(event.currentTarget), orgId, cashRequest);
        normalized.cashPayment = payment;
        candidates[0].cashPayment = payment;
      } catch (error) {
        setFormError(error instanceof Error ? error.message : 'Confira os dados do pagamento.');
        return;
      } finally {
        setCashBusy(false);
      }
    }
    let ok: boolean;
    if (form.id) ok = Boolean(await editGuard.run(() => store.updateShift(normalized)));
    else {
      const countPerDate = form.doctorId ? 1 : vacancyCount;
      const inputs = candidates.flatMap(candidate => Array.from({ length: countPerDate }, () => toNewShift(candidate)));
      if (dates.length > 1) {
        setRecurringError('');
        setRecurringPreview({ inputs, dates, countPerDate, cents: normalized.agreement?.mode === 'default' ? formRate?.amount_cents : normalized.agreement?.amount_cents });
        return;
      }
      ok = Boolean(await editGuard.run(() => inputs.length > 1 ? store.addShifts(inputs) : store.addShift(inputs[0], draftShiftId.current)));
    }
    if (ok) setForm(null); else {
      const message = useStore.getState().error || 'Não foi possível salvar o posto.';
      if (endedShift && message.startsWith('Informe uma justificativa')) setRequestRetroReason(true);
      setFormError(message);
    }
  }
  async function confirmRecurrence() {
    if (!recurringPreview || !canCreateSchedule || store.saving) return;
    if (!editGuard.check()) return;
    setRecurringError('');
    if (await editGuard.run(() => store.addShifts(recurringPreview.inputs))) {
      setRecurringPreview(null);
      setForm(null);
    } else setRecurringError(useStore.getState().error || 'Não foi possível salvar a recorrência.');
  }
  function previewWeek(sourceWeek: 'current' | 'previous') {
    setPageError('');
    const from = sourceWeek === 'current' ? week[0] : addDays(week[0], -7);
    const to = sourceWeek === 'current' ? week[6] : addDays(week[6], -7);
    const source = copyableRegularShifts(shifts).filter(item => item.date >= from && item.date <= to && item.status !== 'cancelled' && (!unitId || item.unitId === unitId) && sectorIds.includes(item.sectorId || ''));
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
    const ok = await saveCopiedShifts(weekPreview.clones, 'Semana copiada.');
    if (ok) setWeekPreview(null); else if (useStore.getState().error) setPageError(useStore.getState().error || 'Não foi possível copiar a semana.');
  }
  async function saveCopiedShifts(clones: Shift[], success: string | false = false) {
    if (!canCreateSchedule || !editGuard.check()) return false;
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
      return Boolean(await editGuard.run(() => store.addShifts(clones.map(item => {
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
      }), { success })));
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
  const cashEligible = canEditFinancial && canSaveShift && form?.employmentType === 'pj'
    && Boolean(form.doctorId) && form.status !== 'cancelled' && (form.id || recurrence === 'once')
    && effectiveDraft.frequency === 'on_delivery' && (openedShift?.paymentAmount == null
      || (openedShift.paidAmount || 0) < openedShift.paymentAmount);
  const formPeriods = formSector ? sectorCoveragePeriods(formSector) : [];
  const recurrenceDates = form && !form.id ? buildRecurringDates(form.date, repeatUntil, recurrence, customWeekdays) : [];
  const storedFormRate = openedShift && canSeeFinancial ? chooseShiftRate(rateQuery.rates, openedShift,
    sectors.find(item => item.id === openedShift.sectorId), doctors.find(item => item.id === openedShift.doctorId)?.specialty) : undefined;
  const originalFormShift = form?.id ? shifts.find(item => item.id === form.id) : undefined;
  const formDoctorChanged = Boolean(originalFormShift?.doctorId && originalFormShift.doctorId !== form?.doctorId);
  const currentSegment = openedShift && shifts.find(shift => shift.id === openedShift.id);
  const existingPost = openedShift?.coveragePost;
  const changedScope = Boolean(openedShift && form && (form.unitId !== openedShift.unitId
    || form.sectorId !== openedShift.sectorId || form.specialty !== openedShift.specialty));
  const configuredPeriod = formPeriods.find(period => period.kind === coverageKind);
  const baseline = form && (existingPost || (
    openedShift && !changedScope ? { date: form.date, startTime: openedShift.startTime, endTime: openedShift.endTime, capacity: 1 }
      : configuredPeriod && { date: form.date, startTime: configuredPeriod.startTime, endTime: configuredPeriod.endTime, capacity: 1 }
  ));
  const plan = coveragePlan || baseline || undefined;
  const writePlan = form ? fractionalWritePlan(form, endedShift ? undefined : baseline || undefined, coveragePlan, Boolean(existingPost)) : undefined;
  const hasHourlyRate = Boolean((writePlan || existingPost) && showAgreementFields && form?.doctorId && hourlyRate.trim());
  const hourlyCents = hasHourlyRate ? parseMoneyCents(hourlyRate) : null;
  const coverageZone = existingPost?.timeZone || formUnit?.timeZone || 'America/Sao_Paulo';
  const plannedInterval = existingPost && !coveragePlan ? { start: Date.parse(existingPost.startsAt), end: Date.parse(existingPost.endsAt) }
    : plan && coveragePlanInterval(plan, coverageZone);
  const draftInterval = form && plan ? coveragePlanInterval(form, coverageZone) : undefined;
  const siblings = existingPost ? shifts.filter(shift => shift.coveragePost?.id === existingPost.id) : [];
  const originalSpan = openedShift && coverageSpan(openedShift);
  const coveragePreview = Boolean(writePlan || form && existingPost && (form.doctorId !== openedShift?.doctorId || (form.status === 'cancelled') !== (openedShift?.status === 'cancelled')
    || draftInterval?.start !== originalSpan?.start || draftInterval?.end !== originalSpan?.end));
  const draftSegments = (coveragePreview || !existingPost) && form && plan && plannedInterval ? [
    ...siblings.filter(item => item.id !== form.id),
    ...(form.doctorId && form.status !== 'cancelled' && draftInterval ? [{ ...form, coveragePost: {
      ...plan, id: existingPost?.id || '', revision: existingPost?.revision || 0, timeZone: coverageZone, published: false,
      startsAt: new Date(plannedInterval.start).toISOString(), endsAt: new Date(plannedInterval.end).toISOString(),
      segmentStartsAt: new Date(draftInterval.start).toISOString(), segmentEndsAt: new Date(draftInterval.end).toISOString(),
      segmentDate: form.date, segmentStartTime: form.startTime, segmentEndTime: form.endTime,
    } }] : []),
  ] : siblings;
  const coverageTotals = plan && plannedInterval && calculateFractionalCoverage(plannedInterval, plan.capacity,
    draftSegments.flatMap(segment => segment.doctorId && segment.status !== 'cancelled' ? coverageSpan(segment) || [] : []));
  const hasGapPreview = Boolean(coveragePreview && coverageTotals && coverageTotals.uncoveredMinutes > 0);
  if (previousGapPreview !== hasGapPreview) {
    setPreviousGapPreview(hasGapPreview);
    if (hasGapPreview) setCoveragePanelOpen(true);
  }
  const canViewCoverage = Boolean((existingPost || hasGapPreview || coveragePanelOpen) && !existingPost?.cancelled);
  const vacancyLabel = openedShift?.coveragePost || openedShift && availableVacancies.ids.has(openedShift.id) ? 'Vaga aberta' : 'Posto sem médico';
  const formKind = form && (form.id ? coverageKindForShift(openedShift || form, formPeriods) : coverageKind);
  const plannedClocks = plan && `${plan.startTime}–${plan.endTime}`;
  const canSetCapacity = canSaveShift && (!endedShift || Boolean(existingPost));
  const showFinancialSection = canSeeFinancial && Boolean(cashEligible || showAgreementFields || openedShift);
  const formTitle = form?.id
    ? openedShift?.doctorId ? 'Ficha do plantão' : vacancyLabel === 'Posto sem médico' ? 'Ficha do posto' : 'Ficha da vaga'
    : form?.coverageMode === 'adhoc' ? 'Novo plantão avulso' : form?.doctorId ? 'Novo plantão' : 'Nova vaga';

  async function refreshMasterShifts() {
    store.syncWithCloud(await fetchInitialDataFromSupabase());
  }
  function editMasterRule(context: MasterShiftContext, effectiveDate?: string) {
    if (!context.rule_id || !canEditSchedule || !canCreateSchedule) return;
    editGuard.transition(() => {
      setForm(null); setScheduleMode('master');
      if (context.unit_id) setUnitId(context.unit_id);
      if (context.sector_id) setSectorId(context.sector_id);
      setMasterEditRequest(previous => ({ ruleId: context.rule_id!, date: effectiveDate, nonce: (previous?.nonce || 0) + 1 }));
    });
  }
  function openMasterShift(id: string) {
    const item = shifts.find(shift => shift.id === id);
    if (!item) { setPageError('Atualize a página para consultar este plantão.'); return; }
    setScheduleMode('general'); setUnitId(item.unitId); if (item.sectorId) setSectorId(item.sectorId); setDate(coverageDate(item)); openShift(item);
  }

  useScheduleDraft('week-copy', weekPreview ? JSON.stringify(weekPreview.clones.map(shift => shift.id)) : null, store.saving, () => setWeekPreview(null));
  useScheduleDraft('shift', form ? JSON.stringify([form, coveragePlan, hourlyRate, agreementDraft, vacancyCount, recurrence, customWeekdays, repeatUntil]) : null, store.saving, () => { setForm(null); setRecurringPreview(null); });
  const scopePicker = <ScheduleScopePicker units={units} sectors={sectors} unitId={unitId} selection={sectorSelection} compact={scopeReady}
    onSelectUnit={id => editGuard.transition(() => { setUnitId(id); setSectorId(''); setDoctorId(''); setSpecialty(''); setFocusedTurn(null); })}
    onSelectSectors={value => editGuard.transition(() => { setSectorSelection(value); setDoctorId(''); setSpecialty(''); setFocusedTurn(null); })}/>;
  if (!scopeReady) return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="nv-page-title">Escala médica</h1><ScheduleEditControl/></header>
    {scopePicker}
  </div>;

  return <div className="nv-schedule min-w-0 space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-2"><h1 className="nv-page-title">Escala médica</h1><div className="flex flex-wrap gap-2"><ScheduleEditControl/>{canPerformAction(store.currentUser, 'escala', 'history') && <button type="button" className="nv-button-secondary" onClick={() => setHistoryTarget({})}>Histórico de alterações</button>}{canApproveSchedule && <Link className="nv-button-secondary" href="/escala/candidaturas"><ArrowRightLeft size={16}/>Candidaturas e trocas</Link>}{canCreateSchedule && scheduleMode === 'general' && <><button className="nv-button-secondary" onClick={() => openShift(undefined, undefined, date, undefined, 1, true)} disabled={!units.length}><Plus size={16}/>Plantão avulso</button><button className="nv-button" onClick={() => openShift()} disabled={!units.length}><Plus size={16}/>Novo posto</button></>}</div></header>
    <div className="flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2">
      {scopePicker}
      <nav className="flex w-fit gap-1 rounded-lg border border-border bg-card-bg p-1" aria-label="Tipo de escala">
        {([['general', 'Escala Geral'], ['master', 'Escala Master']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={scheduleMode === value}
          onClick={() => editGuard.transition(() => setScheduleMode(value))}
          className={`min-h-10 rounded-md px-4 text-sm font-semibold ${scheduleMode === value ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-state-hover'}`}>{label}</button>)}
      </nav>
    </div>
    {scheduleMode === 'master' ? <ScheduleMasterView key={`${orgId}:${unitId}:${sectorId}`} organization={orgId} unitId={unitId} sectorId={sectorId} sectorIds={sectorIds} doctors={doctors} units={units} sectors={sectors} canCreate={canCreateSchedule} canEdit={canEditSchedule} canApprove={canApproveSchedule} canFinance={canEditFinancial} canViewHistory={canPerformAction(store.currentUser, 'escala', 'history')} canManageAbsences={canPerformAction(store.currentUser, 'escala', 'edit') && canPerformAction(store.currentUser, 'escala', 'approve')} editRequest={masterEditRequest} onChanged={refreshMasterShifts} onOpenShift={openMasterShift}/> : <>
    {mobile && <nav className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-card-bg p-1" aria-label="Visualização da escala no celular">
        {([['month', 'Mês'], ['week', 'Semana'], ['day', 'Dia'], ['list', 'Lista']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mobileView === value}
          onClick={() => { if (statusFilter === 'cancelled') setStatusFilter('all'); changeMobileView(value); }} className={`min-h-10 rounded-lg text-sm font-semibold ${mobileView === value ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-state-hover'}`}>{label}</button>)}
    </nav>}

    <nav aria-label="Visualização da escala" className="hidden w-fit flex-wrap rounded-lg border border-border bg-card-bg p-1 md:flex">
      {([['week', 'Semana'], ['day', 'Dia'], ['month', 'Mês'], ['doctor', 'Por médico'], ['specialty', 'Por especialidade'], ['list', 'Plantões']] as const).map(([value, label]) => (
        <button key={value} type="button" aria-pressed={view === value}
          onClick={() => { if (statusFilter === 'cancelled' && (value === 'week' || value === 'day' || value === 'month')) setStatusFilter('all'); setView(value); }}
          className={`flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${view === value ? 'bg-primary text-text-inverse' : 'text-text-secondary hover:bg-state-hover'}`}>
          {value === 'list' && <List size={15} aria-hidden="true"/>}{label}
        </button>
      ))}
    </nav>
    {(statusFilter === 'open' || coverageFilter === 'open') && (availableVacancies.loading || availableVacancies.error) && <p role={availableVacancies.error ? 'alert' : 'status'} className="text-sm text-text-secondary">{availableVacancies.error || 'Verificando vagas disponíveis…'}</p>}
    {pageError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{pageError}</p>}

    <div className="min-w-0 space-y-2">
      <div role="group" aria-label="Navegação por período" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-card-bg px-1.5 py-1 md:px-2">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-1 md:w-fit md:flex-none">
          <button type="button" aria-label={previousPeriodLabel} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-state-hover" onClick={() => navigate(-1)}><ChevronLeft size={18} aria-hidden="true"/></button>
          <span aria-live="polite" className="min-w-0 px-1 text-center text-sm font-semibold first-letter:uppercase md:min-w-44">{periodLabel}</span>
          <button type="button" aria-label={nextPeriodLabel} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-state-hover" onClick={() => navigate(1)}><ChevronRight size={18} aria-hidden="true"/></button>
        </div>
        <button type="button" className="min-h-11 shrink-0 rounded-lg px-2.5 text-sm font-semibold text-primary hover:bg-state-hover" onClick={() => setDate(today)}>Hoje</button>
        <div className="hidden w-36 md:block">
          <input aria-label="Ir para data" title="Ir para data" type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} className="nv-input text-xs"/>
        </div>
        {(filtersActive || (!requestedShiftId && urgentPeriods.length > 0)) && <div className="flex w-full flex-wrap items-center gap-x-2 border-t border-border sm:w-auto sm:border-t-0">
          {filtersActive && <div className="inline-flex items-center gap-1 px-2 text-xs text-text-secondary">
            <span role="status">Filtros ativos</span>
            <button type="button" className="min-h-9 rounded-md px-2 font-semibold text-primary hover:bg-state-hover" onClick={clearFilters}>Limpar filtros</button>
          </div>}
          {!requestedShiftId && urgentPeriods.length > 0 && <button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-danger hover:bg-state-hover" onClick={() => {
            const details = criticalDetails.current;
            if (!details) return;
            details.open = true;
            details.querySelector('summary')?.focus({ preventScroll: true });
            details.scrollIntoView({ block: 'start' });
          }}><AlertTriangle size={14} aria-hidden="true"/>{urgentPeriods.length} {urgentPeriods.length === 1 ? 'alerta crítico' : 'alertas críticos'}</button>}
        </div>}
      </div>
    {view === 'list' ? <div id="plantao" tabIndex={-1} className="space-y-3">
      {requestedShiftId && <Link className="nv-button-secondary" href={'/escala?' + new URLSearchParams({ date, unitId, sectorId })}>Voltar para a escala do dia</Link>}
      <ScheduleList availableVacancyIds={availableVacancies.ids} days={listDays} shifts={listShifts} units={units} sectors={sectors} doctors={doctors} doctorWarnings={doctorDocumentState} onEdit={openShift} onDelete={canDeleteSchedule ? item => openDelete('shift', { shiftId: item.id, from: item.date, to: item.date }) : undefined}/>
    </div> : view === 'doctor' ? <ScheduleDoctorView doctors={visibleDoctors} sectors={sectors} units={units} shifts={listShifts} allShifts={shifts} month={month} canSeeFinancial={canSeeFinancial} onEdit={openShift}/> : view === 'specialty' ? <ScheduleSpecialtyView doctors={doctors} sectors={sectors} shifts={listShifts} allShifts={shifts} month={month} onEdit={openShift}/> : <ScheduleCalendarView
      key={`${orgId}:${unitId}:${sectorId}:${focusedTurn?.nonce || 0}`}
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
      specialty={specialty}
      coverageMode={coverageModeFilter}
      availableVacancyIds={availableVacancies.ids}
      now={referenceTime}
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
      onEditMasterRule={canEditSchedule && canCreateSchedule ? editMasterRule : undefined}
      onHistory={canPerformAction(store.currentUser, 'escala', 'history') ? id => setHistoryTarget({ shiftId: id }) : undefined}
    />}
    </div>
    <details className="rounded-lg border border-border bg-card-bg px-4 py-3 text-sm"><summary className="cursor-pointer font-medium text-text-secondary">Filtros avançados{filtersActive ? ' · ativos' : ''}</summary><div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3"><label className="nv-label">Modalidade de contratação<select className="nv-input" value={employment} onChange={event => setEmployment(event.target.value as EmploymentType | '')}><option value="">Todos</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => { setSpecialty(event.target.value); setDoctorId(''); }}><option value="">Todas</option>{[...new Set([...sectors.flatMap(item => item.specialties), ...doctors.map(item => item.specialty)])].filter(Boolean).sort().map(item => <option key={item} value={item}>{item}</option>)}</select></label><label className="nv-label">Médico<select className="nv-input" value={doctorId} onChange={event => setDoctorId(event.target.value)}><option value="">Todos</option>{visibleDoctors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="nv-label">Turno<select className="nv-input" value={periodKind} onChange={event => setPeriodKind(event.target.value as CoveragePeriodKind | '')}><option value="">Todos</option><option value="day">Diurno</option><option value="night">Noturno</option></select></label><label className="nv-label">Documentação<select className="nv-input" value={documentFilter} onChange={event => setDocumentFilter(event.target.value as 'all' | 'regular' | 'pending')}><option value="all">Todas</option><option value="regular">Regular</option><option value="pending">Pendente</option></select></label>
      <label className="nv-label">Situação do plantão<select className="nv-input" value={statusFilter} onChange={event => {
      const value = event.target.value as typeof statusFilter;
      setStatusFilter(value);
      setCoverageFilter('all');
      if (value === 'cancelled') setView('list');
    }}>
      <option value="all">Todos os plantões ativos</option><option value="exchange">Troca solicitada</option>
      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
      {myDoctor && <label className="flex min-h-10 items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={doctorId === myDoctor.id} onChange={event => setDoctorId(event.target.checked ? myDoctor.id : '')}/>Minhas escalas</label>}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2" role="group" aria-label="Tipo de plantão">
        <span className="mr-1 text-xs text-text-muted" aria-hidden="true">Tipo de plantão</span>
        {([['all', 'Todos'], ['regular', 'Regulares'], ['adhoc', 'Avulsos']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={coverageModeFilter === value}
          onClick={() => setCoverageModeFilter(value)}
          className={`min-h-9 rounded-lg px-3 text-xs font-medium ${coverageModeFilter === value ? 'bg-primary/10 text-primary' : 'text-text-muted hover:bg-state-hover'}`}>{label}</button>)}
      </div>
    </details>
    {!requestedShiftId && urgentPeriods.length > 0 && <details ref={criticalDetails} className="scroll-mt-24 rounded-lg border border-danger/25 bg-card-bg px-3">
      <summary className="cursor-pointer py-2.5 text-sm font-semibold text-danger">Alertas críticos ({urgentPeriods.length})</summary>
      <div className="grid gap-x-4 pb-2 sm:grid-cols-2">
        {urgentPeriods.map(({ sector, day, period }) => {
          const conflict = period.assigned.some(shift => conflictIds.has(shift.id));
          const blocked = period.assigned.some(shift => doctorDocumentState.get(shift.doctorId || '')?.blocked);
          const filter = conflict ? 'conflict' : blocked ? 'critical' : 'deficit';
          return <button key={`${sector.id}-${day}-${period.period.kind}`} type="button"
            onClick={() => {
              setDate(day);
              setUnitId(sector.unitId);
              setSectorId(sector.id);
              setDoctorId('');
              setEmployment('');
              setSpecialty('');
              setDocumentFilter('all');
              setPeriodKind('');
              setStatusFilter('all');
              setCoverageModeFilter('all');
              setCoverageFilter(filter);
              setView('week');
              setFocusedTurn(previous => ({ day, sectorId: sector.id, kind: period.period.kind, nonce: (previous?.nonce || 0) + 1 }));
            }}
            className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border-t border-border px-2 py-2 text-left text-xs hover:bg-state-hover">
            <span className="min-w-0 wrap-anywhere"><strong className="font-semibold">{sector.name}</strong><span className="text-text-muted"> · {formatDay(day)} · {coveragePeriodLabel(period.period.kind)}</span></span>
            <span className="font-semibold text-danger">{conflict ? 'Conflito de horário' : blocked ? 'Impedimento documental' : `${period.deficit} ${period.deficit === 1 ? 'posto' : 'postos'} em falta em até 24h`}</span>
          </button>;
        })}
      </div>
    </details>}
    {(canCreateSchedule || canDeleteSchedule) && <details className="rounded-lg border border-border bg-card-bg px-4 py-3 text-sm"><summary className="cursor-pointer font-medium text-text-secondary">Gerenciar escala</summary><div className="mt-3 flex flex-wrap items-center gap-2"><button className="nv-button-secondary" onClick={() => previewWeek('previous')} disabled={!canCreateSchedule || view !== 'week' || store.saving}><Copy size={15}/>Copiar semana anterior</button><button className="nv-button-secondary" onClick={() => previewWeek('current')} disabled={!canCreateSchedule || view !== 'week' || store.saving}><Copy size={15}/>Replicar para a próxima</button>{canDeleteSchedule && <button type="button" onClick={() => openDelete('period')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-text-secondary transition hover:border-danger/40 hover:bg-danger/5 hover:text-danger"><Trash2 size={15}/>Excluir da escala</button>}</div></details>}

    <details className="rounded-xl border border-border bg-card-bg px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-text-secondary">Pendências e cobertura{coverageFilter !== 'all' ? ' · filtro ativo' : ''}</summary>
      <div className="mt-4 space-y-5">
    <section className="p-1" aria-label="Resumo da cobertura">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="min-w-[210px] flex-1"><p className="text-xs font-medium text-text-muted">Cobertura operacional · unidade, setores e turno</p><p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-text-primary">{coveragePercent}% <span className="text-sm font-normal text-text-muted">· {filled} de {required} postos</span></p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-label="Cobertura do período" aria-valuenow={coveragePercent} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none" style={{ width: `${coveragePercent}%` }}/></div></div>
        <button type="button" onClick={() => setCoverageFilter('deficit')} className="text-left"><span className={`block text-2xl font-semibold tabular-nums ${deficit > 0 ? 'text-danger' : 'text-text-secondary'}`}>{deficit}</span><span className="text-xs text-text-muted">turnos com déficit</span></button>
        <button type="button" onClick={() => setCoverageFilter('open')} className="text-left"><span className={`block text-2xl font-semibold tabular-nums ${open > 0 ? 'text-danger' : 'text-text-secondary'}`}>{open}</span><span className="text-xs text-text-muted">vagas abertas</span></button>
        <button type="button" onClick={() => setCoverageFilter('conflict')} className="text-left"><span className={`block text-2xl font-semibold tabular-nums ${conflicts > 0 ? 'text-warning' : 'text-text-secondary'}`}>{conflicts}</span><span className="text-xs text-text-muted">turnos com conflito</span></button>
        <button type="button" onClick={() => setCoverageFilter('pending')} className="text-left"><span className="block text-2xl font-semibold tabular-nums text-text-primary">{pending}</span><span className="text-xs text-text-muted">confirmações pendentes</span></button>
      </div>
    </section>

    <div className="flex flex-wrap gap-2" aria-label="Filtros rápidos de cobertura">{([
      ['all', 'Todos', 0], ['deficit', 'Com déficit', deficit], ['open', 'Vagas abertas', open], ['conflict', 'Conflitos', conflicts], ['critical', 'Críticos', critical], ['pending', 'Confirmação pendente', pending], ['complete', 'Completos', 0],
    ] as const).map(([filter, label, count]) => <button key={filter} type="button" aria-pressed={coverageFilter === filter} onClick={() => setCoverageFilter(filter)} className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition ${coverageFilter === filter ? 'border-primary bg-primary/10 text-primary' : (filter === 'deficit' || filter === 'open') && count > 0 ? 'border-danger/30 text-danger hover:bg-danger/5' : 'border-border bg-card-bg text-text-secondary hover:bg-state-hover'}`}>{label}{count > 0 ? ` ${count}` : ''}</button>)}</div>

    {(doctorsWithDocumentsPending > 0 || pending > 0 || deficit > 0) && <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {deficit > 0 && <button type="button" onClick={() => { setCoverageFilter('deficit'); setView('week'); }} className="min-h-10 font-medium text-danger hover:underline">{deficit} {deficit === 1 ? 'turno com déficit' : 'turnos com déficit'}</button>}
      {pending > 0 && <button type="button" onClick={() => { setCoverageFilter('pending'); setView('week'); }} className="min-h-10 font-medium text-warning hover:underline">{pending} {pending === 1 ? 'confirmação pendente' : 'confirmações pendentes'}</button>}
      {doctorsWithDocumentsPending > 0 && <button type="button" onClick={() => { setDocumentFilter('pending'); setCoverageFilter('all'); setView('week'); }} className="min-h-10 font-medium text-text-secondary hover:underline">{doctorsWithDocumentsPending} {doctorsWithDocumentsPending === 1 ? 'médico' : 'médicos'} com documentação pendente</button>}
    </div>}

      </div>
    </details>
    </>}
    {historyTarget && canPerformAction(store.currentUser, 'escala', 'history') && <ScheduleHistory organization={orgId} unitId={unitId} sectorIds={sectorIds} shiftId={historyTarget.shiftId} units={units} sectors={sectors} shifts={shifts} onClose={() => setHistoryTarget(null)}/>}
    {selectionShift && <Dialog title="Candidaturas e histórico do plantão" onClose={() => editGuard.transition(() => setSelectionShift(null))}>
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
      {(statusFilter === 'open' || coverageFilter === 'open') && (availableVacancies.loading || availableVacancies.error) && <p role={availableVacancies.error ? 'alert' : 'status'} className="text-sm text-text-secondary">{availableVacancies.error || 'Verificando vagas disponíveis…'}</p>}
    {pageError && <p role="alert" className="text-xs text-danger">{pageError}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" onClick={() => setWeekPreview(null)} disabled={store.saving}>Cancelar</button><button type="button" className="nv-button" onClick={() => void confirmWeekPreview()} disabled={Boolean(weekPreview.blocked || weekPreview.duplicates || weekPreview.conflicts || store.saving || !canCreateSchedule)}>{store.saving ? 'Copiando…' : 'Copiar postos'}</button></div>
    </div></Dialog>}
    {confirmAdministrative && <ShiftApprovalDialog shift={confirmAdministrative} onClose={() => setConfirmAdministrative(null)}
      onSaved={async () => {
        setConfirmAdministrative(null);
        setForm(null);
        try { await refreshMasterShifts(); }
        catch { notify.warning('Atualize a página para consultar a aprovação.'); }
      }}/>}
    {form && <Dialog title={formTitle} closeDisabled={store.saving || cashBusy}
      headerActions={<>
        {canViewCoverage && <button type="button" ref={coverageToggle} aria-expanded={coveragePanelOpen}
          aria-controls={coveragePanelOpen ? 'shift-coverage-panel' : undefined} onClick={() => setCoveragePanelOpen(!coveragePanelOpen)}
          className="min-h-10 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-state-hover">Cobertura</button>}
        {form.id && canPerformAction(store.currentUser, 'escala', 'history') && <button type="button" onClick={() => setHistoryTarget({ shiftId: form.id })}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-state-hover">
          <History size={15} aria-hidden="true" className="hidden sm:block"/>Ver histórico</button>}
      </>}
      aside={canViewCoverage && coveragePanelOpen && plannedInterval && plan && formKind ? <ShiftCoverageTimeline
        planned={plannedInterval} capacity={plan.capacity} segments={draftSegments} doctors={doctors}
        timeZone={coverageZone} kind={formKind} preview={coveragePreview || !existingPost}
        onClose={() => { setCoveragePanelOpen(false); coverageToggle.current?.focus(); }}
        onOpen={existingPost && !coveragePreview ? item => {
          if (item.id !== form.id) editGuard.transition(() => { openShift(item); setCoveragePanelOpen(true); });
        } : undefined}/> : undefined}
      onClose={() => !store.saving && !cashBusy && editGuard.transition(() => setForm(null))}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="nv-button-secondary" onClick={() => editGuard.transition(() => setForm(null))} disabled={store.saving || cashBusy}>Cancelar</button>
        <button type="submit" form="shift-entry-form" className="nv-button" disabled={store.saving || cashBusy || !canSaveShift}
          title={editRestriction || undefined}>{store.saving ? <><LoaderCircle size={15} className="animate-spin" aria-hidden="true"/>Salvando…</>
            : recurrenceDates.length > 1 ? 'Revisar recorrência' : form.doctorId ? 'Salvar plantão' : !form.id && vacancyCount > 1 ? `Criar ${vacancyCount} vagas` : 'Salvar vaga'}</button>
      </div>}>
      <form data-schedule-edit id="shift-entry-form" key={form.id || 'draft'} className="space-y-4" onSubmit={save} aria-busy={store.saving}
        onInvalidCapture={event => { const section = (event.target as HTMLElement).closest('details'); if (section) section.open = true; }}>
        {existingPost?.cancelled && <p className="nv-feedback text-text-secondary">Posto cancelado</p>}
        {editRestriction && <p className="nv-feedback text-text-secondary">{editRestriction}</p>}
        <fieldset disabled={!canSaveShift || store.saving || cashBusy} className="min-w-0 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="nv-label min-w-0">Unidade
              <select className="nv-input" required value={form.unitId} disabled={Boolean(existingPost)} onChange={event => updateFormUnit(event.target.value)}>
                <option value="">Selecione</option>{form.unitId && !formUnit && <option value={form.unitId}>{store.units.find(item => item.id === form.unitId)?.name || form.unitId}</option>}
                {units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </label>
            <div className="min-w-0">
              <label className="nv-label">Setor
                <select className="nv-input" required={form.coverageMode !== 'adhoc'} value={form.sectorId || ''} disabled={Boolean(existingPost)} onChange={event => updateFormSector(event.target.value)}>
                  <option value="">{form.coverageMode === 'adhoc' ? 'Sem setor' : 'Selecione'}</option>
                  {form.sectorId && !formSector && <option value={form.sectorId}>{form.sector || 'Setor registrado'}</option>}
                  {formSectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}
                </select>
              </label>
            </div>
            {formSector ? <p className="text-xs text-text-secondary sm:col-span-2">{form.specialty || 'Setor sem especialidade principal.'}
              {!formSector.primarySpecialty && canEditPermission(store.currentUser, 'unidades') && <Link className="ms-2 text-primary underline"
                href={canViewPermission(store.currentUser, 'configuracoes') ? '/configuracoes#setores-especialidades' : `/unidades/${form.unitId}`}>Configurar especialidade</Link>}
            </p> : <label className="nv-label sm:col-span-2">Especialidade
              <select className="nv-input" required value={form.specialty || ''} disabled={Boolean(existingPost)} onChange={event => updateFormSpecialty(event.target.value)}>
                <option value="">Selecione</option>
                {form.specialty && !formSpecialties.includes(form.specialty) && <option value={form.specialty}>{form.specialty}</option>}
                {formSpecialties.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {!form.id && formPeriods.length > 1 ? <label className="nv-label min-w-0">Período
              <select className="nv-input" value={coverageKind} onChange={event => chooseCoverage(event.target.value as CoveragePeriodKind)}>
                {formPeriods.map(period => <option key={period.kind} value={period.kind}>{coveragePeriodLabel(period.kind)}</option>)}
              </select>
            </label> : <div className="min-w-0">
              <span className="nv-label">Período</span>
              <p className="mt-2 flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                {formKind === 'night' ? <Moon size={15} aria-hidden="true"/> : <Sun size={15} aria-hidden="true"/>}
                {coveragePeriodLabel(formKind || 'day')}
              </p>
            </div>}
            <label className="nv-label min-w-0">Data<input className="nv-input" type="date" required value={form.date}
              onChange={event => {
                const day = event.target.value;
                setForm(current => current && { ...current, date: day });
                if (coveragePlan && !existingPost) setCoveragePlan({ ...coveragePlan, date: day });
                if (day && repeatUntil < day) setRepeatUntil(form.coverageMode === 'adhoc' ? endOfMonth(day) : addDays(day, 90));
              }}/></label>
          </div>
          <label className="nv-label">Médico<select className="nv-input" disabled={!eligibilityReady} value={form.doctorId || ''} onChange={event => updateDoctor(event.target.value)}><option value="">Deixar como vaga aberta</option>{eligibleDoctors.map(doctor => { const compliance = doctorDocumentState.get(doctor.id); const recorded = unchangedAssignment && form.doctorId === doctor.id && !eligibility?.ids.includes(doctor.id); return <option key={doctor.id} value={doctor.id} disabled={recorded}>{doctor.name}{recorded ? ' · responsável registrado' : compliance?.warning ? ' · atenção documental' : ''}</option>; })}</select>{!eligibilityReady && <span role="status" className="mt-2 block text-xs text-text-muted">{eligibility?.key === eligibilityKey && eligibility.error ? <>{eligibility.error}<button type="button" className="ml-2 text-primary underline" onClick={() => setEligibilityRevision(value => value + 1)}>Tentar novamente</button></> : 'Consultando médicos elegíveis…'}</span>}{eligibilityReady && !eligibleDoctors.length && <span className="mt-2 block text-xs font-normal text-text-muted">Nenhum médico elegível encontrado para este setor. Você pode deixar a vaga em aberto.</span>}{formDoctorChanged && <span className="mt-1.5 block text-xs font-normal text-warning">O novo médico ficará aguardando confirmação após salvar.</span>}</label>{form.doctorId && doctorDocumentState.get(form.doctorId)?.warning && <div className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${doctorDocumentState.get(form.doctorId)?.blocked ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/30 bg-warning/5 text-warning'}`}><span className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0"/>Confira as pendências na pasta documental. As autorizações aplicáveis ao plantão são verificadas ao salvar.</span><Link href={`/documentos/${form.doctorId}`} className="shrink-0 font-semibold underline">Abrir pasta</Link></div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="nv-label min-w-0">{form.doctorId ? 'Início do médico' : 'Início da vaga'}
              <input className="nv-input" type="time" required value={form.startTime} onChange={event => {
                const startTime = event.target.value;
                setForm(current => current && { ...current, startTime });
              }}/>
            </label>
            <label className="nv-label min-w-0">{form.doctorId ? 'Fim do médico' : 'Fim da vaga'}
              <input className="nv-input" type="time" required value={form.endTime} onChange={event => {
                const endTime = event.target.value;
                setForm(current => current && { ...current, endTime });
              }}/>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary empty:hidden">
            {plannedClocks && <span className="tabular-nums">Posto previsto {plannedClocks}</span>}
            {form.endTime <= form.startTime && (form.endTime < form.startTime || writePlan || existingPost) && <span>Termina no dia seguinte</span>}
          </div>
          {sectorNotice && <p role="status" className="text-xs text-text-secondary">{sectorNotice}</p>}
        </fieldset>
        {currentSegment?.coveragePost && !currentSegment.doctorId && currentSegment.status === 'open' && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-text-secondary">{currentSegment.coveragePost.published ? 'Publicada no Portal Médico' : 'Publicação pendente no Portal Médico'}</span>
        {canEditSchedule && <button type="button" className="min-h-9 rounded px-2 font-semibold text-primary hover:bg-state-hover"
          disabled={store.saving || coveragePreview} onClick={() => void editGuard.run(async () => {
            const ok = await store.publishCoverage(currentSegment, !currentSegment.coveragePost?.published);
            if (!ok) setFormError(useStore.getState().error || 'Não foi possível atualizar a publicação.');
          })}>{currentSegment.coveragePost.published ? 'Retirar publicação' : 'Publicar vaga'}</button>}
      </div>}
        <div>
          <ShiftFormSection title="Dados operacionais" sectionRef={operationalSection}>
            <fieldset disabled={!canSaveShift || store.saving || cashBusy} className="min-w-0 space-y-3">
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
            <option value={form.status === "confirmed" ? "confirmed" : "pending"}>Escalado</option>
            <option value="completed">Concluído</option><option value="cancelled">Cancelado</option>
          </select>
        </label>}
      </div>
      {form.employmentType && <label className="nv-label">{form.employmentType === 'pj' ? 'Empresa PJ' : form.employmentType === 'concursado' ? 'Prefeitura / órgão público' : 'Empregador'}
        <input className="nv-input" list="employer-options" required={Boolean(form.doctorId && form.employmentType === 'pj')} maxLength={150}
          value={form.employerName || ''} onChange={event => setForm({ ...form, employerName: event.target.value })}/>
        <datalist id="employer-options">{employers.map(item => <option key={item} value={item}/>)}</datalist>
      </label>}
      {newPjAgreement && !canEditFinancial && <p className="text-sm text-warning">A confirmação do valor PJ exige permissão financeira.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Modalidade assistencial<select className="nv-input" value={form.type} disabled={Boolean(existingPost)} onChange={event => setForm({ ...form, type: event.target.value as Shift['type'] })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className="nv-label">Observações<textarea className="nv-input" rows={2} maxLength={1000} value={form.notes || ''} onChange={event => setForm({ ...form, notes: event.target.value })}/></label>
              <p className="text-xs text-text-secondary">Cobertura {form.coverageMode === 'adhoc' ? 'avulsa' : 'regular'}</p>
              {form.coverageMode === 'adhoc' && <label className="nv-label">Motivo da cobertura
                <input className="nv-input" required minLength={3} maxLength={200} value={form.coverageReason || ''} readOnly={Boolean(existingPost)}
                  onChange={event => setForm({ ...form, coverageReason: event.target.value })}/>
              </label>}
              {canCreateSector && !existingPost && <button type="button" disabled={!formUnit || store.saving} className="text-sm font-medium text-primary underline"
                onClick={() => { setSectorNotice(''); setSectorEditorOpen(true); }}>Novo setor</button>}
              {canSetCapacity && <div className="grid gap-3 sm:grid-cols-3">
                {(!openedShift || existingPost) && <>
                  <label className="nv-label">Início previsto<input className="nv-input" type="time" value={plan?.startTime ?? form.startTime}
                    onChange={event => setCoveragePlan({ ...(plan || { date: form.date, startTime: form.startTime, endTime: form.endTime, capacity: 1 }), startTime: event.target.value })}/></label>
                  <label className="nv-label">Fim previsto<input className="nv-input" type="time" value={plan?.endTime ?? form.endTime}
                    onChange={event => setCoveragePlan({ ...(plan || { date: form.date, startTime: form.startTime, endTime: form.endTime, capacity: 1 }), endTime: event.target.value })}/></label>
                </>}
                <label className="nv-label">Médicos simultâneos<input className="nv-input" type="number" min={1} max={20} value={Number.isNaN(plan?.capacity) ? '' : plan?.capacity ?? 1}
                  onChange={event => setCoveragePlan({ ...(plan || { date: form.date, startTime: form.startTime, endTime: form.endTime, capacity: 1 }), capacity: event.target.valueAsNumber })}/></label>
              </div>}
              {!form.id && <div className="space-y-2">
                <div className="grid gap-3 sm:grid-cols-2"><label className="nv-label">Frequência<select aria-label="Frequência" className="nv-input" value={recurrence} onChange={event => setRecurrence(event.target.value as ShiftRecurrence)}><option value="once">Somente esta data</option><option value="daily">Todos os dias</option><option value="weekdays">Segunda a sexta</option><option value="every_other_day">12x36</option><option value="custom">Personalizado</option><option value="weekly">Semanal</option><option value="fortnightly">Quinzenal</option><option value="monthly">Mensal</option></select></label>{recurrence !== 'once' && <label className="nv-label">Repetir até<input className="nv-input" type="date" min={form.date} required value={repeatUntil} onChange={event => setRepeatUntil(event.target.value)}/></label>}</div>{recurrence === "custom" && <fieldset className="mt-3"><legend className="text-xs font-medium text-text-secondary">Dias da semana</legend><div className="mt-2 flex flex-wrap gap-1">{[["Dom", 0], ["Seg", 1], ["Ter", 2], ["Qua", 3], ["Qui", 4], ["Sex", 5], ["Sáb", 6]].map(([label, value]) => <button key={value} type="button" aria-pressed={customWeekdays.includes(Number(value))} onClick={() => setCustomWeekdays(days => days.includes(Number(value)) ? days.filter(day => day !== Number(value)) : [...days, Number(value)])} className={`min-h-9 rounded-lg border px-2.5 text-xs font-medium ${customWeekdays.includes(Number(value)) ? "border-primary bg-primary/10 text-primary" : "border-border text-text-secondary"}`}>{label}</button>)}</div></fieldset>}{recurrence !== "once" && recurrenceDates.length > 0 && <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-text-secondary"><strong className="text-text-primary">{recurrenceDates.length * (form.doctorId ? 1 : vacancyCount)} postos em {recurrenceDates.length} datas:</strong> {recurrenceDescription(form.date, recurrence)}, das {form.startTime} às {form.endTime}, até {new Date(repeatUntil + 'T12:00:00').toLocaleDateString('pt-BR')}.</p>}
                {!form.doctorId && <label className="nv-label">Quantidade de vagas<input className="nv-input" type="number" min={1} max={20} value={vacancyCount}
                  onChange={event => setVacancyCount(Math.max(1, Number(event.target.value)))}/></label>}
              </div>}
            </fieldset>
            {form.id && <MasterShiftOrigin ids={[form.id]} date={form.date} canEdit={canEditSchedule && canCreateSchedule}
              onEditRule={editMasterRule} editingOccurrence/>}
            {canDeleteSchedule && existingPost && !existingPost.cancelled && !coveragePreview && <button type="button"
              className="min-h-10 rounded text-sm font-medium text-danger hover:underline" onClick={() => setCancelCoverageOpen(true)}>Cancelar posto</button>}
          </ShiftFormSection>
          {showFinancialSection && <ShiftFormSection title="Dados financeiros" sectionRef={financialSection}>
            {cashEligible && <section className="space-y-3">
        <label className="nv-label flex items-center gap-2">
          <input type="checkbox" checked={Boolean(cashRequest)}
            onChange={event => setCashRequest(event.target.checked ? crypto.randomUUID() : '')}/>
          Plantão pago à vista
        </label>
        {cashRequest && <ShiftCashPaymentFields amount={openedShift?.paymentAmount == null ? undefined
          : Math.max(0, openedShift.paymentAmount - (openedShift.paidAmount || 0))}/>}
      </section>}
      {canSeeFinancial && openedShift && (openedShift.employmentType === 'pj' || openedShift.paymentAgreement || openedShift.paymentAmount != null || openedShift.paidAt) && <>
        <ShiftFinancialDetails shift={openedShift} applicableRate={storedFormRate} />
        <ShiftPaymentHistory key={openedShift.id} shiftId={openedShift.id} />
        {openedShift.employmentType === 'pj' && (openedShift.doctorId || openedShift.paymentAgreement) && <Link className="nv-button-secondary" href={'/financeiro?' + new URLSearchParams({ period: 'all', shiftId: openedShift.id })}>Abrir ficha no financeiro</Link>}
      </>}
      {(writePlan || existingPost) && showAgreementFields && form.doctorId && <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
        <label className="nv-label">Valor por hora (R$)
          <input className="nv-input" value={hourlyRate} inputMode="decimal" placeholder="Opcional"
            onChange={event => setHourlyRate(event.target.value)}/>
        </label>
        {hasHourlyRate && <label className="nv-label">Frequência de pagamento
          <select className="nv-input" value={effectiveDraft.frequency}
            onChange={event => setAgreementDraft({ ...effectiveDraft, frequency: event.target.value as Shift['paymentFrequency'] || 'on_delivery', frequencyEdited: true })}>
            {Object.entries(paymentFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
        {hourlyCents != null && draftInterval && <p className="text-sm font-medium sm:col-span-2">Valor previsto da alocação {formatShiftMoney(Math.round(hourlyCents * coverageMinutes(draftInterval) / 60))}</p>}
      </div>}
      {showAgreementFields && !hasHourlyRate && (rateQuery.ready
        ? <ShiftAgreementFields draft={effectiveDraft} onChange={setAgreementDraft} rate={formRate} previous={newPjAgreement ? undefined : openedShift} requireAmount={Boolean(newPjAgreement)} dueFor={form} />
        : <div className="space-y-1 text-sm text-text-muted" role="status">
          <p>{rateQuery.error || 'Consultando valores padrão…'}</p>
          {rateQuery.error && <button type="button" className="text-primary underline" onClick={rateQuery.reload}>Tentar novamente</button>}
        </div>)}
          </ShiftFormSection>}
          {form.id && canApproveSchedule && <ShiftFormSection title="Candidaturas e trocas">
            <button type="button" className="min-h-10 text-sm font-medium text-primary underline"
              onClick={() => editGuard.transition(() => { setSelectionShift(openedShift || form); setForm(null); })}>Ver candidaturas e trocas</button>
          </ShiftFormSection>}
          {openedShift && <ShiftFormSection title="Intervalos e aprovações">
            {!openedShift.coveragePost && <p className="text-sm text-text-secondary">{statusLabels[openedShift.status]}</p>}
            {openedShift.doctorId && openedShift.approvalSource && <p className="text-sm text-text-secondary">{shiftApprovalLabels[openedShift.approvalSource]}</p>}
            {openedShift.approvalSource === 'automatic' && <p className="text-xs text-text-secondary">{automaticShiftApprovalMessage}</p>}
            {siblings.length > 1 && <ul className="divide-y divide-border text-sm">
              {siblings.filter(item => item.status !== 'cancelled' && item.id !== form.id).sort((a,b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).map(item =>
                <li key={item.id}><button type="button" className="flex min-h-10 w-full flex-wrap justify-between gap-x-2 rounded py-2 text-left hover:bg-state-hover"
                  onClick={() => editGuard.transition(() => openShift(item))}>
                  <span>{item.doctorId ? doctors.find(doctor => doctor.id === item.doctorId)?.name || 'Médico escalado' : 'Vaga aberta'}</span>
                  <span className="tabular-nums text-text-secondary">{item.startTime}–{item.endTime}{item.approvalSource && item.doctorId && ` · ${shiftApprovalLabels[item.approvalSource]}`}</span>
                </button></li>)}
            </ul>}
            {openedShift.doctorId && openedShift.approvalSource === 'pending' && openedShift.status !== 'cancelled'
              && canEditSchedule && canPerformAction(store.currentUser, 'escala', 'approve_shift') && <button type="button"
              className="min-h-10 text-sm font-medium text-primary underline" onClick={() => setConfirmAdministrative(openedShift)}>Aprovar pelo administrativo</button>}
          </ShiftFormSection>}
        </div>
        {requestRetroReason && endedShift && canSaveShift && <label className="nv-label">Justificativa da edição retroativa
          <span className="mt-1 block text-xs font-normal text-text-secondary">O plantão já terminou. A justificativa será registrada no histórico.</span>
          <textarea className="nv-input" required rows={2} minLength={3} maxLength={1000} value={retroReason}
            onChange={event => setRetroReason(event.target.value)}/>
        </label>}
        {formError && <p role="alert" className="nv-feedback text-danger">{formError}</p>}
      </form>
    </Dialog>}
    {cancelCoverageOpen && openedShift?.coveragePost && <Dialog title="Cancelar posto previsto?" onClose={() => setCancelCoverageOpen(false)} closeDisabled={store.saving}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => setCancelCoverageOpen(false)}>Voltar</button>
        <button type="button" className="nv-button" disabled={store.saving || !canDeleteSchedule} onClick={() => void editGuard.run(async () => {
          const ok = await store.cancelCoverage(openedShift);
          setCancelCoverageOpen(false);
          if (ok) setForm(null);
          else setFormError(useStore.getState().error || 'Não foi possível cancelar o posto.');
        })}>Confirmar cancelamento</button>
      </div>}>
      <p className="text-sm text-text-secondary">As alocações e as vagas desse posto serão canceladas. O histórico ficará disponível.</p>
    </Dialog>}
    {sectorEditorOpen && form && formUnit && <SectorEditorDialog scheduleContext unit={formUnit} organizationName={activeOrganization?.name || ''} specialties={formSpecialties}
      initialSpecialty={formSpecialties.includes(form.specialty || '') ? form.specialty : undefined}
      initialPeriod={{ kind: coverageKind, startTime: form.startTime, endTime: form.endTime, requiredDoctors: 1 }}
      onClose={() => setSectorEditorOpen(false)} onSaved={selectCreatedSector}/>}
    {recurringPreview && <Dialog title="Revisar plantões recorrentes" onClose={() => !store.saving && setRecurringPreview(null)}
      footer={<div className="flex flex-wrap justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={() => setRecurringPreview(null)}>Voltar à edição</button><button type="button" className="nv-button" disabled={store.saving || !canCreateSchedule} onClick={() => void confirmRecurrence()}>{store.saving ? 'Salvando…' : 'Confirmar criação'}</button></div>}>
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
  return <AccessGuard requiredPermission="escala"><ScheduleEditBoundary><Suspense fallback={<p role="status">Carregando escala…</p>}><ScheduleRoute /></Suspense></ScheduleEditBoundary></AccessGuard>;
}
