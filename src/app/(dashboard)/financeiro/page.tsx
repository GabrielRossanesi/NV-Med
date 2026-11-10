'use client';

import Link from 'next/link';
import { financeState, financeStateLabels, saoPauloDate, type FinanceState } from '@/lib/financeState';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
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
import Dialog from '@/components/Dialog';
import ShiftRecordSummary from '@/components/schedule/ShiftRecordSummary';
import { ShiftAgreementFields, ShiftFinancialDetails, ShiftPaymentHistory, useShiftRates } from '@/components/schedule/ShiftFinancialDetails';
import { downloadCsv } from '@/lib/csv';
import { employmentLabels, localDate, paymentFrequencyLabels } from '@/lib/scheduling';
import { canEditPermission, canViewPermission } from '@/lib/permissions';
import { buildAgreementSelection, chooseShiftRate, initialAgreementDraft, parseMoneyCents } from '@/lib/shiftPricing';
import { useStore } from '@/store/useStore';
import type { Doctor, Organization, PaymentFrequency, PaymentStatus, Sector, Shift, Unit } from '@/types';

type PeriodMode = 'week' | 'month' | 'all';
type FinanceView = 'list' | 'kanban';
type PaymentFilter = FinanceState | 'unpaid' | '';

const paymentStatusLabels: Record<PaymentStatus, string> = { pending: 'Pendente', paid: 'Pago' };

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

