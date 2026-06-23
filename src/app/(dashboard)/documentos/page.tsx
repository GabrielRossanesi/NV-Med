'use client';

import { useState, Suspense } from 'react';
import { useStore } from '@/store/useStore';
import { useSearchParams } from 'next/navigation';
import { DocumentStatus, DocumentType } from '@/types';
import AccessGuard from '@/components/AccessGuard';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  ThumbsUp,
  ThumbsDown,
  User,
  ShieldCheck
} from 'lucide-react';
import Link from 'next/link';

function DocumentsPageContent() {
  const {
    activeOrganizationId,
    doctors,
    documents,
    updateDocumentStatus
  } = useStore();

  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);
  const orgDocs = documents.filter((d) => d.organizationId === activeOrganizationId);

  const searchParams = useSearchParams();
  const urlDoctorId = searchParams?.get('doctorId') || 'all';
  const urlStatus = searchParams?.get('status') || 'all';

  // Check if filtered doctor belongs to current company
  const doctorExistsInOrg = urlDoctorId === 'all' || orgDoctors.some(d => d.id === urlDoctorId);
  const initialDoctorId = doctorExistsInOrg ? urlDoctorId : 'invalid';

  // Filters State
  const [filterDocType, setFilterDocType] = useState('all');
  const [filterStatus, setFilterStatus] = useState(urlStatus);
  const [filterDocName, setFilterDocName] = useState(initialDoctorId);

  // Sync state if search parameters or organization changes
  const [prevUrlParams, setPrevUrlParams] = useState({
    status: urlStatus,
    doctorId: urlDoctorId,
    orgId: activeOrganizationId
  });

  if (
    urlStatus !== prevUrlParams.status ||
    urlDoctorId !== prevUrlParams.doctorId ||
    activeOrganizationId !== prevUrlParams.orgId
  ) {
    const exists = urlDoctorId === 'all' || orgDoctors.some(d => d.id === urlDoctorId);
    const nextDoctorId = exists ? urlDoctorId : 'invalid';

    setPrevUrlParams({
      status: urlStatus,
      doctorId: urlDoctorId,
      orgId: activeOrganizationId
    });
    setFilterStatus(urlStatus);
    setFilterDocName(nextDoctorId);
  }



  // Filtered documents
  const filteredDocs = filterDocName === 'invalid' ? [] : orgDocs.filter((doc) => {
    const matchesDoctor = filterDocName === 'all' || doc.doctorId === filterDocName;
    const matchesType = filterDocType === 'all' || doc.type === filterDocType;
    
    let matchesStatus = false;
    if (filterStatus === 'all') {
      matchesStatus = true;
    } else if (filterStatus === 'critical') {
      // Critical documents include expired, rejected, analyzing, sent and not_sent
      matchesStatus = doc.status === 'expired' || doc.status === 'rejected' || doc.status === 'analyzing' || doc.status === 'sent' || doc.status === 'not_sent';
    } else {
      matchesStatus = doc.status === filterStatus;
    }

    return matchesDoctor && matchesType && matchesStatus;
  });

  // Sort filtered documents to display critical ones first
  const statusOrder: Record<string, number> = {
    expired: 1,
    rejected: 2,
    not_sent: 3,
    sent: 4,
    analyzing: 5,
    approved: 6,
  };

  const sortedFilteredDocs = [...filteredDocs].sort((a, b) => {
    const orderA = statusOrder[a.status] || 99;
    const orderB = statusOrder[b.status] || 99;
    return orderA - orderB;
  });

  // Calculate audit statistics
  const totalDocs = orgDocs.length;
  const approvedDocs = orgDocs.filter((d) => d.status === 'approved').length;
  const expiredDocs = orgDocs.filter((d) => d.status === 'expired').length;
  const analyzingDocs = orgDocs.filter((d) => d.status === 'analyzing' || d.status === 'sent').length;

  const docTypeLabels: Record<DocumentType, string> = {
    rg_cnh: 'RG/CNH',
    diploma_medicina: 'Diploma de Medicina',
    diploma_residencia: 'Diploma de Residência/Pós-graduação',
    comprovante_residencia: 'Comprovante de endereço residencial',
    certidao_crm_etica: 'Certidão Ética CRM',
    certidao_crm_financeira: 'Certidão Financeira CRM',
  };

  const statusLabels: Record<DocumentStatus, string> = {
    approved: 'Aprovado',
    analyzing: 'Em Análise',
    expired: 'Vencido',
    rejected: 'Reprovado',
    sent: 'Recebido',
    not_sent: 'Não Enviado',
  };

  const statusBadgeColors: Record<DocumentStatus, string> = {
    approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
    analyzing: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
    expired: 'bg-red-500/10 text-red-650 dark:text-red-400 border border-red-500/20',
    rejected: 'bg-amber-500/10 text-amber-600 dark:text-amber-450 border border-amber-500/20',
    sent: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20',
    not_sent: 'bg-surface-muted text-text-muted border border-border',
  };

  const isNearExpiry = (expiryDate?: string) => {
    if (!expiryDate) return false;
    const diffTime = new Date(expiryDate).getTime() - new Date('2026-06-21').getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 && diffDays <= 30;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-text-primary tracking-tight">Compliance & Documentação</h2>
        <p className="text-sm text-text-muted mt-1">
          Painel centralizado de auditoria documental do CRM para verificação de conformidade jurídica.
        </p>
      </div>

      {orgDocs.length === 0 ? (
        <div className="bg-card-bg border border-card-border rounded-xl p-12 text-center max-w-xl mx-auto space-y-6 my-8">
          <div className="h-16 w-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
            <FileText className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-text-primary">Nenhum Documento Cadastrado</h3>
            <p className="text-xs text-text-muted mt-2 max-w-md mx-auto">
              Nenhum médico foi cadastrado ou nenhum arquivo foi enviado ainda para verificação de compliance.
            </p>
          </div>
          <Link
            href="/medicos"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-text-inverse rounded-xl font-semibold text-xs transition duration-200 cursor-pointer shadow-glow-primary mx-auto"
          >
            Cadastrar primeiro médico
          </Link>
        </div>
      ) : (
        <>
          {/* Audit Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* Total Documents */}
            <div className="bg-card-bg p-4 rounded-xl border border-card-border flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">Total de Documentos</span>
                <h4 className="text-xl font-bold text-text-primary mt-0.5">{totalDocs}</h4>
              </div>
              <FileText className="h-5 w-5 text-text-muted" />
            </div>

            {/* Approved */}
            <div className="bg-card-bg p-4 rounded-xl border border-card-border flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">Aprovados</span>
                <h4 className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{approvedDocs}</h4>
              </div>
              <CheckCircle className="h-5 w-5 text-emerald-500" />
            </div>

            {/* Expired */}
            <div className="bg-card-bg p-4 rounded-xl border border-card-border flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">Vencidos / Irregulares</span>
                <h4 className="text-xl font-bold text-red-600 dark:text-red-400 mt-0.5">{expiredDocs}</h4>
              </div>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>

            {/* Pending Review */}
            <div className="bg-card-bg p-4 rounded-xl border border-card-border flex items-center justify-between">
              <div>
                <span className="text-[9px] uppercase font-bold text-text-muted tracking-wider">Aguardando Análise</span>
                <h4 className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-0.5">{analyzingDocs}</h4>
              </div>
              <Clock className="h-5 w-5 text-blue-500" />
            </div>
          </div>

          {/* Filter strip */}
          <div className="bg-card-bg p-4 rounded-xl border border-card-border grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Doctor selector */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Filtrar por Médico</label>
              <select
                value={filterDocName}
                onChange={(e) => setFilterDocName(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todos os Médicos</option>
                {orgDoctors.map((doc) => (
                  <option key={doc.id} value={doc.id}>{doc.name}</option>
                ))}
              </select>
            </div>

            {/* Document type */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Tipo de Documento</label>
              <select
                value={filterDocType}
                onChange={(e) => setFilterDocType(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todos os Tipos</option>
                {Object.entries(docTypeLabels).map(([type, label]) => (
                  <option key={type} value={type}>{label}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div className="space-y-1">
              <label className="text-[9px] uppercase font-bold text-text-muted">Filtrar por Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none"
              >
                <option value="all">Todos os Status</option>
                <option value="critical">Crítico (Pendentes / Irregulares)</option>
                {Object.entries(statusLabels).map(([status, label]) => (
                  <option key={status} value={status}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Warning: Doctor not found in this company */}
          {filterDocName === 'invalid' && (
            <div className="bg-danger/10 border border-danger/20 p-4 rounded-xl flex items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="text-xs text-danger font-medium flex items-center gap-2">
                <span>⚠️</span>
                <span>Médico não encontrado nesta empresa.</span>
              </div>
              <button
                onClick={() => {
                  setFilterDocName('all');
                  window.history.pushState({}, '', '/documentos');
                }}
                className="text-xs font-bold text-danger hover:underline cursor-pointer font-semibold"
              >
                ✕ Limpar Filtro
              </button>
            </div>
          )}

          {/* Active Filters Summary Banner */}
          {filterDocName !== 'invalid' && (filterStatus !== 'all' || filterDocName !== 'all' || filterDocType !== 'all') && (
            <div className="bg-primary/5 border border-primary/20 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in duration-200">
              <div className="text-xs text-text-secondary">
                <span className="font-bold text-primary mr-1">Filtros Ativos: </span>
                {filterDocName !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Médico: {orgDoctors.find(d => d.id === filterDocName)?.name}
                  </span>
                )}
                {filterStatus !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Status: {filterStatus === 'critical' ? 'Crítico (Vencidos / Pendentes)' : statusLabels[filterStatus as DocumentStatus]}
                  </span>
                )}
                {filterDocType !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Tipo: {docTypeLabels[filterDocType as DocumentType]}
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setFilterStatus('all');
                  setFilterDocName('all');
                  setFilterDocType('all');
                  // Clear URL query parameters
                  window.history.pushState({}, '', '/documentos');
                }}
                className="text-xs font-bold text-primary hover:underline hover:text-primary-hover flex items-center gap-1 self-start sm:self-auto cursor-pointer"
              >
                ✕ Limpar Filtros
              </button>
            </div>
          )}

          {/* Audit Table list */}
          <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/30 text-[10px] uppercase font-bold text-text-muted tracking-wider">
                    <th className="p-4">Médico</th>
                    <th className="p-4">Tipo de Documento</th>
                    <th className="p-4">Nome do Arquivo</th>
                    <th className="p-4">Validade</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-center">Ações Rápidas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  {sortedFilteredDocs.length > 0 ? (
                    sortedFilteredDocs.map((doc) => {
                      const physician = orgDoctors.find((d) => d.id === doc.doctorId);
                      const isExpired = doc.status === 'expired';
                      const isNear = isNearExpiry(doc.expiryDate);

                      return (
                        <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10 transition">
                          <td className="p-4 font-semibold text-text-primary">
                            <Link href={`/medicos/${doc.doctorId}`} className="hover:underline flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-text-muted" />
                              {physician?.name}
                            </Link>
                          </td>
                          <td className="p-4 font-medium text-text-secondary">
                            {docTypeLabels[doc.type] || doc.name}
                          </td>
                          <td className="p-4 font-mono text-[10px] text-text-muted">
                            {doc.fileName ? (
                              <span className="truncate max-w-[200px] block" title={doc.fileName}>{doc.fileName}</span>
                            ) : (
                              <span className="italic text-text-muted">Pendente de Upload</span>
                            )}
                          </td>
                          <td className="p-4">
                            {doc.expiryDate ? (
                              <span className={`font-mono ${
                                isExpired
                                  ? 'text-red-500 font-bold'
                                  : isNear
                                  ? 'text-amber-500 font-bold animate-pulse'
                                  : 'text-text-secondary'
                              }`}>
                                {new Date(doc.expiryDate).toLocaleDateString('pt-BR')}
                                {isNear && <span className="block text-[8px] uppercase tracking-wider text-amber-500 font-semibold mt-0.5">Vence em breve</span>}
                                {isExpired && <span className="block text-[8px] uppercase tracking-wider text-red-500 font-semibold mt-0.5">Vencido</span>}
                              </span>
                            ) : (
                              <span className="text-text-muted font-mono">Sem validade</span>
                            )}
                          </td>
                          <td className="p-4">
                            <span className={`px-2.5 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider ${statusBadgeColors[doc.status]}`}>
                              {statusLabels[doc.status]}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-center gap-1">
                              {doc.status !== 'not_sent' ? (
                                <>
                                  <button
                                    onClick={() => updateDocumentStatus(doc.id, 'approved')}
                                    className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition cursor-pointer"
                                    title="Aprovar Documento"
                                  >
                                    <ThumbsUp className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => updateDocumentStatus(doc.id, 'rejected')}
                                    className="p-1 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition cursor-pointer"
                                    title="Reprovar Documento"
                                  >
                                    <ThumbsDown className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              ) : (
                                <span className="text-[10px] text-text-muted italic">Upload pendente</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-text-muted">
                        Nenhum documento com os filtros ativos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Regulatory Tip Banner */}
      <div className="p-4 rounded-xl bg-surface-muted border border-border flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1 text-text-muted">
          <p className="font-semibold text-text-primary">Manual de Boas Práticas do CRM</p>
          <p>
            O Conselho Federal de Medicina (CFM) exige a manutenção de pastas cadastrais individuais atualizadas para todo médico plantonista ativo em pronto atendimento. Documentos como a Certidão Ética do CRM devem ser reavaliados anualmente para prevenir atuações sob restrição de registro ético.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <AccessGuard requiredPermission="documentos">
      <Suspense fallback={
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
        </div>
      }>
        <DocumentsPageContent />
      </Suspense>
    </AccessGuard>
  );
}
