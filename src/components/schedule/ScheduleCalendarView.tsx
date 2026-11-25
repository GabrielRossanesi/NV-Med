'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CircleHelp, Clock3, Copy, FileWarning, Moon, Plus, Sun, Trash2, UserRoundPlus, X } from 'lucide-react';
import EmploymentBadge from './EmploymentBadge';
import UserAvatar from '@/components/UserAvatar';
import AssignmentStatus from './AssignmentStatus';
import ScheduleMonthGrid from './ScheduleMonthGrid';
import MasterShiftOrigin from './MasterShiftOrigin';
import type { MasterShiftContext } from '@/lib/masterSchedule';
import { filterSchedulePeriod, scheduleHasFilters, type ScheduleFilters } from '@/lib/scheduleFiltering';
import { isCriticalCoverage, scheduleAllocations, scheduleConflictIds, type ScheduleCoverageFilter as CoverageFilter } from '@/lib/scheduleCalendar';
import { coverageDate } from '@/lib/fractionalCoverage';
import { coveragePeriodLabel, localDate, summarizeSectorCoverage, type CoveragePeriodSummary } from '@/lib/scheduling';
import type { CoveragePeriodKind, Doctor, EmploymentType, Sector, Shift, Unit } from '@/types';

type Selection = { day: string; sectorId?: string; kind?: CoveragePeriodKind };

interface Props {
  view: 'week' | 'day' | 'month';
  date: string;
  week: string[];
  month: string;
  firstDayOffset: number;
  daysInMonth: number;
  units: Unit[];
  sectors: Sector[];
  doctors: Doctor[];
  shifts: Shift[];
  employment: EmploymentType | '';
  doctorId: string;
  periodKind: CoveragePeriodKind | '';
  documentFilter: 'all' | 'regular' | 'pending';
  focus: (Selection & { nonce: number }) | null;
  coverageFilter: CoverageFilter;
  statusFilter: Exclude<Shift['status'], 'cancelled'> | 'all' | 'exchange';
  specialty?: string;
  coverageMode?: 'all' | 'regular' | 'adhoc';
  availableVacancyIds?: ReadonlySet<string>;
  now?: number;
  doctorWarnings: Map<string, { warning: boolean; blocked: boolean }>;
  canSeeFinancial: boolean;
  canEditSchedule: boolean;
  canCreateSchedule: boolean;
  canDeleteSchedule: boolean;
  onSelectDate: (date: string) => void;
  onSelectSector: (sectorId: string) => void;
  onOpenShift: (sector: Sector, date: string, kind?: CoveragePeriodKind, suggestedCount?: number) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => void;
  onDeleteTurn: (sector: Sector, day: string, kind: CoveragePeriodKind) => void;
  onEditMasterRule?: (context: MasterShiftContext, date?: string) => void;
  onHistory?: (id: string) => void;
  onCopyPeriod: (sector: Sector, sourceDay: string, targetDay: string, kind: CoveragePeriodKind) => Promise<string>;
}

function dayLabel(day: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', options).replace('.', '');
}

function offsetDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

function PeriodIcon({ kind }: { kind: CoveragePeriodKind }) {
  const Icon = kind === 'day' ? Sun : Moon;
  return <Icon size={13} aria-hidden="true" className="shrink-0 text-text-muted"/>;
}

function tone(period: CoveragePeriodSummary, conflict: boolean, critical: boolean) {
  if (conflict) return { label: 'Conflito de horário', color: 'text-danger', background: 'bg-danger/[0.055]', border: 'border-danger/20', Icon: AlertTriangle };
  if (critical) return { label: 'Atenção crítica', color: 'text-danger', background: 'bg-danger/[0.055]', border: 'border-danger/20', Icon: AlertTriangle };
  if (period.uncreated) return { label: 'Posto previsto por criar', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: CircleHelp };
  if (period.open) return { label: 'Vaga aberta', color: 'text-danger', background: 'bg-danger/[0.055]', border: 'border-danger/20', Icon: UserRoundPlus };
  if (period.assigned.some(shift => shift.exchangeRequested)) return { label: 'Troca solicitada', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: Clock3 };
  if (period.deficit) return { label: 'Cobertura parcial', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: AlertTriangle };
  if (period.assigned.some(shift => shift.status === 'pending')) return { label: 'Confirmação pendente', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: Clock3 };
  if (!period.required && !period.items.length) return { label: 'Sem postos previstos', color: 'text-text-muted', background: 'bg-surface-muted/10', border: 'border-border', Icon: CircleHelp };
  return { label: 'Completo', color: 'text-success', background: '', border: 'border-border', Icon: Check };
}

