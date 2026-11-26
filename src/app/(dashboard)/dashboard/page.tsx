'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, CalendarCheck, ChevronDown, ChevronLeft, ChevronRight, Clock3, type LucideIcon } from 'lucide-react';
import OperationalIndicators, { useOperationalCounts } from '@/components/OperationalIndicators';
import UserAvatar from '@/components/UserAvatar';
import { coverageDays, coverageWeeks, dashboardAgenda, dashboardRange, dashboardShiftMatches, moveDashboardMonth, shiftScheduleHref, type DashboardPeriod } from '@/lib/dashboardOverview';
import { coverageDate, coverageDuration, coverageGroups, summarizeRegisteredCoverage } from '@/lib/fractionalCoverage';
import { saoPauloDate } from '@/lib/financeState';
import { canViewPermission } from '@/lib/permissions';
import { employmentLabels, localDate, shiftInterval } from '@/lib/scheduling';
import { useStore } from '@/store/useStore';
import { useWorkspacePeriod } from '@/components/WorkspaceDataBoundary';
import { useWorkspaceOverview } from '@/components/WorkspaceOverviewProvider';
import type { DocumentOverview } from '@/lib/workspaceOverview';
import type { Doctor, EmploymentType, Sector, Shift, Unit } from '@/types';

const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateAtNoon = (date: string) => new Date(date + 'T12:00:00');
const shortTime = (time: string) => time.slice(0, 5);
const displayDay = (date: string) => {
  const formatted = longDate.format(dateAtNoon(date));
  return formatted.charAt(0).toLocaleUpperCase('pt-BR') + formatted.slice(1);
};

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-sm text-sm font-semibold text-primary hover:underline">
    {children}<ArrowUpRight size={15} className="shrink-0" aria-hidden="true" />
  </Link>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return <div className="grid min-h-35 place-items-center rounded-xl bg-surface-muted/55 px-4 py-5 text-center">
    <div className="max-w-80">
      <Icon size={21} aria-hidden="true" className="mx-auto mb-2 text-accent" />
      <p className="text-sm font-semibold text-text-primary">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">{detail}</p>
    </div>
  </div>;
}

function SegmentedControl<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (value: T) => void; options: { value: T; label: string }[];
}) {
  return <div role="group" aria-label={label} className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-xl bg-surface-muted p-1">
    {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}
      className={`min-h-9 cursor-pointer rounded-lg px-3 text-xs font-semibold transition-colors ${value === option.value ? 'bg-surface-elevated text-text-primary shadow-soft' : 'text-text-muted hover:text-primary'}`}>
      {option.label}
    </button>)}
  </div>;
}

const periodOptions: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' }, { value: 'tomorrow', label: 'Amanhã' },
  { value: 'week', label: '7 dias' }, { value: 'month', label: 'Mês' },
];

function MonthNavigation({ month, onChange }: { month: string; onChange: (value: string) => void }) {
  const button = 'grid size-10 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-state-hover';
  return <div className="mt-3 flex w-fit max-w-full items-center gap-1 rounded-xl border border-border px-1">
    <button type="button" className={button} aria-label="Mês anterior" onClick={() => onChange(moveDashboardMonth(month, -1))}><ChevronLeft size={16} aria-hidden="true" /></button>
    <span aria-live="polite" className="min-w-32 text-center text-xs font-semibold capitalize">{monthLabel.format(dateAtNoon(`${month}-01`))}</span>
    <button type="button" className={button} aria-label="Próximo mês" onClick={() => onChange(moveDashboardMonth(month, 1))}><ChevronRight size={16} aria-hidden="true" /></button>
  </div>;
}

type CoverageFilters = { unit: string; specialty: string; employment: EmploymentType | '' };

