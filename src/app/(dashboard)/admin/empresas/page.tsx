'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import AccessGuard from '@/components/AccessGuard';
import { Organization } from '@/types';
import { 
  Building, 
  Plus, 
  Search, 
  MapPin, 
  Edit, 
  Eye, 
  CheckCircle,
  XCircle,
  AlertCircle,
  MinusCircle
} from 'lucide-react';

export default function AdminOrganizationsPage() {
  const { 
    organizations, 
    doctors, 
    units, 
    documents, 
    addOrganization, 
    updateOrganization, 
    startSimulation 
  } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [responsavelName, setResponsavelName] = useState('');
  const [responsavelRole, setResponsavelRole] = useState('Diretor');
  const [city, setCity] = useState('');
  const [state, setState] = useState('SP');
  const [plan, setPlan] = useState<'bronze' | 'silver' | 'gold' | 'platinum'>('silver');
  const [status, setStatus] = useState<'active' | 'setup' | 'suspended' | 'cancelled'>('active');

  const handleOpenCreateModal = () => {
    setEditingOrg(null);
    setName('');
    setRazaoSocial('');
    setCnpj('');
    setEmail('');
    setPhone('');
    setResponsavelName('');
    setResponsavelRole('Diretor');
    setCity('');
    setState('SP');
    setPlan('silver');
    setStatus('active');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (org: Organization) => {
    setEditingOrg(org);
    setName(org.name || '');
    setRazaoSocial(org.razaoSocial || '');
    setCnpj(org.cnpj || '');
    setEmail(org.email || '');
    setPhone(org.phone || '');
    setResponsavelName(org.responsavelName || '');
    setResponsavelRole(org.responsavelRole || 'Diretor');
    setCity(org.city || '');
    setState(org.state || 'SP');
    setPlan(org.plan || 'silver');
    setStatus(org.status || 'active');
    setIsModalOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;

    const orgData = {
      name,
      razaoSocial,
      cnpj,
      email,
      phone,
      responsavelName,
      responsavelRole,
      city,
      state,
      plan,
      status,
      enabledModules: ['Dashboard', 'Médicos', 'Unidades', 'Documentos', 'Escala', 'Configurações'],
      settings: editingOrg?.settings || {
        specialties: ['Clínico Geral', 'Cardiologia', 'Pediatria'],
        requiredDocuments: [
          { type: 'rg_cnh', name: 'RG/CNH', required: true },
          { type: 'diploma_medicina', name: 'Diploma de Medicina', required: true }
        ]
      }
    };

    if (editingOrg) {
      updateOrganization({
        ...editingOrg,
        ...orgData
      });
    } else {
      addOrganization(orgData);
    }
    setIsModalOpen(false);
  };

  const filteredOrgs = organizations.filter(org => 
    org.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (org.cnpj && org.cnpj.includes(searchTerm)) ||
    (org.city && org.city.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">
            <CheckCircle className="h-3 w-3" /> Ativa
          </span>
        );
      case 'setup':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-500 font-medium">
            <AlertCircle className="h-3 w-3 animate-pulse" /> Implantação
          </span>
        );
      case 'suspended':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-danger/10 text-danger font-medium">
            <MinusCircle className="h-3 w-3" /> Suspensa
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-muted text-text-muted font-medium">
            <XCircle className="h-3 w-3" /> Cancelada
          </span>
        );
      default:
        return null;
    }
  };

  const getPlanBadge = (plan?: string) => {
    switch (plan) {
      case 'platinum':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">Platinum</span>;
      case 'gold':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20">Gold</span>;
      case 'silver':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">Silver</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-500/10 text-gray-500">Bronze</span>;
    }
  };

  return (
    <AccessGuard requiredPermission="empresas">
      <div className="space-y-8 animate-in fade-in duration-300">
        {/* Title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text-primary tracking-tight flex items-center gap-2">
              <Building className="h-6 w-6 text-primary" />
              Gestão de Empresas
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Controle licenças, planos de pagamento, dados cadastrais e realize simulações de acesso.
            </p>
          </div>
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-text-inverse hover:bg-primary-hover rounded-xl shadow-glow-primary transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Nova Empresa
          </button>
        </div>

        {/* Filter and Search */}
        <div className="flex items-center gap-3 bg-card-bg border border-border p-3 rounded-xl shadow-soft">
          <Search className="h-4 w-4 text-text-muted flex-shrink-0" />
          <input
            type="text"
            placeholder="Buscar por nome da clínica, CNPJ ou cidade..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
          />
        </div>

        {/* Companies Table */}
        <div className="bg-card-bg border border-border rounded-2xl shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  <th className="p-4">Empresa</th>
                  <th className="p-4">CNPJ & Local</th>
                  <th className="p-4">Responsável</th>
                  <th className="p-4 text-center">Plano & Status</th>
                  <th className="p-4 text-center">Métricas</th>
                  <th className="p-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredOrgs.map((org) => {
                  const docCount = doctors.filter(d => d.organizationId === org.id).length;
                  const unitCount = units.filter(u => u.organizationId === org.id).length;
                  const pendingDocs = documents.filter(
                    d => d.organizationId === org.id && 
                    (d.status === 'expired' || d.status === 'rejected' || d.status === 'analyzing')
                  ).length;

                  return (
                    <tr key={org.id} className="hover:bg-state-hover transition duration-150">
                      <td className="p-4">
                        <div className="font-semibold text-text-primary text-sm">{org.name}</div>
                        <div className="text-[10px] text-text-muted font-mono mt-0.5">{org.razaoSocial}</div>
                      </td>
                      <td className="p-4">
                        <div className="text-text-secondary font-mono">{org.cnpj || 'S/ CNPJ'}</div>
                        <div className="text-[10px] text-text-muted flex items-center gap-1 mt-0.5">
                          <MapPin className="h-3 w-3" /> {org.city || 'Desconhecido'} - {org.state || 'UF'}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="text-text-secondary font-medium">{org.responsavelName || 'N/A'}</div>
                        <div className="text-[10px] text-text-muted mt-0.5">{org.responsavelRole}</div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-col items-center gap-1.5 justify-center">
                          {getPlanBadge(org.plan)}
                          {getStatusBadge(org.status)}
                        </div>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-3">
                          <div className="text-center" title="Médicos">
                            <span className="text-[10px] text-text-muted uppercase font-bold block">MED</span>
                            <span className="font-semibold text-text-primary font-mono">{docCount}</span>
                          </div>
                          <div className="text-center" title="Unidades">
                            <span className="text-[10px] text-text-muted uppercase font-bold block">UNI</span>
                            <span className="font-semibold text-text-primary font-mono">{unitCount}</span>
                          </div>
                          <div className="text-center" title="Pendências Documentais">
                            <span className="text-[10px] text-text-muted uppercase font-bold block">PEND</span>
                            <span className={`font-semibold font-mono ${pendingDocs > 0 ? 'text-danger font-bold' : 'text-text-muted'}`}>
                              {pendingDocs}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenEditModal(org)}
                            className="p-2 text-text-secondary hover:text-primary hover:bg-surface-muted rounded-lg transition cursor-pointer"
                            title="Editar empresa"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => startSimulation(org.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-500 hover:bg-amber-500 hover:text-white rounded-lg transition font-semibold text-[10px] cursor-pointer"
                            title="Simular login operacional nesta empresa"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Simular
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredOrgs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-text-muted">
                      Nenhuma empresa encontrada com os filtros ativos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Create/Edit */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            
            <div className="relative w-full max-w-xl bg-card-bg border border-border rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-border">
                <h3 className="text-lg font-bold text-text-primary">
                  {editingOrg ? 'Editar Empresa' : 'Cadastrar Nova Empresa'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="text-text-muted hover:text-text-primary text-sm font-bold">✕</button>
              </div>

              {/* Body Form */}
              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Nome Fantasia *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Pronto Socorro da Criança"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Razão Social</label>
                    <input
                      type="text"
                      value={razaoSocial}
                      onChange={(e) => setRazaoSocial(e.target.value)}
                      placeholder="Ex: Pronto Socorro Infantil da Capital Ltda"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">CNPJ</label>
                    <input
                      type="text"
                      value={cnpj}
                      onChange={(e) => setCnpj(e.target.value)}
                      placeholder="00.000.000/0000-00"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Telefone</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 99999-9999"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">E-mail Principal</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="contato@empresa.com.br"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Responsável</label>
                    <input
                      type="text"
                      value={responsavelName}
                      onChange={(e) => setResponsavelName(e.target.value)}
                      placeholder="Nome do Diretor/Gestor"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Cargo do Responsável</label>
                    <input
                      type="text"
                      value={responsavelRole}
                      onChange={(e) => setResponsavelRole(e.target.value)}
                      placeholder="Ex: Diretor Clínico"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Cidade</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Cidade"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Estado (UF)</label>
                    <input
                      type="text"
                      maxLength={2}
                      value={state}
                      onChange={(e) => setState(e.target.value.toUpperCase())}
                      placeholder="SP"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Plano Comercial</label>
                    <select
                      value={plan}
                      onChange={(e) => setPlan(e.target.value as 'silver' | 'gold' | 'platinum')}
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary focus:border-primary focus:outline-none"
                    >
                      <option value="silver">Silver (R$ 799/mês)</option>
                      <option value="gold">Gold (R$ 1.299/mês)</option>
                      <option value="platinum">Platinum (R$ 1.999/mês)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Status Licença</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'active' | 'setup' | 'suspended' | 'cancelled')}
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary focus:border-primary focus:outline-none"
                    >
                      <option value="active">Ativa</option>
                      <option value="setup">Implantação</option>
                      <option value="suspended">Suspensa</option>
                      <option value="cancelled">Cancelada</option>
                    </select>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 text-sm font-semibold border border-border bg-card-bg hover:bg-state-hover text-text-primary rounded-xl transition cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold bg-primary text-text-inverse hover:bg-primary-hover rounded-xl shadow-glow-primary transition cursor-pointer"
                  >
                    Salvar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AccessGuard>
  );
}
