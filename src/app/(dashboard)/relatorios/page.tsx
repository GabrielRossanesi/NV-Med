'use client';

import { useState } from 'react';
import { AlertTriangle, Banknote, Building2, CalendarRange, CheckCircle2, Download, FileSpreadsheet, ShieldCheck, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import { downloadCsv } from '@/lib/csv';
import { employmentLabels, localDate, paymentFrequencyLabels } from '@/lib/scheduling';
import { canViewPermission } from '@/lib/permissions';
import { documentIsCritical, documentIsNearExpiry } from '@/lib/documentCompliance';
import { applicableDocuments, getDocumentGovernance } from '@/lib/documentGovernance';
import { doctorContractModelLabels } from '@/lib/doctorProfile';
import { useStore } from '@/store/useStore';
import type { Shift } from '@/types';

type PeriodMode = 'week' | 'month';

const shiftStatusLabels = { open: 'Vaga aberta', confirmed: 'Confirmado', pending: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado' };
const shiftTypeLabels = { onsite: 'Presencial', oncall: 'Sobreaviso', telemedicine: 'Telemedicina' };
const documentStatusLabels = { not_sent: 'Não enviado', sent: 'Enviado', analyzing: 'Em análise', approved: 'Aprovado', expired: 'Vencido', rejected: 'Reprovado' };

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDate(date);
}

function periodBounds(reference: string, mode: PeriodMode) {
  if (mode === 'month') {
    const [year, month] = reference.slice(0, 7).split('-').map(Number);
    const end = new Date(year, month, 0);
    return { start: `${year}-${String(month).padStart(2, '0')}-01`, end: localDate(end) };
  }
  const date = new Date(`${reference}T12:00:00`);
  const distance = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - distance);
  const start = localDate(date);
  return { start, end: addDays(start, 6) };
}

function displayDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR');
}

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function safeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

function ExportRow({ icon: Icon, title, description, count, onExport }: { icon: typeof CalendarRange; title: string; description: string; count: number; onExport: () => void }) {
  return (
    <div className="flex flex-col gap-4 border-b border-border py-5 last:border-b-0 sm:flex-row sm:items-center">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={18}/></span>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="font-semibold text-text-primary">{title}</h3><span className="rounded-md bg-surface-muted px-2 py-0.5 text-[11px] tabular-nums text-text-muted">{count} registros</span></div><p className="mt-1 text-sm text-text-muted">{description}</p></div>
      <button type="button" className="nv-button-secondary shrink-0" onClick={onExport} disabled={!count}><Download size={15}/>Exportar CSV</button>
    </div>
  );
}

