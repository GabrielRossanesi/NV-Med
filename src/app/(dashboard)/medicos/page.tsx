'use client';

import { useId, useState, Suspense } from 'react';
import { useStore } from '@/store/useStore';
import { useSearchParams } from 'next/navigation';
import { DoctorStatus } from '@/types';
import {
  Search,
  Plus,
  Building,
  CheckCircle,
  Clock,
  XCircle,
  Eye,
  Trash2,
  AlertTriangle,
  FileCheck2
} from 'lucide-react';
import AccessGuard from '@/components/AccessGuard';
import { useConfirmation } from '@/components/ConfirmationProvider';
import Dialog from '@/components/Dialog';
import { canPerformAction } from '@/lib/permissions';
import Link from 'next/link';
import { getDoctorCompliance } from '@/lib/documentCompliance';
import { getDocumentGovernance } from '@/lib/documentGovernance';
import { doctorContractModelShortLabels } from '@/lib/doctorProfile';
import { doctorHasOperationalUnit, getDoctorOperationalUnitIds } from '@/lib/doctorUnits';
import DoctorBankingFields from '@/components/DoctorBankingFields';
import { bankingFromForm } from '@/lib/doctorBanking';
import DoctorProfileFields, { doctorProfileFromForm } from '@/components/DoctorProfileFields';
import { matchesDoctorSearch } from '@/lib/doctorName';

