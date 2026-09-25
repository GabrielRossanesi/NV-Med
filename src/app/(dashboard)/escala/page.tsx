'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowRightLeft, ChevronLeft, ChevronRight, Clock3, Copy, List, LoaderCircle, Moon, Plus, Repeat2, Sun, UserRoundPlus, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import ScheduleCalendarView from '@/components/schedule/ScheduleCalendarView';
import { buildRecurringDates, coveragePeriodLabel, employmentLabels, hasConflict, localDate, paymentFrequencyLabels, sectorCoveragePeriods, statusAfterDoctorSelection, summarizeSectorCoverage, type ShiftRecurrence } from '@/lib/scheduling';
import { canEditPermission, canViewPermission } from '@/lib/permissions';
import { doctorScheduleCompliance } from '@/lib/documentGovernance';
import { useStore } from '@/store/useStore';
import type { CoveragePeriodKind, Doctor, EmploymentType, Sector, Shift, Unit } from '@/types';

type ViewMode = 'week' | 'month' | 'list';
const statusLabels = { open: 'Vaga aberta', confirmed: 'Confirmado', pending: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado' };
const typeLabels = { onsite: 'Presencial', oncall: 'Sobreaviso', telemedicine: 'Telemedicina' };

function addDays(value: string, amount: number) { const date = new Date(value + 'T12:00:00'); date.setDate(date.getDate() + amount); return localDate(date); }
function mondayOf(value: string) { const date = new Date(value + 'T12:00:00'); const distance = (date.getDay() + 6) % 7; date.setDate(date.getDate() - distance); return localDate(date); }
function formatDay(value: string) { return new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', ''); }
function recurrenceDescription(startDate: string, recurrence: ShiftRecurrence) {
  const date = new Date(startDate + 'T12:00:00');
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long' });
  if (recurrence === 'weekly') return `toda ${weekday}`;
  if (recurrence === 'fortnightly') return `a cada 2 semanas, às ${weekday}s`;
  const ordinal = Math.floor((date.getDate() - 1) / 7) + 1;
  return `na ${ordinal}ª ${weekday} de cada mês`;
}
function toNewShift(shift: Shift): Omit<Shift, 'id' | 'organizationId'> {
  return { sectorId: shift.sectorId, sector: shift.sector, specialty: shift.specialty, employmentType: shift.employmentType, employerName: shift.employerName, paymentAmount: shift.paymentAmount, paymentStatus: shift.paymentStatus, paymentFrequency: shift.paymentFrequency, paidAt: shift.paidAt, doctorId: shift.doctorId, unitId: shift.unitId, date: shift.date, startTime: shift.startTime, endTime: shift.endTime, type: shift.type, status: shift.status, notes: shift.notes };
}

function ScheduleList({ days, shifts, units, sectors, doctors, doctorWarnings, onEdit }: { days: string[]; shifts: Shift[]; units: Unit[]; sectors: Sector[]; doctors: Doctor[]; doctorWarnings: Map<string, { warning: boolean; blocked: boolean }>; onEdit: (shift: Shift) => void }) {
  if (!days.length) return <div className="rounded-xl border border-dashed border-border py-16 text-center"><List className="mx-auto h-6 w-6 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum plantão individual neste período</p><p className="mt-1 text-xs text-text-muted">Crie os postos previstos no calendário para gerenciá-los aqui.</p></div>;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-base font-semibold">Plantões individuais</h2><p className="mt-1 text-xs text-text-muted">Cada linha representa um posto salvo. Use a ação para preencher uma vaga ou substituir o médico.</p></div><span className="text-xs font-medium text-text-muted">{shifts.length} {shifts.length === 1 ? 'plantão criado' : 'plantões criados'}</span></div>
    <div className="overflow-hidden rounded-xl border border-border bg-card-bg">
      <div className="hidden grid-cols-[105px_110px_minmax(180px,1fr)_minmax(180px,1fr)_100px_125px_150px] gap-3 border-b border-border bg-surface-muted/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted lg:grid"><span>Plantão</span><span>Horário</span><span>Unidade · setor</span><span>Médico</span><span>Vínculo</span><span>Situação</span><span>Ação</span></div>
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
          return <div key={item.id} className="grid gap-3 px-4 py-4 transition hover:bg-state-hover lg:grid-cols-[105px_110px_minmax(180px,1fr)_minmax(180px,1fr)_100px_125px_150px] lg:items-center">
            <span className="flex items-center gap-2"><PeriodIcon size={14} className={kind === 'day' ? 'text-warning' : 'text-primary'}/><span><strong className="block text-xs text-text-primary">Plantão {String(sequence).padStart(2, '0')}</strong><span className="text-[10px] text-text-muted">{coveragePeriodLabel(kind)}</span></span></span>
            <span className="flex items-center gap-1.5 text-xs font-medium tabular-nums text-text-secondary"><Clock3 size={13}/>{item.startTime}–{item.endTime}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-semibold text-text-primary">{unit?.name || 'Unidade'}</span><span className="mt-0.5 block truncate text-xs text-text-muted">{sector?.name || item.sector || 'Setor'}{item.specialty ? ` · ${item.specialty}` : ''}</span></span>
            <span className={`flex min-w-0 items-center gap-1.5 truncate text-sm font-medium ${doctor ? 'text-text-primary' : 'text-warning'}`}>{doctor?.name || 'Vaga aberta'}{warning?.warning && <AlertTriangle size={13} className={warning.blocked ? 'shrink-0 text-danger' : 'shrink-0 text-warning'} aria-label="Pendência documental"/>}</span>
            <span className="text-xs text-text-secondary">{item.employmentType ? employmentLabels[item.employmentType] : '—'}</span>
            <span className={`text-xs font-medium ${item.status === 'open' ? 'text-warning' : item.status === 'pending' ? 'text-warning' : item.status === 'confirmed' ? 'text-success' : 'text-text-secondary'}`}>{statusLabels[item.status]}</span>
            <button type="button" onClick={() => onEdit(item)} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-primary transition hover:border-primary/40 hover:bg-primary/5">{doctor ? <ArrowRightLeft size={13}/> : <UserRoundPlus size={13}/>} {doctor ? 'Trocar médico' : 'Preencher vaga'}</button>
          </div>;
        })}</div>
      </section>; })}
    </div>
  </section>;
}