function Inspector({ selection, onClose, children }: { selection: Selection; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={onClose} aria-label={`Detalhes da escala de ${dayLabel(selection.day)}`} className="nv-dialog fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto border-l border-border p-0 sm:w-[min(36rem,100vw)]">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-modal-bg px-5 py-4"><h2 className="nv-section-title capitalize">{dayLabel(selection.day, { weekday: 'long', day: '2-digit', month: 'long' })}</h2><button type="button" aria-label="Fechar detalhes" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover hover:text-text-primary"><X size={19}/></button></div>
    <div className="space-y-6 px-5 py-5">{children}</div>
  </dialog>;
}

export default function ScheduleCalendarView({ view, date, week, month, firstDayOffset, daysInMonth, units, sectors, doctors, shifts, employment, doctorId, periodKind, documentFilter, focus, coverageFilter, statusFilter, doctorWarnings, canSeeFinancial, canEditSchedule, canCreateSchedule, canDeleteSchedule, onSelectDate, onOpenShift, onEditShift, onDeleteShift, onDeleteTurn, onCopyPeriod, onEditMasterRule, onHistory, specialty, coverageMode, availableVacancyIds = new Set(), now }: Props) {
  const [selection, setSelection] = useState<Selection | null>(focus);
  const [actionFeedback, setActionFeedback] = useState('');
  const [referenceTime] = useState(Date.now);
  const currentTime = now ?? referenceTime;
  const filters: ScheduleFilters = { employment, doctorId, periodKind, documentFilter, coverageFilter, statusFilter, specialty, coverageMode };
  const filtered = scheduleHasFilters(filters);
  const days = view === 'day' ? [date] : week;
  const doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const activeShifts = useMemo(() => shifts.filter(shift => shift.status !== 'cancelled'), [shifts]);
  const shiftById = useMemo(() => new Map(activeShifts.map(shift => [shift.id, shift])), [activeShifts]);
  const conflictIds = useMemo(() => scheduleConflictIds(activeShifts), [activeShifts]);
  const shiftsBySectorDay = new Map<string, Shift[]>();
  activeShifts.forEach(shift => { const key = `${shift.sectorId}:${coverageDate(shift)}`; const items = shiftsBySectorDay.get(key) || []; items.push(shift); shiftsBySectorDay.set(key, items); });
  const coverageCache = new Map<string, ReturnType<typeof summarizeSectorCoverage>>();
  const coverageFor = (sector: Sector, day: string) => {
    const key = `${sector.id}:${day}`;
    let summary = coverageCache.get(key);
    if (!summary) { summary = summarizeSectorCoverage(sector, shiftsBySectorDay.get(key) || []); coverageCache.set(key, summary); }
    return summary;
  };
  const hasPeriodConflict = (period: CoveragePeriodSummary) => period.assigned.some(shift => conflictIds.has(shift.id));
  const isCritical = (period: CoveragePeriodSummary, day: string) => isCriticalCoverage(period, day, conflictIds, doctorWarnings, currentTime);
  const stateFor = (period: CoveragePeriodSummary, day: string) => tone(period, hasPeriodConflict(period), isCritical(period, day));
  const context = { availableVacancyIds, conflicts: conflictIds, warnings: doctorWarnings, now: currentTime };
  const displayedFor = (sector: Sector, day: string) => coverageFor(sector, day).periods.map(period => filterSchedulePeriod(period, sector, day, filters, context))
    .filter(period => period.items.length || period.uncreated);
  const openSelection = (day: string, sectorId?: string, kind?: CoveragePeriodKind) => { onSelectDate(day); setActionFeedback(''); setSelection({ day, sectorId, kind }); };
  const edit = (shift: Shift) => { setSelection(null); onEditShift(shift); };
  const create = (sector: Sector, day: string, kind: CoveragePeriodKind, count = 1) => { setSelection(null); onOpenShift(sector, day, kind, count); };
  const copy = async (sector: Sector, sourceDay: string, targetDay: string, kind: CoveragePeriodKind) => setActionFeedback(await onCopyPeriod(sector, sourceDay, targetDay, kind));
  const selectionGroups = selection ? sectors.filter(sector => !selection.sectorId || sector.id === selection.sectorId)
    .map(sector => ({ sector, periods: displayedFor(sector, selection.day).filter(period => !selection.kind || period.period.kind === selection.kind) }))
    .filter(group => group.periods.length) : [];
  const calendarDays = view === 'month' ? Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`) : days;
  const summaries = calendarDays.map(day => {
    const operational = sectors.flatMap(sector => coverageFor(sector, day).periods);
    return { day, filled: operational.reduce((sum, period) => sum + period.filled, 0), required: operational.reduce((sum, period) => sum + period.required, 0),
      fractional: operational.some(period => period.items.some(item => item.coveragePost)),
      entries: sectors.flatMap(sector => displayedFor(sector, day).flatMap(period => scheduleAllocations(period, doctorById, availableVacancyIds)
        .map(entry => ({ ...entry, sectorId: sector.id, sectorName: sectors.length > 1 ? sector.name : undefined, id: `${sector.id}:${entry.id}` }))))
        .sort((a, b) => (a.date || day).localeCompare(b.date || day) || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime) || a.id.localeCompare(b.id)),
    };
  });
  const selectionOperational = selection ? sectors.flatMap(sector => coverageFor(sector, selection.day).periods) : [];
  return <>
    <ScheduleMonthGrid days={summaries} offset={view === 'month' ? firstDayOffset : 0} mode={view} filtered={filtered}
      vacanciesOnly={statusFilter === 'open' || coverageFilter === 'open'} selectedDate={date} today={localDate()} onOpenDay={openSelection}
      onOpenEntry={(entry, day) => {
        if (!entry.shiftId) {
          openSelection(day, entry.sectorId, entry.kind);
          return;
        }
        const shift = shiftById.get(entry.shiftId);
        if (shift) edit(shift);
      }}/>


    {selection && <Inspector selection={selection} onClose={() => setSelection(null)}>
      <p className="text-xs text-text-secondary">Cobertura total do dia: {selectionOperational.reduce((sum, period) => sum + period.filled, 0)}/{selectionOperational.reduce((sum, period) => sum + period.required, 0)} {selectionOperational.some(period => period.items.some(item => item.coveragePost)) ? 'posições integralmente cobertas' : 'postos ocupados'}.{filtered ? ' A lista abaixo respeita os filtros ativos.' : ''}</p>
      {actionFeedback && <p role="status" className="rounded-lg border border-border bg-surface-muted/30 px-3 py-2 text-xs text-text-secondary">{actionFeedback}</p>}
      {onHistory && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-xs font-semibold">Histórico administrativo dos plantões</summary><div className="mt-2 flex flex-col items-start gap-2">{selectionGroups.flatMap(group => group.periods.flatMap(period => period.items)).map(shift => <button key={shift.id} type="button" className="min-h-10 text-xs font-semibold text-primary" onClick={() => onHistory(shift.id)}>Ver histórico · {doctorById.get(shift.doctorId || '')?.name || 'Vaga aberta'} · {shift.startTime}–{shift.endTime}</button>)}</div></details>}
      <MasterShiftOrigin ids={selectionGroups.flatMap(group => group.periods.flatMap(period => period.items.map(shift => shift.id)))} date={selection.day} canEdit={Boolean(onEditMasterRule)} onEditRule={onEditMasterRule ? (context, day) => { setSelection(null); onEditMasterRule(context, day); } : undefined}/>
      {selectionGroups.length ? selectionGroups.map(({ sector, periods }) => <section key={sector.id} className="border-b border-border pb-5 last:border-0"><div><p className="text-xs text-text-muted">{unitById.get(sector.unitId)?.name || 'Unidade'}</p><h3 className="mt-0.5 text-base font-semibold">{sector.name}</h3></div><div className="mt-4 space-y-5">{periods.map(period => { const conflict = hasPeriodConflict(period); const state = stateFor(period, selection.day); const deletable = period.items.filter(item => !item.coveragePost).length; return <div key={period.period.kind}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-semibold"><PeriodIcon kind={period.period.kind}/>{coveragePeriodLabel(period.period.kind)} · {period.period.startTime}–{period.period.endTime}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{period.filled}<span className="text-base font-normal text-text-muted">/{period.required} médicos · cobertura total</span></p></div><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${state.color} ${state.background}`}><state.Icon size={12}/>{state.label}</span></div>
          <div className="mt-3 space-y-2">{period.assigned.map(shift => { const doctor = doctorById.get(shift.doctorId || ''); const warning = doctor && doctorWarnings.get(doctor.id); return <div key={shift.id} className="flex items-center gap-1 rounded-lg border border-border pr-1 transition hover:bg-state-hover"><button type="button" onClick={() => edit(shift)} className="flex min-h-16 min-w-0 flex-1 items-center justify-between gap-3 px-3 text-left"><span className="flex min-w-0 items-center gap-2"><UserAvatar name={doctor?.name || 'Médico'} className="h-8 w-8"/><span className="min-w-0"><span className="block break-words text-xs font-semibold">{doctor?.name || 'Médico não encontrado'}</span><span className="mt-1 block text-[11px] tabular-nums text-text-muted">{shift.startTime}–{shift.endTime}</span><span className="mt-0.5 block text-[10px] text-text-muted"><EmploymentBadge employment={shift.employmentType}/>{shift.specialty ? ` · ${shift.specialty}` : ''}</span>{shift.coverageMode === 'adhoc' && <span className="mt-0.5 block truncate text-[10px] font-medium text-primary" title={shift.coverageReason}>Avulso · {shift.coverageReason}</span>}{shift.notes && <span className="mt-0.5 block truncate text-[10px] text-text-muted" title={shift.notes}>{shift.notes}</span>}{canSeeFinancial && shift.employmentType === 'pj' && Number(shift.paymentAmount) > 0 && <span className="mt-0.5 block text-[10px] text-text-muted">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(shift.paymentAmount))}</span>}</span></span><span className="flex max-w-36 shrink-0 flex-col items-end gap-1 text-right"><AssignmentStatus status={shift.status}/>{shift.exchangeRequested && <span className="text-[11px] text-warning">Troca solicitada</span>}{warning?.warning && <span className={`flex items-center gap-1 text-[11px] ${warning.blocked ? 'text-danger' : 'text-warning'}`}><FileWarning size={12} aria-hidden="true"/>{warning.blocked ? 'Impedimento documental' : 'Pendência documental'}</span>}{conflictIds.has(shift.id) && <span className="text-[11px] text-danger">Conflito de horário</span>}</span></button><button type="button" aria-label={`Excluir plantão de ${doctor?.name || 'médico'}`} onClick={() => void onDeleteShift(shift)} className={canDeleteSchedule && !shift.coveragePost ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/5 hover:text-danger" : "hidden"}><Trash2 size={14}/></button></div>; })}
            {period.vacancies.filter(shift => !employment || shift.employmentType === employment).map(shift => {
              const available = shift.coveragePost || availableVacancyIds.has(shift.id);
              const label = available ? (shift.coverageMode === 'adhoc' && !shift.coveragePost ? 'Vaga avulsa' : 'Vaga aberta') : 'Posto sem médico';
              return <div key={shift.id} className={`flex items-center gap-1 rounded-lg border pr-1 text-xs ${available ? 'border-danger/25 bg-danger/[0.045]' : 'border-border bg-surface-muted/30'}`}>
                <button type="button" onClick={() => edit(shift)} className="flex min-h-12 min-w-0 flex-1 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className={`flex items-center gap-1.5 font-semibold ${available ? 'text-danger' : 'text-text-secondary'}`}><UserRoundPlus size={14} aria-hidden="true" className="shrink-0"/>{label}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-text-secondary">
                      <span className="wrap-anywhere">{shift.specialty || (available ? 'Disponível para preenchimento' : 'Sem especialidade')}</span>
                      <EmploymentBadge employment={shift.employmentType} provisional/>
                      <span className="tabular-nums">{shift.startTime}–{shift.endTime}</span>
                    </span>
                  </span>
                  <span className="font-semibold text-primary">{canEditSchedule ? 'Preencher' : 'Ver vaga'}</span>
                </button>
                {canDeleteSchedule && !shift.coveragePost && <button type="button" aria-label={available ? 'Excluir vaga aberta' : 'Excluir posto sem médico'} onClick={() => void onDeleteShift(shift)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/5 hover:text-danger"><Trash2 size={14}/></button>}
              </div>;
            })}
            {period.uncreated > 0 && <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/[0.045] px-3 py-3 text-xs"><span className="text-warning">{period.uncreated} {period.uncreated === 1 ? 'posto previsto ainda não criado' : 'postos previstos ainda não criados'}</span><button type="button" disabled={!canCreateSchedule} onClick={() => create(sector, selection.day, period.period.kind, period.uncreated)} className="shrink-0 font-semibold text-primary hover:underline">Criar</button></div>}
            {conflict && <p className="flex items-center gap-1.5 text-xs text-danger"><AlertTriangle size={13}/>Há médicos com horários coincidentes. Abra o plantão para corrigir.</p>}
          </div>
          {canDeleteSchedule && !filtered && deletable > 0 && <button type="button" onClick={() => onDeleteTurn(sector, selection.day, period.period.kind)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-danger transition hover:bg-danger/5"><Trash2 size={13}/>Excluir este turno ({deletable})</button>}
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!canCreateSchedule} onClick={() => create(sector, selection.day, period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Plus size={13}/>Novo posto</button>{canEditSchedule && period.vacancies[0] && <button type="button" onClick={() => edit(period.vacancies[0])} className="nv-button min-h-9 text-xs"><UserRoundPlus size={13}/>Preencher vaga</button>}<button type="button" disabled={!canCreateSchedule} onClick={() => void copy(sector, offsetDay(selection.day, -1), selection.day, period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Copy size={13}/>Copiar dia anterior</button><button type="button" disabled={!canCreateSchedule} onClick={() => void copy(sector, selection.day, offsetDay(selection.day, 1), period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Copy size={13}/>Duplicar para amanhã</button></div>
        </div>; })}</div></section>) : <p className="py-10 text-center text-sm text-text-muted">Nenhum turno corresponde aos filtros neste dia.</p>}
    </Inspector>}
  </>;
}
