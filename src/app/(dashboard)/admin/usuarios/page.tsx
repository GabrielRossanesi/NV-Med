'use client';

import { useState } from 'react';
import { useStore } from '@/store/useStore';
import Dialog from '@/components/Dialog';
import UserPermissionsPanel from '@/components/UserPermissionsPanel';
import AccessGuard from '@/components/AccessGuard';
import DeleteConfirmDialog from '@/components/DeleteConfirmDialog';
import TemporaryPasswordDialog from '@/components/TemporaryPasswordDialog';
import { AdditionalPermissions, UserAccount } from '@/types';
import { canPerformAction, sanitizeAdditionalPermissions, SAAS_ROLES, TENANT_ROLES } from '@/lib/permissions';
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
  AlertCircle,
  Trash2,
  KeyRound
} from 'lucide-react';

export default function AdminUsersPage() {
  const { users, organizations, currentUser, saving, addUser, updateUser, deleteUser, setUserTemporaryPassword } = useStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterOrg, setFilterOrg] = useState<string>('all');
  const [filterRole, setFilterRole] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserAccount | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserAccount | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [type, setType] = useState<'saas_admin' | 'tenant_user'>('tenant_user');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [role, setRole] = useState('Escalista');
  const [status, setStatus] = useState<'active' | 'pending' | 'inactive'>('active');
  const [additionalPermissions, setAdditionalPermissions] = useState<AdditionalPermissions>({});
  const [delegatedPermissions, setDelegatedPermissions] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const isSaas = currentUser.type === 'saas_admin';
  const canCreate = canPerformAction(currentUser, 'usuarios', 'create');
  const canManageUsers = canPerformAction(currentUser, 'usuarios', 'edit');
  const saasRoles = SAAS_ROLES;
  const tenantRoles = TENANT_ROLES.filter(item => isSaas || (item !== 'Diretor' && (currentUser.role === 'Diretor' || item !== 'Gerente')));
  const canManageTarget = (user: UserAccount) => user.id !== currentUser.id && (isSaas
    ? currentUser.role === 'CEO' || user.type === 'tenant_user'
    : user.type === 'tenant_user' && user.organizationId === currentUser.organizationId && tenantRoles.includes(user.role));

  const handleOpenCreateModal = () => {
    setEditingUser(null);
    setName('');
    setEmail('');
    setPhone('');
    setType('tenant_user');
    setOrganizationId(isSaas ? (organizations[0]?.id || null) : currentUser.organizationId);
    setRole('Escalista');
    setStatus('active');
    setAdditionalPermissions({});
    setDelegatedPermissions([]);
    setReason('');
    setFormError('');
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
    setAdditionalPermissions(user.additionalPermissions || {});
    setDelegatedPermissions(user.delegatedPermissions || []);
    setReason('');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleTypeChange = (newType: 'saas_admin' | 'tenant_user') => {
    setType(newType);
    if (newType === 'saas_admin') {
      setOrganizationId(null);
      setRole('Gerente');
      setAdditionalPermissions({});
    } else {
      setOrganizationId(isSaas ? (organizations[0]?.id || null) : currentUser.organizationId);
      setRole('Escalista');
      setAdditionalPermissions({});
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || saving) return;
    setFormError('');

    const userData = {
      name,
      email,
      phone,
      type,
      organizationId: type === 'saas_admin' ? null : organizationId,
      role,
      status,
      additionalPermissions: sanitizeAdditionalPermissions(additionalPermissions, type),
      delegatedPermissions,
      reason: reason.trim(),
      avatar: '',
      lastActive: status === 'pending' ? undefined : (editingUser?.lastActive || (status === 'active' ? new Date().toISOString().split('T')[0] : undefined))
    };

    if (editingUser) {
      if (!await updateUser({
        ...editingUser,
        ...userData
      })) { setFormError(useStore.getState().error || 'Não foi possível salvar o acesso.'); return; }
    } else {
      if (!await addUser(userData)) { setFormError(useStore.getState().error || 'Não foi possível criar o acesso.'); return; }
      const createdUser = useStore.getState().users.find(user => user.email.toLowerCase() === email.trim().toLowerCase());
      setIsModalOpen(false);
      if (createdUser && isSaas) setPasswordUser(createdUser);
      return;
    }
    setIsModalOpen(false);
  };

  const handleSimulateInvite = (user: UserAccount) => { alert('Acesso de ' + user.name + ': peça para abrir a tela de login e selecionar Primeiro acesso ou esqueci minha senha.'); };

  // Filter logic
  const filteredUsers = users.filter((user) => {
    if (!isSaas && (user.type !== 'tenant_user' || user.organizationId !== currentUser.organizationId)) return false;
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
          <span className="nv-badge bg-success/10 text-success">
            <CheckCircle className="h-3 w-3" /> Ativo
          </span>
        );
      case 'pending':
        return (
          <span className="nv-badge bg-warning/10 text-warning">
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
            <h2 className="nv-page-title flex items-center gap-2">
              <Users className="h-6 w-6 text-primary" />
              Gestão de Usuários
            </h2>
            <p className="text-sm text-text-muted mt-1">
              {isSaas ? 'Gerencie operadores SaaS e acessos das empresas.' : 'Gerencie os acessos administrativos da sua empresa.'}
            </p>
          </div>
          {canCreate && <button
            onClick={handleOpenCreateModal}
            className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold bg-primary text-text-inverse hover:bg-primary-hover rounded-xl shadow-glow-primary transition cursor-pointer self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            Novo Usuário
          </button>}
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
                className="nv-input"
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
                className="nv-input"
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
                className="nv-input"
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
                className="nv-input"
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
        <div className="nv-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-muted font-semibold text-text-secondary uppercase tracking-wide">
                  <th className="p-4">Usuário</th>
                  <th className="p-4">Tipo & Vínculo</th>
                  <th className="p-4">Cargo / Função</th>
                  <th className="p-4">Contato</th>
                  <th className="p-4 text-center">Último Acesso</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs">
                {filteredUsers.map((user) => {
                  const org = organizations.find(o => o.id === user.organizationId);
                  
                  return (
                    <tr key={user.id} className="hover:bg-table-row-hover transition-colors duration-150">
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-warning/10 text-warning border border-warning/20">
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
                        <div className="text-[9px] text-text-muted mt-0.5">
                          {Object.keys(user.additionalPermissions || {}).length
                            ? `${Object.keys(user.additionalPermissions || {}).length} ${Object.keys(user.additionalPermissions || {}).length === 1 ? 'permissão adicional' : 'permissões adicionais'}`
                            : 'Permissões do cargo'}
                        </div>
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
                        {user.status === 'pending' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-warning bg-warning/5 px-2 py-0.5 rounded-full border border-amber-500/10">
                            <Clock className="h-3 w-3" /> Convite pendente
                          </span>
                        ) : user.lastActive ? (
                          <span className="font-mono text-xs text-text-primary bg-surface-muted px-2 py-0.5 rounded border border-border inline-block">
                            {user.lastActive}
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-muted bg-surface-muted/30 px-2 py-0.5 rounded-full border border-border/30 italic">
                            Nunca acessou
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {getStatusBadge(user.status)}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          {canManageUsers && canManageTarget(user) && <button
                            onClick={() => handleOpenEditModal(user)}
                            className="p-2 text-text-secondary hover:text-primary hover:bg-surface-muted rounded-lg transition cursor-pointer"
                            title="Editar usuário"
                          >
                            <Edit className="h-4 w-4" />
                          </button>}
                          {isSaas && canManageUsers && canManageTarget(user) && (
                            <button
                              onClick={() => setPasswordUser(user)}
                              className="p-2 text-text-secondary hover:text-primary hover:bg-surface-muted rounded-lg transition cursor-pointer"
                              title="Definir senha temporária"
                              aria-label={`Definir senha temporária de ${user.name}`}
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                          )}
                          {user.status === 'pending' && (
                            <button
                              onClick={() => handleSimulateInvite(user)}
                              className="px-2 py-1 bg-surface-muted hover:bg-state-hover border border-border rounded text-[10px] font-semibold text-text-secondary cursor-pointer"
                              title="Instruções de acesso"
                            >
                              Convidar
                            </button>
                          )}
                          {isSaas && canManageUsers && canManageTarget(user) && (
                            <button
                              onClick={() => setDeletingUser(user)}
                              className="p-2 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition cursor-pointer"
                              title="Excluir usuário"
                              aria-label={`Excluir ${user.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-text-muted">
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
          <Dialog title={editingUser ? 'Editar Usuário' : 'Criar Novo Usuário'} size="lg" onClose={() => !saving && setIsModalOpen(false)}
            footer={<div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={saving} onClick={() => setIsModalOpen(false)}>Cancelar</button><button type="submit" form="user-access-form" className="nv-button" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button></div>}>
              <form id="user-access-form" onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Mariana Costa Martins"
                      className="nv-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">E-mail Corporativo *</label>
                    <input
                      type="email"
                      readOnly={!!editingUser}
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="mariana@empresa.com.br"
                      className="nv-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Telefone</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(11) 98888-8888"
                      className="nv-input"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Tipo de Conta</label>
                      <select
                        value={type}
                        disabled={!isSaas || currentUser.role !== 'CEO' || Boolean(editingUser)}
                        onChange={(e) => handleTypeChange(e.target.value as 'saas_admin' | 'tenant_user')}
                        className="nv-input"
                      >
                        <option value="tenant_user">Usuário da Empresa</option>
                        <option value="saas_admin">Admin SaaS</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-text-muted uppercase mb-1">Status</label>
                      <select
                        value={status}
                        disabled={!isSaas && !canPerformAction(currentUser, 'usuarios', 'deactivate') && Boolean(editingUser)}
                        onChange={(e) => setStatus(e.target.value as 'active' | 'pending' | 'inactive')}
                        className="nv-input"
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
                        required
                        disabled={!isSaas || Boolean(editingUser)}
                        onChange={(e) => setOrganizationId(e.target.value)}
                        className="nv-input"
                      >
                        <option value="">Selecione a empresa</option>
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
                      onChange={(e) => {
                        const nextRole = e.target.value;
                        setRole(nextRole);
                      }}
                      className="nv-input"
                    >
                      {type === 'saas_admin' ? (
                        saasRoles.map(r => <option key={r} value={r}>{r}</option>)
                      ) : (
                        tenantRoles.filter(item => isSaas || item !== 'Gerente' || editingUser?.role === 'Gerente').map(r => <option key={r} value={r}>{r}</option>)
                      )}
                    </select>
                  </div>

                  {type === 'tenant_user' && (
                    <UserPermissionsPanel user={editingUser} actor={currentUser} role={role} permissions={additionalPermissions}
                      onChange={setAdditionalPermissions} delegations={delegatedPermissions} onDelegationsChange={setDelegatedPermissions} />
                  )}
                </div>
                <label className="nv-label">Motivo da alteração<input className="nv-input" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} placeholder="Opcional" /></label>
                {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
              </form>
          </Dialog>
        )}
        {deletingUser && (
          <DeleteConfirmDialog
            title="Excluir usuário"
            itemName={deletingUser.email}
            description={`O acesso de ${deletingUser.name} será removido do NV Med e do Supabase Auth.`}
            impacts={[
              'A pessoa perderá o acesso imediatamente.',
              'O perfil e a foto serão removidos permanentemente.',
              'Os registros operacionais criados anteriormente serão preservados.',
            ]}
            busy={saving}
            onClose={() => setDeletingUser(null)}
            onConfirm={async (confirmation) => { if (await deleteUser(deletingUser.id, confirmation)) setDeletingUser(null); }}
          />
        )}
        {passwordUser && (
          <TemporaryPasswordDialog
            user={passwordUser}
            busy={saving}
            onClose={() => setPasswordUser(null)}
            onSave={(password) => setUserTemporaryPassword(passwordUser.id, password)}
          />
        )}
      </div>
    </AccessGuard>
  );
}
