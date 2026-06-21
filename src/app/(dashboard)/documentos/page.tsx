'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { DocumentStatus, DocumentType } from '@/types';
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

export default function DocumentsPage() {
  const {
    activeOrganizationId,
    doctors,
    documents,
    updateDocumentStatus
  } = useStore();

  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);
  const orgDocs = documents.filter((d) => d.organizationId === activeOrganizationId);

  // Filters State
  const [filterDocType, setFilterDocType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDocName, setFilterDocName] = useState('all'); // specific doctor filter

  // Filtered documents
  const filteredDocs = orgDocs.filter((doc) => {
    const matchesDoctor = filterDocName === 'all' || doc.doctorId === filterDocName;
    const matchesType = filterDocType === 'all' || doc.type === filterDocType;
    const matchesStatus = filterStatus === 'all' || doc.status === filterStatus;

    return matchesDoctor && matchesType && matchesStatus;
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
    comprovante_residencia: 'Comprovante de Endereço',
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
    approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-450 border border-emerald-500/20',
    analyzing: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
    expired: 'bg-red-500/10 text-red-650 dark:text-red-400 border border-red-500/20',
    rejected: 'bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20',
    sent: 'bg-indigo-500/10 text-indigo-650 dark:text-indigo-400 border border-indigo-500/20',
    not_sent: 'bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700',
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Compliance & Documentação</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Painel centralizado de auditoria documental do CRM para verificação de conformidade jurídica.
        </p>
      </div>

      {/* Audit Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Documents */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-450 tracking-wider">Total de Documentos</span>
            <h4 className="text-xl font-bold text-slate-950 dark:text-white mt-0.5">{totalDocs}</h4>
          </div>
          <FileText className="h-5 w-5 text-slate-400" />
        </div>

        {/* Approved */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-450 tracking-wider">Aprovados</span>
            <h4 className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{approvedDocs}</h4>
          </div>
          <CheckCircle className="h-5 w-5 text-emerald-500" />
        </div>

        {/* Expired */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-450 tracking-wider">Vencidos / Irregulares</span>
            <h4 className="text-xl font-bold text-red-650 dark:text-red-400 mt-0.5">{expiredDocs}</h4>
          </div>
          <AlertTriangle className="h-5 w-5 text-red-500" />
        </div>

        {/* Pending Review */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[9px] uppercase font-bold text-slate-450 tracking-wider">Aguardando Análise</span>
            <h4 className="text-xl font-bold text-blue-650 dark:text-blue-400 mt-0.5">{analyzingDocs}</h4>
          </div>
          <Clock className="h-5 w-5 text-blue-500" />
        </div>
      </div>

      {/* Filter strip */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Doctor selector */}
        <div className="space-y-1">
          <label className="text-[9px] uppercase font-bold text-slate-400">Filtrar por Médico</label>
          <select
            value={filterDocName}
            onChange={(e) => setFilterDocName(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-855 rounded-lg text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none"
          >
            <option value="all">Todos os Médicos</option>
            {orgDoctors.map((doc) => (
              <option key={doc.id} value={doc.id}>{doc.name}</option>
            ))}
          </select>
        </div>

        {/* Document type */}
        <div className="space-y-1">
          <label className="text-[9px] uppercase font-bold text-slate-400">Tipo de Documento</label>
          <select
            value={filterDocType}
            onChange={(e) => setFilterDocType(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-855 rounded-lg text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none"
          >
            <option value="all">Todos os Tipos</option>
            {Object.entries(docTypeLabels).map(([type, label]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div className="space-y-1">
          <label className="text-[9px] uppercase font-bold text-slate-400">Filtrar por Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full px-2.5 py-1.5 border border-slate-200 dark:border-slate-855 rounded-lg text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none"
          >
            <option value="all">Todos os Status</option>
            {Object.entries(statusLabels).map(([status, label]) => (
              <option key={status} value={status}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Audit Table list */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                <th className="p-4">Médico</th>
                <th className="p-4">Tipo de Documento</th>
                <th className="p-4">Nome do Arquivo</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Ações Rápidas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-xs">
              {filteredDocs.length > 0 ? (
                filteredDocs.map((doc) => {
                  const physician = orgDoctors.find((d) => d.id === doc.doctorId);

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10 transition">
                      <td className="p-4 font-semibold text-slate-850 dark:text-slate-100">
                        <Link href={`/medicos/${doc.doctorId}`} className="hover:underline flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          {physician?.name}
                        </Link>
                      </td>
                      <td className="p-4 font-medium text-slate-700 dark:text-slate-300">
                        {docTypeLabels[doc.type] || doc.name}
                      </td>
                      <td className="p-4 font-mono text-[10px] text-slate-500">
                        {doc.fileName ? (
                          <span className="truncate max-w-[200px] block" title={doc.fileName}>{doc.fileName}</span>
                        ) : (
                          <span className="italic text-slate-400">Pendente de Upload</span>
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
                                className="p-1 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition"
                                title="Aprovar Documento"
                              >
                                <ThumbsUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => updateDocumentStatus(doc.id, 'rejected')}
                                className="p-1 rounded text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
                                title="Reprovar Documento"
                              >
                                <ThumbsDown className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[10px] text-slate-400 italic">Upload pendente</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-450">
                    Nenhum documento com os filtros ativos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Regulatory Tip Banner */}
      <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-teal-650 dark:text-teal-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs space-y-1 text-slate-500 dark:text-slate-400">
          <p className="font-semibold text-slate-850 dark:text-slate-200">Manual de Boas Práticas do CRM</p>
          <p>
            O Conselho Federal de Medicina (CFM) exige a manutenção de pastas cadastrais individuais atualizadas para todo médico plantonista ativo em pronto atendimento. Documentos como a Certidão Ética do CRM devem ser reavaliados anualmente para prevenir atuações sob restrição de registro ético.
          </p>
        </div>
      </div>
    </div>
  );
}
