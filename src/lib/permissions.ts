import type { AdditionalPermissions, UserAccount } from '@/types';

export type PermissionLevel = 'none' | 'view' | 'edit';
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'deactivate' | 'history';
type PermissionUser = Pick<UserAccount, 'type' | 'role' | 'additionalPermissions'>;

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  'saas_admin:CEO': ['admin', 'empresas', 'usuarios', 'permissoes', 'simular_acesso', 'dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'configuracoes'],
  'saas_admin:Gerente': ['admin', 'empresas', 'usuarios', 'simular_acesso', 'dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'configuracoes'],
  'saas_admin:Coordenador': ['admin', 'empresas', 'usuarios', 'dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios'],
  'saas_admin:Administrativo': ['admin', 'empresas', 'usuarios', 'dashboard', 'medicos', 'unidades'],
  'saas_admin:Financeiro': ['admin', 'empresas', 'dashboard', 'relatorios', 'financeiro'],
  'saas_admin:Jurídico': ['admin', 'empresas', 'dashboard', 'documentos'],
  'tenant_user:Diretor': ['dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'configuracoes', 'usuarios'],
  'tenant_user:Gerente': ['dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'usuarios'],
  'tenant_user:Coordenador de Escalas': ['dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios'],
  'tenant_user:Escalista': ['dashboard', 'medicos', 'unidades', 'escala', 'relatorios'],
  'tenant_user:Financeiro': ['dashboard', 'escala', 'relatorios', 'financeiro'],
  'tenant_user:Jurídico': ['dashboard', 'medicos', 'documentos', 'relatorios'],
};

export const TENANT_ROLES = ['Diretor', 'Gerente', 'Coordenador de Escalas', 'Escalista', 'Financeiro', 'Jurídico'];
export const SAAS_ROLES = ['CEO', 'Gerente', 'Coordenador', 'Administrativo', 'Financeiro', 'Jurídico'];

export const ADDITIONAL_PERMISSION_MODULES = [
  { key: 'medicos', label: 'Médicos', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
  { key: 'unidades', label: 'Unidades e setores', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'documentos', label: 'Documentos', actions: ['view', 'edit', 'approve'] },
  { key: 'escala', label: 'Escalas', actions: ['view', 'create', 'edit', 'delete', 'approve'] },
  { key: 'financeiro', label: 'Financeiro', actions: ['view', 'edit'] },
  { key: 'dados_bancarios', label: 'Dados bancários médicos', actions: ['view', 'edit', 'history'] },
  { key: 'relatorios', label: 'Relatórios', actions: ['view'] },
  { key: 'configuracoes', label: 'Configurações', actions: ['view', 'edit'] },
  { key: 'usuarios', label: 'Usuários da empresa', actions: ['view', 'create', 'edit', 'deactivate'] },
] as const;
export const permissionActionLabels: Record<PermissionAction, string> = {
  view: 'Visualizar', create: 'Criar', edit: 'Editar', delete: 'Excluir', approve: 'Aprovar', deactivate: 'Desativar',
  history: 'Consultar histórico',
};

const allowedActions = new Set<string>(ADDITIONAL_PERMISSION_MODULES.flatMap(module => module.actions.map(action => `${module.key}.${action}`)));
const legacyModules = new Set<string>(ADDITIONAL_PERMISSION_MODULES.filter(module => module.key !== 'usuarios' && module.key !== 'dados_bancarios').map(module => module.key));

export function roleHasPermission(type: UserAccount['type'], role: string, module: string) {
  return (ROLE_PERMISSIONS[`${type}:${role}`] || []).includes(module);
}

export function roleHasAction(type: UserAccount['type'], role: string, module: string, action: PermissionAction): boolean {
  if (module === 'dados_bancarios') return ['view', 'edit', 'history'].includes(action) && (type === 'saas_admin' ? ['CEO', 'Gerente', 'Financeiro'] : ['Diretor', 'Gerente', 'Financeiro']).includes(role);
  if (action === 'view') return roleHasPermission(type, role, module);
  if (!allowedActions.has(`${module}.${action}`)) return false;
  if (module === 'usuarios') return (type === 'saas_admin' ? ['CEO', 'Gerente'] : ['Diretor', 'Gerente']).includes(role);
  if (type === 'saas_admin') {
    if (['CEO', 'Gerente'].includes(role)) return true;
    if (module === 'financeiro') return role === 'Financeiro';
    if (module === 'documentos') return ['Coordenador', 'Jurídico'].includes(role);
    if (action === 'approve') return role === 'Coordenador';
    return ['Coordenador', 'Administrativo'].includes(role) && ['medicos', 'unidades', 'escala'].includes(module);
  }
  if (module === 'financeiro') return ['Diretor', 'Gerente', 'Financeiro'].includes(role);
  if (module === 'configuracoes') return role === 'Diretor';
  if (module === 'documentos') return ['Diretor', 'Gerente', 'Coordenador de Escalas', 'Jurídico'].includes(role);
  if (action === 'approve') return ['Diretor', 'Gerente', 'Coordenador de Escalas'].includes(role);
  return ['Diretor', 'Gerente', 'Coordenador de Escalas', 'Escalista'].includes(role);
}

export function permissionDecision(user: PermissionUser, module: string, action: PermissionAction) {
  const baseline = roleHasAction(user.type, user.role, module, action);
  if (module === 'usuarios' && action !== 'view' && !baseline) return { allowed: false, origin: 'Ação reservada à gestão de usuários' };
  const exception = user.type === 'tenant_user' ? user.additionalPermissions?.[`${module}.${action}`] : undefined;
  const legacy = user.type === 'tenant_user' ? user.additionalPermissions?.[module] : undefined;
  if (action !== 'view' && !permissionDecision(user, module, 'view').allowed) return { allowed: false, origin: 'Sem acesso ao módulo' };
  if (exception === 'deny') return { allowed: false, origin: 'Negado individualmente' };
  if (exception === 'allow') return { allowed: true, origin: 'Concedido individualmente' };
  if (baseline) return { allowed: true, origin: 'Permitido pelo cargo' };
  const legacyGrant = action === 'view' ? legacy === 'view' || legacy === 'edit'
    : legacy === 'edit' && (action === 'edit' || (['create', 'delete'].includes(action) && ['medicos', 'unidades', 'escala'].includes(module)));
  return legacyGrant ? { allowed: true, origin: 'Concessão anterior' } : { allowed: false, origin: 'Sem permissão pelo cargo' };
}

export function canPerformAction(user: PermissionUser, module: string, action: PermissionAction) {
  return permissionDecision(user, module, action).allowed;
}

export function getPermissionLevel(user: PermissionUser, module: string): PermissionLevel {
  return canEditPermission(user, module) ? 'edit' : canViewPermission(user, module) ? 'view' : 'none';
}

export function canViewPermission(user: PermissionUser, module: string) {
  return canPerformAction(user, module, 'view');
}

export function canEditPermission(user: PermissionUser, module: string) {
  return canPerformAction(user, module, 'edit');
}

export function sanitizeAdditionalPermissions(value: unknown, type: UserAccount['type']): AdditionalPermissions {
  if (type !== 'tenant_user' || !value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, level]) =>
    (allowedActions.has(key) && (level === 'allow' || level === 'deny')) ||
    (legacyModules.has(key) && (level === 'view' || level === 'edit'))
  )) as AdditionalPermissions;
}