function Schedule() {
  const store = useStore();
  const params = useSearchParams();
  const today = localDate();
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date')! : today;
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<ViewMode>('week');
  const [unitId, setUnitId] = useState(params.get('unitId') || '');
  const [sectorId, setSectorId] = useState('');
  const [employment, setEmployment] = useState<EmploymentType | ''>('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [form, setForm] = useState<Shift | null>(null);
  const [vacancyCount, setVacancyCount] = useState(1);
  const [coverageKind, setCoverageKind] = useState<CoveragePeriodKind>('day');
  const [recurrence, setRecurrence] = useState<ShiftRecurrence>('once');
  const [repeatUntil, setRepeatUntil] = useState('');
  const [formError, setFormError] = useState('');
  const [pageError, setPageError] = useState('');
  const orgId = store.activeOrganizationId;
  const canSeeFinancial = canViewPermission(store.currentUser, 'financeiro');
  const canEditFinancial = canEditPermission(store.currentUser, 'financeiro');
  const units = store.units.filter(item => item.organizationId === orgId && item.status === 'active');
  const sectors = store.sectors.filter(item => item.organizationId === orgId && item.status === 'active');
  const doctors = store.doctors.filter(item => item.organizationId === orgId && item.status === 'active');
  const shifts = store.shifts.filter(item => item.organizationId === orgId);
  const activeOrganization = store.organizations.find(item => item.id === orgId);
  const organizationDocuments = store.documents.filter(item => item.organizationId === orgId);
  const doctorDocumentState = new Map(doctors.map(doctor => [doctor.id, doctorScheduleCompliance(doctor, organizationDocuments, activeOrganization)]));
  const selectedSector = sectors.find(item => item.id === sectorId);
  const visibleSectors = sectors.filter(item => (!unitId || item.unitId === unitId) && (!sectorId || item.id === sectorId));
  const weekStart = mondayOf(date);
  const week = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const month = date.slice(0, 7);
  const firstOfMonth = new Date(month + '-01T12:00:00');
  const daysInMonth = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0).getDate();

  const shiftsFor = (sector: Sector, day: string) => shifts.filter(item => item.sectorId === sector.id && item.date === day && item.status !== 'cancelled');
  const coverageFor = (sector: Sector, day: string) => summarizeSectorCoverage(sector, shiftsFor(sector, day));
  const employers = [...new Set(shifts.map(item => item.employerName).filter(Boolean))] as string[];
  const listShifts = shifts
    .filter(item => item.date.startsWith(month) && item.status !== 'cancelled')
    .filter(item => (!unitId || item.unitId === unitId) && (!sectorId || item.sectorId === sectorId))
    .filter(item => !employment || !item.doctorId || item.employmentType === employment)
    .filter(item => !onlyGaps || item.status === 'open' || visibleSectors.some(sector => sector.id === item.sectorId && coverageFor(sector, item.date).deficit > 0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || (a.sector || '').localeCompare(b.sector || ''));
  const listDays = [...new Set(listShifts.map(item => item.date))];

  function navigate(amount: number) { setDate(view === 'week' ? addDays(date, amount * 7) : (() => { const next = new Date(date + 'T12:00:00'); next.setMonth(next.getMonth() + amount); return localDate(next); })()); }
  function openShift(shift?: Shift, sector = selectedSector, day = date, requestedKind?: CoveragePeriodKind, suggestedCount = 1) {
    store.clearFeedback(); setFormError(''); setPageError(''); setVacancyCount(Math.max(1, suggestedCount)); setRecurrence('once'); setRepeatUntil(addDays(day, 90));
    const resolvedSector = shift ? sectors.find(item => item.id === shift.sectorId) : sector || visibleSectors[0];
    const resolvedUnit = shift?.unitId || resolvedSector?.unitId || unitId || units[0]?.id || '';
    const periods = resolvedSector ? sectorCoveragePeriods(resolvedSector) : [];
    const period = shift ? periods.find(item => item.startTime === shift.startTime && item.endTime === shift.endTime) || periods[0] : periods.find(item => item.kind === requestedKind) || periods[0];
    setCoverageKind(period?.kind || 'day');
    setForm(shift || { id: '', organizationId: orgId, unitId: resolvedUnit, sectorId: resolvedSector?.id || '', sector: resolvedSector?.name || '', specialty: resolvedSector?.specialties[0] || '', doctorId: undefined, date: day, startTime: period?.startTime || resolvedSector?.defaultStartTime || '07:00', endTime: period?.endTime || resolvedSector?.defaultEndTime || '19:00', type: 'onsite', status: 'open', paymentAmount: 0, paymentStatus: 'pending', paymentFrequency: 'on_delivery', notes: '' });
  }
  function updateFormUnit(nextUnit: string) {
    if (!form) return; const firstSector = sectors.find(item => item.unitId === nextUnit);
    const period = firstSector ? sectorCoveragePeriods(firstSector)[0] : undefined; setCoverageKind(period?.kind || 'day');
    setForm({ ...form, unitId: nextUnit, sectorId: firstSector?.id || '', sector: firstSector?.name || '', specialty: firstSector?.specialties[0] || '', startTime: period?.startTime || form.startTime, endTime: period?.endTime || form.endTime });
  }
  function updateFormSector(nextSectorId: string) {
    if (!form) return; const sector = sectors.find(item => item.id === nextSectorId);
    const period = sector ? sectorCoveragePeriods(sector)[0] : undefined;
    if (sector && period) { setCoverageKind(period.kind); setForm({ ...form, sectorId: sector.id, sector: sector.name, specialty: sector.specialties[0] || '', startTime: period.startTime, endTime: period.endTime }); }
  }
  function chooseCoverage(kind: CoveragePeriodKind) {
    if (!form) return;
    const sector = sectors.find(item => item.id === form.sectorId);
    const period = sector && sectorCoveragePeriods(sector).find(item => item.kind === kind);
    if (period) { setCoverageKind(kind); setForm({ ...form, startTime: period.startTime, endTime: period.endTime }); }
  }
  function updateDoctor(nextDoctorId: string) {
    if (!form) return;
    if (!nextDoctorId) { setRecurrence('once'); return setForm({ ...form, doctorId: undefined, employmentType: undefined, employerName: '', paymentAmount: 0, paymentStatus: 'pending', paymentFrequency: 'on_delivery', paidAt: undefined, status: 'open' }); }
    const previous = [...shifts].reverse().find(item => item.doctorId === nextDoctorId && item.unitId === form.unitId && item.employmentType);
    setForm({ ...form, doctorId: nextDoctorId, employmentType: previous?.employmentType, employerName: previous?.employerName || '', paymentFrequency: previous?.paymentFrequency || form.paymentFrequency || 'on_delivery', status: statusAfterDoctorSelection(form.status, form.doctorId, nextDoctorId) });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!form) return;
    setFormError('');
    const sector = sectors.find(item => item.id === form.sectorId && item.unitId === form.unitId);
    if (!sector) return setFormError('Selecione um setor válido desta unidade.');
    if (form.startTime === form.endTime) return setFormError('Início e fim precisam ser diferentes.');
    if (form.doctorId && (!form.employmentType || (form.employmentType === 'pj' && !form.employerName?.trim()))) return setFormError('Informe o vínculo e a empresa para profissionais PJ.');
    const selectedDoctorState = form.doctorId ? doctorDocumentState.get(form.doctorId) : undefined;
    const originalShift = form.id ? shifts.find(item => item.id === form.id) : undefined;
    if (selectedDoctorState?.blocked && (!originalShift || originalShift.doctorId !== form.doctorId)) return setFormError('Este médico está bloqueado para novos plantões por pendências documentais críticas. Regularize a pasta antes de escalar.');
    if (!form.id && form.doctorId && recurrence !== 'once' && (!repeatUntil || repeatUntil < form.date)) return setFormError('Defina uma data final igual ou posterior ao primeiro plantão.');
    const normalized: Shift = { ...form, sector: sector.name, status: form.doctorId ? (form.status === 'open' ? 'pending' : form.status) : 'open', employmentType: form.doctorId ? form.employmentType : undefined, employerName: form.doctorId ? form.employerName?.trim() : undefined, paymentAmount: form.doctorId ? Math.max(0, Number(form.paymentAmount || 0)) : 0, paymentStatus: form.doctorId ? form.paymentStatus || 'pending' : 'pending', paymentFrequency: form.doctorId ? form.paymentFrequency || 'on_delivery' : 'on_delivery', paidAt: form.doctorId && form.paymentStatus === 'paid' ? form.paidAt : undefined };
    const dates = !form.id && form.doctorId ? buildRecurringDates(form.date, repeatUntil, recurrence) : [form.date];
    const candidates = dates.map((candidateDate, index) => ({ ...normalized, id: normalized.id || `recurring-${index}`, date: candidateDate }));
    const duplicate = candidates.find(candidate => shifts.some(item => item.status !== 'cancelled' && item.sectorId === candidate.sectorId && item.date === candidate.date && item.startTime === candidate.startTime && item.endTime === candidate.endTime && item.doctorId === candidate.doctorId));
    if (duplicate) return setFormError(`Já existe um plantão igual em ${new Date(duplicate.date + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
    const conflict = candidates.find(candidate => hasConflict(candidate, shifts));
    if (conflict) return setFormError(`O médico já está escalado em horário coincidente em ${new Date(conflict.date + 'T12:00:00').toLocaleDateString('pt-BR')}.`);
    let ok: boolean;
    if (form.id) ok = await store.updateShift(normalized);
    else if (!form.doctorId && vacancyCount > 1) ok = await store.addShifts(Array.from({ length: vacancyCount }, () => toNewShift(normalized)));
    else if (candidates.length > 1) ok = await store.addShifts(candidates.map(toNewShift));
    else ok = await store.addShift(toNewShift(normalized));
    if (ok) setForm(null); else setFormError(useStore.getState().error || 'Não foi possível salvar o posto.');
  }
  async function replicateWeek() {
    setPageError('');
    const source = shifts.filter(item => item.date >= week[0] && item.date <= week[6] && item.status !== 'cancelled' && item.status !== 'completed' && (!unitId || item.unitId === unitId) && (!sectorId || item.sectorId === sectorId));
    if (!source.length) return setPageError('Não há postos nesta semana para replicar.');
    if (!window.confirm(`Replicar ${source.length} posto${source.length === 1 ? '' : 's'} para a próxima semana?`)) return;
    const clones = source.map(item => ({ ...item, id: '', organizationId: orgId, date: addDays(item.date, 7), status: item.doctorId ? 'pending' as const : 'open' as const, paymentStatus: 'pending' as const }));
    const blocked = clones.filter(candidate => candidate.doctorId && doctorDocumentState.get(candidate.doctorId)?.blocked);
    if (blocked.length) return setPageError(`${blocked.length} posto${blocked.length === 1 ? '' : 's'} não pode ser replicado porque o médico está bloqueado por pendência documental.`);
    const duplicates = clones.filter(candidate => shifts.some(item => item.sectorId === candidate.sectorId && item.date === candidate.date && item.startTime === candidate.startTime && item.endTime === candidate.endTime && item.doctorId === candidate.doctorId && item.status !== 'cancelled'));
    const conflicts = clones.filter(candidate => candidate.doctorId && hasConflict(candidate, [...shifts, ...clones.filter(item => item !== candidate)]));
    if (duplicates.length || conflicts.length) return setPageError(`A próxima semana tem ${duplicates.length + conflicts.length} posto${duplicates.length + conflicts.length === 1 ? '' : 's'} duplicado ou com conflito. Revise-a antes de replicar.`);
    const inputs = clones.map(toNewShift);
    if (!await store.addShifts(inputs)) setPageError(useStore.getState().error || 'Não foi possível replicar a semana.');
  }

  const linkedDoctors = form ? doctors.filter(doctor => doctor.linkedUnits.includes(form.unitId)) : [];
  const doctorPool = linkedDoctors.length ? linkedDoctors : doctors;
  const eligibleDoctors = form ? doctorPool.filter(doctor => !form.specialty || doctor.specialty === form.specialty || !(sectors.find(item => item.id === form.sectorId)?.specialties.length)) : [];
  const formSector = form ? sectors.find(item => item.id === form.sectorId) : undefined;
  const formPeriods = formSector ? sectorCoveragePeriods(formSector) : [];
  const recurrenceDates = form && !form.id && form.doctorId ? buildRecurringDates(form.date, repeatUntil, recurrence) : [];
  const formUnit = form ? units.find(item => item.id === form.unitId) : undefined;
  const originalFormShift = form?.id ? shifts.find(item => item.id === form.id) : undefined;
  const formDoctorChanged = Boolean(originalFormShift?.doctorId && originalFormShift.doctorId !== form?.doctorId);
  const formTitle = form?.id ? (form.doctorId ? 'Editar plantão' : 'Preencher vaga') : form?.doctorId ? 'Novo plantão' : 'Nova vaga';

  return <div className="space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-primary">Operação e cobertura</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Escala de plantões</h1><p className="mt-2 text-sm text-text-secondary">Organize postos por unidade e setor e encontre os furos antes do plantão.</p></div><button className="nv-button" onClick={() => openShift()} disabled={!sectors.length}><Plus size={16}/>Novo posto</button></header>

    {(!units.length || !sectors.length) && <section className="rounded-xl border border-border bg-card-bg p-6"><h2 className="font-semibold">Configure a estrutura da escala</h2><p className="mt-2 text-sm text-text-secondary">Cadastre uma unidade e seus setores antes de criar postos.</p><Link className="nv-button-secondary mt-4" href="/unidades">Gerenciar unidades e setores</Link></section>}

    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card-bg p-3 lg:flex-row lg:items-end" aria-label="Controles da escala">
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row"><label className="nv-label min-w-0 flex-1">Unidade<select className="nv-input" value={unitId} onChange={event => { setUnitId(event.target.value); setSectorId(''); }}><option value="">Todas as unidades</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="nv-label min-w-0 flex-1">Setor<select className="nv-input" value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">Todos os setores</option>{sectors.filter(item => !unitId || item.unitId === unitId).map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label><label className="nv-label min-w-0 flex-1">Vínculo<select className="nv-input" value={employment} onChange={event => setEmployment(event.target.value as EmploymentType | '')}><option value="">Todos</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <div className="flex flex-wrap items-center gap-2"><button aria-pressed={onlyGaps} className={`nv-button-secondary ${onlyGaps ? 'border-danger text-danger' : ''}`} onClick={() => setOnlyGaps(value => !value)}><AlertTriangle size={15}/>Com déficit</button><button className="nv-button-secondary" onClick={replicateWeek} disabled={view !== 'week' || store.saving}><Copy size={15}/>Replicar semana</button></div>
    </section>

    <div className="flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-lg border border-border bg-card-bg p-1"><button className={`rounded-md px-3 py-2 text-sm font-medium ${view === 'week' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => setView('week')}>Semana</button><button className={`rounded-md px-3 py-2 text-sm font-medium ${view === 'month' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => setView('month')}>Mês</button><button className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${view === 'list' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`} onClick={() => setView('list')}><List size={15}/>Plantões</button></div><div className="flex items-center gap-1"><button aria-label="Período anterior" className="p-2.5 text-text-muted hover:text-primary" onClick={() => navigate(-1)}><ChevronLeft/></button><button className="min-w-44 px-3 text-sm font-semibold capitalize" onClick={() => setDate(today)}>{view === 'week' ? `${formatDay(week[0])} – ${formatDay(week[6])}` : firstOfMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</button><button aria-label="Próximo período" className="p-2.5 text-text-muted hover:text-primary" onClick={() => navigate(1)}><ChevronRight/></button></div></div>
    {pageError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{pageError}</p>}

    {view === 'list' ? <ScheduleList days={listDays} shifts={listShifts} units={units} sectors={sectors} doctors={doctors} doctorWarnings={doctorDocumentState} onEdit={openShift}/> : <ScheduleCalendarView
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
      onlyGaps={onlyGaps}
      selectedSectorId={sectorId}
      selectedUnitId={unitId}
      doctorWarnings={doctorDocumentState}
      onSelectDate={setDate}
      onSelectSector={setSectorId}
      onOpenShift={(sector, shiftDate, kind, count) => openShift(undefined, sector, shiftDate, kind, count)}
      onEditShift={item => openShift(item)}
      onDeleteShift={async item => { if (window.confirm('Excluir este posto da escala?')) await store.deleteShift(item.id); }}
    />}
    {form && <Dialog title={formTitle} onClose={() => !store.saving && setForm(null)}><form className="space-y-5" onSubmit={save} aria-busy={store.saving}>{form.id && <section className="rounded-xl border border-border bg-surface-muted/35 p-4"><p className="text-[10px] font-semibold uppercase tracking-wider text-primary">Plantão individual</p><p className="mt-1 text-sm font-semibold text-text-primary">{new Date(form.date + 'T12:00:00').toLocaleDateString('pt-BR')} · {form.startTime}–{form.endTime}</p><p className="mt-1 text-xs text-text-muted">{formUnit?.name || 'Unidade'} · {formSector?.name || form.sector || 'Setor'}</p><p className="mt-3 text-xs leading-5 text-text-secondary">Escolha outro médico para fazer a substituição. Conflitos de horário e pendências documentais serão verificados antes de salvar.</p></section>}<div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Unidade<select className="nv-input" required value={form.unitId} onChange={event => updateFormUnit(event.target.value)}><option value="">Selecione</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label><label className="nv-label">Setor<select className="nv-input" required value={form.sectorId || ''} onChange={event => updateFormSector(event.target.value)}><option value="">Selecione</option>{sectors.filter(item => item.unitId === form.unitId).map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label></div><label className="nv-label">Especialidade<select className="nv-input" value={form.specialty || ''} onChange={event => setForm({ ...form, specialty: event.target.value })}><option value="">Sem especialidade específica</option>{formSector?.specialties.map(item => <option key={item} value={item}>{item}</option>)}</select></label>{formPeriods.length > 0 && <fieldset><legend className="nv-label">Período de cobertura</legend><div className="grid gap-2 sm:grid-cols-2">{formPeriods.map(period => { const Icon = period.kind === 'day' ? Sun : Moon; const selected = coverageKind === period.kind; return <button key={period.kind} type="button" onClick={() => chooseCoverage(period.kind)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected ? 'border-primary bg-primary/10 ring-1 ring-primary/20' : 'border-border hover:bg-state-hover'}`}><Icon size={18} className={period.kind === 'day' ? 'text-warning' : 'text-primary'}/><span className="min-w-0"><strong className="block text-sm text-text-primary">{coveragePeriodLabel(period.kind)}</strong><span className="text-xs tabular-nums text-text-muted">{period.startTime}–{period.endTime} · {period.requiredDoctors} médico{period.requiredDoctors === 1 ? '' : 's'}</span></span></button>; })}</div></fieldset>}<div><p className="nv-label">Data e horário deste médico</p><div className="grid gap-4 sm:grid-cols-3"><label className="nv-label font-normal">Data<input className="nv-input" type="date" required value={form.date} onChange={event => { setForm({ ...form, date: event.target.value }); if (repeatUntil < event.target.value) setRepeatUntil(addDays(event.target.value, 90)); }}/></label><label className="nv-label font-normal">Início<input className="nv-input" type="time" required value={form.startTime} onChange={event => setForm({ ...form, startTime: event.target.value })}/></label><label className="nv-label font-normal">Fim<input className="nv-input" type="time" required value={form.endTime} onChange={event => setForm({ ...form, endTime: event.target.value })}/></label></div><p className="mt-1.5 text-xs text-text-muted">O período preenche o horário padrão. Você pode ajustar este médico sem alterar o setor.</p></div><label className="nv-label">{form.id ? 'Médico deste plantão' : 'Médico'}<select className="nv-input" value={form.doctorId || ''} onChange={event => updateDoctor(event.target.value)}><option value="">Deixar como vaga aberta</option>{eligibleDoctors.map(doctor => { const compliance = doctorDocumentState.get(doctor.id); const selectedExisting = Boolean(form.id && form.doctorId === doctor.id); return <option key={doctor.id} value={doctor.id} disabled={Boolean(compliance?.blocked && !selectedExisting)}>{doctor.name} · {doctor.specialty}{compliance?.blocked ? ' · bloqueado por documentos' : compliance?.warning ? ' · atenção documental' : ''}</option>; })}</select>{formDoctorChanged && <span className="mt-1.5 block text-xs font-normal text-warning">O novo médico ficará aguardando confirmação após salvar.</span>}</label>{form.doctorId && doctorDocumentState.get(form.doctorId)?.warning && <div className={`flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-xs ${doctorDocumentState.get(form.doctorId)?.blocked ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/30 bg-warning/5 text-warning'}`}><span className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0"/>{doctorDocumentState.get(form.doctorId)?.blocked ? 'Médico bloqueado para novos plantões por pendência crítica.' : 'Médico com documento pendente ou próximo do vencimento.'}</span><Link href={`/documentos/${form.doctorId}`} className="shrink-0 font-semibold underline">Abrir pasta</Link></div>}{form.doctorId && !form.id && <section className="rounded-xl border border-border bg-surface-muted/35 p-4"><div className="flex items-start gap-3"><Repeat2 size={18} className="mt-0.5 shrink-0 text-primary"/><div><h3 className="text-sm font-semibold">Repetição automática</h3><p className="mt-1 text-xs text-text-muted">Use para médicos fixos. Todos os plantões serão criados de uma vez.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="nv-label">Frequência<select className="nv-input" value={recurrence} onChange={event => setRecurrence(event.target.value as ShiftRecurrence)}><option value="once">Somente este plantão</option><option value="weekly">Semanal</option><option value="fortnightly">Quinzenal</option><option value="monthly">Mensal</option></select></label>{recurrence !== 'once' && <label className="nv-label">Repetir até<input className="nv-input" type="date" min={form.date} required value={repeatUntil} onChange={event => setRepeatUntil(event.target.value)}/></label>}</div>{recurrence !== 'once' && recurrenceDates.length > 0 && <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs leading-5 text-text-secondary"><strong className="text-text-primary">{recurrenceDates.length} plantões:</strong> {recurrenceDescription(form.date, recurrence)}, das {form.startTime} às {form.endTime}, até {new Date(repeatUntil + 'T12:00:00').toLocaleDateString('pt-BR')}.</p>}</section>}{!form.doctorId && !form.id && <label className="nv-label">Quantidade de vagas<input className="nv-input" type="number" min={1} max={20} value={vacancyCount} onChange={event => setVacancyCount(Math.max(1, Number(event.target.value)))}/></label>}{form.doctorId && <><div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Vínculo<select className="nv-input" required value={form.employmentType || ''} onChange={event => setForm({ ...form, employmentType: event.target.value as EmploymentType })}><option value="">Selecione</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="nv-label">Situação<select className="nv-input" value={form.status} onChange={event => setForm({ ...form, status: event.target.value as Shift['status'] })}><option value="pending">Aguardando confirmação</option><option value="confirmed">Confirmado</option><option value="completed">Concluído</option><option value="cancelled">Cancelado</option></select></label></div><label className="nv-label">{form.employmentType === 'pj' ? 'Empresa PJ' : form.employmentType === 'concursado' ? 'Prefeitura / órgão público' : 'Empregador'}<input className="nv-input" list="employer-options" required={form.employmentType === 'pj'} maxLength={150} value={form.employerName || ''} onChange={event => setForm({ ...form, employerName: event.target.value })}/><datalist id="employer-options">{employers.map(item => <option key={item} value={item}/>)}</datalist></label>{canSeeFinancial && <div className="grid gap-4 sm:grid-cols-3"><label className="nv-label">Valor do plantão (R$)<input className="nv-input disabled:cursor-not-allowed disabled:opacity-65" disabled={!canEditFinancial} type="number" min="0" max="9999999999.99" step="0.01" value={form.paymentAmount || 0} onChange={event => setForm({ ...form, paymentAmount: Number(event.target.value) })}/></label><label className="nv-label">Regime de pagamento<select className="nv-input disabled:cursor-not-allowed disabled:opacity-65" disabled={!canEditFinancial} value={form.paymentFrequency || 'on_delivery'} onChange={event => setForm({ ...form, paymentFrequency: event.target.value as Shift['paymentFrequency'] })}>{Object.entries(paymentFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="nv-label">Situação financeira<select className="nv-input disabled:cursor-not-allowed disabled:opacity-65" disabled={!canEditFinancial} value={form.paymentStatus || 'pending'} onChange={event => setForm({ ...form, paymentStatus: event.target.value as Shift['paymentStatus'], paidAt: event.target.value === 'paid' ? form.paidAt || new Date().toISOString() : undefined })}><option value="pending">Pendente</option><option value="paid">Pago</option></select></label></div>}</>}<div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Modalidade<select className="nv-input" value={form.type} onChange={event => setForm({ ...form, type: event.target.value as Shift['type'] })}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{form.endTime < form.startTime && <p className="self-end pb-3 text-xs text-primary">Termina no dia seguinte.</p>}</div><label className="nv-label">Observações<textarea className="nv-input" rows={2} maxLength={1000} value={form.notes || ''} onChange={event => setForm({ ...form, notes: event.target.value })}/></label>{formError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{formError}</p>}{store.saving && <p role="status" className="flex items-center gap-2 text-xs text-text-muted"><LoaderCircle size={14} className="animate-spin"/>Confirmando o plantão no banco de dados…</p>}<div className="flex justify-end gap-3 pt-2"><button type="button" className="nv-button-secondary" onClick={() => setForm(null)} disabled={store.saving}>Cancelar</button><button className="nv-button" disabled={store.saving}>{store.saving ? <><LoaderCircle size={15} className="animate-spin"/>Salvando plantão…</> : recurrenceDates.length > 1 ? `Criar ${recurrenceDates.length} plantões` : form.doctorId ? 'Salvar plantão' : vacancyCount > 1 ? `Criar ${vacancyCount} vagas` : 'Criar vaga'}</button></div></form></Dialog>}
  </div>;
}

export default function SchedulePage() { const orgId = useStore(state => state.activeOrganizationId); return <AccessGuard requiredPermission="escala"><Suspense fallback={<p>Carregando escala…</p>}><Schedule key={orgId}/></Suspense></AccessGuard>; }
