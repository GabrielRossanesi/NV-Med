'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CircleHelp, Clock3, Copy, FileWarning, Moon, Plus, Sun, Trash2, UserRoundPlus, X } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { coveragePeriodLabel, employmentLabels, hasConflict, localDate, summarizeSectorCoverage, type CoveragePeriodSummary } from '@/lib/scheduling';
import type { CoveragePeriodKind, Doctor, EmploymentType, Sector, Shift, Unit } from '@/types';

type CoverageFilter = 'all' | 'deficit' | 'open' | 'conflict' | 'pending' | 'complete';
type Selection = { day: string; sectorId?: string; kind?: CoveragePeriodKind };

interface Props {
  view: 'week' | 'month';
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
  doctorWarnings: Map<string, { warning: boolean; blocked: boolean }>;
  canSeeFinancial: boolean;
  canEditSchedule: boolean;
  onSelectDate: (date: string) => void;
  onSelectSector: (sectorId: string) => void;
  onOpenShift: (sector: Sector, date: string, kind?: CoveragePeriodKind, suggestedCount?: number) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => void;
  onDeleteTurn: (sector: Sector, day: string, kind: CoveragePeriodKind) => void;
  onCopyPeriod: (sector: Sector, sourceDay: string, targetDay: string, kind: CoveragePeriodKind) => Promise<string>;
}

const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const monthWeekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const statusLabels: Record<Shift['status'], string> = { open: 'Vaga aberta', confirmed: 'Confirmado', pending: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado' };

function dayLabel(day: string, options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }) {
  return new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR', options).replace('.', '');
}

function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 2 ? `${parts[0]} ${parts.at(-1)}` : name;
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

function tone(period: CoveragePeriodSummary, conflict: boolean, day: string) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (conflict) return { label: 'Conflito de horário', color: 'text-danger', background: 'bg-danger/[0.055]', border: 'border-danger/20', Icon: AlertTriangle };
  if (period.deficit && day >= localDate() && day <= localDate(tomorrow)) return { label: 'Cobertura crítica', color: 'text-danger', background: 'bg-danger/[0.055]', border: 'border-danger/20', Icon: AlertTriangle };
  if (period.uncreated) return { label: 'Posto previsto por criar', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: CircleHelp };
  if (period.open) return { label: 'Vaga aberta', color: 'text-info', background: 'bg-info/[0.055]', border: 'border-info/20', Icon: UserRoundPlus };
  if (period.deficit) return { label: 'Cobertura parcial', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: AlertTriangle };
  if (period.assigned.some(shift => shift.status === 'pending')) return { label: 'Confirmação pendente', color: 'text-warning', background: 'bg-warning/[0.055]', border: 'border-warning/20', Icon: Clock3 };
  return { label: 'Completo', color: 'text-success', background: 'bg-success/[0.045]', border: 'border-success/20', Icon: Check };
}

