'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import AccessGuard from '@/components/AccessGuard';
import { UserAccount } from '@/types';
import { 
  Users, 
  Plus, 
  Search, 
  Building, 
  Shield, 
  Edit, 
  Mail, 
  Phone, 
  Clock, 
  CheckCircle, 
  XCircle, 
  AlertCircle
} from 'lucide-react';

export default function AdminUsersPage() {
  const { users, organizations, addUser, updateUser } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterOrg, setFilterOrg] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<'saas_admin' | 'tenant_user'>('tenant_user');
  const [organizationId, setOrganizationId] = useState<string | null>('org-1');
  const [role, setRole] = useState('Escalista');
  const [status, setStatus] = useState<'active' | 'pending' | 'inactive'>('active');

  // Available roles by type
  const saasRoles = ['CEO', 'Gerente', 'Coordenador', 'Administrativo', 'Financeiro', 'Jurídico'];
  const tenantRoles = ['Diretor', 'Gerente', 'Coordenador de Escalas', 'Escalista', 'Financeiro', 'Jurídico'];

  const handleOpenCreateModal = () => {
    setEditingUser(null);
    setName('');
    setEmail('');
    setPhone('');
    setType('tenant_user');
    setOrganizationId(organizations[0]?.id || null);
    setRole('Escalista');
    setStatus('active');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (user: UserAccount) => {
    setEditingUser(user);
    setName(user.name);
    setEmail(user.email);
    setPhone(user.phone || '');
    setType(user.type);
    setOrganizationId(user.organizationId);
    setRole(user.role);
    setStatus(user.status);
    setIsModalOpen(true);
  };

  const handleTypeChange = (newType: 'saas_admin' | 'tenant_user') => {
    setType(newType);
    if (newType === 'saas_admin') {
      setOrganizationId(null);
      setRole('Gerente');
    } else {
      setOrganizationId(organizations[0]?.id || null);
      setRole('Escalista');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    const userData = {
      name,
      email,
      phone,
      type,
      organizationId: type === 'saas_admin' ? null : organizationId,
      role,
      status,
      avatar: ''
    };

    if (editingUser) {
      updateUser({
        ...editingUser,
        ...userData
      });
    } else {
      addUser(userData);
    }
    setIsModalOpen(false);
  };

  const handleSimulateInvite = (user: UserAccount) => {
    alert(`Convite de acesso reenviado com sucesso para ${user.name} (${user.email})!`);
  };

  // Filter logic
  const filteredUsers = users.filter((user) => {
    const matchesSearch = 
      user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesType = filterType === 'all' || user.type === filterType;
    const matchesOrg = filterOrg === 'all' || user.organizationId === filterOrg;
    const matchesRole = filterRole === 'all' || user.role === filterRole;
    const matchesStatus = filterStatus === 'all' || user.status === filterStatus;

    return matchesSearch && matchesType && matchesOrg && matchesRole && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">
            <CheckCircle className="h-3 w-3" /> Ativo
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-500 animate-pulse">
            <AlertCircle className="h-3 w-3" /> Pendente
          </span>
        );
      case 'inactive':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-danger/10 text-danger">
            <XCircle className="h-3 w-3" /> Inativo
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <AccessGuard requiredPermission="usuarios">
      <div className="space-y-8 animate-in fade-in duration-300">
        {/* Title */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-text-primary tracking-tight flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Gestão de Usuários
            </h2>
            <p className="text-sm text-text-muted mt-1">
              Controle credenciais de acessos de operadores internos (SaaS) e profissionais administrativos de hospitais clientes.
            </p>
          </div>
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-text-inverse hover:bg-primary-hover rounded-xl shadow-glow-primary transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Novo Usuário
          </button>
        </div>

        {/* Filters Panel */}
        <div className="bg-card-bg border border-border p-4 rounded-2xl shadow-soft space-y-4">
          <div className="flex items-center gap-3 bg-surface-muted/50 border border-border px-3 py-2 rounded-xl">
            <Search className="h-4 w-4 text-text-muted flex-shrink-0" />
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Tipo</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-input-bg border border-input-border rounded-lg text-text-primary focus:outline-none"
              >
                <option value="all">Todos os tipos</option>
                <option value="saas_admin">Admin SaaS</option>
                <option value="tenant_user">Usuário da Empresa</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Empresa</label>
              <select
                value={filterOrg}
                onChange={(e) => setFilterOrg(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-input-bg border border-input-border rounded-lg text-text-primary focus:outline-none"
              >
                <option value="all">Todas as empresas</option>
                {organizations.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Cargo</label>
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-input-bg border border-input-border rounded-lg text-text-primary focus:outline-none"
              >
                <option value="all">Todos os cargos</option>
                {Array.from(new Set(users.map(u => u.role))).map(role => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-2 py-1.5 text-xs bg-input-bg border border-input-border rounded-lg text-text-primary focus:outline-none"
              >
                <option value="all">Todos os status</option>
                <option value="active">Ativo</option>
                <option value="pending">Convite Pendente</option>
                <option value="inactive">Inativo</option>
              </select>
            </div>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-card-bg border border-border rounded-2xl shadow-soft overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                  <th className="p-4">Usuário</th>
                  <th className="p-4">Tipo & Vínculo</th>
                  <th className="p-4">Cargo / Função</th>
                  <th className="p-4">Contato</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredUsers.map((user) => {
                  const org = organizations.find(o => o.id === user.organizationId);
                  
                  return (
                    <tr key={user.id} className="hover:bg-state-hover transition duration-150">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center font-bold text-xs text-text-inverse ${
                            user.type === 'saas_admin' ? 'bg-primary' : 'bg-amber-500'
                          }`}>
                            {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-semibold text-text-primary text-sm">{user.name}</div>
                            <div className="text-[10px] text-text-muted flex items-center gap-1 mt-0.5">
                              <Clock className="h-3 w-3" /> Criado em {user.createdAt}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        {user.type === 'saas_admin' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                            <Shield className="h-3 w-3" /> Admin SaaS
                          </span>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20">
                              <Building className="h-3 w-3" /> Cliente
                            </span>
                            <p className="text-[10px] text-text-muted truncate max-w-[150px]" title={org?.name}>
                              {org?.name || 'Nenhuma'}
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-text-secondary">{user.role}</div>
                        <div className="text-[9px] text-text-muted mt-0.5">RBAC Herdado</div>
                      </td>
                      <td className="p-4 space-y-1">
                        <div className="flex items-center gap-1.5 text-text-secondary font-mono">
                          <Mail className="h-3.5 w-3.5 text-text-muted" /> {user.email}
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-1.5 text-text-muted font-mono">
                            <Phone className="h-3.5 w-3.5 text-text-muted" /> {user.phone}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {getStatusBadge(user.status)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleOpenEditModal(user)}
                            className="p-2 text-text-secondary hover:text-primary hover:bg-surface-muted rounded-lg transition cursor-pointer"
                            title="Editar usuário"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          {user.status === 'pending' && (
                            <button
                              onClick={() => handleSimulateInvite(user)}
                              className="px-2 py-1 bg-surface-muted hover:bg-state-hover border border-border rounded text-[10px] font-semibold text-text-secondary cursor-pointer"
                              title="Reenviar convite"
                            >
                              Convidar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-text-muted">
                      Nenhum usuário cadastrado com os filtros ativos.
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
            
            <div className="relative w-full max-w-lg bg-card-bg border border-border rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-border">
                <h3 className="text-lg font-bold text-text-primary">
                  {editingUser ? 'Editar Usuário' : 'Criar Novo Usuário'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="text-text-muted hover:text-text-primary text-sm font-bold">✕</button>
              </div>

              {/* Body Form */}
              <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Mariana Costa Martins"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">E-mail Corporativo *</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="mariana@empresa.com.br"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Telefone</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 98888-8888"
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary placeholder-text-muted focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Tipo de Conta</label>
                      <select
                        value={type}
                        onChange={(e) => handleTypeChange(e.target.value as 'saas_admin' | 'tenant_user')}
                        className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary focus:border-primary focus:outline-none"
                      >
                        <option value="tenant_user">Usuário da Empresa</option>
                        <option value="saas_admin">Admin SaaS</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Status</label>
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value as 'active' | 'pending' | 'inactive')}
                        className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary focus:border-primary focus:outline-none"
                      >
                        <option value="active">Ativo</option>
                        <option value="pending">Convite Pendente</option>
                        <option value="inactive">Inativo</option>
                      </select>
                    </div>
                  </div>

                  {type === 'tenant_user' && (
                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Empresa Vinculada</label>
                      <select
                        value={organizationId || ''}
                        onChange={(e) => setOrganizationId(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary focus:border-primary focus:outline-none"
                      >
                        {organizations.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Cargo / Role</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-input-bg border border-input-border rounded-xl text-text-primary focus:border-primary focus:outline-none"
                    >
                      {type === 'saas_admin' ? (
                        saasRoles.map(r => <option key={r} value={r}>{r}</option>)
                      ) : (
                        tenantRoles.map(r => <option key={r} value={r}>{r}</option>)
                      )}
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
