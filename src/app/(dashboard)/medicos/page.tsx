'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
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

export default function DoctorsPage() {
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

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [specialtyFilter, setSpecialtyFilter] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    const matchesSpecialty = specialtyFilter === 'all' || doc.specialty === specialtyFilter;

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
          <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            Corpo Clínico (Médicos)
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Cadastro e credenciamento de médicos no tenant ativo.
          </p>
        </div>
        <button
          onClick={() => {
            setSpecialty(activeOrg?.settings.specialties[0] || '');
            setIsModalOpen(true);
          }}
          className="bg-teal-500 hover:bg-teal-600 text-white rounded-xl py-2.5 px-4 font-semibold text-xs flex items-center justify-center gap-2 self-start transition duration-200"
        >
          <Plus className="h-4 w-4" />
          Novo Médico
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center gap-4">
        {/* Search */}
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nome, CRM ou especialidade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 dark:border-slate-855 rounded-lg text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
          />
        </div>

        {/* Specialty Filter */}
        <div className="relative w-full md:w-48">
          <select
            value={specialtyFilter}
            onChange={(e) => setSpecialtyFilter(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-855 rounded-lg text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
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
            className="w-full px-3 py-2 border border-slate-200 dark:border-slate-855 rounded-lg text-xs bg-slate-50 dark:bg-slate-950 focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
          >
            <option value="all">Todos Status</option>
            <option value="active">Ativo</option>
            <option value="pending">Pendente</option>
            <option value="inactive">Inativo</option>
          </select>
        </div>
      </div>

      {/* Table grid */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                <th className="p-4">Médico</th>
                <th className="p-4">CRM / UF</th>
                <th className="p-4">Especialidade</th>
                <th className="p-4">Unidades Vinculadas</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-150 dark:divide-slate-800 text-xs">
              {filteredDoctors.length > 0 ? (
                filteredDoctors.map((doc) => {
                  // Find clinical names linked to this doctor
                  const linkedClinics = orgUnits.filter((u) => doc.linkedUnits.includes(u.id));

                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/10 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
                            {doc.name.charAt(4)}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{doc.name}</p>
                            <p className="text-[10px] text-slate-400">{doc.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-mono font-medium">
                        {doc.crm} / {doc.crmUf}
                      </td>
                      <td className="p-4 text-slate-600 dark:text-slate-350">
                        {doc.specialty}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {linkedClinics.map((lc) => (
                            <span key={lc.id} className="inline-flex items-center gap-0.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 px-1.5 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-400">
                              <Building className="h-2.5 w-2.5 flex-shrink-0" />
                              {lc.name.replace('Pronto Atendimento ', 'P.A. ').replace('Hospital ', 'Hosp. ').replace('Clínica ', 'Clín. ')}
                            </span>
                          ))}
                          {linkedClinics.length === 0 && (
                            <span className="text-[10px] text-slate-400 italic">Sem vínculos</span>
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
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
                            title="Ver Perfil Detalhado"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => handleDelete(doc.id)}
                            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
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
                  <td colSpan={6} className="p-8 text-center text-slate-400">
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
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-250 dark:border-slate-800 max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4 text-teal-500" />
                  Cadastrar Novo Médico
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Informe as credenciais do médico para a empresa ativa</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Full name */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Nome Completo</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr(a). Nome Sobrenome"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Specialty */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Especialidade Principal</label>
                  <select
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
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
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Número CRM</label>
                  <input
                    type="text"
                    required
                    value={crm}
                    onChange={(e) => setCrm(e.target.value)}
                    placeholder="Ex: 123456"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* CRM UF */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">UF CRM</label>
                  <select
                    value={crmUf}
                    onChange={(e) => setCrmUf(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
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
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">CPF</label>
                  <input
                    type="text"
                    required
                    value={cpf}
                    onChange={(e) => setCpf(e.target.value)}
                    placeholder="Ex: 000.000.000-00"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Telefone de Contato</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ex: (11) 99999-9999"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">E-mail</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="medico@exemplo.com"
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                {/* Status */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status Inicial</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as DoctorStatus)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    <option value="active">Ativo (Aprovado)</option>
                    <option value="pending">Pendente (Análise de Docs)</option>
                    <option value="inactive">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Residential address */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Endereço Residencial</label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Rua, Número, Bairro, Cidade - UF"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-855 rounded-lg focus:outline-none focus:border-teal-500 focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>

              {/* Linked Units Selection */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Vincular a Unidades</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border border-slate-200 dark:border-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto bg-slate-50 dark:bg-slate-950">
                  {orgUnits.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedUnits.includes(u.id)}
                        onChange={() => handleUnitToggle(u.id)}
                        className="rounded text-teal-600 focus:ring-teal-500 border-slate-300"
                      />
                      <span className="truncate">{u.name}</span>
                    </label>
                  ))}
                  {orgUnits.length === 0 && (
                    <p className="text-xs text-slate-400 italic col-span-2">Cadastre unidades primeiro nas configurações.</p>
                  )}
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 flex items-center justify-end gap-3 bg-white dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-300 font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-semibold text-xs transition duration-200"
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
