'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CircleHelp, Clock3, Copy, FileWarning, Moon, Plus, Sun, Trash2, UserRoundPlus, X } from 'lucide-react';
import EmploymentBadge from './EmploymentBadge';
import UserAvatar from '@/components/UserAvatar';
import AssignmentStatus from './AssignmentStatus';
import ScheduleAllocationList from './ScheduleAllocationList';
import ScheduleMonthGrid from './ScheduleMonthGrid';
import MasterShiftOrigin from './MasterShiftOrigin';
import type { MasterShiftContext } from '@/lib/masterSchedule';
import { isCriticalCoverage, scheduleAllocations, scheduleConflictIds, type ScheduleCoverageFilter as CoverageFilter } from '@/lib/scheduleCalendar';
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
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-modal-bg px-5 py-4"><div><p className="text-xs font-medium uppercase tracking-wide text-primary">Detalhe do turno</p><h2 className="nv-section-title mt-1 capitalize">{dayLabel(selection.day, { weekday: 'long', day: '2-digit', month: 'long' })}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover hover:text-text-primary"><X size={19}/></button></div>
    <div className="space-y-6 px-5 py-5">{children}</div>
  </dialog>;
}

export default function ScheduleCalendarView({ view, date, week, month, firstDayOffset, daysInMonth, units, sectors, doctors, shifts, employment, doctorId, periodKind, documentFilter, focus, coverageFilter, statusFilter, doctorWarnings, canSeeFinancial, canEditSchedule, canCreateSchedule, canDeleteSchedule, onSelectDate, onSelectSector, onOpenShift, onEditShift, onDeleteShift, onDeleteTurn, onCopyPeriod, onEditMasterRule }: Props) {
  const [selection, setSelection] = useState<Selection | null>(focus);
  const [actionFeedback, setActionFeedback] = useState('');
  const [referenceTime] = useState(Date.now);
  const days = view === 'day' ? [date] : week;
  const doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const activeShifts = useMemo(() => shifts.filter(shift => shift.status !== 'cancelled'), [shifts]);
  const conflictIds = useMemo(() => scheduleConflictIds(activeShifts), [activeShifts]);
  const shiftsBySectorDay = new Map<string, Shift[]>();
  activeShifts.forEach(shift => { const key = `${shift.sectorId}:${shift.date}`; const items = shiftsBySectorDay.get(key) || []; items.push(shift); shiftsBySectorDay.set(key, items); });
  const coverageCache = new Map<string, ReturnType<typeof summarizeSectorCoverage>>();
  const coverageFor = (sector: Sector, day: string) => {
    const key = `${sector.id}:${day}`;
    let summary = coverageCache.get(key);
    if (!summary) { summary = summarizeSectorCoverage(sector, shiftsBySectorDay.get(key) || []); coverageCache.set(key, summary); }
    return summary;
  };
  const hasPeriodConflict = (period: CoveragePeriodSummary) => period.assigned.some(shift => conflictIds.has(shift.id));
  const isCritical = (period: CoveragePeriodSummary, day: string) => isCriticalCoverage(period, day, conflictIds, doctorWarnings, referenceTime);
  const stateFor = (period: CoveragePeriodSummary, day: string) => tone(period, hasPeriodConflict(period), isCritical(period, day));
  const matchesAdvanced = (period: CoveragePeriodSummary) => (!periodKind || period.period.kind === periodKind)
    && (statusFilter === 'all' || [...period.assigned, ...period.vacancies].some(item =>
      statusFilter === (item.exchangeRequested ? 'exchange' : item.status)))
    && (!doctorId || period.assigned.some(item => item.doctorId === doctorId))
    && (!employment || period.items.some(item => item.employmentType === employment))
    && (documentFilter === 'all' || period.assigned.some(item => { const warning = doctorWarnings.get(item.doctorId || '')?.warning || false; return documentFilter === 'pending' ? warning : !warning; }));
  const matches = (period: CoveragePeriodSummary, day: string) => matchesAdvanced(period) && (coverageFilter === 'all'
    || (coverageFilter === 'deficit' && period.deficit > 0)
    || (coverageFilter === 'open' && period.open > 0)
    || (coverageFilter === 'conflict' && hasPeriodConflict(period))
    || (coverageFilter === 'critical' && isCritical(period, day))
    || (coverageFilter === 'pending' && period.assigned.some(shift => shift.status === 'pending'))
    || (coverageFilter === 'complete' && period.required > 0 && period.deficit === 0));
  const openSelection = (day: string, sectorId?: string, kind?: CoveragePeriodKind) => { onSelectDate(day); setActionFeedback(''); setSelection({ day, sectorId, kind }); };
  const edit = (shift: Shift) => { setSelection(null); onEditShift(shift); };
  const create = (sector: Sector, day: string, kind: CoveragePeriodKind, count = 1) => { setSelection(null); onOpenShift(sector, day, kind, count); };
  const copy = async (sector: Sector, sourceDay: string, targetDay: string, kind: CoveragePeriodKind) => setActionFeedback(await onCopyPeriod(sector, sourceDay, targetDay, kind));
  const visibleRows = sectors.flatMap(sector => coverageFor(sector, days[0]).periods.map(period => ({ sector, kind: period.period.kind, startTime: period.period.startTime, endTime: period.period.endTime })))
    .filter(row => days.some(day => coverageFor(row.sector, day).periods.some(period => period.period.kind === row.kind && matches(period, day))));

  function periodCell(sector: Sector, day: string, kind: CoveragePeriodKind) {
    const period = coverageFor(sector, day).periods.find(item => item.period.kind === kind);
    if (!period || !matches(period, day)) return <div className="h-full min-h-36 bg-surface-muted/10 p-3" aria-label="Não corresponde ao filtro"/>;
    const vacancy = period.vacancies[0];
    const quickCreate = canCreateSchedule && period.uncreated > 0;
    const quickAssign = canEditSchedule && vacancy;
    return <div className="relative h-full min-h-36 min-w-0 bg-card-bg">
      <button type="button" onClick={() => openSelection(day, sector.id, kind)} title={`Abrir detalhes de ${sector.name}, ${coveragePeriodLabel(kind)}, ${dayLabel(day)}`} className="flex h-full min-h-36 w-full min-w-0 flex-col p-3 text-left transition-colors hover:bg-state-hover focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none">
        <span className={`flex w-full items-center justify-between gap-2 text-[11px] ${quickCreate || quickAssign ? 'pr-9' : ''}`}>
          <span className="text-text-muted">{dayLabel(day)}</span>
          <span className="shrink-0 font-semibold tabular-nums text-text-secondary" aria-label={`${period.filled} médicos escalados para ${period.required} postos`}>{period.filled}/{period.required}</span>
        </span>
        <span className="mt-3 block w-full min-w-0"><ScheduleAllocationList entries={scheduleAllocations(period, doctorById)}/></span>
        {!period.required && !period.items.length && <span className="mt-2 text-xs text-text-muted">Sem postos previstos</span>}
        <span className="sr-only">Abrir detalhes do turno</span>
      </button>
      {(quickCreate || quickAssign) && <button type="button" onClick={() => quickAssign ? edit(vacancy!) : create(sector, day, kind, period.uncreated)} className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary" aria-label={`${quickAssign ? 'Preencher vaga' : 'Criar postos previstos'} em ${sector.name}, ${day}`}><Plus size={16} aria-hidden="true"/></button>}
    </div>;
  }

  const selectionGroups = selection ? sectors.filter(sector => !selection.sectorId || sector.id === selection.sectorId).map(sector => ({ sector, periods: coverageFor(sector, selection.day).periods.filter(period => (!selection.kind || period.period.kind === selection.kind) && matches(period, selection.day)) })).filter(group => group.periods.length) : [];
  const monthDays = Array.from({ length: view === 'month' ? daysInMonth : 0 }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const monthSummaries = monthDays.map(day => {
    const groups = sectors.map(sector => ({ sector, periods: coverageFor(sector, day).periods.filter(period => matches(period, day)) }));
    const periods = groups.flatMap(group => group.periods);
    return { day, filled: periods.reduce((sum, period) => sum + period.filled, 0), required: periods.reduce((sum, period) => sum + period.required, 0),
      entries: groups.flatMap(({ sector, periods }) => periods.flatMap(period => scheduleAllocations(period, doctorById).map(entry => ({ ...entry, id: `${sector.id}:${entry.id}` })))),
    };
  });

  return <>
    {view !== 'month' ? <>
      <p className="hidden text-xs text-text-muted md:block">{view === 'week' ? 'Equipe por setor e turno. Role na horizontal para consultar os outros dias.' : 'Equipe por setor e turno no dia selecionado.'}</p>
      <div tabIndex={0} role="region" aria-label={view === 'day' ? 'Escala diária por setor e turno' : 'Escala semanal com rolagem horizontal'} className="relative hidden max-h-[70vh] min-w-0 overflow-auto rounded-xl border border-border bg-card-bg focus-visible:outline-2 focus-visible:outline-primary md:block">
        <table className={`w-full table-fixed border-separate border-spacing-0 ${view === 'day' ? 'min-w-[600px]' : 'min-w-[1920px]'}`}>
          <caption className="sr-only">Médicos e vagas por unidade, setor, turno e data</caption>
          <thead className="sticky top-0 z-20 bg-card-bg">
            <tr><th scope="col" className="sticky left-0 z-30 w-52 border-b border-border bg-card-bg p-3 text-left text-xs font-semibold text-text-muted">Unidade · setor · turno</th>
              {days.map(day => <th key={day} scope="col" className="border-b border-l border-border bg-card-bg p-0 text-left"><button type="button" onClick={() => openSelection(day)} className={`w-full px-3 py-3 text-left transition-colors hover:bg-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${date === day ? 'bg-primary/5 text-primary' : 'text-text-secondary'}`}><span className="block text-[11px] font-semibold uppercase tracking-wide">{dayLabel(day, { weekday: 'short' })}</span><span className="mt-0.5 block text-sm font-semibold tabular-nums">{dayLabel(day)}</span></button></th>)}
            </tr>
          </thead>
          <tbody>{visibleRows.map(row => <tr key={`${row.sector.id}-${row.kind}`}>
            <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-card-bg p-0 align-top text-left font-normal"><button type="button" onClick={() => { onSelectSector(row.sector.id); openSelection(date, row.sector.id, row.kind); }} className="w-full p-3 text-left transition-colors hover:bg-state-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"><span className="block break-words text-[11px] text-text-muted">{unitById.get(row.sector.unitId)?.name || 'Unidade'}</span><span className="mt-1 block break-words text-sm font-semibold text-text-primary">{row.sector.name}</span><span className="mt-3 flex items-center gap-1 text-xs text-text-secondary"><PeriodIcon kind={row.kind}/>{coveragePeriodLabel(row.kind)}</span><span className="mt-1 block text-[11px] tabular-nums text-text-muted">{row.startTime}–{row.endTime}</span></button></th>
            {days.map(day => <td key={day} className="border-b border-l border-border p-0 align-top">{periodCell(row.sector, day, row.kind)}</td>)}
          </tr>)}</tbody>
        </table>
        {!visibleRows.length && <p className="p-10 text-center text-sm text-text-muted">Nenhum turno corresponde aos filtros neste período.</p>}
      </div>
      <div className="space-y-4 md:hidden">{days.map(day => {
        const groups = sectors.map(sector => ({ sector, periods: coverageFor(sector, day).periods.filter(period => matches(period, day)) })).filter(group => group.periods.length);
        if (!groups.length) return null;
        return <section key={day} className="overflow-hidden rounded-xl border border-border bg-card-bg">
          <button type="button" onClick={() => openSelection(day)} className="w-full border-b border-border bg-surface-muted/35 px-4 py-3 text-left text-sm font-semibold capitalize focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary">{dayLabel(day, { weekday: 'long', day: '2-digit', month: 'short' })}</button>
          <div className="divide-y divide-border">{groups.map(({ sector, periods }) => <div key={sector.id} className="px-4 py-3"><p className="text-[11px] text-text-muted">{unitById.get(sector.unitId)?.name}</p><h3 className="break-words text-sm font-semibold">{sector.name}</h3><div className="mt-3 space-y-3">{periods.map(period => <div key={period.period.kind}><p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-secondary"><PeriodIcon kind={period.period.kind}/>{coveragePeriodLabel(period.period.kind)} · {period.period.startTime}–{period.period.endTime}</p>{periodCell(sector, day, period.period.kind)}</div>)}</div></div>)}</div>
        </section>;
      })}{!visibleRows.length && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-text-muted">Nenhum turno corresponde aos filtros neste período.</p>}</div>
    </> : <ScheduleMonthGrid days={monthSummaries} offset={firstDayOffset} selectedDate={date} today={localDate()} onOpenDay={day => openSelection(day)}/>}


    {selection && <Inspector selection={selection} onClose={() => setSelection(null)}>
      {actionFeedback && <p role="status" className="rounded-lg border border-border bg-surface-muted/30 px-3 py-2 text-xs text-text-secondary">{actionFeedback}</p>}
      <MasterShiftOrigin ids={selectionGroups.flatMap(group => group.periods.flatMap(period => period.items.map(shift => shift.id)))} date={selection.day} canEdit={Boolean(onEditMasterRule)} onEditRule={onEditMasterRule ? (context, day) => { setSelection(null); onEditMasterRule(context, day); } : undefined}/>
      {selectionGroups.length ? selectionGroups.map(({ sector, periods }) => <section key={sector.id} className="border-b border-border pb-5 last:border-0"><div><p className="text-xs text-text-muted">{unitById.get(sector.unitId)?.name || 'Unidade'}</p><h3 className="mt-0.5 text-base font-semibold">{sector.name}</h3></div><div className="mt-4 space-y-5">{periods.map(period => { const conflict = hasPeriodConflict(period); const state = stateFor(period, selection.day); return <div key={period.period.kind}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-semibold"><PeriodIcon kind={period.period.kind}/>{coveragePeriodLabel(period.period.kind)} · {period.period.startTime}–{period.period.endTime}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{period.filled}<span className="text-base font-normal text-text-muted">/{period.required} médicos</span></p></div><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${state.color} ${state.background}`}><state.Icon size={12}/>{state.label}</span></div>
          <div className="mt-3 space-y-2">{period.assigned.map(shift => { const doctor = doctorById.get(shift.doctorId || ''); const warning = doctor && doctorWarnings.get(doctor.id); return <div key={shift.id} className="flex items-center gap-1 rounded-lg border border-border pr-1 transition hover:bg-state-hover"><button type="button" onClick={() => edit(shift)} className="flex min-h-16 min-w-0 flex-1 items-center justify-between gap-3 px-3 text-left"><span className="flex min-w-0 items-center gap-2"><UserAvatar name={doctor?.name || 'Médico'} className="h-8 w-8"/><span className="min-w-0"><span className="block break-words text-xs font-semibold">{doctor?.name || 'Médico não encontrado'}</span><span className="mt-0.5 block text-[10px] text-text-muted"><EmploymentBadge employment={shift.employmentType}/>{shift.specialty ? ` · ${shift.specialty}` : ''}</span>{shift.coverageMode === 'adhoc' && <span className="mt-0.5 block truncate text-[10px] font-medium text-primary" title={shift.coverageReason}>Avulso · {shift.coverageReason}</span>}{shift.notes && <span className="mt-0.5 block truncate text-[10px] text-text-muted" title={shift.notes}>{shift.notes}</span>}{canSeeFinancial && shift.employmentType === 'pj' && Number(shift.paymentAmount) > 0 && <span className="mt-0.5 block text-[10px] text-text-muted">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(shift.paymentAmount))}</span>}</span></span><span className="flex max-w-36 shrink-0 flex-col items-end gap-1 text-right"><AssignmentStatus status={shift.status}/>{shift.exchangeRequested && <span className="text-[11px] text-warning">Troca solicitada</span>}{warning?.warning && <span className={`flex items-center gap-1 text-[11px] ${warning.blocked ? 'text-danger' : 'text-warning'}`}><FileWarning size={12} aria-hidden="true"/>{warning.blocked ? 'Impedimento documental' : 'Pendência documental'}</span>}{conflictIds.has(shift.id) && <span className="text-[11px] text-danger">Conflito de horário</span>}</span></button><button type="button" aria-label={`Excluir plantão de ${doctor?.name || 'médico'}`} onClick={() => void onDeleteShift(shift)} className={canDeleteSchedule ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/5 hover:text-danger" : "hidden"}><Trash2 size={14}/></button></div>; })}
            {period.vacancies.filter(shift => !employment || shift.employmentType === employment).map(shift => <div key={shift.id} className="flex items-center gap-1 rounded-lg border border-danger/25 bg-danger/[0.045] pr-1 text-xs font-semibold text-danger"><button type="button" onClick={() => edit(shift)} className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left"><span className="flex items-center gap-1.5"><UserRoundPlus size={14}/>{shift.coverageMode === 'adhoc' ? 'Vaga avulsa' : 'Vaga aberta'} · {shift.specialty || 'disponível para preenchimento'} <EmploymentBadge employment={shift.employmentType} provisional/></span><span>{canEditSchedule ? 'Preencher' : 'Ver vaga'}</span></button><button type="button" aria-label="Excluir vaga aberta" onClick={() => void onDeleteShift(shift)} className={canDeleteSchedule ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/5 hover:text-danger" : "hidden"}><Trash2 size={14}/></button></div>)}
            {period.uncreated > 0 && <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/[0.045] px-3 py-3 text-xs"><span className="text-warning">{period.uncreated} {period.uncreated === 1 ? 'posto previsto ainda não criado' : 'postos previstos ainda não criados'}</span><button type="button" disabled={!canCreateSchedule} onClick={() => create(sector, selection.day, period.period.kind, period.uncreated)} className="shrink-0 font-semibold text-primary hover:underline">Criar</button></div>}
            {conflict && <p className="flex items-center gap-1.5 text-xs text-danger"><AlertTriangle size={13}/>Há médicos com horários coincidentes. Abra o plantão para corrigir.</p>}
          </div>
          {canDeleteSchedule && period.items.length > 0 && <button type="button" onClick={() => onDeleteTurn(sector, selection.day, period.period.kind)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-danger transition hover:bg-danger/5"><Trash2 size={13}/>Excluir este turno ({period.items.length})</button>}
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!canCreateSchedule} onClick={() => create(sector, selection.day, period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Plus size={13}/>Novo posto</button>{canEditSchedule && period.vacancies[0] && <button type="button" onClick={() => edit(period.vacancies[0])} className="nv-button min-h-9 text-xs"><UserRoundPlus size={13}/>Preencher vaga</button>}<button type="button" disabled={!canCreateSchedule} onClick={() => void copy(sector, offsetDay(selection.day, -1), selection.day, period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Copy size={13}/>Copiar dia anterior</button><button type="button" disabled={!canCreateSchedule} onClick={() => void copy(sector, selection.day, offsetDay(selection.day, 1), period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Copy size={13}/>Duplicar para amanhã</button></div>
        </div>; })}</div></section>) : <p className="py-10 text-center text-sm text-text-muted">Nenhum turno corresponde aos filtros neste dia.</p>}
    </Inspector>}
  </>;
}