export default function ReportsPage() {
  const store = useStore();
  const [mode, setMode] = useState<PeriodMode>('month');
  const [reference, setReference] = useState(localDate());
  const [unitId, setUnitId] = useState('');
  const [lastExport, setLastExport] = useState('');
  const [documentReferenceTime] = useState(() => Date.now());
  const orgId = store.activeOrganizationId;
  const organization = store.organizations.find(item => item.id === orgId);
  const documentGovernance = getDocumentGovernance(organization);
  const units = store.units.filter(item => item.organizationId === orgId);
  const sectors = store.sectors.filter(item => item.organizationId === orgId);
  const doctors = store.doctors.filter(item => item.organizationId === orgId && (!unitId || item.linkedUnits.includes(unitId)));
  const documents = store.documents.filter(item => item.organizationId === orgId && doctors.some(doctor => doctor.id === item.doctorId));
  const canSeeFinancial = canViewPermission(store.currentUser, 'financeiro');
  const bounds = periodBounds(reference, mode);
  const periodShifts = store.shifts
    .filter(item => item.organizationId === orgId && item.date >= bounds.start && item.date <= bounds.end && item.status !== 'cancelled')
    .filter(item => !unitId || item.unitId === unitId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const financialShifts = periodShifts.filter(item => item.doctorId);
  const totalAmount = financialShifts.reduce((total, item) => total + (item.paymentAmount || 0), 0);
  const paidAmount = financialShifts.filter(item => item.paymentStatus === 'paid').reduce((total, item) => total + (item.paymentAmount || 0), 0);
  const pendingAmount = totalAmount - paidAmount;

  const compliance = doctors.map(doctor => {
    const doctorDocuments = applicableDocuments(doctor, documents, organization?.settings.requiredDocuments);
    const pending = doctorDocuments.filter(item => item.status !== 'approved' || documentIsCritical(item, documentReferenceTime) || documentIsNearExpiry(item, documentReferenceTime, Math.max(...documentGovernance.expiryAlertDays)));
    return { doctor, documents: doctorDocuments, pending, regular: doctorDocuments.length > 0 && pending.length === 0 };
  });
  const regularDoctors = compliance.filter(item => item.regular).length;

  const doctorFinancials = doctors.map(doctor => {
    const shifts = financialShifts.filter(item => item.doctorId === doctor.id);
    const total = shifts.reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
    const paid = shifts.filter(item => item.paymentStatus === 'paid').reduce((sum, item) => sum + (item.paymentAmount || 0), 0);
    return { doctor, shifts: shifts.length, total, paid, pending: total - paid };
  }).filter(item => item.shifts > 0).sort((a, b) => b.total - a.total);

  const filenameBase = `${safeName(organization?.name || 'empresa')}-${bounds.start}-${bounds.end}`;
  function exported(label: string) { setLastExport(`${label} exportado em ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`); }

  function exportShifts() {
    downloadCsv(`plantoes-${filenameBase}`, ['Data', 'Início', 'Fim', 'Unidade', 'Setor', 'Especialidade', 'Médico', 'CRM', 'Vínculo', 'Empregador', 'Modalidade', 'Situação'], periodShifts.map(item => {
      const unit = units.find(value => value.id === item.unitId); const sector = sectors.find(value => value.id === item.sectorId); const doctor = store.doctors.find(value => value.id === item.doctorId);
      return [displayDate(item.date), item.startTime, item.endTime, unit?.name, sector?.name || item.sector, item.specialty, doctor?.name || 'Vaga aberta', doctor ? `${doctor.crm}-${doctor.crmUf}` : '', item.employmentType ? employmentLabels[item.employmentType] : '', item.employerName, shiftTypeLabels[item.type], shiftStatusLabels[item.status]];
    })); exported('Plantões');
  }

  function exportDoctors() {
    downloadCsv(`medicos-${safeName(organization?.name || 'empresa')}`, ['Médico', 'CRM', 'UF', 'RQE', 'Especialidade', 'Contratação', 'Contrato', 'Status', 'E-mail', 'Telefone', 'Unidades vinculadas'], doctors.map(doctor => [doctor.name, doctor.crm, doctor.crmUf, doctor.rqe || '', doctor.specialty, doctorContractModelLabels[doctor.contractModel || 'pf'], doctor.contractSigned ? 'Assinado' : 'Pendente', doctor.status === 'active' ? 'Ativo' : doctor.status === 'pending' ? 'Pendente' : 'Inativo', doctor.email, doctor.phone, doctor.linkedUnits.map(id => units.find(unit => unit.id === id)?.name).filter(Boolean).join(' | ')])); exported('Médicos');
  }

  function exportCompliance() {
    downloadCsv(`conformidade-documental-${safeName(organization?.name || 'empresa')}`, ['Médico', 'CRM', 'RQE', 'Especialidade', 'Contratação', 'Contrato', 'Conformidade', 'Pendências', 'Documentos pendentes', 'Documentos aprovados', 'Total de documentos'], compliance.map(item => [item.doctor.name, `${item.doctor.crm}-${item.doctor.crmUf}`, item.doctor.rqe || '', item.doctor.specialty, doctorContractModelLabels[item.doctor.contractModel || 'pf'], item.doctor.contractSigned ? 'Assinado' : 'Pendente', item.regular ? 'Regular' : 'Pendente', item.pending.length, item.pending.map(document => `${document.name} (${documentStatusLabels[document.status]})`).join(' | ') || 'Nenhuma', item.documents.filter(document => document.status === 'approved').length, item.documents.length])); exported('Conformidade documental');
  }

  function financialRow(item: Shift) {
    const doctor = store.doctors.find(value => value.id === item.doctorId); const unit = units.find(value => value.id === item.unitId); const sector = sectors.find(value => value.id === item.sectorId);
    return [displayDate(item.date), item.startTime, item.endTime, doctor?.name, doctor ? `${doctor.crm}-${doctor.crmUf}` : '', unit?.name, sector?.name || item.sector, item.specialty, item.employmentType ? employmentLabels[item.employmentType] : '', item.employerName, paymentFrequencyLabels[item.paymentFrequency || 'on_delivery'], (item.paymentAmount || 0).toFixed(2).replace('.', ','), item.paymentStatus === 'paid' ? 'Pago' : 'Pendente'];
  }

  function exportFinancial() {
    downloadCsv(`financeiro-detalhado-${filenameBase}`, ['Data', 'Início', 'Fim', 'Médico', 'CRM', 'Unidade', 'Setor', 'Especialidade', 'Vínculo', 'Empregador', 'Regime de pagamento', 'Valor (R$)', 'Pagamento'], financialShifts.map(financialRow)); exported('Financeiro detalhado');
  }

  function exportDoctorSummary() {
    downloadCsv(`financeiro-por-medico-${filenameBase}`, ['Médico', 'CRM', 'Plantões', 'Total (R$)', 'Pago (R$)', 'Pendente (R$)'], doctorFinancials.map(item => [item.doctor.name, `${item.doctor.crm}-${item.doctor.crmUf}`, item.shifts, item.total.toFixed(2).replace('.', ','), item.paid.toFixed(2).replace('.', ','), item.pending.toFixed(2).replace('.', ',')])); exported('Resumo por médico');
  }

  return (
    <AccessGuard requiredPermission="relatorios">
      <div className="space-y-7 animate-in fade-in duration-300">
        <header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Monitoramento operacional</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-bold tracking-tight"><FileSpreadsheet className="h-6 w-6 text-primary"/>Relatórios e exportações</h1><p className="mt-1 text-sm text-text-muted">Extraia dados da unidade em CSV compatível com Excel e acompanhe pagamentos por período.</p></header>

        <section aria-label="Filtros dos relatórios" className="grid gap-4 rounded-2xl border border-border bg-card-bg p-4 md:grid-cols-[180px_minmax(180px,1fr)_minmax(220px,1.2fr)]">
          <label className="nv-label">Período<select className="nv-input mt-2" value={mode} onChange={event => setMode(event.target.value as PeriodMode)}><option value="week">Semanal</option><option value="month">Mensal</option></select></label>
          <label className="nv-label">{mode === 'week' ? 'Semana de referência' : 'Mês de referência'}<input className="nv-input mt-2" type={mode === 'week' ? 'date' : 'month'} value={mode === 'week' ? reference : reference.slice(0, 7)} onChange={event => setReference(mode === 'week' ? event.target.value : `${event.target.value}-01`)}/></label>
          <label className="nv-label">Unidade<select className="nv-input mt-2" value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">Todas as unidades</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        </section>

        <section className="grid overflow-hidden rounded-2xl border border-border bg-card-bg sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumo do período">
          <div className="p-5"><p className="text-xs text-text-muted">Período selecionado</p><p className="mt-2 font-semibold tabular-nums">{displayDate(bounds.start)} – {displayDate(bounds.end)}</p></div>
          <div className="border-t border-border p-5 sm:border-l sm:border-t-0"><p className="text-xs text-text-muted">Plantões</p><p className="mt-2 text-2xl font-semibold tabular-nums">{periodShifts.length}</p></div>
          <div className="border-t border-border p-5 lg:border-l lg:border-t-0"><p className="text-xs text-text-muted">Médicos regulares</p><p className="mt-2 text-2xl font-semibold tabular-nums text-success">{regularDoctors}<span className="text-sm font-normal text-text-muted">/{doctors.length}</span></p></div>
          <div className="border-t border-border p-5 sm:border-l lg:border-t-0"><p className="text-xs text-text-muted">Pendências documentais</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${compliance.some(item => !item.regular) ? 'text-danger' : 'text-success'}`}>{compliance.filter(item => !item.regular).length}</p></div>
        </section>

        {lastExport && <p role="status" className="flex items-center gap-2 text-sm text-primary"><CheckCircle2 size={16}/>{lastExport}</p>}

        <div className={`grid gap-8 ${canSeeFinancial ? 'xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]' : ''}`}>
          <section><div className="border-b border-border pb-3"><h2 className="font-semibold">Exportações operacionais</h2><p className="mt-1 text-sm text-text-muted">Os plantões respeitam período e unidade. Médicos e documentos respeitam a unidade selecionada.</p></div>
            <ExportRow icon={CalendarRange} title="Plantões médicos" description="Escala detalhada com unidade, setor, especialidade, vínculo e situação." count={periodShifts.length} onExport={exportShifts}/>
            <ExportRow icon={Users} title="Lista de médicos" description="Corpo clínico, contatos, CRM, especialidade e unidades vinculadas." count={doctors.length} onExport={exportDoctors}/>
            <ExportRow icon={ShieldCheck} title="Conformidade documental" description="Médicos regulares e pendentes, incluindo cada documento que exige ação." count={compliance.length} onExport={exportCompliance}/>
          </section>

          {canSeeFinancial && <section><div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3"><div><h2 className="font-semibold">Financeiro por médico</h2><p className="mt-1 text-sm text-text-muted">Valores registrados nos plantões do período selecionado.</p></div><div className="flex gap-2"><button className="nv-button-secondary" onClick={exportDoctorSummary} disabled={!doctorFinancials.length}><Download size={14}/>Resumo</button><button className="nv-button-secondary" onClick={exportFinancial} disabled={!financialShifts.length}><Download size={14}/>Detalhado</button></div></div>
            <div className="grid grid-cols-3 border-b border-border"><div className="py-4"><p className="text-xs text-text-muted">Total previsto</p><p className="mt-1 font-semibold tabular-nums">{money(totalAmount)}</p></div><div className="border-l border-border px-4 py-4"><p className="text-xs text-text-muted">Pago</p><p className="mt-1 font-semibold tabular-nums text-success">{money(paidAmount)}</p></div><div className="border-l border-border pl-4 py-4"><p className="text-xs text-text-muted">Pendente</p><p className="mt-1 font-semibold tabular-nums text-warning">{money(pendingAmount)}</p></div></div>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-[10px] uppercase tracking-wider text-text-muted"><tr><th className="py-3 pr-4">Médico</th><th className="p-3 text-right">Plantões</th><th className="p-3 text-right">Pago</th><th className="py-3 pl-4 text-right">Pendente</th></tr></thead><tbody className="divide-y divide-border">{doctorFinancials.map(item => <tr key={item.doctor.id}><td className="py-3 pr-4"><span className="block font-medium">{item.doctor.name}</span><span className="text-xs text-text-muted">{item.doctor.crm}-{item.doctor.crmUf}</span></td><td className="p-3 text-right tabular-nums">{item.shifts}</td><td className="p-3 text-right tabular-nums text-success">{money(item.paid)}</td><td className="py-3 pl-4 text-right tabular-nums text-warning">{money(item.pending)}</td></tr>)}{!doctorFinancials.length && <tr><td colSpan={4} className="py-10 text-center text-sm text-text-muted"><Banknote className="mx-auto mb-2 h-5 w-5"/>Nenhum plantão com médico neste período.</td></tr>}</tbody></table></div>
            {financialShifts.some(item => !item.paymentAmount) && <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0"/>Há plantões sem valor informado. Edite esses plantões na escala para completar o relatório.</p>}
          </section>}
        </div>

        <p className="flex items-center gap-2 text-xs text-text-muted"><Building2 size={14}/>{organization?.name || 'Empresa'} · dados atualizados conforme os registros atuais do NV Med.</p>
      </div>
    </AccessGuard>
  );
}
