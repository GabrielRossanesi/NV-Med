'use client';

import { useState, Suspense } from 'react';
import { useStore } from '@/store/useStore';
import { useSearchParams } from 'next/navigation';
import { UnitType, UnitStatus } from '@/types';
import {
  Building2,
  Search,
  Plus,
  CheckCircle,
  XCircle,
  Eye,
  Trash2,
  Phone,
  User,
  MapPin
} from 'lucide-react';
import Link from 'next/link';

function UnitsPageContent() {
  const {
    activeOrganizationId,
    organizations,
    units,
    addUnit,
    deleteUnit
  } = useStore();

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];
  const orgUnits = units.filter((u) => u.organizationId === activeOrganizationId);

  const searchParams = useSearchParams();
  const urlStatus = searchParams?.get('status') || 'all';
  const urlSearch = searchParams?.get('search') || '';

  const [search, setSearch] = useState(urlSearch);
  const [statusFilter, setStatusFilter] = useState<string>(urlStatus);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sync state if search parameters or organization changes
  const [prevUrlParams, setPrevUrlParams] = useState({
    status: urlStatus,
    search: urlSearch,
    orgId: activeOrganizationId
  });

  if (
    urlStatus !== prevUrlParams.status ||
    urlSearch !== prevUrlParams.search ||
    activeOrganizationId !== prevUrlParams.orgId
  ) {
    setPrevUrlParams({
      status: urlStatus,
      search: urlSearch,
      orgId: activeOrganizationId
    });
    setStatusFilter(urlStatus);
    setSearch(urlSearch);
  }


  // Form states for new Unit
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('SP');
  const [type, setType] = useState<UnitType>('hospital');
  const [manager, setManager] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<UnitStatus>('active');
  const [selectedSpecs, setSelectedSpecs] = useState<string[]>([]);

  // Filtering
  const filteredUnits = orgUnits.filter((unit) => {
    const matchesSearch =
      unit.name.toLowerCase().includes(search.toLowerCase()) ||
      unit.city.toLowerCase().includes(search.toLowerCase()) ||
      unit.cnpj.includes(search);

    const matchesStatus = statusFilter === 'all' || unit.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleSpecToggle = (specName: string) => {
    setSelectedSpecs((prev) =>
      prev.includes(specName) ? prev.filter((s) => s !== specName) : [...prev, specName]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    addUnit({
      name,
      cnpj,
      address,
      city,
      state,
      type,
      manager,
      phone,
      status,
      specialties: selectedSpecs
    });

    // Reset Form
    setName('');
    setCnpj('');
    setAddress('');
    setCity('');
    setState('SP');
    setType('hospital');
    setManager('');
    setPhone('');
    setStatus('active');
    setSelectedSpecs([]);
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm('Deseja excluir esta unidade? Vínculos em plantões e escalas associados serão removidos.')) {
      deleteUnit(id);
    }
  };

  const getTypeLabel = (t: UnitType) => {
    const labels: Record<UnitType, string> = {
      hospital: 'Hospital',
      clinic: 'Clínica',
      er: 'Pronto Atendimento',
      upa: 'UPA',
      lab: 'Laboratório'
    };
    return labels[t];
  };

  const getStatusBadge = (status: UnitStatus) => {
    return status === 'active' ? (
      <span className="inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
        <CheckCircle className="h-3 w-3" />
        Ativa
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
        <XCircle className="h-3 w-3" />
        Inativa
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-primary tracking-tight">
            Unidades de Atendimento
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Gestão física de hospitais, clínicas e pronto atendimentos associados.
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-primary hover:bg-primary-hover text-white rounded-xl py-2.5 px-4 font-semibold text-xs flex items-center justify-center gap-2 self-start transition duration-200 cursor-pointer"
        >
          <Plus className="h-4 w-4" />
          Nova Unidade
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-card-bg p-4 rounded-xl border border-card-border flex flex-col md:flex-row items-center gap-4">
        <div className="relative w-full md:flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
          <input
            type="text"
            placeholder="Buscar por nome da unidade, cidade ou CNPJ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
          />
        </div>

        <div className="relative w-full md:w-40">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg text-xs bg-background text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
          >
            <option value="all">Todos Status</option>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </div>
      </div>

      {/* Active Filters Summary */}
      {(statusFilter !== 'all' || search !== '') && (
        <div className="bg-primary/5 border border-primary/20 p-3.5 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-in fade-in duration-200">
          <div className="text-xs text-text-secondary">
            <span className="font-bold text-primary mr-1">Filtros Ativos:</span>
            {statusFilter !== 'all' && (
              <span className="bg-card-bg border border-border px-2 py-0.5 rounded mr-1.5 font-medium inline-block my-0.5">
                Status: {statusFilter === 'active' ? 'Ativa' : 'Inativa'}
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
              setSearch('');
              window.history.pushState({}, '', '/unidades');
            }}
            className="text-xs font-bold text-primary hover:underline hover:text-primary-hover flex items-center gap-1 self-start sm:self-auto cursor-pointer"
          >
            ✕ Limpar Filtros
          </button>
        </div>
      )}

      {/* Units Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUnits.length > 0 ? (
          filteredUnits.map((unit) => (
            <div
              key={unit.id}
              className="bg-card-bg rounded-xl border border-card-border p-5 flex flex-col justify-between hover:border-primary/30 dark:hover:border-teal-555/20 transition duration-150"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-surface-muted p-2 rounded-lg text-text-muted">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-text-primary leading-tight">{unit.name}</h4>
                      <span className="text-[10px] text-text-muted font-semibold">{getTypeLabel(unit.type)}</span>
                    </div>
                  </div>
                  {getStatusBadge(unit.status)}
                </div>

                {/* Info summary */}
                <div className="mt-4 space-y-2 text-xs text-text-secondary">
                  <p className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-text-muted flex-shrink-0" />
                    <span>{unit.address}, {unit.city} - {unit.state}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <User className="h-4 w-4 text-text-muted flex-shrink-0" />
                    <span>Responsável: {unit.manager}</span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-text-muted flex-shrink-0" />
                    <span>{unit.phone}</span>
                  </p>
                </div>

                {/* Specialties badges */}
                <div className="mt-4 flex flex-wrap gap-1">
                  {unit.specialties.map((spec) => (
                    <span key={spec} className="bg-background border border-card-border text-[10px] text-text-muted px-2 py-0.5 rounded">
                      {spec}
                    </span>
                  ))}
                  {unit.specialties.length === 0 && (
                    <span className="text-[10px] text-text-muted italic">Nenhuma especialidade vinculada</span>
                  )}
                </div>
              </div>

              {/* Card actions */}
              <div className="mt-6 pt-4 border-t border-border flex items-center justify-end gap-2">
                <Link
                  href={`/unidades/${unit.id}`}
                  className="px-3 py-1.5 rounded bg-surface-muted hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-900 border border-border text-text-secondary font-semibold text-xs flex items-center gap-1 transition"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Ver Detalhes
                </Link>
                <button
                  onClick={() => handleDelete(unit.id)}
                  className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/20 text-text-muted hover:text-red-600 dark:hover:text-red-400 transition cursor-pointer"
                  title="Excluir"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-text-muted text-xs">
            Nenhuma unidade cadastrada correspondente.
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
          <div className="bg-card-bg rounded-xl border border-border max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-primary" />
                  Cadastrar Nova Unidade
                </h3>
                <p className="text-[10px] text-text-muted mt-0.5">Informe as credenciais físicas da nova clínica ou hospital</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-text-muted hover:text-text-primary text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Nome da Unidade</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Hospital NV Med Pinheiros"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">CNPJ</label>
                  <input
                    type="text"
                    required
                    value={cnpj}
                    onChange={(e) => setCnpj(e.target.value)}
                    placeholder="Ex: 00.000.000/0001-00"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Tipo</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as UnitType)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    <option value="hospital">Hospital</option>
                    <option value="clinic">Clínica</option>
                    <option value="er">Pronto Atendimento (P.A.)</option>
                    <option value="upa">UPA</option>
                    <option value="lab">Laboratório</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Responsável</label>
                  <input
                    type="text"
                    required
                    value={manager}
                    onChange={(e) => setManager(e.target.value)}
                    placeholder="Nome do gestor ou diretor técnico"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Telefone</label>
                  <input
                    type="text"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ex: (11) 98888-8888"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Cidade</label>
                  <input
                    type="text"
                    required
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Cidade"
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Estado</label>
                  <select
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                  >
                    {['SP', 'RJ', 'MG', 'PR', 'SC', 'RS', 'BA', 'DF', 'PE'].map((uf) => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Endereço Completo</label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Rua, Número, Bairro"
                  className="w-full px-3 py-2 text-xs bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-primary focus:bg-white dark:focus:bg-slate-900 transition"
                />
              </div>

              {/* Specialties checklist */}
              <div className="space-y-2.5">
                <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">Especialidades Atendidas nesta Unidade</label>
                <div className="grid grid-cols-2 gap-2 border border-card-border rounded-lg p-3 max-h-36 overflow-y-auto bg-background">
                  {activeOrg?.settings.specialties.map((spec) => (
                    <label key={spec} className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedSpecs.includes(spec)}
                        onChange={() => handleSpecToggle(spec)}
                        className="rounded text-primary focus:ring-teal-500 border-slate-350"
                      />
                      <span className="text-text-secondary">{spec}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Modal footer actions */}
              <div className="border-t border-border pt-4 flex items-center justify-end gap-3 bg-card-bg">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-card-border text-text-muted dark:text-text-secondary font-semibold text-xs hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-hover text-white font-semibold text-xs transition duration-200 cursor-pointer"
                >
                  Salvar Unidade
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function UnitsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-48 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
      </div>
    }>
      <UnitsPageContent />
    </Suspense>
  );
}