function ScheduleFilterBar({ units, specialties, filters, onFilter }: {
  units: Unit[]; specialties: string[]; filters: CoverageFilters; onFilter: (filters: CoverageFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fieldsId = useId();
  const activeCount = Object.values(filters).filter(Boolean).length;
  return <div className="nv-panel rounded-xl px-3 py-2 sm:px-4 sm:py-3">
    <button type="button" aria-expanded={expanded} aria-controls={fieldsId} onClick={() => setExpanded(value => !value)}
      className="flex min-h-10 w-full items-center justify-between gap-2 text-left text-sm font-semibold sm:hidden">
      <span>Filtros de cobertura e agenda{activeCount > 0 && <span className="ml-2 text-xs text-primary">({activeCount})</span>}</span>
      <ChevronDown size={16} aria-hidden="true" className={expanded ? 'shrink-0 rotate-180' : 'shrink-0'}/>
    </button>
    <fieldset id={fieldsId} className={`${expanded ? 'grid' : 'hidden'} min-w-0 gap-3 pb-2 pt-1 sm:grid sm:grid-cols-3 sm:p-0`}>
      <legend className="sr-only">Filtros de cobertura e agenda</legend>
      <label className="nv-label text-xs">Unidade<select className="nv-input" value={filters.unit} onChange={event => onFilter({ ...filters, unit: event.target.value })}>
        <option value="">Todas</option>{units.map(unit => <option value={unit.id} key={unit.id}>{unit.name}</option>)}
      </select></label>
      <label className="nv-label text-xs">Especialidade<select className="nv-input" value={filters.specialty} onChange={event => onFilter({ ...filters, specialty: event.target.value })}>
        <option value="">Todas</option>{specialties.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label className="nv-label text-xs">Modalidade de contratação<select className="nv-input" value={filters.employment} onChange={event => onFilter({ ...filters, employment: event.target.value as EmploymentType | '' })}>
        <option value="">Todas</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </fieldset>
  </div>;
}

function CoveragePanel({ today, sectors, shifts, unitById, doctorById, filters }: {
  today: string; sectors: Sector[]; shifts: Shift[]; unitById: Map<string, Unit>; doctorById: Map<string, Doctor>;
  filters: CoverageFilters;
}) {
  const [range, setRange] = useState<DashboardPeriod>('week');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [groupBy, setGroupBy] = useState<'unit' | 'sector' | 'specialty'>('unit');
  const [showAll, setShowAll] = useState(false);
  const [referenceTime] = useState(Date.now);
  const { start, end, length } = dashboardRange(today, range, month);
  useWorkspacePeriod('coverage',{start,end});
  const periodShifts = shifts.filter(shift => shift.status !== 'cancelled' && coverageDate(shift) >= start && coverageDate(shift) <= end);
  const registered = summarizeRegisteredCoverage(periodShifts);
  const hourCoverage = registered.plannedMinutes ? Math.round(100 * registered.coveredMinutes / registered.plannedMinutes) : 0;
  const visibleDays = coverageDays(start, sectors, periodShifts, length, Boolean(filters.specialty || filters.employment));
  const columns = range === 'month' ? coverageWeeks(visibleDays) : visibleDays.map(day => ({ ...day, end: day.day }));
  const required = visibleDays.reduce((sum, day) => sum + day.required, 0);
  const deficit = visibleDays.reduce((sum, day) => sum + day.deficit, 0);
  const vacancies = periodShifts.filter(shift => !shift.doctorId).map(shiftInterval);
  const upcomingVacancies = vacancies.filter(vacancy => vacancy.start > referenceTime).length;
  const historicalGaps = vacancies.filter(vacancy => vacancy.end <= referenceTime).length;
  const confirmed = periodShifts.filter(shift => shift.status === 'confirmed' && shift.doctorId).length;
  const percent = required ? Math.round((required - deficit) / required * 100) : null;
  const peak = Math.max(1, ...columns.map(day => day.required));
  const distribution = new Map<string, { name: string; posts: Shift[][] }>();
  for (const post of coverageGroups(periodShifts).values()) {
    const shift = post[0];
    const specialty = shift.specialty || doctorById.get(shift.doctorId || '')?.specialty || 'Sem especialidade';
    const key = groupBy === 'unit' ? shift.unitId : groupBy === 'sector' ? shift.sectorId || '' : specialty;
    const name = groupBy === 'unit' ? unitById.get(key)?.name || 'Unidade sem cadastro'
      : groupBy === 'sector' ? sectors.find(sector => sector.id === key)?.name || 'Sem setor' : specialty;
    const group = distribution.get(key) || { name, posts: [] };
    group.posts.push(post);
    distribution.set(key, group);
  }
  const groups = [...distribution.entries()].map(([key, group]) => ({
    key, name: group.name, count: group.posts.length, coverage: summarizeRegisteredCoverage(group.posts.flat()),
  })).sort((a, b) => b.coverage.uncoveredMinutes - a.coverage.uncoveredMinutes || b.count - a.count || a.name.localeCompare(b.name, 'pt-BR'));
  const visibleGroups = showAll ? groups : groups.slice(0, 4);

  return <section id="cobertura" aria-labelledby="coverage-title" className="nv-panel self-start rounded-[1.375rem] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="coverage-title" className="nv-section-title">Escalas e cobertura</h2>
        <p className="mt-1 text-sm text-text-muted">{filters.specialty || filters.employment ? 'Ocupação dos postos cadastrados para os filtros selecionados.' : 'Ocupação dos postos previstos.'}</p>
      </div>
      <SegmentedControl label="Período de cobertura" value={range} onChange={setRange} options={periodOptions} />
    </div>
    {range === 'month' && <MonthNavigation month={month} onChange={setMonth} />}
    <div className="my-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <strong className="text-4xl font-semibold tracking-[-0.06em] tabular-nums text-text-primary">{percent === null ? '—' : `${percent}%`}</strong>
      <span className="text-sm text-text-secondary">{required ? `${required - deficit} de ${required} postos preenchidos` : 'Sem previsão de cobertura'}</span>
    </div>

    {required > 0 ? <>
      <ul aria-label={range === 'month' ? 'Cobertura semanal do mês' : 'Cobertura diária'} className="flex gap-0.5 rounded-2xl border border-border bg-surface-muted/35 px-2 pb-2 pt-3 sm:gap-2 sm:px-3">
        {columns.map(day => <li key={day.day} className="min-w-0 flex-1">
          <Link href={'/escala?' + new URLSearchParams({ date: day.day, ...(filters.unit && { unitId: filters.unit }), ...(filters.specialty && { specialty: filters.specialty }), ...(filters.employment && { contratacao: filters.employment }) })}
            aria-label={`${range === 'month' ? `${shortDate.format(dateAtNoon(day.day))} a ${shortDate.format(dateAtNoon(day.end))}` : longDate.format(dateAtNoon(day.day))}, ${day.required - day.deficit} de ${day.required} postos preenchidos`}
            className="group flex flex-col items-center gap-2 rounded-lg px-0.5 py-1 text-center hover:bg-state-hover">
            <span className="text-xs font-semibold tabular-nums text-text-secondary">{day.required - day.deficit}/{day.required}</span>
            <span className="flex h-19 w-full max-w-16 flex-col justify-end" aria-hidden="true">
              <span className="flex w-full flex-col justify-end overflow-hidden rounded-t-md bg-accent/20 group-hover:bg-accent/30" style={{ height: `${day.required / peak * 100}%` }}>
                <span className="bg-primary/80" style={{ height: day.required ? `${(day.required - day.deficit) / day.required * 100}%` : 0 }} />
              </span>
            </span>
            <span className="text-[11px] font-medium capitalize text-text-muted">{range === 'month' ? `${day.day.slice(-2)}–${day.end.slice(-2)}` : <>{weekday.format(dateAtNoon(day.day)).replace('.', '')} <span className="hidden min-[390px]:inline">{day.day.slice(-2)}</span></>}</span>
          </Link>
        </li>)}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/80" />Preenchidos</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-accent/25" />Descobertos</span>
      </div>
    </> : <EmptyState icon={CalendarDays} title={filters.specialty || filters.employment ? 'Sem postos cadastrados para os filtros selecionados' : 'Sem postos previstos neste período'} detail={filters.specialty ? 'Ajuste o período, a unidade ou a especialidade.' : 'A previsão aparece quando há setores ativos com cobertura configurada.'} />}

    <dl className="mt-4 grid grid-cols-2 gap-3 border-y border-border py-3">
      <div><dt className="text-xs text-text-muted">Plantões confirmados</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-primary">{confirmed}</dd></div>
      <div><dt className="text-xs text-text-muted">Intervalos vagos</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${vacancies.length ? 'text-warning' : 'text-text-primary'}`}>{vacancies.length}</dd></div>
      <div><dt className="text-xs text-text-muted">Vagas futuras</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{upcomingVacancies}</dd></div>
      <div><dt className="text-xs text-text-muted">Intervalos encerrados sem cobertura</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{historicalGaps}</dd></div>
    </dl>
    {registered.plannedMinutes > 0 && <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
      {[
        ['Horas previstas cadastradas', coverageDuration(registered.plannedMinutes)],
        ['Horas cobertas', coverageDuration(registered.coveredMinutes)],
        ['Horas descobertas', coverageDuration(registered.uncoveredMinutes)],
        ['Cobertura das horas', `${hourCoverage}%`],
        ['Postos integrais', registered.complete],
        ['Postos parciais', registered.partial],
        ['Postos sem cobertura', registered.empty],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-0.5 font-semibold tabular-nums">{value}</dd></div>)}
    </dl>}

    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Postos cadastrados</h3>
      <SegmentedControl label="Agrupar postos" value={groupBy} onChange={value => { setGroupBy(value); setShowAll(false); }} options={[{ value: 'unit', label: 'Unidade' }, { value: 'sector', label: 'Setor' }, { value: 'specialty', label: 'Especialidade' }]} />
    </div>
    {groups.length ? <ul className="mt-2 divide-y divide-border">
      {visibleGroups.map(item => <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2.5 text-sm">
        <span className="min-w-0 wrap-anywhere font-medium text-text-secondary">{item.name}</span>
        <span className="text-xs tabular-nums text-text-muted">{item.count} {item.count === 1 ? 'posto' : 'postos'}
          {item.coverage.plannedMinutes > 0 && <span className="ml-2 font-semibold">{Math.round(100 * item.coverage.coveredMinutes / item.coverage.plannedMinutes)}% das horas</span>}</span>
      </li>)}
    </ul> : <p className="mt-2 text-sm text-text-muted">Nenhum plantão cadastrado neste período.</p>}
    {groups.length > 4 && <button type="button" className="mt-2 min-h-9 text-sm font-semibold text-primary hover:underline" onClick={() => setShowAll(value => !value)}>{showAll ? 'Mostrar menos' : `Mostrar mais ${groups.length - 4}`}</button>}
  </section>;
}

function UpcomingPanel({ today, shifts, unitById, doctorById, filters }: {
  today: string; shifts: Shift[]; unitById: Map<string, Unit>; doctorById: Map<string, Doctor>; filters: CoverageFilters;
}) {
  const [selected, setSelected] = useState<DashboardPeriod>('today');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [page, setPage] = useState({ key: '', index: 0 });
  const { start: day, end } = dashboardRange(today, selected, month);
  useWorkspacePeriod('agenda',{start:day,end});
  const agenda = useMemo(() => dashboardAgenda(shifts, day, end, selected !== 'month'), [shifts, day, end, selected]);
  const pageSize = selected === 'month' ? 8 : 4;
  const pageCount = Math.ceil(agenda.length / pageSize);
  const pageKey = JSON.stringify([selected, day, filters]);
  const pageIndex = page.key === pageKey ? Math.max(0, Math.min(page.index, pageCount - 1)) : 0;
  const scheduleHref = '/escala?' + new URLSearchParams({ date: day, ...(selected === 'month' && { view: 'month' }), ...(filters.unit && { unitId: filters.unit }), ...(filters.specialty && { specialty: filters.specialty }), ...(filters.employment && { contratacao: filters.employment }) });

  return <section aria-labelledby="agenda-title" className="nv-panel self-start rounded-[1.375rem] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h2 id="agenda-title" className="nv-section-title">Próximos plantões confirmados</h2>
      <SegmentedControl label="Período dos plantões" value={selected} onChange={setSelected} options={periodOptions} />
    </div>
    {selected === 'month' && <MonthNavigation month={month} onChange={setMonth} />}
    <p className="mb-3 mt-5 flex items-center gap-2 text-xs font-semibold text-text-muted"><CalendarDays size={15} aria-hidden="true" />{day !== end ? `${shortDate.format(dateAtNoon(day))} – ${shortDate.format(dateAtNoon(end))}` : displayDay(day)}</p>
    {agenda.length ? <ul className="divide-y divide-border border-y border-border">
      {agenda.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize).map(shift => {
        const doctor = doctorById.get(shift.doctorId || '');
        return <li key={shift.id}><Link href={shiftScheduleHref(shift)} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-lg py-3 hover:bg-table-row-hover">
          <UserAvatar name={doctor?.name || 'Médico'} className="row-span-2 mt-0.5 size-9" />
          <div className="min-w-0">
            <p className="wrap-anywhere text-sm font-semibold group-hover:text-primary">{doctor?.name || 'Médico escalado'}</p>
            <p className="mt-0.5 wrap-anywhere text-xs leading-relaxed text-text-muted">{unitById.get(shift.unitId)?.name || 'Unidade'} · {shift.specialty || doctor?.specialty || 'Sem especialidade'}</p>
          </div>
          <ArrowUpRight size={15} className="mt-0.5 text-text-muted group-hover:text-primary" aria-hidden="true" />
          <div className="col-span-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-text-secondary"><Clock3 size={13} aria-hidden="true" />{shortDate.format(dateAtNoon(shift.date))} · {shortTime(shift.startTime)}–{shortTime(shift.endTime)}</span>
            <span className="nv-badge bg-success/10 text-success">Confirmado</span>
          </div>
        </Link></li>;
      })}
    </ul> : <EmptyState icon={CalendarCheck} title="Nenhum plantão confirmado" detail="Consulte a escala do dia para acompanhar vagas e confirmações." />}
    {selected === 'month' && pageCount > 1 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
      <button type="button" className="nv-button-secondary" disabled={pageIndex === 0} onClick={() => setPage({ key: pageKey, index: pageIndex - 1 })}>Anterior</button>
      <span aria-live="polite">Página {pageIndex + 1} de {pageCount}</span>
      <button type="button" className="nv-button-secondary" disabled={pageIndex + 1 >= pageCount} onClick={() => setPage({ key: pageKey, index: pageIndex + 1 })}>Próxima</button>
    </div>}
    <div className="mt-3"><TextLink href={scheduleHref}>{selected === 'month' ? 'Ver escala do mês' : selected === 'week' ? 'Abrir calendário da escala' : 'Ver escala do dia'}{agenda.length > pageSize ? ` (${agenda.length} confirmados)` : ''}</TextLink></div>
  </section>;
}

function PendingPanel({ units, issues, canSeeDocuments, checkins, checkinHref }: {
  units: Unit[]; issues: DocumentOverview['issues']; canSeeDocuments: boolean;
  checkins?: number | null; checkinHref?: string;
}) {
  const [unit, setUnit] = useState('');
  const [specialty, setSpecialty] = useState('');
  const specialties = [...new Set(issues.map(item => item.doctor.specialty).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const filtered = issues.filter(item => (!unit || item.linkedUnits.includes(unit)) && (!specialty || item.doctor.specialty === specialty));
  const docsQuery = new URLSearchParams({ status: 'pending' });
  if (unit) docsQuery.set('unitId', unit);
  if (specialty) docsQuery.set('specialty', specialty);
  const reviews = filtered.reduce((sum, item) => sum + item.review, 0);
  const expired = filtered.reduce((sum, item) => sum + item.expired, 0);
  const nearExpiry = filtered.reduce((sum, item) => sum + item.nearExpiry, 0);

  return <section id="pendencias" tabIndex={-1} aria-labelledby="pending-title" className="nv-panel self-start rounded-[1.375rem] p-4 sm:p-6">
    <h2 id="pending-title" className="nv-section-title">Pendências</h2>
    {canSeeDocuments && <>
      {issues.length > 0 && <details className="mt-3 rounded-lg border border-border px-3">
        <summary className="min-h-10 cursor-pointer py-2 text-sm font-medium text-text-secondary">Filtrar documentação{(unit || specialty) && <span className="ml-2 text-xs text-primary">({Number(Boolean(unit)) + Number(Boolean(specialty))})</span>}</summary>
        <div className="grid gap-2 pb-3 min-[390px]:grid-cols-2">
          <label className="nv-label text-xs">Unidade<select className="nv-input" value={unit} onChange={event => setUnit(event.target.value)}><option value="">Todas</option>{units.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
          <label className="nv-label text-xs">Especialidade<select className="nv-input" value={specialty} onChange={event => setSpecialty(event.target.value)}><option value="">Todas</option>{specialties.map(item => <option key={item}>{item}</option>)}</select></label>
        </div>
      </details>}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
        <div><p className="text-sm font-semibold">Médicos com documentação pendente</p><p className="text-xs text-text-muted">Inclui documentos próximos do vencimento.</p></div>
        <strong className="text-2xl font-semibold tabular-nums">{filtered.length}</strong>
      </div>
      <ul aria-label="Situação dos documentos" className="my-3 flex flex-wrap gap-2">
        <li className="nv-badge bg-danger/10 text-danger">{expired} {expired === 1 ? 'vencido' : 'vencidos'}</li>
        <li className="nv-badge bg-warning/10 text-warning">{nearExpiry} a vencer</li>
        <li className="nv-badge bg-accent/10 text-accent">{reviews} em revisão</li>
      </ul>
      {filtered.length > 0 ? <ul className="divide-y divide-border border-y border-border">
        {filtered.slice(0, 3).map(item => <li key={item.doctor.id}><Link href={`/documentos/${item.doctor.id}`} className="group flex items-center justify-between gap-3 rounded-lg py-2.5 hover:bg-table-row-hover">
          <span className="min-w-0"><strong className="block wrap-anywhere text-sm font-semibold group-hover:text-primary">{item.doctor.name}</strong><span className="text-xs text-text-muted">{item.doctor.specialty}</span></span>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-secondary">
            {item.pending ? `${item.pending} ${item.pending === 1 ? 'pendência' : 'pendências'}` : `${item.nearExpiry} a vencer`}<ArrowUpRight size={14} aria-hidden="true" />
          </span>
        </Link></li>)}
      </ul> : <p className="rounded-lg bg-surface-muted/55 p-3 text-sm text-text-muted">Nenhum médico com pendência para os filtros selecionados.</p>}
      <div className="mt-2"><TextLink href={`/documentos?${docsQuery}`}>Ver pastas pendentes</TextLink></div>
    </>}
    {checkins != null && <div className="mt-4 rounded-xl bg-surface-muted/55 px-3 py-2.5">
      <p className="text-sm font-semibold">{checkins} {checkins === 1 ? 'check-in pendente' : 'check-ins pendentes'} hoje</p>
      {checkinHref && <TextLink href={checkinHref}>Ver relatório de presença</TextLink>}
    </div>}
    {!canSeeDocuments && checkins == null && <p className="mt-4 text-sm text-text-muted">Nenhuma fila de pendências disponível para este acesso.</p>}
  </section>;
}

function FinancePanel() {
  const overview=useWorkspaceOverview();
  const today = saoPauloDate();
  const month = today.slice(0, 7);
  if(!overview.finance.data)return <section className="nv-panel p-5"><h2 className="nv-section-title">Financeiro</h2><p role={overview.finance.error?'alert':'status'} className="mt-3 text-sm">{overview.finance.error||'Carregando resumo financeiro…'}</p>{overview.finance.error&&<button className="nv-button-secondary mt-3" onClick={overview.reload}>Tentar novamente</button>}</section>;
  const { pending, overdue, onDelivery, paidThisMonth, nextDue } = overview.finance.data;
  const financeHref = '/financeiro?' + new URLSearchParams({ month });

  return <section aria-labelledby="finance-title" className="nv-panel self-start rounded-[1.375rem] p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h2 id="finance-title" className="nv-section-title">Financeiro</h2>
      <TextLink href={financeHref}>Abrir financeiro</TextLink>
    </div>
    <Link href={`${financeHref}&period=all&frequency=on_delivery&status=unpaid`} className="group mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-accent/20 bg-[var(--dashboard-wash)] p-3.5 hover:border-primary/40">
      <div className="min-w-0"><p className="text-sm font-semibold">Pagamentos à vista pendentes</p><p className="mt-1 text-xs text-text-muted">{onDelivery.count} {onDelivery.count === 1 ? 'plantão sem baixa' : 'plantões sem baixa'}</p></div>
      <span className="flex max-w-full items-center gap-1.5 text-lg font-semibold tabular-nums"><span className="wrap-anywhere">{money.format(onDelivery.amount)}</span><ArrowUpRight size={15} className="shrink-0 text-accent group-hover:text-primary" aria-hidden="true" /></span>
    </Link>
    <dl className="mt-4 grid grid-cols-2 gap-3">
      <div><dt className="text-xs text-text-muted">Total pendente</dt><dd className="mt-1 wrap-anywhere text-lg font-semibold tabular-nums">{money.format(pending)}</dd></div>
      <div><dt className="text-xs text-text-muted">Valor vencido</dt><dd className={`mt-1 wrap-anywhere text-lg font-semibold tabular-nums ${overdue ? 'text-danger' : ''}`}>{money.format(overdue)}</dd></div>
      <div><dt className="text-xs text-text-muted">Plantões do mês já pagos</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-primary">{paidThisMonth}</dd></div>
      <div><dt className="text-xs text-text-muted">Próximos vencimentos</dt><dd className="mt-1 text-sm font-semibold">
        {nextDue.length ? nextDue.map(([due, amount]) => <span key={due} className="block wrap-anywhere"><time dateTime={due}>{shortDate.format(dateAtNoon(due))}</time> · {money.format(amount)}</span>) : 'Sem vencimentos programados'}
      </dd></div>
    </dl>
  </section>;
}

function DashboardContent({ organization }: { organization: string }) {
  const overview=useWorkspaceOverview();
  const { doctors, units, sectors, shifts, currentUser } = useStore();
  const canSeeSchedule = canViewPermission(currentUser, 'escala');
  const canSeeDoctors = canViewPermission(currentUser, 'medicos');
  const canSeeDocuments = canViewPermission(currentUser, 'documentos');
  const canSeeFinance = canViewPermission(currentUser, 'financeiro');
  const canSeeReports = canViewPermission(currentUser, 'relatorios');
  const canSeeUnits = canViewPermission(currentUser, 'unidades');
  const canSeeSettings = canViewPermission(currentUser, 'configuracoes');
  const [referenceTime] = useState(Date.now);
  const [scheduleFilters, setScheduleFilters] = useState<CoverageFilters>({ unit: '', specialty: '', employment: '' });
  useEffect(() => {
    if (window.location.hash === '#pendencias') document.getElementById('pendencias')?.scrollIntoView();
  }, []);
  const today = localDate(new Date(referenceTime));
  const result = useOperationalCounts(organization, canSeeSchedule || canSeeDoctors);
  const orgShifts = useMemo(() => shifts.filter(shift => shift.organizationId === organization), [shifts, organization]);
  const orgDoctors = useMemo(() => doctors.filter(doctor => doctor.organizationId === organization), [doctors, organization]);
  const orgUnits = useMemo(() => units.filter(unit => unit.organizationId === organization), [units, organization]);
  const unitById = useMemo(() => new Map(orgUnits.map(unit => [unit.id, unit])), [orgUnits]);
  const doctorById = useMemo(() => new Map(orgDoctors.map(doctor => [doctor.id, doctor])), [orgDoctors]);
  const orgSectors = useMemo(() => sectors.filter(sector => sector.organizationId === organization), [sectors, organization]);
  const sectorById = useMemo(() => new Map(orgSectors.map(sector => [sector.id, sector])), [orgSectors]);
  const activeSectors = useMemo(() => orgSectors.filter(sector => sector.status === 'active'), [orgSectors]);
  const scheduleShifts = useMemo(() => orgShifts.filter(shift => (!scheduleFilters.employment || shift.employmentType === scheduleFilters.employment)
    && dashboardShiftMatches(shift, scheduleFilters.unit, scheduleFilters.specialty, doctorById, sectorById)), [orgShifts, scheduleFilters, doctorById, sectorById]);
  const specialties = useMemo(() => [...new Set([...orgSectors.flatMap(sector => sector.specialties), ...orgShifts.map(shift => shift.specialty || ''), ...orgDoctors.map(doctor => doctor.specialty)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [orgDoctors, orgSectors, orgShifts]);
  const [todayCoverage] = useMemo(() => coverageDays(today, activeSectors, orgShifts, 1), [today, activeSectors, orgShifts]);
  const issues = overview.documents.data?.issues || [];
  const checkins = canSeeSchedule ? result?.counts?.checkins_pending : null;
  const reportDay = result?.counts?.today || today;
  const checkinHref = canSeeReports ? '/relatorios/plantoes?' + new URLSearchParams({ empresa: organization, inicio: reportDay, fim: reportDay, presenca: 'pending' }) : undefined;

  return <div className="nv-overview mx-auto max-w-[104rem] space-y-6 max-md:space-y-4 lg:space-y-7">
    <header className="flex flex-wrap items-end justify-between gap-3 max-md:gap-2">
      <h1 className="nv-page-title min-w-0 text-3xl sm:text-[2.75rem]">Painel de controle</h1>
      <div className="flex flex-wrap items-center gap-2.5 max-[389px]:gap-2">
        <time dateTime={today} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-xs font-medium text-text-secondary max-md:px-2.5 max-[389px]:gap-1.5 max-[389px]:px-2">
          <CalendarDays size={15} aria-hidden="true" className="text-accent" />{displayDay(today)}
        </time>
        {canSeeSchedule && organization && <Link href={`/escala?date=${today}`} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-3.5 text-xs font-semibold text-text-inverse transition-colors hover:bg-primary-hover max-[389px]:gap-1.5 max-[389px]:px-2.5">Abrir escala <ArrowRight size={15} aria-hidden="true" /></Link>}
      </div>
    </header>

    {organization ? <>
      {orgUnits.length === 0 && orgDoctors.length === 0 && (canSeeDoctors || canSeeUnits || canSeeSettings) && <section className="nv-panel p-4 sm:p-6">
        <h2 className="nv-section-title">Primeiros passos</h2>
        <p className="mt-1 text-sm text-text-muted">Cadastre a estrutura da empresa para começar a montar as escalas.</p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {canSeeDoctors && <TextLink href="/medicos">Abrir corpo clínico</TextLink>}
          {canSeeUnits && <TextLink href="/unidades">Abrir unidades e setores</TextLink>}
          {canSeeSettings && <TextLink href="/configuracoes">Configurações da empresa</TextLink>}
        </div>
      </section>}
      <OperationalIndicators today={today} gaps={todayCoverage.deficit} canSeeSchedule={canSeeSchedule} canSeeDoctors={canSeeDoctors} result={result} />
      {canSeeSchedule && <section aria-label="Cobertura e agenda de plantões" className="space-y-3">
        <ScheduleFilterBar units={orgUnits} specialties={specialties} filters={scheduleFilters} onFilter={setScheduleFilters}/>
        <div className="nv-overview-grid grid gap-4 lg:gap-5">
          <CoveragePanel today={today} sectors={activeSectors.filter(sector => !scheduleFilters.unit || sector.unitId === scheduleFilters.unit)} shifts={scheduleShifts} unitById={unitById} doctorById={doctorById} filters={scheduleFilters} />
          <UpcomingPanel today={today} shifts={scheduleShifts} unitById={unitById} doctorById={doctorById} filters={scheduleFilters} />
        </div>
      </section>}
      <div className="nv-overview-grid grid gap-4 lg:gap-5">
        {canSeeDocuments&&!overview.documents.data?<section className="nv-panel p-5"><h2 className="nv-section-title">Pendências</h2><p role={overview.documents.error?'alert':'status'} className="mt-3 text-sm">{overview.documents.error||'Carregando pendências…'}</p>{overview.documents.error&&<button className="nv-button-secondary mt-3" onClick={overview.reload}>Tentar novamente</button>}</section>:<PendingPanel units={orgUnits} issues={issues} canSeeDocuments={canSeeDocuments} checkins={checkins} checkinHref={checkinHref} />}
        {canSeeFinance && <FinancePanel />}
      </div>
    </> : <section id="pendencias"><EmptyState icon={Building2} title="Nenhuma empresa selecionada" detail="Selecione uma empresa disponível para acompanhar a operação." /></section>}
  </div>;
}

export default function DashboardPage() {
  const organization = useStore(state => state.activeOrganizationId);
  const userId = useStore(state => state.currentUser.id);
  return <DashboardContent key={`${organization}/${userId}`} organization={organization} />;
}