function DoctorsPageContent() {
  const confirm = useConfirmation();
  const {
    activeOrganizationId,
    currentUser,
    organizations,
    doctors,
    documents,
    units,
    shifts,
    addDoctor,
    deleteDoctor
  } = useStore();

  const canCreate = canPerformAction(currentUser, 'medicos', 'create');
  const canCreateBanking = canPerformAction(currentUser, 'dados_bancarios', 'edit');
  const canDelete = canPerformAction(currentUser, 'medicos', 'delete');
  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const documentGovernance = getDocumentGovernance(activeOrg);
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId);
  const orgShifts = shifts.filter((shift) => shift.organizationId === activeOrganizationId);
  
  // Filter doctors by active organization
  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);

  const searchParams = useSearchParams();
  const urlSpecialty = searchParams?.get('especialidade') || searchParams?.get('specialty') || 'all';
  const urlStatus = searchParams?.get('status') || 'all';
  const urlUnit = searchParams?.get('unitId') || 'all';
  const urlDocumentStatus = searchParams?.get('documentStatus') || 'all';

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(urlStatus);
  const [specialtyFilter, setSpecialtyFilter] = useState<string>(urlSpecialty);
  const [unitFilter, setUnitFilter] = useState<string>(urlUnit);
  const [documentFilter, setDocumentFilter] = useState<string>(urlDocumentStatus);
  const [referenceTime] = useState(() => Date.now());
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sync state if search parameters or organization changes
  const [prevUrlParams, setPrevUrlParams] = useState({
    specialty: urlSpecialty,
    status: urlStatus,
    orgId: activeOrganizationId
  });

  if (
    urlSpecialty !== prevUrlParams.specialty ||
    urlStatus !== prevUrlParams.status ||
    activeOrganizationId !== prevUrlParams.orgId
  ) {
    setPrevUrlParams({
      specialty: urlSpecialty,
      status: urlStatus,
      orgId: activeOrganizationId
    });
    setSpecialtyFilter(urlSpecialty);
    setStatusFilter(urlStatus);
  }


  const createFormId = useId();
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const orgDocuments = documents.filter(document => document.organizationId === activeOrganizationId);

  // Filtered doctors list
  const filteredDoctors = orgDoctors.filter((doc) => {
    const matchesSearch = matchesDoctorSearch(doc, search);

    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
    const matchesSpecialty = specialtyFilter === 'all' || doc.specialty.toLowerCase() === specialtyFilter.toLowerCase();
    const matchesUnit = unitFilter === 'all' || doctorHasOperationalUnit(orgShifts, doc.id, unitFilter);
    const operationalDoctor = { ...doc, linkedUnits: getDoctorOperationalUnitIds(orgShifts, doc.id) };
    const documentSummary = getDoctorCompliance(operationalDoctor, orgDocuments, referenceTime, activeOrg?.settings.requiredDocuments, Math.max(...documentGovernance.expiryAlertDays));
    const matchesDocuments = documentFilter === 'all' || (documentFilter === 'pending' ? documentSummary.pending > 0 || documentSummary.nearExpiry > 0 : documentSummary.compliant);

    return matchesSearch && matchesStatus && matchesSpecialty && matchesUnit && matchesDocuments;
  });

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canCreate || creating) return;
    setCreateError('');
    const fields = new FormData(e.currentTarget);
    let banking, profile;
    try {
      profile = doctorProfileFromForm(fields);
      banking = canCreateBanking ? bankingFromForm(fields) : undefined;
    }
    catch (failure) { setCreateError((failure as Error).message); return; }
    
    setCreating(true);
    const saved = await addDoctor(profile, banking);
    setCreating(false);
    if (!saved) {
      setCreateError(useStore.getState().error || 'Não foi possível salvar o cadastro. Tente novamente.');
      return;
    }

    setIsModalOpen(false);
  };

  function closeCreateForm() {
    setCreateError('');
    setIsModalOpen(false);
  }

  const handleDelete = (id: string) => {
    if (!canDelete) return;
    void confirm({ title: 'Excluir médico?', description: 'Todos os plantões e documentos vinculados serão apagados.', tone: 'danger', confirmLabel: 'Excluir médico', onConfirm: () => deleteDoctor(id) });
  };

  const getStatusBadge = (status: DoctorStatus) => {
    switch (status) {
      case 'active':
        return (
          <span className="nv-badge bg-success/10 text-success">
            <CheckCircle className="h-3 w-3" />
            Ativo
          </span>
        );
      case 'pending':
        return (
          <span className="nv-badge bg-warning/10 text-warning">
            <Clock className="h-3 w-3" />
            Pendente
          </span>
        );
      case 'inactive':
        return (
          <span className="inline-flex items-center gap-1 bg-surface-muted text-text-muted px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
            <XCircle className="h-3 w-3" />
            Inativo
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="nv-page-title">Médicos</h2>
        <button
          disabled={!canCreate}
          onClick={() => {
            if (canCreate) setIsModalOpen(true);
          }}
          className="bg-primary hover:bg-primary-hover text-text-inverse rounded-xl py-2.5 px-4 font-semibold text-xs flex items-center justify-center gap-2 self-start transition duration-200 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Novo médico
        </button>
      </div>

      {orgDoctors.length === 0 ? (
        <div className="bg-card-bg border border-card-border rounded-xl p-12 text-center max-w-xl mx-auto space-y-6 my-8">
          <h3 className="text-lg font-bold text-text-primary">Nenhum médico cadastrado</h3>
          <button
            disabled={!canCreate}
            onClick={() => {
              if (canCreate) setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-hover text-text-inverse rounded-xl font-semibold text-xs transition duration-200 cursor-pointer shadow-glow-primary mx-auto"
          >
            <Plus className="h-4 w-4" />
            Cadastrar primeiro médico
          </button>
        </div>
      ) : (
        <>
          {/* Filters Bar */}
          <div className="grid gap-3 rounded-xl border border-card-border bg-card-bg p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_160px_170px]">
            {/* Search */}
            <div className="relative w-full md:flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
              <input
                type="text"
                placeholder="Buscar por nome, CRM, RQE ou especialidade..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="nv-input pl-9"
              />
            </div>

            {/* Specialty Filter */}
            <div className="relative w-full">
              <select
                value={specialtyFilter}
                onChange={(e) => setSpecialtyFilter(e.target.value)}
                className="nv-input"
              >
                <option value="all">Todas Especialidades</option>
                {activeOrg?.settings.specialties.map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="relative w-full">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="nv-input"
              >
                <option value="all">Todos Status</option>
                <option value="active">Ativo</option>
                <option value="pending">Pendente</option>
                <option value="inactive">Inativo</option>
              </select>
            </div>

            <div className="relative w-full">
              <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary transition">
                <option value="all">Todas as unidades</option>
                {orgUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </select>
            </div>

            <div className="relative w-full">
              <select value={documentFilter} onChange={(e) => setDocumentFilter(e.target.value)} className="w-full px-3 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary transition">
                <option value="all">Toda documentação</option>
                <option value="pending">Com pendências</option>
                <option value="compliant">Documentação regular</option>
              </select>
            </div>
          </div>

          {/* Active Filters Summary */}
          {(statusFilter !== 'all' || specialtyFilter !== 'all' || unitFilter !== 'all' || documentFilter !== 'all' || search !== '') && (
            <div className="bg-primary/5 border border-primary/20 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in duration-200">
              <div className="text-xs text-text-secondary">
                <span className="font-bold text-primary mr-1">Filtros Ativos:</span>
                {specialtyFilter !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Especialidade: {specialtyFilter}
                  </span>
                )}
                {statusFilter !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Status: {statusFilter === 'active' ? 'Ativo' : statusFilter === 'pending' ? 'Pendente' : 'Inativo'}
                  </span>
                )}
                {unitFilter !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Unidade: {orgUnits.find(unit => unit.id === unitFilter)?.name || 'Selecionada'}
                  </span>
                )}
                {documentFilter !== 'all' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                    Documentação: {documentFilter === 'pending' ? 'Com pendências' : 'Regular'}
                  </span>
                )}
                {search !== '' && (
                  <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5 font-mono">
                    Busca: &quot;{search}&quot;
                  </span>
                )}
              </div>
              <button
                onClick={() => {
                  setStatusFilter('all');
                  setSpecialtyFilter('all');
                  setUnitFilter('all');
                  setDocumentFilter('all');
                  setSearch('');
                  window.history.pushState({}, '', '/medicos');
                }}
                className="text-xs font-bold text-primary hover:underline hover:text-primary-hover flex items-center gap-1 self-start sm:self-auto cursor-pointer"
              >
                ✕ Limpar Filtros
              </button>
            </div>
          )}

          {/* Table grid */}
          <div className="bg-card-bg rounded-xl border border-card-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/30 text-[10px] uppercase font-bold text-text-muted tracking-wider">
                    <th className="p-4">Médico</th>
                    <th className="p-4">CRM / UF</th>
                    <th className="p-4">Especialidade</th>
                    <th className="p-4">Contratação</th>
                    <th className="p-4">Unidades atendidas</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Documentação</th>
                    <th className="p-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-xs">
                  {filteredDoctors.length > 0 ? (
                    filteredDoctors.map((doc) => {
                      const operationalUnitIds = getDoctorOperationalUnitIds(orgShifts, doc.id);
                      const linkedClinics = orgUnits.filter((u) => operationalUnitIds.includes(u.id));
                      const documentSummary = getDoctorCompliance({ ...doc, linkedUnits: operationalUnitIds }, orgDocuments, referenceTime, activeOrg?.settings.requiredDocuments, Math.max(...documentGovernance.expiryAlertDays));

                      return (
                        <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10 transition">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                                {doc.name.charAt(4)}
                              </div>
                              <div>
                                <p className="font-semibold text-text-primary">{doc.name}</p>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 font-mono font-medium text-text-primary">
                            <span className="block">{doc.crm} / {doc.crmUf}</span>
                            {doc.rqe && <span className="mt-1 block text-[10px] font-sans font-normal text-text-muted">RQE {doc.rqe}</span>}
                          </td>
                          <td className="p-4 text-text-secondary">
                            {doc.specialty}
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col items-start gap-1.5">
                              <span className="rounded-md bg-surface-muted px-2 py-1 text-[10px] font-bold text-text-secondary">{doctorContractModelShortLabels[doc.contractModel || 'pf']}</span>
                              <span className={`text-[10px] font-semibold ${doc.contractSigned ? 'text-success' : 'text-warning'}`}>{doc.contractSigned ? 'Contrato assinado' : 'Contrato pendente'}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-wrap gap-1 max-w-xs">
                              {linkedClinics.map((lc) => (
                                <span key={lc.id} className="inline-flex items-center gap-0.5 bg-background border border-card-border px-1.5 py-0.5 rounded text-[10px] text-text-secondary">
                                  <Building className="h-2.5 w-2.5 flex-shrink-0" />
                                  {lc.name.replace('Pronto Atendimento ', 'P.A. ').replace('Hospital ', 'Hosp. ').replace('Clínica ', 'Clín. ')}
                                </span>
                              ))}
                              {linkedClinics.length === 0 && (
                                <span className="text-[10px] text-text-muted italic">Sem plantões</span>
                              )}
                            </div>
                          </td>
                          <td className="p-4">
                            {getStatusBadge(doc.status)}
                          </td>
                          <td className="p-4">
                            <Link href={`/documentos/${doc.id}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition hover:opacity-80 ${documentSummary.compliant ? 'bg-success/10 text-success' : documentSummary.critical ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
                              {documentSummary.compliant ? <FileCheck2 className="h-3 w-3"/> : <AlertTriangle className="h-3 w-3"/>}
                              {documentSummary.compliant ? 'Regular' : documentSummary.pending ? `${documentSummary.pending} pendente${documentSummary.pending === 1 ? '' : 's'}` : `${documentSummary.nearExpiry} vencendo`}
                            </Link>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center justify-center gap-2">
                              <Link
                                href={`/medicos/${doc.id}`}
                                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-text-muted hover:text-slate-800 dark:hover:text-slate-200 transition cursor-pointer"
                                title="Ver Perfil Detalhado"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                              <button
                                disabled={!canDelete}
                                onClick={() => handleDelete(doc.id)}
                                className="p-1.5 rounded text-text-muted hover:bg-danger/10 hover:text-danger transition cursor-pointer"
                                title="Excluir"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-text-muted">
                        Nenhum médico encontrado com os filtros ativos.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {isModalOpen && <Dialog title="Cadastrar médico" size="lg" onClose={closeCreateForm} closeDisabled={creating}
        footer={<div className="space-y-2">
          {createError && <p role="alert" className="text-sm text-danger">{createError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="nv-button-secondary" onClick={closeCreateForm} disabled={creating}>Cancelar</button>
            <button type="submit" form={createFormId} className="nv-button" disabled={creating || !canCreate}>{creating ? 'Salvando…' : 'Salvar cadastro'}</button>
          </div>
        </div>}>
        <form id={createFormId} onSubmit={handleSubmit} aria-busy={creating}>
          <fieldset disabled={creating || !canCreate} className="min-w-0 space-y-6">
            <DoctorProfileFields specialties={activeOrg?.settings.specialties || []}/>
            <div className="border-t border-border pt-4">
              {canCreateBanking ? <DoctorBankingFields/> : <section aria-label="Dados bancários" className="space-y-2">
                <h3 className="nv-section-title">Dados bancários</h3>
                <p className="text-sm text-text-muted">O cadastro será salvo como pendente. Um usuário autorizado ou o próprio médico deverá preencher a chave PIX e seu tipo para concluir o cadastro.</p>
              </section>}
            </div>
            <p className="text-xs text-text-muted">O cadastro não cria acesso ao portal nem envia convites. A liberação será individual na página do médico.</p>
          </fieldset>
        </form>
      </Dialog>}
    </div>
  );
}

export default function DoctorsPage() {
  return (
    <AccessGuard requiredPermission="medicos">
      <Suspense fallback={
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
        </div>
      }>
        <DoctorsPageContent />
      </Suspense>
    </AccessGuard>
  );
}
