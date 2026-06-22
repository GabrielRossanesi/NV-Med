'use client';

import { useState, Suspense } from 'react';
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
  UserCheck
} from 'lucide-react';
import Link from 'next/link';

function DoctorsPageContent() {
  const {
    activeOrganizationId,
    organizations,
    doctors,
    units,
    addDoctor,
    deleteDoctor
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId);
  
  // Filter doctors by active organization
  const orgDoctors = doctors.filter((d) => d.organizationId === activeOrganizationId);

  const searchParams = useSearchParams();
  const urlSpecialty = searchParams?.get('especialidade') || searchParams?.get('specialty') || 'all';
  const urlStatus = searchParams?.get('status') || 'all';

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(urlStatus);
  const [specialtyFilter, setSpecialtyFilter] = useState<string>(urlSpecialty);
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


  // Form state for new doctor
  const [name, setName] = useState('');
  const [crm, setCrm] = useState('');
  const [crmUf, setCrmUf] = useState('SP');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [specialty, setSpecialty] = useState(activeOrg?.settings.specialties[0] || '');
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<DoctorStatus>('active');
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);

  // Filtered doctors list
  const filteredDoctors = orgDoctors.filter((doc) => {
    const matchesSearch =
      doc.name.toLowerCase().includes(search.toLowerCase()) ||
      doc.crm.includes(search) ||
      doc.specialty.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
    const matchesSpecialty = specialtyFilter === 'all' || doc.specialty.toLowerCase() === specialtyFilter.toLowerCase();

    return matchesSearch && matchesStatus && matchesSpecialty;
  });

  const handleUnitToggle = (unitId: string) => {
    setSelectedUnits((prev) =>
      prev.includes(unitId) ? prev.filter((id) => id !== unitId) : [...prev, unitId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    addDoctor({
      name,
      crm,
      crmUf,
      cpf,
      phone,
      email,
      specialty,
      address,
      status,
      linkedUnits: selectedUnits
    });

    // Reset Form
    setName('');
    setCrm('');
    setCrmUf('SP');
    setCpf('');
    setPhone('');
    setEmail('');
    setSpecialty(activeOrg?.settings.specialties[0] || '');
    setAddress('');
    setStatus('active');
    setSelectedUnits([]);
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm('Deseja realmente excluir este médico? Todos os plantões e documentos vinculados serão apagados.')) {
      deleteDoctor(id);
    }
  };

  const getStatusBadge = (status: DoctorStatus) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
            <CheckCircle className="h-3 w-3" />
            Ativo
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
            <Clock className="h-3 w-3 animate-pulse" />
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
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">
            Corpo Clínico (Médicos)
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Cadastro e credenciamento de médicos no tenant ativo.
          </p>
        </div>
        <button
          onClick={() => {
            setSpecialty(activeOrg?.settings.specialties[0] || '');
            setIsModalOpen(true);
          }}
          className="bg-primary hover:bg-primary-hover text-white rounded-xl py-2.5 px-4 font-semibold text-xs flex items-center justify-center gap-2 self-start transition duration-200 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Novo Médico
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-card-bg p-4 rounded-xl border border-card-border flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Buscar por nome, CRM ou especialidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
          />
        </div>

        {/* Specialty Filter */}
        <div className="relative w-full md:w-48">
          <select
            value={specialtyFilter}
            onChange={(e) => setSpecialtyFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
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
        <div className="relative w-full md:w-40">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
          >
            <option value="all">Todos Status</option>
            <option value="active">Ativo</option>
            <option value="pending">Pendente</option>
            <option value="inactive">Inativo</option>
          </select>
        </div>
      </div>

      {/* Active Filters Summary */}
      {(statusFilter !== 'all' || specialtyFilter !== 'all' || search !== '') && (
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
                <th className="p-4">Unidades Vinculadas</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {filteredDoctors.length > 0 ? (
                filteredDoctors.map((doc) => {
                  // Find clinical names linked to this doctor
                  const linkedClinics = orgUnits.filter((u) => doc.linkedUnits.includes(u.id));

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                            {doc.name.charAt(4)}
                          </div>
                          <div>
                            <p className="font-semibold text-text-primary">{doc.name}</p>
                            <p className="text-[10px] text-text-muted">{doc.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-mono font-medium text-text-primary">
                        {doc.crm} / {doc.crmUf}
                      </td>
                      <td className="p-4 text-text-secondary">
                        {doc.specialty}
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
                            <span className="text-[10px] text-text-muted italic">Sem vínculos</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        {getStatusBadge(doc.status)}
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
                            onClick={() => handleDelete(doc.id)}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-text-muted hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer"
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
                  <td colSpan={6} className="p-8 text-center text-text-muted">
                    Nenhum médico encontrado com os filtros ativos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="bg-card-bg rounded-xl border border-border max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-primary" />
                  Cadastrar Novo Médico
                </h3>
                <p className="text-[10px] text-text-muted mt-0.5">Informe as credenciais do médico para a empresa ativa</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-text-muted hover:text-text-primary text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Nome Completo</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr(a). Nome Sobrenome"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Specialty */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Especialidade Principal</label>
                  <select
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    {activeOrg?.settings.specialties.map((spec) => (
                      <option key={spec} value={spec}>
                        {spec}
                      </option>
                    ))}
                  </select>
                </div>

                {/* CRM */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Número CRM</label>
                  <input
                    type="text"
                    required
                    value={crm}
                    onChange={(e) => setCrm(e.target.value)}
                    placeholder="Ex: 123456"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* CRM UF */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">UF CRM</label>
                  <select
                    value={crmUf}
                    onChange={(e) => setCrmUf(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    {['SP', 'RJ', 'MG', 'PR', 'RS', 'SC', 'DF', 'BA', 'PE', 'CE'].map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                </div>

                {/* CPF */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">CPF</label>
                  <input
                    type="text"
                    required
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    placeholder="Ex: 000.000.000-00"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Telefone de Contato</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ex: (11) 99999-9999"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">E-mail</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="medico@exemplo.com"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Status Inicial</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as DoctorStatus)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    <option value="active">Ativo (Aprovado)</option>
                    <option value="pending">Pendente (Análise de Docs)</option>
                    <option value="inactive">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Residential address */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Endereço Residencial</label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Rua, Número, Bairro, Cidade - UF"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>

              {/* Linked Units Selection */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Vincular a Unidades</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-card-border rounded-lg p-3 max-h-40 overflow-y-auto bg-background">
                  {orgUnits.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedUnits.includes(u.id)}
                        onChange={() => handleUnitToggle(u.id)}
                        className="rounded text-primary focus:ring-teal-500 border-slate-300"
                      />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))}
                  {orgUnits.length === 0 && (
                    <p className="text-xs text-text-muted italic col-span-2">Cadastre unidades primeiro nas configurações.</p>
                  )}
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="border-t border-border pt-4 flex items-center justify-end gap-3 bg-card-bg">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-card-border text-text-muted dark:text-slate-300 font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-xs transition duration-200"
                >
                  Salvar Cadastro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DoctorsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-48 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
      </div>
    }>
      <DoctorsPageContent />
    </Suspense>
  );
}