function Inspector({ selection, onClose, children }: { selection: Selection; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={onClose} aria-label={`Detalhes da escala de ${dayLabel(selection.day)}`} className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-xl overflow-y-auto border-l border-border bg-card-bg p-0 text-text-primary shadow-2xl backdrop:bg-black/45 sm:w-[min(36rem,100vw)]">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card-bg px-5 py-5"><div><p className="text-xs font-medium uppercase tracking-wide text-primary">Detalhe do turno</p><h2 className="mt-1 text-lg font-semibold capitalize">{dayLabel(selection.day, { weekday: 'long', day: '2-digit', month: 'long' })}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-state-hover"><X size={19}/></button></div>
    <div className="space-y-6 px-5 py-5">{children}</div>
  </dialog>;
}

export default function ScheduleCalendarView({ view, date, week, month, firstDayOffset, daysInMonth, units, sectors, doctors, shifts, employment, doctorId, periodKind, documentFilter, focus, coverageFilter, doctorWarnings, canSeeFinancial, canEditSchedule, onSelectDate, onSelectSector, onOpenShift, onEditShift, onDeleteShift, onDeleteTurn, onCopyPeriod }: Props) {
  const [selection, setSelection] = useState<Selection | null>(focus);
  const [actionFeedback, setActionFeedback] = useState('');
  const doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));
  const unitById = new Map(units.map(unit => [unit.id, unit]));
  const activeShifts = shifts.filter(shift => shift.status !== 'cancelled');
  const shiftsBySectorDay = new Map<string, Shift[]>();
  activeShifts.forEach(shift => { const key = `${shift.sectorId}:${shift.date}`; const items = shiftsBySectorDay.get(key) || []; items.push(shift); shiftsBySectorDay.set(key, items); });
  const coverageCache = new Map<string, ReturnType<typeof summarizeSectorCoverage>>();
  const coverageFor = (sector: Sector, day: string) => {
    const key = `${sector.id}:${day}`;
    let summary = coverageCache.get(key);
    if (!summary) { summary = summarizeSectorCoverage(sector, shiftsBySectorDay.get(key) || []); coverageCache.set(key, summary); }
    return summary;
  };
  const hasPeriodConflict = (period: CoveragePeriodSummary) => period.assigned.some(shift => hasConflict(shift, activeShifts));
  const matchesAdvanced = (period: CoveragePeriodSummary) => (!periodKind || period.period.kind === periodKind)
    && (!doctorId || period.assigned.some(item => item.doctorId === doctorId))
    && (!employment || period.assigned.some(item => item.employmentType === employment))
    && (documentFilter === 'all' || period.assigned.some(item => { const warning = doctorWarnings.get(item.doctorId || '')?.warning || false; return documentFilter === 'pending' ? warning : !warning; }));
  const matches = (period: CoveragePeriodSummary) => matchesAdvanced(period) && (coverageFilter === 'all'
    || (coverageFilter === 'deficit' && period.deficit > 0)
    || (coverageFilter === 'open' && period.open > 0)
    || (coverageFilter === 'conflict' && hasPeriodConflict(period))
    || (coverageFilter === 'pending' && period.assigned.some(shift => shift.status === 'pending'))
    || (coverageFilter === 'complete' && period.required > 0 && period.deficit === 0));
  const openSelection = (day: string, sectorId?: string, kind?: CoveragePeriodKind) => { onSelectDate(day); setActionFeedback(''); setSelection({ day, sectorId, kind }); };
  const edit = (shift: Shift) => { setSelection(null); onEditShift(shift); };
  const create = (sector: Sector, day: string, kind: CoveragePeriodKind, count = 1) => { setSelection(null); onOpenShift(sector, day, kind, count); };
  const copy = async (sector: Sector, sourceDay: string, targetDay: string, kind: CoveragePeriodKind) => setActionFeedback(await onCopyPeriod(sector, sourceDay, targetDay, kind));
  const visibleRows = sectors.flatMap(sector => coverageFor(sector, week[0]).periods.map(period => ({ sector, kind: period.period.kind, startTime: period.period.startTime, endTime: period.period.endTime })))
    .filter(row => week.some(day => coverageFor(row.sector, day).periods.some(period => period.period.kind === row.kind && matches(period))));

  function periodCell(sector: Sector, day: string, kind: CoveragePeriodKind) {
    const period = coverageFor(sector, day).periods.find(item => item.period.kind === kind);
    if (!period || !matches(period)) return <div className="min-h-30 border-l border-border bg-surface-muted/10 p-3" aria-label="Não corresponde ao filtro"/>;
    const conflict = hasPeriodConflict(period);
    const state = tone(period, conflict, day);
    const firstDoctor = period.assigned.filter(item => (!employment || item.employmentType === employment) && (!doctorId || item.doctorId === doctorId)).map(item => doctorById.get(item.doctorId || '')).find(Boolean);
    const vacancy = period.vacancies[0];
    return <div className={`group relative min-h-30 border-l border-border p-2 ${state.background}`}>
      <button type="button" onClick={() => openSelection(day, sector.id, kind)} title={`${state.label}: ${period.filled} de ${period.required} médicos. Abrir detalhes.`} className={`flex h-full min-h-26 w-full flex-col rounded-lg border p-2 text-left transition hover:border-primary/45 hover:bg-card-bg/60 focus-visible:outline-2 focus-visible:outline-primary ${state.border}`}>
        <span className={`flex items-center gap-1 text-[11px] font-semibold ${state.color}`}><state.Icon size={12} aria-hidden="true"/>{state.label}</span>
        <span className="mt-1.5 text-xl font-semibold tabular-nums leading-none text-text-primary">{period.filled}<span className="text-sm font-normal text-text-muted">/{period.required}</span></span>
        <span className="mt-1 text-[10px] text-text-secondary">{period.filled} escalado{period.filled === 1 ? '' : 's'} · {period.deficit} em falta</span>
        {firstDoctor && <span className="mt-1 truncate text-[10px] font-medium text-text-secondary">{shortName(firstDoctor.name)}{period.assigned.length > 1 ? ` +${period.assigned.length - 1}` : ''}</span>}
        {period.open > 0 && <span className="mt-0.5 text-[10px] font-medium text-info">{period.open} {period.open === 1 ? 'vaga aberta' : 'vagas abertas'}</span>}
        {period.assigned.some(shift => shift.status === 'pending') && <span className="mt-0.5 text-[10px] font-medium text-warning">{period.assigned.filter(shift => shift.status === 'pending').length} confirmação pendente</span>}
        {period.uncreated > 0 && <span className="mt-0.5 text-[10px] font-medium text-warning">{period.uncreated} {period.uncreated === 1 ? 'posto por criar' : 'postos por criar'}</span>}
      </button>
      {(period.uncreated > 0 || vacancy) && <button type="button" onClick={() => period.uncreated ? create(sector, day, kind, period.uncreated) : edit(vacancy!)} className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md bg-card-bg text-primary opacity-100 shadow-sm transition hover:bg-primary hover:text-text-inverse sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={period.uncreated ? `Criar postos previstos em ${sector.name}, ${day}` : `Preencher vaga em ${sector.name}, ${day}`} title={period.uncreated ? 'Criar posto' : 'Preencher vaga'}><Plus size={15}/></button>}
    </div>;
  }

  const selectionGroups = selection ? sectors.filter(sector => !selection.sectorId || sector.id === selection.sectorId).map(sector => ({ sector, periods: coverageFor(sector, selection.day).periods.filter(period => (!selection.kind || period.period.kind === selection.kind) && matches(period)) })).filter(group => group.periods.length) : [];
  const monthDays = Array.from({ length: daysInMonth }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`);
  const monthSummaries = monthDays.map(day => {
    const periods = sectors.flatMap(sector => coverageFor(sector, day).periods.filter(matches));
    return { day, filled: periods.reduce((sum, period) => sum + period.filled, 0), required: periods.reduce((sum, period) => sum + period.required, 0), deficit: periods.filter(period => period.deficit > 0).length, open: periods.reduce((sum, period) => sum + period.open, 0), conflict: periods.filter(hasPeriodConflict).length };
  });

  return <>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-text-muted" aria-label="Legenda da escala">
      <span className="font-semibold text-text-secondary">Legenda</span><span className="flex items-center gap-1"><Check size={12} className="text-success"/>Completo</span><span className="flex items-center gap-1"><AlertTriangle size={12} className="text-warning"/>Déficit</span><span className="flex items-center gap-1"><UserRoundPlus size={12} className="text-info"/>Vaga aberta</span><span className="flex items-center gap-1"><CircleHelp size={12} className="text-warning"/>Posto por criar</span><span className="flex items-center gap-1"><Clock3 size={12} className="text-warning"/>Confirmação pendente</span><span className="flex items-center gap-1"><AlertTriangle size={12} className="text-danger"/>Conflito ou crítico</span>
    </div>

    {view === 'week' ? <>
      <div className="hidden max-h-[70vh] overflow-auto rounded-xl border border-border bg-card-bg md:block"><div className="min-w-[1310px]">
        <div className="sticky top-0 z-20 grid grid-cols-[210px_repeat(7,minmax(157px,1fr))] border-b border-border bg-card-bg shadow-sm"><div className="sticky left-0 z-30 bg-card-bg p-3 text-xs font-semibold text-text-muted">Unidade · setor · turno</div>{week.map((day, index) => <button key={day} type="button" onClick={() => openSelection(day)} className={`border-l border-border px-3 py-2 text-left transition hover:bg-state-hover ${date === day ? 'bg-primary/5 text-primary' : ''}`}><span className="block text-[10px] font-semibold uppercase tracking-wide">{weekdays[index]}</span><span className="block text-sm font-semibold tabular-nums">{dayLabel(day)}</span></button>)}</div>
        {visibleRows.map((row, index) => <div key={`${row.sector.id}-${row.kind}`} className={`grid grid-cols-[210px_repeat(7,minmax(157px,1fr))] ${index ? 'border-t border-border' : ''}`}><button type="button" onClick={() => { onSelectSector(row.sector.id); openSelection(date, row.sector.id, row.kind); }} className="sticky left-0 z-10 border-r border-border bg-card-bg p-3 text-left transition hover:bg-state-hover"><span className="block truncate text-[10px] text-text-muted">{unitById.get(row.sector.unitId)?.name || 'Unidade'}</span><span className="mt-0.5 block truncate text-xs font-semibold text-text-primary">{row.sector.name}</span><span className="mt-2 flex items-center gap-1 text-[10px] text-text-muted"><PeriodIcon kind={row.kind}/>{coveragePeriodLabel(row.kind)} · {row.startTime}–{row.endTime}</span></button>{week.map(day => <div key={day}>{periodCell(row.sector, day, row.kind)}</div>)}</div>)}
        {!visibleRows.length && <p className="p-10 text-center text-sm text-text-muted">Nenhum turno corresponde aos filtros neste período.</p>}
      </div></div>
      <div className="space-y-4 md:hidden">{week.map(day => {
        const groups = sectors.map(sector => ({ sector, periods: coverageFor(sector, day).periods.filter(matches) })).filter(group => group.periods.length);
        if (!groups.length) return null;
        return <section key={day} className="overflow-hidden rounded-xl border border-border bg-card-bg"><button type="button" onClick={() => openSelection(day)} className="w-full border-b border-border bg-surface-muted/35 px-4 py-3 text-left text-sm font-semibold capitalize">{dayLabel(day, { weekday: 'long', day: '2-digit', month: 'short' })}</button><div className="divide-y divide-border">{groups.map(({ sector, periods }) => <div key={sector.id} className="px-4 py-3"><p className="text-[11px] text-text-muted">{unitById.get(sector.unitId)?.name}</p><p className="text-sm font-semibold">{sector.name}</p><div className="mt-2 space-y-1">{periods.map(period => { const state = tone(period, hasPeriodConflict(period), day); return <button key={period.period.kind} type="button" onClick={() => openSelection(day, sector.id, period.period.kind)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-2 text-left hover:bg-state-hover"><span className="flex items-center gap-2 text-xs"><PeriodIcon kind={period.period.kind}/>{period.period.startTime}–{period.period.endTime}</span><span className={`flex items-center gap-1 text-xs font-semibold ${state.color}`}><state.Icon size={13}/>{period.filled}/{period.required} · {state.label}</span></button>; })}</div></div>)}</div></section>;
      })}</div>
    </> : <>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card-bg md:block"><div className="min-w-[700px]"><div className="grid grid-cols-7 border-b border-border bg-surface-muted/35">{monthWeekdays.map(day => <span key={day} className="p-3 text-center text-xs font-semibold text-text-muted">{day}</span>)}</div><div className="grid grid-cols-7">{Array.from({ length: firstDayOffset }, (_, index) => <div key={`pad-${index}`} className="min-h-29 border-b border-r border-border bg-surface-muted/15"/>)}{monthSummaries.map(({ day, filled, required, deficit, open, conflict }) => <button key={day} type="button" onClick={() => openSelection(day)} className={`min-h-29 border-b border-r border-border p-2 text-left align-top transition hover:bg-state-hover ${date === day ? 'bg-primary/5 ring-2 ring-inset ring-primary' : ''}`}><span className="block text-sm font-semibold tabular-nums">{Number(day.slice(-2))}</span>{required > 0 && <><span className="mt-2 block text-xs font-semibold tabular-nums">{filled}/{required} postos</span>{deficit > 0 && <span className="mt-1 block text-[10px] font-medium text-warning">{deficit} {deficit === 1 ? 'turno com déficit' : 'turnos com déficit'}</span>}{open > 0 && <span className="block text-[10px] font-medium text-info">{open} {open === 1 ? 'vaga aberta' : 'vagas abertas'}</span>}{conflict > 0 && <span className="block text-[10px] font-medium text-danger">{conflict} {conflict === 1 ? 'conflito' : 'conflitos'}</span>}</>}</button>)}</div></div></div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-bg md:hidden">{monthSummaries.map(({ day, filled, required, deficit, open, conflict }) => <button key={day} type="button" onClick={() => openSelection(day)} className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-state-hover"><span className="min-w-0"><span className="block text-sm font-semibold capitalize">{dayLabel(day, { weekday: 'short', day: '2-digit', month: 'short' })}</span><span className="text-xs text-text-muted">{required ? `${filled} de ${required} postos` : 'Sem postos previstos'}</span></span><span className="text-right text-[11px] font-medium">{deficit > 0 && <span className="block text-warning">{deficit} com déficit</span>}{open > 0 && <span className="block text-info">{open} {open === 1 ? 'vaga' : 'vagas'}</span>}{conflict > 0 && <span className="block text-danger">{conflict} {conflict === 1 ? 'conflito' : 'conflitos'}</span>}</span></button>)}</div>
    </>}

    {selection && <Inspector selection={selection} onClose={() => setSelection(null)}>
      {actionFeedback && <p role="status" className="rounded-lg border border-border bg-surface-muted/30 px-3 py-2 text-xs text-text-secondary">{actionFeedback}</p>}
      {selectionGroups.length ? selectionGroups.map(({ sector, periods }) => <section key={sector.id} className="border-b border-border pb-5 last:border-0"><div><p className="text-xs text-text-muted">{unitById.get(sector.unitId)?.name || 'Unidade'}</p><h3 className="mt-0.5 text-base font-semibold">{sector.name}</h3></div><div className="mt-4 space-y-5">{periods.map(period => { const conflict = hasPeriodConflict(period); const state = tone(period, conflict, selection.day); return <div key={period.period.kind}><div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-semibold"><PeriodIcon kind={period.period.kind}/>{coveragePeriodLabel(period.period.kind)} · {period.period.startTime}–{period.period.endTime}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{period.filled}<span className="text-base font-normal text-text-muted">/{period.required} médicos</span></p></div><span className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${state.color} ${state.background}`}><state.Icon size={12}/>{state.label}</span></div>
          <div className="mt-3 space-y-2">{period.assigned.filter(shift => (!employment || shift.employmentType === employment) && (!doctorId || shift.doctorId === doctorId)).map(shift => { const doctor = doctorById.get(shift.doctorId || ''); const warning = doctor && doctorWarnings.get(doctor.id); return <div key={shift.id} className="flex items-center gap-1 rounded-lg border border-border pr-1 transition hover:bg-state-hover"><button type="button" onClick={() => edit(shift)} className="flex min-h-16 min-w-0 flex-1 items-center justify-between gap-3 px-3 text-left"><span className="flex min-w-0 items-center gap-2"><UserAvatar name={doctor?.name || 'Médico'} className="h-8 w-8"/><span className="min-w-0"><span className="block truncate text-xs font-semibold">{doctor?.name || 'Médico não encontrado'}</span><span className="mt-0.5 block text-[10px] text-text-muted">{shift.employmentType ? employmentLabels[shift.employmentType] : 'Vínculo não informado'}{shift.specialty ? ` · ${shift.specialty}` : ''}</span>{shift.notes && <span className="mt-0.5 block truncate text-[10px] text-text-muted" title={shift.notes}>{shift.notes}</span>}{canSeeFinancial && Number(shift.paymentAmount) > 0 && <span className="mt-0.5 block text-[10px] text-text-muted">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(shift.paymentAmount))}</span>}</span></span><span className={`shrink-0 text-[10px] font-medium ${shift.status === 'confirmed' || shift.status === 'completed' ? 'text-success' : 'text-warning'}`}>{warning?.warning && <FileWarning size={12} className="mr-1 inline text-danger" aria-label="Pendência documental"/>}{statusLabels[shift.status]}</span></button><button type="button" aria-label={`Excluir plantão de ${doctor?.name || 'médico'}`} onClick={() => void onDeleteShift(shift)} className={canEditSchedule ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/5 hover:text-danger" : "hidden"}><Trash2 size={14}/></button></div>; })}
            {period.vacancies.map(shift => <div key={shift.id} className="flex items-center gap-1 rounded-lg border border-info/25 bg-info/[0.045] pr-1 text-xs font-semibold text-info"><button type="button" onClick={() => edit(shift)} className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left"><span className="flex items-center gap-1.5"><UserRoundPlus size={14}/>Vaga aberta · disponível para preenchimento</span><span>Preencher</span></button><button type="button" aria-label="Excluir vaga aberta" onClick={() => void onDeleteShift(shift)} className={canEditSchedule ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/5 hover:text-danger" : "hidden"}><Trash2 size={14}/></button></div>)}
            {period.uncreated > 0 && <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/25 bg-warning/[0.045] px-3 py-3 text-xs"><span className="text-warning">{period.uncreated} {period.uncreated === 1 ? 'posto previsto ainda não criado' : 'postos previstos ainda não criados'}</span><button type="button" onClick={() => create(sector, selection.day, period.period.kind, period.uncreated)} className="shrink-0 font-semibold text-primary hover:underline">Criar</button></div>}
            {conflict && <p className="flex items-center gap-1.5 text-xs text-danger"><AlertTriangle size={13}/>Há médicos com horários coincidentes. Abra o plantão para corrigir.</p>}
          </div>
          {canEditSchedule && period.items.length > 0 && <button type="button" onClick={() => onDeleteTurn(sector, selection.day, period.period.kind)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-danger transition hover:bg-danger/5"><Trash2 size={13}/>Excluir este turno ({period.items.length})</button>}
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => create(sector, selection.day, period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Plus size={13}/>Novo posto</button>{period.vacancies[0] && <button type="button" onClick={() => edit(period.vacancies[0])} className="nv-button min-h-9 text-xs"><UserRoundPlus size={13}/>Preencher vaga</button>}<button type="button" onClick={() => void copy(sector, offsetDay(selection.day, -1), selection.day, period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Copy size={13}/>Copiar dia anterior</button><button type="button" onClick={() => void copy(sector, selection.day, offsetDay(selection.day, 1), period.period.kind)} className="nv-button-secondary min-h-9 text-xs"><Copy size={13}/>Duplicar para amanhã</button></div>
        </div>; })}</div></section>) : <p className="py-10 text-center text-sm text-text-muted">Nenhum turno corresponde aos filtros neste dia.</p>}
    </Inspector>}
  </>;
}
