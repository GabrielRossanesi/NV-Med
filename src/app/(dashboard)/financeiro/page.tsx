'use client';

import { useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  Columns3,
  Download,
  List,
  ReceiptText,
  RotateCcw,
  WalletCards,
} from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import Dialog from '@/components/Dialog';
import { downloadCsv } from '@/lib/csv';
import { employmentLabels, localDate, paymentFrequencyLabels } from '@/lib/scheduling';
import { useStore } from '@/store/useStore';
import type { PaymentFrequency, PaymentStatus, Shift } from '@/types';

type PeriodMode = 'week' | 'month';
type FinanceView = 'list' | 'kanban';

const paymentStatusLabels: Record<PaymentStatus, string> = { pending: 'Pendente', paid: 'Pago' };

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

function periodBounds(mode: PeriodMode, reference: string) {
  const date = new Date(`${reference}T12:00:00`);
  if (mode === 'week') {
    const start = addDays(reference, -((date.getDay() + 6) % 7));
    return { start, end: addDays(start, 6) };
  }
  const start = `${reference.slice(0, 7)}-01`;
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return { start, end: `${reference.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` };
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
}

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function safeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function FinancePage() {
  const store = useStore();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [reference, setReference] = useState(localDate());
  const [unitId, setUnitId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [frequency, setFrequency] = useState<PaymentFrequency | ''>('');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('');
  const [view, setView] = useState<FinanceView>('list');
  const [editing, setEditing] = useState<Shift | null>(null);
  const [editAmount, setEditAmount] = useState(0);
  const [editFrequency, setEditFrequency] = useState<PaymentFrequency>('on_delivery');
  const [editStatus, setEditStatus] = useState<PaymentStatus>('pending');
  const [editError, setEditError] = useState('');
  const orgId = store.activeOrganizationId;
  const organization = store.organizations.find(item => item.id === orgId);
  const bounds = periodBounds(periodMode, reference);

  // Every collection is scoped before it participates in filters or joins.
  const units = useMemo(() => store.units.filter(item => item.organizationId === orgId), [store.units, orgId]);
  const sectors = useMemo(() => store.sectors.filter(item => item.organizationId === orgId), [store.sectors, orgId]);
  const doctors = useMemo(() => store.doctors.filter(item => item.organizationId === orgId), [store.doctors, orgId]);
  const organizationShifts = useMemo(() => store.shifts.filter(item => item.organizationId === orgId), [store.shifts, orgId]);
  const specialties = useMemo(() => [...new Set([
    ...organizationShifts.map(item => item.specialty).filter(Boolean),
    ...sectors.flatMap(item => item.specialties),
  ] as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [organizationShifts, sectors]);

  const filteredShifts = useMemo(() => organizationShifts
    .filter(item => item.doctorId && item.status !== 'cancelled' && item.date >= bounds.start && item.date <= bounds.end)
    .filter(item => !unitId || item.unitId === unitId)
    .filter(item => !sectorId || item.sectorId === sectorId)
    .filter(item => !specialty || item.specialty === specialty)
    .filter(item => !frequency || (item.paymentFrequency || 'on_delivery') === frequency)
    .filter(item => !paymentStatus || (item.paymentStatus || 'pending') === paymentStatus)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)), [organizationShifts, bounds.start, bounds.end, unitId, sectorId, specialty, frequency, paymentStatus]);

  const total = filteredShifts.reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
  const paid = filteredShifts.filter(item => item.paymentStatus === 'paid').reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
  const pending = total - paid;
  const onDelivery = filteredShifts.filter(item => (item.paymentFrequency || 'on_delivery') === 'on_delivery');
  const monthly = filteredShifts.filter(item => item.paymentFrequency === 'monthly');
  const visibleSectors = sectors.filter(item => !unitId || item.unitId === unitId);

  function resetFilters() {
    setUnitId('');
    setSectorId('');
    setSpecialty('');
    setFrequency('');
    setPaymentStatus('');
  }

  function exportCsv() {
    const rows = filteredShifts.map(item => {
      const doctor = doctors.find(value => value.id === item.doctorId);
      const unit = units.find(value => value.id === item.unitId);
      const sector = sectors.find(value => value.id === item.sectorId);
      return [
        organization?.name,
        displayDate(item.date),
        item.startTime,
        item.endTime,
        doctor?.name,
        doctor ? `${doctor.crm}-${doctor.crmUf}` : '',
        unit?.name,
        sector?.name || item.sector,
        item.specialty,
        item.employmentType ? employmentLabels[item.employmentType] : '',
        item.employerName,
        paymentFrequencyLabels[item.paymentFrequency || 'on_delivery'],
        (item.paymentAmount || 0).toFixed(2).replace('.', ','),
        paymentStatusLabels[item.paymentStatus || 'pending'],
        item.paidAt ? new Date(item.paidAt).toLocaleString('pt-BR') : '',
      ];
    });
    downloadCsv(
      `financeiro-${safeName(organization?.name || 'empresa')}-${bounds.start}-${bounds.end}`,
      ['Empresa', 'Data', 'Início', 'Fim', 'Médico', 'CRM', 'Unidade', 'Setor', 'Especialidade', 'Vínculo', 'Empregador', 'Regime de pagamento', 'Valor (R$)', 'Situação', 'Pago em'],
      rows,
    );
  }

  function openPayment(shift: Shift) {
    setEditing(shift);
    setEditAmount(shift.paymentAmount || 0);
    setEditFrequency(shift.paymentFrequency || 'on_delivery');
    setEditStatus(shift.paymentStatus || 'pending');
    setEditError('');
  }

  async function savePayment(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (!Number.isFinite(editAmount) || editAmount < 0) return setEditError('Informe um valor válido para o plantão.');
    const ok = await store.updateShiftFinancials(editing.id, editAmount, editFrequency, editStatus);
    if (ok) setEditing(null);
    else setEditError(useStore.getState().error || 'Não foi possível atualizar o pagamento.');
  }

  function shiftContext(shift: Shift) {
    return {
      doctor: doctors.find(item => item.id === shift.doctorId),
      unit: units.find(item => item.id === shift.unitId),
      sector: sectors.find(item => item.id === shift.sectorId),
    };
  }

  return (
    <AccessGuard requiredPermission="financeiro">
      <div className="space-y-6 animate-in fade-in duration-300">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Gestão financeira</p>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight"><WalletCards className="h-6 w-6 text-primary"/>Pagamentos médicos</h1>
            <p className="mt-1 text-sm text-text-muted">Concilie valores por unidade, setor e especialidade de {organization?.name || 'sua empresa'}.</p>
          </div>
          <button type="button" className="nv-button" onClick={exportCsv} disabled={!filteredShifts.length}><Download size={16}/>Exportar CSV</button>
        </header>

        <section aria-label="Filtros financeiros" className="rounded-2xl border border-border bg-card-bg p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <label className="nv-label">Período<select className="nv-input" value={periodMode} onChange={event => setPeriodMode(event.target.value as PeriodMode)}><option value="week">Semanal</option><option value="month">Mensal</option></select></label>
            <label className="nv-label">Referência<input className="nv-input" type={periodMode === 'week' ? 'date' : 'month'} value={periodMode === 'week' ? reference : reference.slice(0, 7)} onChange={event => setReference(periodMode === 'week' ? event.target.value : `${event.target.value}-01`)}/></label>
            <label className="nv-label">Unidade<select className="nv-input" value={unitId} onChange={event => { setUnitId(event.target.value); setSectorId(''); }}><option value="">Todas</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label className="nv-label">Setor<select className="nv-input" value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">Todos</option>{visibleSectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
            <label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => setSpecialty(event.target.value)}><option value="">Todas</option>{specialties.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
            <button type="button" className="nv-button-secondary self-end" onClick={resetFilters}><RotateCcw size={15}/>Limpar filtros</button>
          </div>
          <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:max-w-[620px]">
            <label className="nv-label">Regime de pagamento<select className="nv-input" value={frequency} onChange={event => setFrequency(event.target.value as PaymentFrequency | '')}><option value="">À vista e mensal</option>{Object.entries(paymentFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="nv-label">Situação<select className="nv-input" value={paymentStatus} onChange={event => setPaymentStatus(event.target.value as PaymentStatus | '')}><option value="">Pendentes e pagos</option><option value="pending">Pendente</option><option value="paid">Pago</option></select></label>
          </div>
        </section>

        <section className="grid overflow-hidden rounded-2xl border border-border bg-card-bg sm:grid-cols-2 xl:grid-cols-5" aria-label="Resumo financeiro">
          <div className="p-5"><p className="text-xs text-text-muted">Total previsto</p><p className="mt-2 text-xl font-semibold tabular-nums">{money(total)}</p><p className="mt-1 text-[11px] text-text-muted">{filteredShifts.length} plantões</p></div>
          <div className="border-t border-border p-5 sm:border-l sm:border-t-0"><p className="text-xs text-text-muted">Pendente</p><p className="mt-2 text-xl font-semibold tabular-nums text-warning">{money(pending)}</p><p className="mt-1 text-[11px] text-text-muted">Aguardando conciliação</p></div>
          <div className="border-t border-border p-5 xl:border-l xl:border-t-0"><p className="text-xs text-text-muted">Pago</p><p className="mt-2 text-xl font-semibold tabular-nums text-success">{money(paid)}</p><p className="mt-1 text-[11px] text-text-muted">Baixado no período</p></div>
          <div className="border-t border-border p-5 sm:border-l xl:border-t-0"><p className="text-xs text-text-muted">À vista</p><p className="mt-2 text-xl font-semibold tabular-nums">{onDelivery.length}</p><p className="mt-1 text-[11px] text-text-muted">{money(onDelivery.reduce((sum, item) => sum + (item.paymentAmount || 0), 0))}</p></div>
          <div className="border-t border-border p-5 xl:border-l xl:border-t-0"><p className="text-xs text-text-muted">Mensal</p><p className="mt-2 text-xl font-semibold tabular-nums">{monthly.length}</p><p className="mt-1 text-[11px] text-text-muted">{money(monthly.reduce((sum, item) => sum + (item.paymentAmount || 0), 0))}</p></div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div><h2 className="font-semibold">Conciliação do período</h2><p className="mt-1 text-sm text-text-muted">{displayDate(bounds.start)} – {displayDate(bounds.end)} · dados exclusivos da empresa ativa.</p></div>
          <div className="inline-flex rounded-lg border border-border bg-card-bg p-1" aria-label="Modo de exibição">
            <button type="button" onClick={() => setView('list')} className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${view === 'list' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`}><List size={15}/>Lista</button>
            <button type="button" onClick={() => setView('kanban')} className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ${view === 'kanban' ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`}><Columns3 size={15}/>Kanban</button>
          </div>
        </div>

        {view === 'list' ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-card-bg">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-border bg-surface-muted/50 text-[10px] font-semibold uppercase tracking-wider text-text-muted"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Médico</th><th className="px-4 py-3">Unidade · setor</th><th className="px-4 py-3">Especialidade</th><th className="px-4 py-3">Regime</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead>
                <tbody className="divide-y divide-border">{filteredShifts.map(shift => { const { doctor, unit, sector } = shiftContext(shift); const status = shift.paymentStatus || 'pending'; return <tr key={shift.id} className="transition hover:bg-state-hover"><td className="px-4 py-3"><span className="block font-medium tabular-nums">{displayDate(shift.date)}</span><span className="text-xs text-text-muted">{shift.startTime}–{shift.endTime}</span></td><td className="px-4 py-3"><span className="block font-medium">{doctor?.name || 'Médico'}</span><span className="text-xs text-text-muted">{doctor ? `${doctor.crm}-${doctor.crmUf}` : ''}</span></td><td className="px-4 py-3"><span className="block max-w-48 truncate font-medium">{unit?.name || 'Unidade'}</span><span className="text-xs text-text-muted">{sector?.name || shift.sector || 'Setor'}</span></td><td className="px-4 py-3 text-text-secondary">{shift.specialty || '—'}</td><td className="px-4 py-3"><span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-medium">{paymentFrequencyLabels[shift.paymentFrequency || 'on_delivery']}</span></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(shift.paymentAmount || 0)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === 'paid' ? 'text-success' : 'text-warning'}`}>{status === 'paid' ? <CheckCircle2 size={14}/> : <ReceiptText size={14}/>} {paymentStatusLabels[status]}</span></td><td className="px-4 py-3 text-right"><button type="button" disabled={store.saving} onClick={() => openPayment(shift)} className="text-xs font-semibold text-primary hover:underline">Editar</button></td></tr>; })}</tbody>
              </table>
            </div>
            {!filteredShifts.length && <div className="py-16 text-center"><Banknote className="mx-auto h-6 w-6 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum pagamento neste recorte</p><p className="mt-1 text-xs text-text-muted">Ajuste o período ou os filtros para consultar outros plantões.</p></div>}
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {(['pending', 'paid'] as PaymentStatus[]).map(status => { const items = filteredShifts.filter(item => (item.paymentStatus || 'pending') === status); return <section key={status} className="overflow-hidden rounded-2xl border border-border bg-card-bg"><header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h3 className="font-semibold">{paymentStatusLabels[status]}</h3><p className="mt-0.5 text-xs text-text-muted">{items.length} registros · {money(items.reduce((sum, item) => sum + (item.paymentAmount || 0), 0))}</p></div><span className={`h-2.5 w-2.5 rounded-full ${status === 'paid' ? 'bg-success' : 'bg-warning'}`}/></header><div className="max-h-[680px] divide-y divide-border overflow-y-auto">{items.map(shift => { const { doctor, unit, sector } = shiftContext(shift); return <article key={shift.id} className="p-4 transition hover:bg-state-hover"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{doctor?.name || 'Médico'}</p><p className="mt-1 truncate text-xs text-text-muted">{unit?.name} · {sector?.name || shift.sector}</p></div><p className="shrink-0 font-semibold tabular-nums">{money(shift.paymentAmount || 0)}</p></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-surface-muted px-2 py-1">{displayDate(shift.date)}</span><span className="rounded bg-surface-muted px-2 py-1">{shift.specialty || 'Sem especialidade'}</span><span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">{paymentFrequencyLabels[shift.paymentFrequency || 'on_delivery']}</span></div><button type="button" disabled={store.saving} onClick={() => openPayment(shift)} className="mt-4 text-xs font-semibold text-primary hover:underline">Editar pagamento</button></article>; })}{!items.length && <p className="px-4 py-12 text-center text-sm text-text-muted">Nenhum item nesta etapa.</p>}</div></section>; })}
          </div>
        )}

        {editing && <Dialog title="Editar pagamento" onClose={() => !store.saving && setEditing(null)}><form className="space-y-4" onSubmit={savePayment}><div className="rounded-xl bg-surface-muted/60 p-4"><p className="text-sm font-semibold">{shiftContext(editing).doctor?.name || 'Médico'}</p><p className="mt-1 text-xs text-text-muted">{displayDate(editing.date)} · {shiftContext(editing).unit?.name} · {shiftContext(editing).sector?.name || editing.sector}</p></div><label className="nv-label">Valor do plantão (R$)<input className="nv-input" type="number" min="0" max="9999999999.99" step="0.01" required value={editAmount} onChange={event => setEditAmount(Number(event.target.value))}/></label><div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Regime de pagamento<select className="nv-input" value={editFrequency} onChange={event => setEditFrequency(event.target.value as PaymentFrequency)}>{Object.entries(paymentFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="nv-label">Situação<select className="nv-input" value={editStatus} onChange={event => setEditStatus(event.target.value as PaymentStatus)}><option value="pending">Pendente</option><option value="paid">Pago</option></select></label></div>{editError && <p role="alert" className="text-sm text-danger">{editError}</p>}<div className="flex justify-end gap-3 pt-2"><button type="button" className="nv-button-secondary" onClick={() => setEditing(null)}>Cancelar</button><button className="nv-button" disabled={store.saving}>{store.saving ? 'Salvando…' : 'Salvar pagamento'}</button></div></form></Dialog>}

        <p className="flex items-center gap-2 text-xs text-text-muted"><Building2 size={14}/>{organization?.name || 'Empresa'} · o acesso e as exportações respeitam o cliente selecionado.</p>
      </div>
    </AccessGuard>
  );
}
