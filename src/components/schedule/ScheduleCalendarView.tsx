'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Check, Clock3, Moon, Plus, Sun, Trash2, UserRoundPlus } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { coveragePeriodLabel, employmentLabels, summarizeSectorCoverage, type SectorCoverageSummary } from '@/lib/scheduling';
import type { CoveragePeriodKind, Doctor, EmploymentType, Sector, Shift, Unit } from '@/types';

const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const monthDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const statusLabels = { open: 'Vaga aberta', confirmed: 'Confirmado', pending: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado' };

type DoctorWarning = { warning: boolean; blocked: boolean };
type CalendarView = 'week' | 'month';

interface ScheduleCalendarViewProps {
  view: CalendarView;
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
  onlyGaps: boolean;
  selectedSectorId: string;
  selectedUnitId: string;
  doctorWarnings: Map<string, DoctorWarning>;
  onSelectDate: (date: string) => void;
  onSelectSector: (sectorId: string) => void;
  onOpenShift: (sector: Sector, date: string, kind?: CoveragePeriodKind, suggestedCount?: number) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => Promise<void>;
}

interface DaySummary {
  required: number;
  created: number;
  filled: number;
  open: number;
  uncreated: number;
  deficit: number;
}

function formatDay(value: string) {
  return new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

function formatFullDate(value: string) {
  return new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
}

function doctorShortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 2 ? `${parts[0]} ${parts.at(-1)}` : name;
}

function emptyDaySummary(): DaySummary {
  return { required: 0, created: 0, filled: 0, open: 0, uncreated: 0, deficit: 0 };
}

function mergeSummary(total: DaySummary, summary: SectorCoverageSummary): DaySummary {
  return {
    required: total.required + summary.required,
    created: total.created + summary.created,
    filled: total.filled + summary.filled,
    open: total.open + summary.open,
    uncreated: total.uncreated + summary.uncreated,
    deficit: total.deficit + summary.deficit,
  };
}

function CoverageLegend() {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-text-muted" aria-label="Legenda da escala">
    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success"/>Médico escalado</span>
    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning"/>Vaga criada</span>
    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-danger"/>Posto por criar</span>
  </div>;
}

function SummaryStrip({ summary }: { summary: DaySummary }) {
  return <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-surface-muted/25">
    <div className="p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Escalados</p><p className="mt-1 text-lg font-semibold tabular-nums text-success">{summary.filled}<span className="text-sm font-normal text-text-muted">/{summary.required}</span></p></div>
    <div className="border-l border-border p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Vagas abertas</p><p className={`mt-1 text-lg font-semibold tabular-nums ${summary.open ? 'text-warning' : 'text-text-secondary'}`}>{summary.open}</p></div>
    <div className="border-l border-border p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Por criar</p><p className={`mt-1 text-lg font-semibold tabular-nums ${summary.uncreated ? 'text-danger' : 'text-text-secondary'}`}>{summary.uncreated}</p></div>
  </div>;
}

function PeriodIcon({ kind, size = 14 }: { kind: CoveragePeriodKind; size?: number }) {
  const Icon = kind === 'day' ? Sun : Moon;
  return <Icon size={size} className={kind === 'day' ? 'shrink-0 text-warning' : 'shrink-0 text-primary'}/>;
}

interface DayGroupsProps {
  day: string;
  groups: Array<{ sector: Sector; coverage: SectorCoverageSummary }>;
  units: Unit[];
  doctors: Doctor[];
  employment: EmploymentType | '';
  doctorWarnings: Map<string, DoctorWarning>;
  compact?: boolean;
  onSelectSector: (sectorId: string) => void;
  onOpenShift: ScheduleCalendarViewProps['onOpenShift'];
  onEditShift: ScheduleCalendarViewProps['onEditShift'];
  onDeleteShift: ScheduleCalendarViewProps['onDeleteShift'];
}

function DayGroups({ day, groups, units, doctors, employment, doctorWarnings, compact = false, onSelectSector, onOpenShift, onEditShift, onDeleteShift }: DayGroupsProps) {
  if (!groups.length) return <div className="py-10 text-center"><p className="text-sm font-medium">Nenhum setor para exibir</p><p className="mt-1 text-xs text-text-muted">Ajuste os filtros ou cadastre um setor nesta unidade.</p></div>;

  return <div className={compact ? 'grid gap-3 lg:grid-cols-2' : 'space-y-4'}>
    {groups.map(({ sector, coverage }) => {
      const unit = units.find(item => item.id === sector.unitId);
      return <section key={sector.id} className="rounded-xl border border-border bg-card-bg p-4">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={() => onSelectSector(sector.id)} className="min-w-0 text-left">
            <span className="block truncate text-[11px] text-text-muted">{unit?.name || 'Unidade'}</span>
            <span className="mt-0.5 block truncate text-sm font-semibold text-text-primary">{sector.name}</span>
          </button>
          <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${coverage.deficit ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>{coverage.filled}/{coverage.required} escalados</span>
        </div>
        {sector.specialties.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{sector.specialties.map(item => <span key={item} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-text-muted">{item}</span>)}</div>}
        <div className="mt-3 space-y-3">
          {coverage.periods.map(period => {
            const displayItems = period.items.filter(item => !employment || !item.doctorId || item.employmentType === employment);
            return <div key={period.period.kind} className="rounded-xl border border-border bg-surface-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PeriodIcon kind={period.period.kind} size={16}/>
                  <div><p className="text-xs font-semibold">{coveragePeriodLabel(period.period.kind)}</p><p className="text-[11px] tabular-nums text-text-muted">{period.period.startTime}–{period.period.endTime}</p></div>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-medium">
                  <span className="text-success">{period.filled} escalado{period.filled === 1 ? '' : 's'}</span>
                  {period.open > 0 && <span className="text-warning">{period.open} vaga{period.open === 1 ? '' : 's'}</span>}
                  {period.uncreated > 0 && <span className="text-danger">{period.uncreated} por criar</span>}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {displayItems.map(item => {
                  const doctor = doctors.find(value => value.id === item.doctorId);
                  const warning = doctor ? doctorWarnings.get(doctor.id) : undefined;
                  const sequence = period.items.findIndex(value => value.id === item.id) + 1;
                  return <div key={item.id} className={`rounded-lg border px-3 py-2.5 ${doctor ? 'border-success/20 bg-success/5' : 'border-warning/25 bg-warning/5'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Plantão {String(sequence).padStart(2, '0')}</span><span className={`text-[10px] font-semibold ${item.status === 'confirmed' ? 'text-success' : 'text-warning'}`}>{statusLabels[item.status]}</span></div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                      <button type="button" onClick={() => onEditShift(item)} className="min-w-0 flex-1 text-left"><span className={`flex items-center gap-1.5 truncate text-xs font-semibold ${doctor ? 'text-text-primary' : 'text-warning'}`}>{doctor?.name || 'Vaga aberta'}{warning?.warning && <AlertTriangle size={12} className={warning.blocked ? 'shrink-0 text-danger' : 'shrink-0 text-warning'}/>}</span><span className="mt-0.5 flex items-center gap-1 text-[10px] text-text-muted"><Clock3 size={11}/>{item.startTime}–{item.endTime}{item.employmentType ? ` · ${employmentLabels[item.employmentType]}` : ''}</span></button>
                      <div className="flex shrink-0 items-center gap-1"><button type="button" onClick={() => onEditShift(item)} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-card-bg px-2.5 text-[11px] font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/5">{doctor ? <ArrowRightLeft size={12}/> : <UserRoundPlus size={12}/>} {doctor ? 'Trocar médico' : 'Preencher vaga'}</button><button type="button" className="p-2 text-text-muted hover:text-danger" aria-label={`Excluir plantão ${sequence}`} onClick={() => void onDeleteShift(item)}><Trash2 size={13}/></button></div>
                    </div>
                  </div>;
                })}
                {employment && !displayItems.length && period.items.length > 0 && <p className="py-1 text-[11px] text-text-muted">Nenhum plantão deste período corresponde ao vínculo selecionado.</p>}
                {!period.items.length && <p className="py-1 text-[11px] text-text-muted">Nenhum posto criado para este período.</p>}
              </div>
              {period.uncreated > 0 && <button type="button" onClick={() => onOpenShift(sector, day, period.period.kind, period.uncreated)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><Plus size={13}/>Criar {period.uncreated} {period.uncreated === 1 ? 'posto previsto' : 'postos previstos'}</button>}
            </div>;
          })}
        </div>
      </section>;
    })}
  </div>;
}

export default function ScheduleCalendarView({ view, date, week, month, firstDayOffset, daysInMonth, units, sectors, doctors, shifts, employment, onlyGaps, selectedSectorId, selectedUnitId, doctorWarnings, onSelectDate, onSelectSector, onOpenShift, onEditShift, onDeleteShift }: ScheduleCalendarViewProps) {
  const [detailsDate, setDetailsDate] = useState<string | null>(null);

  const coverageFor = (sector: Sector, day: string) => summarizeSectorCoverage(sector, shifts.filter(item => item.sectorId === sector.id && item.date === day));
  const groupsFor = (day: string) => sectors
    .map(sector => ({ sector, coverage: coverageFor(sector, day) }))
    .filter(group => !onlyGaps || group.coverage.deficit > 0);
  const summaryFor = (day: string) => groupsFor(day).reduce((total, group) => mergeSummary(total, group.coverage), emptyDaySummary());
  const selectedGroups = groupsFor(date);
  const selectedSummary = summaryFor(date);

  const openDay = (day: string) => {
    onSelectDate(day);
    setDetailsDate(day);
  };

  const monthPeriodRows = (day: string) => {
    const rows = new Map<string, { kind: CoveragePeriodKind; startTime: string; endTime: string; filled: number; required: number; open: number; uncreated: number }>();
    groupsFor(day).forEach(group => group.coverage.periods.forEach(period => {
      const key = `${period.period.kind}-${period.period.startTime}-${period.period.endTime}`;
      const current = rows.get(key) || { kind: period.period.kind, startTime: period.period.startTime, endTime: period.period.endTime, filled: 0, required: 0, open: 0, uncreated: 0 };
      current.filled += period.filled;
      current.required += period.required;
      current.open += period.open;
      current.uncreated += period.uncreated;
      rows.set(key, current);
    }));
    return [...rows.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
  };

  const closeDetailsAndOpen = (sector: Sector, day: string, kind?: CoveragePeriodKind, count?: number) => {
    setDetailsDate(null);
    onOpenShift(sector, day, kind, count);
  };
  const closeDetailsAndEdit = (shift: Shift) => {
    setDetailsDate(null);
    onEditShift(shift);
  };

  return <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <CoverageLegend/>
      <p className="text-[11px] text-text-muted">Clique em um dia para ver médicos, vagas e especialidades.</p>
    </div>
    <div className="grid gap-5">
      <main className="min-w-0">
        {view === 'week' ? <div className="overflow-x-auto rounded-xl border border-border bg-card-bg"><div className="min-w-[1160px]">
          <div className="grid grid-cols-[240px_repeat(7,minmax(130px,1fr))] border-b border-border bg-surface-muted/60">
            <div className="p-3 text-xs font-semibold text-text-muted">Unidade · setor</div>
            {week.map((day, index) => <button key={day} type="button" onClick={() => onSelectDate(day)} className={`border-l border-border p-3 text-center transition hover:bg-state-hover ${date === day ? 'bg-primary/10 text-primary' : ''}`}><span className="block text-xs font-semibold">{weekDays[index]}</span><span className="mt-1 block text-sm tabular-nums">{formatDay(day)}</span></button>)}
          </div>
          {sectors.filter(sector => !onlyGaps || week.some(day => coverageFor(sector, day).deficit > 0)).map((sector, rowIndex) => {
            const unit = units.find(item => item.id === sector.unitId);
            return <div key={sector.id} className={`grid grid-cols-[240px_repeat(7,minmax(130px,1fr))] ${rowIndex ? 'border-t border-border' : ''}`}>
              <button type="button" className="p-3 text-left transition hover:bg-state-hover" onClick={() => onSelectSector(sector.id)}><span className="block truncate text-[11px] text-text-muted">{unit?.name}</span><span className="mt-1 block truncate text-sm font-semibold">{sector.name}</span><span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-text-muted">{sector.specialties.join(' · ') || 'Sem especialidade'}</span></button>
              {week.map(day => {
                const coverage = coverageFor(sector, day);
                const tone = coverage.uncreated ? 'bg-danger/[0.035]' : coverage.open ? 'bg-warning/[0.04]' : coverage.filled ? 'bg-success/[0.035]' : '';
                return <button key={day} type="button" onClick={() => onSelectDate(day)} className={`min-h-44 border-l border-border p-2.5 text-left align-top transition hover:bg-state-hover ${tone} ${date === day && (!selectedSectorId || selectedSectorId === sector.id) ? 'ring-2 ring-inset ring-primary' : ''}`}>
                  <span className="flex items-center justify-between gap-1"><span className={`inline-flex items-center gap-1 text-xs font-semibold ${coverage.deficit ? 'text-danger' : 'text-success'}`}>{coverage.deficit ? <AlertTriangle size={12}/> : <Check size={12}/>} {coverage.filled}/{coverage.required}</span><span className="text-[9px] uppercase tracking-wide text-text-muted">médicos</span></span>
                  <span className="mt-2 block space-y-2">{coverage.periods.map(period => {
                    const names = period.assigned.map(item => doctors.find(doctor => doctor.id === item.doctorId)?.name).filter(Boolean) as string[];
                    return <span key={period.period.kind} className="block border-t border-border/70 pt-2 first:border-t-0 first:pt-0">
                      <span className="flex items-center justify-between gap-1"><span className="flex items-center gap-1 text-[10px] font-medium text-text-secondary"><PeriodIcon kind={period.period.kind} size={12}/>{period.period.startTime}–{period.period.endTime}</span><span className="text-[10px] font-semibold tabular-nums">{period.filled}/{period.required}</span></span>
                      {names.length > 0 && <span className="mt-1 block truncate text-[10px] text-success" title={names.join(', ')}>{doctorShortName(names[0])}{names.length > 1 ? ` +${names.length - 1}` : ''}</span>}
                      {period.open > 0 && <span className="mt-0.5 block text-[10px] font-medium text-warning">{period.open} {period.open === 1 ? 'vaga criada' : 'vagas criadas'}</span>}
                      {period.uncreated > 0 && <span className="mt-0.5 block text-[10px] font-medium text-danger">{period.uncreated} {period.uncreated === 1 ? 'posto por criar' : 'postos por criar'}</span>}
                    </span>;
                  })}</span>
                </button>;
              })}
            </div>;
          })}
          {!sectors.length && <div className="p-12 text-center text-sm text-text-muted">Nenhum setor corresponde aos filtros.</div>}
        </div></div> : <div className="overflow-x-auto rounded-xl border border-border bg-card-bg"><div className="min-w-[920px]">
          <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60">{monthDays.map(item => <div key={item} className="p-3 text-center text-xs font-semibold text-text-muted">{item}</div>)}</div>
          <div className="grid grid-cols-7">
            {Array.from({ length: firstDayOffset }, (_, index) => <div key={`pad-${index}`} className="min-h-36 border-b border-r border-border bg-surface-muted/20"/>)}
            {Array.from({ length: daysInMonth }, (_, index) => {
              const day = `${month}-${String(index + 1).padStart(2, '0')}`;
              const summary = summaryFor(day);
              const rows = monthPeriodRows(day);
              const tone = summary.uncreated ? 'bg-danger/[0.025]' : summary.open ? 'bg-warning/[0.03]' : summary.filled ? 'bg-success/[0.025]' : '';
              return <button key={day} type="button" onClick={() => openDay(day)} aria-label={`Abrir plantões de ${formatFullDate(day)}`} className={`min-h-36 border-b border-r border-border p-2.5 text-left align-top transition hover:bg-state-hover ${tone} ${date === day ? 'ring-2 ring-inset ring-primary' : ''}`}>
                <span className="flex items-start justify-between gap-2"><span className="text-sm font-semibold tabular-nums">{index + 1}</span>{summary.required > 0 && <span className={`text-[10px] font-semibold tabular-nums ${summary.deficit ? 'text-danger' : 'text-success'}`}>{summary.filled}/{summary.required}</span>}</span>
                <span className="mt-2 block space-y-1.5">{rows.slice(0, 2).map(row => <span key={`${row.kind}-${row.startTime}`} className="block rounded-md border border-border bg-card-bg/70 px-1.5 py-1"><span className="flex items-center justify-between gap-1 text-[9px]"><span className="flex items-center gap-1 text-text-muted"><PeriodIcon kind={row.kind} size={10}/>{row.startTime}–{row.endTime}</span><strong className={row.filled < row.required ? 'text-danger' : 'text-success'}>{row.filled}/{row.required}</strong></span>{row.open > 0 && <span className="mt-0.5 block text-[9px] text-warning">{row.open} vaga{row.open === 1 ? '' : 's'}</span>}{row.uncreated > 0 && <span className="mt-0.5 block text-[9px] text-danger">{row.uncreated} por criar</span>}</span>)}{rows.length > 2 && <span className="block text-[9px] font-medium text-primary">+{rows.length - 2} horários</span>}</span>
              </button>;
            })}
          </div>
        </div></div>}
      </main>

      <aside className="rounded-xl border border-border bg-card-bg">
        <div className="border-b border-border p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium capitalize text-text-muted">{new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long' })}</p><h2 className="mt-1 font-semibold">{formatDay(date)}</h2></div><button type="button" onClick={() => setDetailsDate(date)} className="text-xs font-semibold text-primary hover:underline">Ver detalhes</button></div><div className="mt-4"><SummaryStrip summary={selectedSummary}/></div></div>
        <div className="p-4"><DayGroups day={date} groups={selectedGroups} units={units} doctors={doctors} employment={employment} doctorWarnings={doctorWarnings} compact onSelectSector={onSelectSector} onOpenShift={onOpenShift} onEditShift={onEditShift} onDeleteShift={onDeleteShift}/></div>
      </aside>
    </div>

    {detailsDate && (() => {
      const groups = groupsFor(detailsDate);
      const summary = summaryFor(detailsDate);
      const context = selectedUnitId ? units.find(unit => unit.id === selectedUnitId)?.name : 'Todas as unidades';
      return <Dialog title={`Plantões de ${formatFullDate(detailsDate)}`} size="xl" onClose={() => setDetailsDate(null)}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">{context}</p><p className="mt-1 text-xs text-text-muted">{selectedSectorId ? 'Setor filtrado' : 'Todos os setores e especialidades visíveis'}</p></div><CoverageLegend/></div>
          <SummaryStrip summary={summary}/>
          <DayGroups day={detailsDate} groups={groups} units={units} doctors={doctors} employment={employment} doctorWarnings={doctorWarnings} onSelectSector={onSelectSector} onOpenShift={closeDetailsAndOpen} onEditShift={closeDetailsAndEdit} onDeleteShift={onDeleteShift}/>
        </div>
      </Dialog>;
    })()}
  </>;
}
