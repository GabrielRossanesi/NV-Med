'use client';

import { use, useState } from 'react';
import { useStore } from '@/store/useStore';
import { DocumentStatus, DocumentType, DoctorStatus } from '@/types';
import {
  ArrowLeft,
  Calendar,
  Building,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileText,
  Upload,
  ShieldCheck,
  MapPin,
  Mail,
  Phone,
  FileCheck
} from 'lucide-react';
import Link from 'next/link';

export default function DoctorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const doctorId = resolvedParams.id;

  const {
    activeOrganizationId,
    doctors,
    units,
    shifts,
    documents,
    updateDoctor,
    uploadDocument,
    updateDocumentStatus
  } = useStore();

  const doctor = doctors.find((d) => d.id === doctorId && d.organizationId === activeOrganizationId);
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId);
  const docShifts = shifts.filter((s) => s.doctorId === doctorId && s.organizationId === activeOrganizationId);
  const docDocs = documents.filter((d) => d.doctorId === doctorId && d.organizationId === activeOrganizationId);

  const [selectedFileNames, setSelectedFileNames] = useState<Record<string, string>>({});

  if (!doctor) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Médico não encontrado</h3>
        <p className="text-sm text-slate-400 mt-1">O registro procurado não pertence a esta empresa ou foi apagado.</p>
        <Link href="/medicos" className="mt-4 inline-flex items-center gap-1 text-teal-500 hover:underline text-xs font-semibold">
          <ArrowLeft className="h-4 w-4" />
          Voltar para listagem
        </Link>
      </div>
    );
  }

  // Handle status update of the doctor
  const handleDoctorStatusChange = (newStatus: DoctorStatus) => {
    updateDoctor({ ...doctor, status: newStatus });
  };

  // Handle mock file selection
  const handleFileChange = (type: DocumentType, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFileNames((prev) => ({ ...prev, [type]: file.name }));
    }
  };

  // Trigger simulated upload
  const handleUpload = (type: DocumentType) => {
    const fileName = selectedFileNames[type] || 'documento_enviado.pdf';
    uploadDocument(doctorId, type, fileName);
    // Clear filename selection
    setSelectedFileNames((prev) => {
      const copy = { ...prev };
      delete copy[type];
      return copy;
    });
  };

  // Get status color mappings
  const docStatusColors: Record<DocumentStatus, string> = {
    approved: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/20',
    analyzing: 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/20',
    expired: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/20',
    rejected: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/20',
    sent: 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/20',
    not_sent: 'bg-slate-50 dark:bg-slate-950 text-slate-400 border border-slate-200 dark:border-slate-800',
  };

  const docStatusLabels: Record<DocumentStatus, string> = {
    approved: 'Aprovado',
    analyzing: 'Em Análise',
    expired: 'Vencido',
    rejected: 'Reprovado',
    sent: 'Recebido',
    not_sent: 'Não Enviado',
  };

  // Doctor status toggle button classes
  const getBtnClass = (s: DoctorStatus) => {
    const activeColors = {
      active: 'bg-emerald-500 text-white shadow-md border-emerald-500',
      pending: 'bg-amber-500 text-white shadow-md border-amber-500',
      inactive: 'bg-slate-600 text-white shadow-md border-slate-600'
    };
    const inactiveColors = 'bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900';
    return `px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-all ${doctor.status === s ? activeColors[s] : inactiveColors}`;
  };

  // Find linked units
  const linkedUnitsList = orgUnits.filter((u) => doctor.linkedUnits.includes(u.id));

  // Sort doctor shifts
  const sortedShifts = [...docShifts]
    .filter((s) => s.status !== 'cancelled')
    .sort((a, b) => b.date.localeCompare(a.date)) // newest first
    .slice(0, 5);

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Back navigation */}
      <div>
        <Link href="/medicos" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-xs font-semibold mb-2">
          <ArrowLeft className="h-4 w-4" />
          Voltar para listagem
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{doctor.name}</h2>
            <p className="text-xs text-slate-400 mt-1">CRM: {doctor.crm}-{doctor.crmUf} • Cadastro: {doctor.status.toUpperCase()}</p>
          </div>
          
          {/* Quick status admin toggler */}
          <div className="flex flex-wrap gap-2 items-center bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 mr-1.5 block">Status Geral:</span>
            <button onClick={() => handleDoctorStatusChange('active')} className={getBtnClass('active')}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Ativo
            </button>
            <button onClick={() => handleDoctorStatusChange('pending')} className={getBtnClass('pending')}>
              <Clock className="h-3.5 w-3.5" />
              Pendente
            </button>
            <button onClick={() => handleDoctorStatusChange('inactive')} className={getBtnClass('inactive')}>
              <AlertCircle className="h-3.5 w-3.5" />
              Inativo
            </button>
          </div>
        </div>
      </div>

      {/* Main layout grids */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Columns (Profile + Units + Shifts) */}
        <div className="lg:col-span-1 space-y-6">
          {/* Profile details */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6 space-y-4">
            <div className="flex items-center gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="h-10 w-10 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold text-lg">
                {doctor.name.charAt(4)}
              </div>
              <div>
                <p className="font-bold text-slate-950 dark:text-white leading-tight">{doctor.name}</p>
                <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold mt-0.5">{doctor.specialty}</p>
              </div>
            </div>

            <div className="space-y-3.5 text-xs text-slate-600 dark:text-slate-350">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-slate-400 uppercase font-bold">Documentos Pessoais</span>
                  <span className="font-mono">CRM: {doctor.crm}-{doctor.crmUf}</span>
                  <span className="block font-mono mt-0.5">CPF: {doctor.cpf}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Mail className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-slate-400 uppercase font-bold">E-mail</span>
                  <span className="break-all">{doctor.email}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Phone className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-slate-400 uppercase font-bold">Telefone</span>
                  <span>{doctor.phone}</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 text-slate-400 flex-shrink-0" />
                <div>
                  <span className="block text-[10px] text-slate-400 uppercase font-bold">Endereço Residencial</span>
                  <span>{doctor.address}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Linked units list */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Building className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              Unidades Vinculadas
            </h3>
            <div className="space-y-2">
              {linkedUnitsList.map((u) => (
                <div key={u.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-800 flex items-center justify-between text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{u.name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{u.city} - {u.state} • {u.type.toUpperCase()}</p>
                  </div>
                </div>
              ))}
              {linkedUnitsList.length === 0 && (
                <p className="text-xs text-slate-450 italic text-center py-4">Sem vínculos cadastrados.</p>
              )}
            </div>
          </div>

          {/* Doctor plantões */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-5">
            <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-teal-600 dark:text-teal-400" />
              Plantões Recentes
            </h3>
            <div className="space-y-3">
              {sortedShifts.length > 0 ? (
                sortedShifts.map((shift) => {
                  const unit = orgUnits.find((u) => u.id === shift.unitId);
                  return (
                    <div key={shift.id} className="flex justify-between items-center text-xs pb-3 last:pb-0 last:border-b-0 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <p className="font-semibold text-slate-850 dark:text-slate-200">{unit?.name}</p>
                        <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <span>{new Date(shift.date).toLocaleDateString('pt-BR')}</span>
                          <span>•</span>
                          <span>{shift.startTime} - {shift.endTime}</span>
                        </p>
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        shift.status === 'confirmed'
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : shift.status === 'completed'
                          ? 'bg-blue-500/10 text-blue-500'
                          : 'bg-amber-500/10 text-amber-600'
                      }`}>
                        {shift.status === 'confirmed' ? 'Confirmado' : shift.status === 'completed' ? 'Concluido' : 'Pendente'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-slate-450 italic text-center py-4">Nenhum plantão recente registrado.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Columns (Required Document Checklist) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
            <div className="pb-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <FileCheck className="h-4.5 w-4.5 text-teal-600 dark:text-teal-400" />
                  Pasta de Documentos Obrigatórios
                </h3>
                <p className="text-[11px] text-slate-400">Verifique a validade e gerencie a documentação do CRM do médico.</p>
              </div>
            </div>

            {/* Checklist items */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800 mt-4">
              {docDocs.map((doc) => {
                const fileNameInputKey = doc.type;
                const isSelected = !!selectedFileNames[fileNameInputKey];

                return (
                  <div key={doc.id} className="py-5 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1.5 md:max-w-md">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-slate-450 flex-shrink-0" />
                        <h4 className="font-semibold text-xs text-slate-900 dark:text-white leading-snug">{doc.name}</h4>
                      </div>
                      
                      {doc.fileName && (
                        <div className="text-[10px] text-slate-500 flex flex-col sm:flex-row sm:gap-4 gap-1 pl-6">
                          <span className="truncate max-w-[200px] font-mono">Arquivo: {doc.fileName}</span>
                          {doc.uploadDate && <span>Envio: {new Date(doc.uploadDate).toLocaleDateString('pt-BR')}</span>}
                          {doc.expiryDate && <span>Validade: {new Date(doc.expiryDate).toLocaleDateString('pt-BR')}</span>}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pl-6 md:pl-0">
                      {/* Document Status Badge */}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${docStatusColors[doc.status]}`}>
                        {docStatusLabels[doc.status]}
                      </span>

                      {/* Document Action Simulator */}
                      <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-950 p-1.5 rounded-lg border border-slate-200 dark:border-slate-800">
                        {/* If not sent, let them simulate mock select and upload */}
                        {doc.status === 'not_sent' || doc.status === 'expired' || doc.status === 'rejected' ? (
                          <div className="flex items-center gap-1.5">
                            <label className="cursor-pointer bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-350 dark:border-slate-800 rounded px-2.5 py-1 text-[10px] font-bold flex items-center gap-1">
                              <Upload className="h-3 w-3" />
                              Selecionar
                              <input
                                type="file"
                                className="hidden"
                                accept=".pdf,.png,.jpg"
                                onChange={(e) => handleFileChange(doc.type, e)}
                              />
                            </label>
                            
                            {isSelected && (
                              <button
                                onClick={() => handleUpload(doc.type)}
                                className="bg-teal-500 hover:bg-teal-600 text-white rounded px-2.5 py-1 text-[10px] font-bold"
                              >
                                Enviar
                              </button>
                            )}
                          </div>
                        ) : (
                          // If document is sent/analyzing/approved, provide immediate administrative triggers to approve/reject
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => updateDocumentStatus(doc.id, 'approved')}
                              className="text-[9px] bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold px-2 py-1 rounded"
                            >
                              Aprovar
                            </button>
                            <button
                              onClick={() => updateDocumentStatus(doc.id, 'rejected')}
                              className="text-[9px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-500 font-bold px-2 py-1 rounded"
                            >
                              Reprovar
                            </button>
                            <button
                              onClick={() => updateDocumentStatus(doc.id, 'expired')}
                              className="text-[9px] bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-bold px-2 py-1 rounded"
                            >
                              Expirar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
