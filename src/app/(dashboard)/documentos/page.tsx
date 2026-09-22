'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, ChevronRight, FileText, FolderOpen, LayoutGrid, List, Search, ShieldCheck, Users } from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import { doctorMatchesUnit, documentIsCritical, documentIsNearExpiry, documentNeedsAction, documentStatusClasses, documentStatusLabels, documentStatusOrder, getDoctorCompliance } from '@/lib/documentCompliance';
import { getDocumentGovernance, requirementApplies } from '@/lib/documentGovernance';
import { canEditPermission } from '@/lib/permissions';
import type { DocumentStatus } from '@/types';
import { useStore } from '@/store/useStore';

type ViewMode = 'clinical' | 'files';
type ComplianceFilter = 'all' | 'pending' | 'critical' | 'review' | 'compliant';

function DocumentCenter() {
  const searchParams = useSearchParams();
  const store = useStore();
  const { activeOrganizationId, doctors, documents, units, organizations, currentUser } = store;
  const [referenceTime] = useState(() => Date.now());
  const [view, setView] = useState<ViewMode>('clinical');
  const [search, setSearch] = useState('');
  const [unitId, setUnitId] = useState(searchParams.get('unitId') || '');
  const [specialty, setSpecialty] = useState(searchParams.get('specialty') || '');
  const queryStatus = searchParams.get('status');
  const [compliance, setCompliance] = useState<ComplianceFilter>(queryStatus === 'critical' ? 'critical' : queryStatus === 'review' ? 'review' : queryStatus === 'not_sent' ? 'pending' : 'all');
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<DocumentStatus>('analyzing');
  const [bulkNote, setBulkNote] = useState('');
  const doctorId = searchParams.get('doctorId') || '';

  const orgDoctors = useMemo(() => doctors.filter(doctor => doctor.organizationId === activeOrganizationId), [doctors, activeOrganizationId]);
  const orgDocuments = useMemo(() => documents.filter(document => document.organizationId === activeOrganizationId), [documents, activeOrganizationId]);
  const orgUnits = useMemo(() => units.filter(unit => unit.organizationId === activeOrganizationId), [units, activeOrganizationId]);
  const activeOrganization = organizations.find(organization => organization.id === activeOrganizationId);
  const requirements = useMemo(() => activeOrganization?.settings.requiredDocuments || [], [activeOrganization]);
  const governance = getDocumentGovernance(activeOrganization);
  const canEdit = canEditPermission(currentUser, 'documentos');
  const specialties = useMemo(() => [...new Set(orgDoctors.map(doctor => doctor.specialty))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [orgDoctors]);
  const summaries = useMemo(() => new Map(orgDoctors.map(doctor => [doctor.id, getDoctorCompliance(doctor, orgDocuments, referenceTime, requirements, Math.max(...governance.expiryAlertDays))])), [orgDoctors, orgDocuments, referenceTime, requirements, governance.expiryAlertDays]);

  const matchesCompliance = (id: string) => {
    const summary = summaries.get(id);
    if (!summary || compliance === 'all') return true;
    if (compliance === 'critical') return summary.critical > 0;
    if (compliance === 'review') return summary.review > 0;
    if (compliance === 'pending') return summary.pending > 0 || summary.nearExpiry > 0;
    return summary.compliant;
  };

  const filteredDoctors = orgDoctors
    .filter(doctor => !doctorId || doctor.id === doctorId)
    .filter(doctor => !search || `${doctor.name} ${doctor.crm} ${doctor.specialty}`.toLowerCase().includes(search.toLowerCase()))
    .filter(doctor => doctorMatchesUnit(doctor, unitId))
    .filter(doctor => !specialty || doctor.specialty === specialty)
    .filter(doctor => matchesCompliance(doctor.id))
    .sort((a, b) => (summaries.get(b.id)?.critical || 0) - (summaries.get(a.id)?.critical || 0) || (summaries.get(b.id)?.pending || 0) - (summaries.get(a.id)?.pending || 0) || a.name.localeCompare(b.name, 'pt-BR'));

  const filteredDoctorIds = new Set(filteredDoctors.map(doctor => doctor.id));
  const filteredDocuments = orgDocuments
    .filter(document => filteredDoctorIds.has(document.doctorId))
    .filter(document => {
      if (!requirements.length) return true;
      const doctor = orgDoctors.find(item => item.id === document.doctorId);
      const requirement = requirements.find(item => item.type === document.type);
      return Boolean(doctor && requirement && requirementApplies(requirement, doctor));
    })
    .filter(document => compliance !== 'critical' || documentIsCritical(document))
    .filter(document => compliance !== 'review' || document.status === 'sent' || document.status === 'analyzing')
    .filter(document => compliance !== 'pending' || documentNeedsAction(document) || documentIsCritical(document, referenceTime) || documentIsNearExpiry(document, referenceTime, Math.max(...governance.expiryAlertDays)))
    .filter(document => compliance !== 'compliant' || document.status === 'approved')
    .sort((a, b) => documentStatusOrder[a.status] - documentStatusOrder[b.status] || a.name.localeCompare(b.name, 'pt-BR'));

  const pendingDoctors = orgDoctors.filter(doctor => (summaries.get(doctor.id)?.pending || 0) > 0 || (summaries.get(doctor.id)?.nearExpiry || 0) > 0).length;
  const criticalDoctors = orgDoctors.filter(doctor => (summaries.get(doctor.id)?.critical || 0) > 0).length;
  const compliantDoctors = orgDoctors.filter(doctor => summaries.get(doctor.id)?.compliant).length;
  const resetFilters = () => { setSearch(''); setUnitId(''); setSpecialty(''); setCompliance('all'); window.history.replaceState({}, '', '/documentos'); };
  const selectedSet = new Set(selectedDocumentIds);
  const visibleIds = filteredDocuments.map(document => document.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSet.has(id));
  const toggleAllVisible = () => setSelectedDocumentIds(current => allVisibleSelected ? current.filter(id => !visibleIds.includes(id)) : [...new Set([...current, ...visibleIds])]);
  const applyBulkAction = async () => {
    if (!selectedDocumentIds.length) return;
    if (await store.bulkUpdateDocuments(selectedDocumentIds, bulkStatus, bulkNote)) {
      setSelectedDocumentIds([]);
      setBulkNote('');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Compliance clínico</p><h1 className="mt-2 text-2xl font-bold tracking-tight text-text-primary">Documentação médica</h1><p className="mt-1 text-sm text-text-muted">Acompanhe pendências, validade e arquivos por médico, unidade e especialidade.</p></div>
        <div className="inline-flex self-start rounded-xl border border-border bg-card-bg p-1" aria-label="Modo de visualização">
          <button type="button" onClick={() => setView('clinical')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${view === 'clinical' ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-secondary hover:bg-state-hover'}`}><Users size={15}/>Corpo clínico</button>
          <button type="button" onClick={() => setView('files')} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${view === 'files' ? 'bg-primary text-text-inverse shadow-sm' : 'text-text-secondary hover:bg-state-hover'}`}><List size={15}/>Arquivos</button>
        </div>
      </header>

      <section className="grid overflow-hidden rounded-2xl border border-border bg-card-bg sm:grid-cols-2 xl:grid-cols-4" aria-label="Resumo documental">
        <div className="p-5"><p className="text-xs text-text-muted">Corpo clínico</p><p className="mt-2 text-2xl font-semibold tabular-nums">{orgDoctors.length}</p><p className="mt-1 text-[11px] text-text-muted">médicos cadastrados</p></div>
        <div className="border-t border-border p-5 sm:border-l sm:border-t-0"><p className="text-xs text-text-muted">Com pendências</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${pendingDoctors ? 'text-warning' : 'text-success'}`}>{pendingDoctors}</p><p className="mt-1 text-[11px] text-text-muted">exigem acompanhamento</p></div>
        <div className="border-t border-border p-5 xl:border-l xl:border-t-0"><p className="text-xs text-text-muted">Ação imediata</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${criticalDoctors ? 'text-danger' : 'text-success'}`}>{criticalDoctors}</p><p className="mt-1 text-[11px] text-text-muted">vencidos, reprovados ou ausentes</p></div>
        <div className="border-t border-border p-5 sm:border-l xl:border-t-0"><p className="text-xs text-text-muted">Regulares</p><p className="mt-2 text-2xl font-semibold tabular-nums text-success">{compliantDoctors}</p><p className="mt-1 text-[11px] text-text-muted">pastas completas e válidas</p></div>
      </section>

      {criticalDoctors > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-danger/25 bg-danger/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger"/><div><h2 className="text-sm font-semibold text-text-primary">{criticalDoctors} {criticalDoctors === 1 ? 'médico precisa' : 'médicos precisam'} de ação documental</h2><p className="mt-0.5 text-xs text-text-muted">Priorize documentos vencidos, reprovados e ainda não enviados.</p></div></div><button type="button" onClick={() => setCompliance('critical')} className="self-start text-xs font-semibold text-danger hover:underline">Mostrar somente críticos</button></section>}

      <section className="rounded-2xl border border-border bg-card-bg p-4" aria-label="Filtros de documentação">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_1fr_1fr_1fr_auto]">
          <label className="nv-label">Buscar médico<div className="relative mt-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"/><input className="nv-input pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome, CRM ou especialidade"/></div></label>
          <label className="nv-label">Unidade<select className="nv-input" value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">Todas as unidades</option>{orgUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
          <label className="nv-label">Especialidade<select className="nv-input" value={specialty} onChange={event => setSpecialty(event.target.value)}><option value="">Todas</option>{specialties.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="nv-label">Situação<select className="nv-input" value={compliance} onChange={event => setCompliance(event.target.value as ComplianceFilter)}><option value="all">Todas</option><option value="critical">Ação imediata</option><option value="pending">Com pendências</option><option value="review">Em conferência</option><option value="compliant">Regular</option></select></label>
          <button type="button" onClick={resetFilters} className="nv-button-secondary self-end">Limpar</button>
        </div>
      </section>

      {view === 'clinical' ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-card-bg">
          <header className="flex items-center justify-between border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold text-text-primary">Pastas do corpo clínico</h2><p className="mt-0.5 text-xs text-text-muted">{filteredDoctors.length} {filteredDoctors.length === 1 ? 'médico no recorte' : 'médicos no recorte'}</p></div><LayoutGrid size={17} className="text-text-muted"/></header>
          <div className="divide-y divide-border">
            {filteredDoctors.map(doctor => { const summary = summaries.get(doctor.id)!; const linkedUnits = orgUnits.filter(unit => doctor.linkedUnits.includes(unit.id)); const alertLabel = summary.pending ? `${summary.pending} ${summary.pending === 1 ? 'pendência' : 'pendências'}` : `${summary.nearExpiry} perto do vencimento`; return <Link key={doctor.id} href={`/documentos/${doctor.id}`} className="group grid gap-4 px-4 py-4 transition hover:bg-state-hover md:grid-cols-[minmax(220px,1.15fr)_minmax(180px,1fr)_170px_170px_24px] md:items-center"><div className="flex min-w-0 items-center gap-3"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl font-semibold ${summary.critical ? 'bg-danger/10 text-danger' : summary.pending || summary.nearExpiry ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>{doctor.name.split(' ').filter(Boolean).slice(0,2).map(part => part[0]).join('')}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-text-primary group-hover:text-primary">{doctor.name}</p><p className="mt-0.5 text-xs text-text-muted">CRM {doctor.crm}-{doctor.crmUf} · {doctor.specialty}</p></div></div><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Unidades</p><p className="mt-1 truncate text-xs text-text-secondary">{linkedUnits.map(unit => unit.name).join(' · ') || 'Sem unidade vinculada'}</p></div><div><div className="flex items-center justify-between text-[11px]"><span className="text-text-muted">Conformidade</span><span className="font-semibold tabular-nums text-text-primary">{summary.percentage}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className={`h-full rounded-full transition-all duration-500 ${summary.compliant ? 'bg-success' : summary.critical ? 'bg-danger' : 'bg-warning'}`} style={{width:`${summary.percentage}%`}}/></div></div><div>{summary.compliant ? <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"><CheckCircle2 size={13}/>Regular</span> : <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${summary.critical ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}><AlertTriangle size={13}/>{alertLabel}</span>}</div><ChevronRight size={17} className="hidden text-text-muted transition group-hover:translate-x-0.5 group-hover:text-primary md:block"/></Link>; })}
            {!filteredDoctors.length && <div className="py-16 text-center"><FolderOpen className="mx-auto h-7 w-7 text-text-muted"/><p className="mt-3 text-sm font-medium text-text-primary">Nenhuma pasta encontrada</p><p className="mt-1 text-xs text-text-muted">Ajuste os filtros para ampliar o recorte.</p></div>}
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card-bg">
          <header className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-sm font-semibold text-text-primary">Arquivos e requisitos</h2><p className="mt-0.5 text-xs text-text-muted">{filteredDocuments.length} itens documentais · {selectedDocumentIds.length} selecionados</p></div>{canEdit && <div className="flex flex-wrap items-center gap-2"><select aria-label="Situação em lote" className="rounded-lg border border-input-border bg-input-bg px-3 py-2 text-xs" value={bulkStatus} onChange={event => setBulkStatus(event.target.value as DocumentStatus)}><option value="analyzing">Enviar para análise</option><option value="approved">Aprovar</option><option value="rejected">Reprovar</option><option value="expired">Marcar como vencido</option></select><input aria-label="Observação da ação em lote" className="rounded-lg border border-input-border bg-input-bg px-3 py-2 text-xs" placeholder={bulkStatus === 'rejected' ? 'Motivo obrigatório' : 'Observação opcional'} maxLength={1000} value={bulkNote} onChange={event => setBulkNote(event.target.value)}/><button type="button" className="nv-button" disabled={!selectedDocumentIds.length || store.saving || (bulkStatus === 'rejected' && !bulkNote.trim())} onClick={applyBulkAction}>{store.saving ? 'Salvando…' : 'Aplicar em lote'}</button></div>}</header>
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-border bg-surface-muted/50 text-[10px] font-semibold uppercase tracking-wider text-text-muted"><tr>{canEdit && <th className="w-12 px-4 py-3"><input type="checkbox" aria-label="Selecionar documentos visíveis" checked={allVisibleSelected} onChange={toggleAllVisible}/></th>}<th className="px-4 py-3">Documento</th><th className="px-4 py-3">Médico</th><th className="px-4 py-3">Unidade</th><th className="px-4 py-3">Validade</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3 text-right">Pasta</th></tr></thead><tbody className="divide-y divide-border">{filteredDocuments.map(document => { const doctor = orgDoctors.find(item => item.id === document.doctorId); const doctorUnits = orgUnits.filter(unit => doctor?.linkedUnits.includes(unit.id)); return <tr key={document.id} className="transition hover:bg-state-hover">{canEdit && <td className="px-4 py-3"><input type="checkbox" aria-label={`Selecionar ${document.name} de ${doctor?.name || 'médico'}`} checked={selectedSet.has(document.id)} onChange={() => setSelectedDocumentIds(current => current.includes(document.id) ? current.filter(id => id !== document.id) : [...current, document.id])}/></td>}<td className="px-4 py-3"><p className="font-medium text-text-primary">{document.name}</p><p className="mt-0.5 max-w-64 truncate text-xs text-text-muted">{document.fileName || 'Arquivo ainda não enviado'}</p></td><td className="px-4 py-3"><p className="font-medium text-text-primary">{doctor?.name || 'Médico'}</p><p className="mt-0.5 text-xs text-text-muted">{doctor?.specialty}</p></td><td className="px-4 py-3 text-xs text-text-secondary">{doctorUnits.map(unit => unit.name).join(' · ') || '—'}</td><td className="px-4 py-3 text-xs tabular-nums text-text-secondary">{document.expiryDate ? new Date(`${document.expiryDate}T12:00:00`).toLocaleDateString('pt-BR') : 'Sem validade'}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${documentStatusClasses[document.status]}`}>{documentStatusLabels[document.status]}</span>{document.reviewNote && <p className="mt-1 max-w-48 truncate text-[11px] text-text-muted" title={document.reviewNote}>{document.reviewNote}</p>}</td><td className="px-4 py-3 text-right"><Link href={`/documentos/${document.doctorId}`} className="text-xs font-semibold text-primary hover:underline">Abrir pasta</Link></td></tr>; })}</tbody></table></div>
          {!filteredDocuments.length && <div className="py-16 text-center"><FileText className="mx-auto h-7 w-7 text-text-muted"/><p className="mt-3 text-sm font-medium">Nenhum documento encontrado.</p></div>}
        </section>
      )}
      <p className="flex items-center gap-2 text-xs text-text-muted"><ShieldCheck size={14}/>Os arquivos e indicadores exibidos pertencem somente à empresa ativa.</p>
    </div>
  );
}

export default function DocumentsPage() {
  return <AccessGuard requiredPermission="documentos"><Suspense fallback={<div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-primary"/></div>}><DocumentCenter/></Suspense></AccessGuard>;
}