function periodBounds(mode: PeriodMode, reference: string) {
  if (mode === 'all') return { start: '', end: '' };
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

function PaymentRecordDialog({ shift, organization, unit, sector, doctor, onClose }: {
  shift: Shift; organization?: Organization; unit?: Unit; sector?: Sector; doctor?: Doctor; onClose: () => void;
}) {
  const { currentUser, saving, updateShiftAgreement, updateShiftFinancials } = useStore();
  const [view, setView] = useState<'details' | 'agreement' | 'settlement' | 'adjustment'>('details');
  const [draft, setDraft] = useState(() => initialAgreementDraft(shift));
  const [baseline, setBaseline] = useState(shift);
  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [error, setError] = useState('');
  const paid = shift.paymentStatus === 'paid';
  const canEdit = canEditPermission(currentUser, 'financeiro');
  const canAdjust = canEdit && canEditPermission(currentUser, 'configuracoes');
  const adjustment = view === 'adjustment';
  const editingAgreement = canEdit && ((!paid && view === 'agreement') || (paid && canAdjust && adjustment));
  const { rates, ready, error: rateError, reload } = useShiftRates(shift.organizationId, true);
  const rate = chooseShiftRate(rates, shift, sector, doctor?.specialty);

  function openView(next: typeof view) {
    setError('');
    setDraft(initialAgreementDraft(shift));
    setBaseline(shift);
    setStatus('pending');
    setView(next);
  }

  async function saveAgreement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingAgreement || !ready || saving) return;
    setError('');
    try {
      const selection = buildAgreementSelection(draft, rate, baseline, adjustment);
      if (!selection) return setError('Altere a modalidade ou selecione como definir o valor acordado.');
      if (await updateShiftAgreement(shift.id, selection, adjustment)) openView('details');
      else setError(useStore.getState().error || 'Não foi possível salvar o acordo.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Confira o acordo financeiro.'); }
  }

  async function saveSettlement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || paid || saving) return;
    setError('');
    const fields = new FormData(event.currentTarget);
    const cents = status === 'paid' ? parseMoneyCents(String(fields.get('paidAmount') || '')) : null;
    if (status === 'paid' && cents === null) return setError('Informe o valor pago em reais, com até duas casas decimais.');
    const ok = await updateShiftFinancials(shift.id, baseline.paymentAmount ?? 0, baseline.paymentFrequency || 'on_delivery', status, {
      amount: cents === null ? null : cents / 100,
      date: status === 'paid' ? String(fields.get('paidOn') || '') : null,
      note: String(fields.get('note') || ''),
    });
    if (ok) openView('details');
    else setError(useStore.getState().error || 'Não foi possível atualizar o pagamento.');
  }

  return <Dialog title="Ficha financeira do plantão" onClose={() => { if (!saving) onClose(); }}>
    <div className="space-y-4">
      <ShiftRecordSummary shift={shift} organization={organization?.name} unit={unit?.name} sector={sector?.name} doctor={doctor?.name} />
      <ShiftFinancialDetails shift={shift} applicableRate={rate} />
      {view === 'details' && <div className="flex flex-wrap gap-2">
        {canEdit && !paid && <>
          <button type="button" className="nv-button-secondary" onClick={() => openView('agreement')}>Editar acordo</button>
          <button type="button" className="nv-button" onClick={() => openView('settlement')}>Registrar pagamento</button>
        </>}
        {paid && canAdjust && <button type="button" className="nv-button-secondary" onClick={() => openView('adjustment')}>Ajuste administrativo</button>}
      </div>}
      {editingAgreement && <form className="space-y-3" onSubmit={saveAgreement}>
        {adjustment && <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">Corrija o valor acordado com justificativa. A baixa registrada, a modalidade e o valor efetivamente pago são preservados.</p>}
        {ready ? <ShiftAgreementFields draft={draft} onChange={setDraft} rate={rate} previous={baseline} adjustment={adjustment} /> : <p role="status" className="text-sm text-text-muted">{rateError || 'Consultando valores padrão…'}{rateError && <button type="button" className="ml-2 text-primary underline" onClick={reload}>Tentar novamente</button>}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={saving} onClick={() => openView('details')}>Cancelar</button><button className="nv-button" disabled={!ready || saving}>{saving ? 'Salvando…' : adjustment ? 'Registrar ajuste' : 'Salvar acordo'}</button></div>
      </form>}
      {view === 'settlement' && canEdit && !paid && <form className="space-y-3" onSubmit={saveSettlement}>
        <label className="nv-label">Situação<select className="nv-input" value={status} onChange={event => setStatus(event.target.value as PaymentStatus)}><option value="pending">Pendente</option><option value="paid">Pago</option></select></label>
        {status === 'paid' && <div className="grid gap-3 sm:grid-cols-2">
          <label className="nv-label">Valor efetivamente pago (R$)<input className="nv-input" inputMode="decimal" name="paidAmount" defaultValue={String(shift.paymentAmount ?? 0)} required /></label>
          <label className="nv-label">Data do pagamento<input className="nv-input" type="date" name="paidOn" max={saoPauloDate()} defaultValue={saoPauloDate()} required /></label>
        </div>}
        <label className="nv-label">Observações<textarea className="nv-input" name="note" maxLength={1000} rows={3} defaultValue={shift.paymentNote} /></label>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={saving} onClick={() => openView('details')}>Cancelar</button><button className="nv-button" disabled={saving}>{saving ? 'Salvando…' : 'Salvar pagamento'}</button></div>
      </form>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ShiftPaymentHistory key={JSON.stringify([shift.id, shift.paymentAgreement?.changed_at, shift.paidAt, shift.paymentNote])} shiftId={shift.id} />
    </div>
  </Dialog>;
}

function FinancePageContent({ params }: { params: URLSearchParams }) {
  const store = useStore();
  const month = params.get('month') || '';
  const initialFrequency = params.get('frequency');
  const initialStatus = params.get('status');
  const [periodMode, setPeriodMode] = useState<PeriodMode>(params.get('period') === 'all' ? 'all' : 'month');
  const [reference, setReference] = useState(/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month + '-01' : localDate());
  const [unitId, setUnitId] = useState('');
  const [sectorId, setSectorId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [frequency, setFrequency] = useState<PaymentFrequency | ''>(initialFrequency === 'on_delivery' || initialFrequency === 'monthly' ? initialFrequency : '');
  const [paymentStatus, setPaymentStatus] = useState<PaymentFilter>(initialStatus === 'unpaid' ? initialStatus : '');
  const [view, setView] = useState<FinanceView>('list');
  const requestedShift = params.get('shiftId');
  const [editingId, setEditingId] = useState<string | null>(requestedShift);
  const orgId = store.activeOrganizationId;
  const organization = store.organizations.find(item => item.id === orgId);
  const bounds = periodBounds(periodMode, reference);
  const today = saoPauloDate();

  // Every collection is scoped before it participates in filters or joins.
  const units = useMemo(() => store.units.filter(item => item.organizationId === orgId), [store.units, orgId]);
  const sectors = useMemo(() => store.sectors.filter(item => item.organizationId === orgId), [store.sectors, orgId]);
  const doctors = useMemo(() => store.doctors.filter(item => item.organizationId === orgId), [store.doctors, orgId]);
  const organizationShifts = useMemo(() => store.shifts.filter(item => item.organizationId === orgId), [store.shifts, orgId]);
  const editing = organizationShifts.find(shift => shift.id === editingId && shift.doctorId);
  const specialties = useMemo(() => [...new Set([
    ...organizationShifts.map(item => item.specialty).filter(Boolean),
    ...sectors.flatMap(item => item.specialties),
  ] as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [organizationShifts, sectors]);

  const filteredShifts = useMemo(() => organizationShifts
    .filter(item => !requestedShift || item.id === requestedShift)
    .filter(item => item.doctorId && (item.status !== 'cancelled' || paymentStatus === 'cancelled') && (!bounds.start || (item.date >= bounds.start && item.date <= bounds.end)))
    .filter(item => !unitId || item.unitId === unitId)
    .filter(item => !sectorId || item.sectorId === sectorId)
    .filter(item => !specialty || item.specialty === specialty)
    .filter(item => !frequency || (item.paymentFrequency || 'on_delivery') === frequency)
    .filter(item => !paymentStatus || (paymentStatus === 'unpaid' ? item.paymentStatus !== 'paid' : financeState(item, today) === paymentStatus))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)), [organizationShifts, requestedShift, bounds.start, bounds.end, unitId, sectorId, specialty, frequency, paymentStatus, today]);

  const total = filteredShifts.reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
  const paid = filteredShifts.filter(item => item.paymentStatus === 'paid').reduce((sum, item) => sum + (item.paidAmount ?? item.paymentAmount ?? 0), 0);
  const pending = filteredShifts.filter(item => item.paymentStatus !== 'paid' && item.status !== 'cancelled').reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
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
        financeStateLabels[financeState(item, today)],
        item.paymentDueDate ? displayDate(item.paymentDueDate) : '',
        item.paidAt ? new Date(item.paidAt).toLocaleString('pt-BR') : '',
        item.paidAmount?.toFixed(2).replace('.', ','),
      ];
    });
    downloadCsv(
      `financeiro-${safeName(organization?.name || 'empresa')}-${bounds.start ? `${bounds.start}-${bounds.end}` : 'todos-os-periodos'}`,
      ['Empresa', 'Data', 'Início', 'Fim', 'Médico', 'CRM', 'Unidade', 'Setor', 'Especialidade', 'Vínculo', 'Empregador', 'Regime de pagamento', 'Valor (R$)', 'Situação', 'Vencimento', 'Pago em', 'Valor pago (R$)'],
      rows,
    );
  }

  function shiftContext(shift: Shift) {
    return {
      doctor: doctors.find(item => item.id === shift.doctorId),
      unit: units.find(item => item.id === shift.unitId),
      sector: sectors.find(item => item.id === shift.sectorId),
    };
  }

  return (
    <>
      <div className="space-y-6 animate-in fade-in duration-300">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Gestão financeira</p>
            <h1 className="nv-page-title mt-2 flex items-center gap-2"><WalletCards className="h-6 w-6 text-primary"/>Pagamentos médicos</h1>
            <p className="mt-1 text-sm text-text-muted">Concilie valores por unidade, setor e especialidade de {organization?.name || 'sua empresa'}.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditPermission(store.currentUser, 'configuracoes') && <Link className="nv-button-secondary" href="/financeiro/configuracao">Regras de vencimento</Link>}
            <Link className="nv-button-secondary" href="/configuracoes/valores-plantoes">Valores de plantões</Link>
            {requestedShift && <Link className="nv-button-secondary" href="/financeiro">Ver todos os pagamentos</Link>}
            <button type="button" className="nv-button" onClick={exportCsv} disabled={!filteredShifts.length}><Download size={16}/>Exportar CSV</button>
          </div>
        </header>

        {!canEditPermission(store.currentUser, 'financeiro') && <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-text-secondary"><ReceiptText size={16} className="shrink-0 text-primary"/><span><strong className="font-semibold text-text-primary">Acesso somente para consulta.</strong> Você pode visualizar e exportar os dados financeiros, sem alterar valores ou pagamentos.</span></div>}

        <section aria-label="Filtros financeiros" className="nv-panel p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <label className="nv-label">Período<select className="nv-input" value={periodMode} onChange={event => setPeriodMode(event.target.value as PeriodMode)}><option value="week">Semanal</option><option value="month">Mensal</option><option value="all">Todos os períodos</option></select></label>
            <label className="nv-label">Referência<input className="nv-input" disabled={periodMode === 'all'} type={periodMode === 'week' ? 'date' : 'month'} value={periodMode === 'week' ? reference : reference.slice(0, 7)} onChange={event => setReference(periodMode === 'week' ? event.target.value : `${event.target.value}-01`)}/></label>
            <label className="nv-label">Unidade<select className="nv-input" value={unitId} onChange={event => { setUnitId(event.target.value); setSectorId(''); }}><option value="">Todas</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
            <label className="nv-label">Setor<select className="nv-input" value={sectorId} onChange={event => setSectorId(event.target.value)}><option value="">Todos</option>{visibleSectors.map(sector => <option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label>
            <label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => setSpecialty(event.target.value)}><option value="">Todas</option>{specialties.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
            <button type="button" className="nv-button-secondary self-end" onClick={resetFilters}><RotateCcw size={15}/>Limpar filtros</button>
          </div>
          <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2 xl:max-w-[620px]">
            <label className="nv-label">Regime de pagamento<select className="nv-input" value={frequency} onChange={event => setFrequency(event.target.value as PaymentFrequency | '')}><option value="">À vista e mensal</option>{Object.entries(paymentFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="nv-label">Situação<select className="nv-input" value={paymentStatus} onChange={event => setPaymentStatus(event.target.value as PaymentFilter)}>
              <option value="">Todos os pagamentos ativos</option>
              <option value="unpaid">Aguardando pagamento</option>
              {Object.entries(financeStateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          </div>
        </section>

        <section className="grid overflow-hidden nv-panel sm:grid-cols-2 xl:grid-cols-5" aria-label="Resumo financeiro">
          <div className="p-5"><p className="text-xs text-text-muted">Total previsto</p><p className="mt-2 text-xl font-semibold tabular-nums">{money(total)}</p><p className="mt-1 text-[11px] text-text-muted">{filteredShifts.length} plantões</p></div>
          <div className="border-t border-border p-5 sm:border-l sm:border-t-0"><p className="text-xs text-text-muted">Pendente</p><p className="mt-2 text-xl font-semibold tabular-nums text-warning">{money(pending)}</p><p className="mt-1 text-[11px] text-text-muted">Aguardando conciliação</p></div>
          <div className="border-t border-border p-5 xl:border-l xl:border-t-0"><p className="text-xs text-text-muted">Pago</p><p className="mt-2 text-xl font-semibold tabular-nums text-success">{money(paid)}</p><p className="mt-1 text-[11px] text-text-muted">Baixado no período</p></div>
          <div className="border-t border-border p-5 sm:border-l xl:border-t-0"><p className="text-xs text-text-muted">À vista</p><p className="mt-2 text-xl font-semibold tabular-nums">{onDelivery.length}</p><p className="mt-1 text-[11px] text-text-muted">{money(onDelivery.reduce((sum, item) => sum + (item.paymentAmount || 0), 0))}</p></div>
          <div className="border-t border-border p-5 xl:border-l xl:border-t-0"><p className="text-xs text-text-muted">Mensal</p><p className="mt-2 text-xl font-semibold tabular-nums">{monthly.length}</p><p className="mt-1 text-[11px] text-text-muted">{money(monthly.reduce((sum, item) => sum + (item.paymentAmount || 0), 0))}</p></div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div><h2 className="font-semibold">Conciliação do período</h2><p className="mt-1 text-sm text-text-muted">{bounds.start ? `${displayDate(bounds.start)} – ${displayDate(bounds.end)}` : 'Todos os períodos'} · dados exclusivos da empresa ativa.</p></div>
          <div className="nv-segment self-start" role="group" aria-label="Modo de exibição">
            <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} className="inline-flex items-center justify-center gap-2"><List size={15}/>Lista</button>
            <button type="button" onClick={() => setView('kanban')} aria-pressed={view === 'kanban'} className="inline-flex items-center justify-center gap-2"><Columns3 size={15}/>Kanban</button>
          </div>
        </div>

        {view === 'list' ? (
          <div className="overflow-hidden nv-panel">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-border bg-surface-muted font-semibold uppercase tracking-wide text-text-secondary"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Médico</th><th className="px-4 py-3">Unidade · setor</th><th className="px-4 py-3">Especialidade</th><th className="px-4 py-3">Regime</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3 text-right">Ficha</th></tr></thead>
                <tbody className="divide-y divide-border">{filteredShifts.map(shift => { const { doctor, unit, sector } = shiftContext(shift); const status = financeState(shift, today); return <tr key={shift.id} className="transition hover:bg-state-hover"><td className="px-4 py-3"><span className="block font-medium tabular-nums">{displayDate(shift.date)}</span><span className="text-xs text-text-muted">{shift.startTime}–{shift.endTime}</span></td><td className="px-4 py-3"><span className="block font-medium">{doctor?.name || 'Médico'}</span><span className="text-xs text-text-muted">{doctor ? `${doctor.crm}-${doctor.crmUf}` : ''}</span></td><td className="px-4 py-3"><span className="block max-w-48 truncate font-medium">{unit?.name || 'Unidade'}</span><span className="text-xs text-text-muted">{sector?.name || shift.sector || 'Setor'}</span></td><td className="px-4 py-3 text-text-secondary">{shift.specialty || '—'}</td><td className="px-4 py-3"><span className="rounded-md bg-surface-muted px-2 py-1 text-xs font-medium">{paymentFrequencyLabels[shift.paymentFrequency || 'on_delivery']}</span></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(shift.paymentAmount || 0)}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${status === 'paid' ? 'text-success' : 'text-warning'}`}>{status === 'paid' ? <CheckCircle2 size={14}/> : <ReceiptText size={14}/>} {financeStateLabels[status]}</span>{shift.paymentDueDate && <span className="block text-xs text-text-muted">Vence em {displayDate(shift.paymentDueDate)}</span>}{shift.paidAmount !== undefined && <span className="block text-xs text-text-muted">{money(shift.paidAmount)} pagos</span>}</td><td className="px-4 py-3 text-right"><button type="button" disabled={store.saving} onClick={() => setEditingId(shift.id)} className="text-xs font-semibold text-primary hover:underline">Ver ficha</button></td></tr>; })}</tbody>
              </table>
            </div>
            {!filteredShifts.length && <div className="py-16 text-center"><Banknote className="mx-auto h-6 w-6 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum pagamento neste recorte</p><p className="mt-1 text-xs text-text-muted">Ajuste o período ou os filtros para consultar outros plantões.</p></div>}
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {(['pending', 'paid'] as PaymentStatus[]).map(status => { const items = filteredShifts.filter(item => (item.paymentStatus || 'pending') === status); return <section key={status} className="overflow-hidden nv-panel"><header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h3 className="font-semibold">{paymentStatusLabels[status]}</h3><p className="mt-0.5 text-xs text-text-muted">{items.length} registros · {money(items.reduce((sum, item) => sum + (item.paymentAmount || 0), 0))}</p></div><span className={`h-2.5 w-2.5 rounded-full ${status === 'paid' ? 'bg-success' : 'bg-warning'}`}/></header><div className="max-h-[680px] divide-y divide-border overflow-y-auto">{items.map(shift => { const { doctor, unit, sector } = shiftContext(shift); return <article key={shift.id} className="p-4 transition hover:bg-state-hover"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-sm font-semibold">{doctor?.name || 'Médico'}</p><p className="mt-1 truncate text-xs text-text-muted">{unit?.name} · {sector?.name || shift.sector}</p></div><p className="shrink-0 font-semibold tabular-nums">{money(shift.paymentAmount || 0)}</p></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded bg-surface-muted px-2 py-1">{displayDate(shift.date)}</span><span className="rounded bg-surface-muted px-2 py-1">{shift.specialty || 'Sem especialidade'}</span><span className="rounded bg-primary/10 px-2 py-1 font-medium text-primary">{paymentFrequencyLabels[shift.paymentFrequency || 'on_delivery']}</span></div><button type="button" disabled={store.saving} onClick={() => setEditingId(shift.id)} className="mt-4 text-xs font-semibold text-primary hover:underline">Ver ficha financeira</button></article>; })}{!items.length && <p className="px-4 py-12 text-center text-sm text-text-muted">Nenhum item nesta etapa.</p>}</div></section>; })}
          </div>
        )}

        {editing && <PaymentRecordDialog key={editing.id} shift={editing} organization={organization}
          {...shiftContext(editing)} onClose={() => setEditingId(null)} />}

        <p className="flex items-center gap-2 text-xs text-text-muted"><Building2 size={14}/>{organization?.name || 'Empresa'} · o acesso e as exportações respeitam o cliente selecionado.</p>
      </div>
    </>
  );
}

function FinanceRoute() {
  const params = useSearchParams();
  const { currentUser, activeOrganizationId } = useStore();
  if (!canViewPermission(currentUser, 'financeiro')) return <p className="nv-panel p-5 text-sm">Seu perfil não tem acesso ao financeiro desta empresa.</p>;
  return <FinancePageContent key={activeOrganizationId + '?' + params.toString()} params={params} />;
}

export default function FinancePage() {
  return <Suspense fallback={<p role="status">Carregando financeiro…</p>}><FinanceRoute /></Suspense>;
}
