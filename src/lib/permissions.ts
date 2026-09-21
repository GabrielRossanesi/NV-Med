import type { AdditionalPermissions, UserAccount } from '@/types';

export type PermissionLevel = 'none' | 'view' | 'edit';

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  'saas_admin:CEO': ['admin', 'empresas', 'usuarios', 'permissoes', 'simular_acesso', 'dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'configuracoes'],
  'saas_admin:Gerente': ['admin', 'empresas', 'usuarios', 'simular_acesso', 'dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'configuracoes'],
  'saas_admin:Coordenador': ['admin', 'empresas', 'usuarios', 'dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios'],
  'saas_admin:Administrativo': ['admin', 'empresas', 'usuarios', 'dashboard', 'medicos', 'unidades'],
  'saas_admin:Financeiro': ['admin', 'empresas', 'dashboard', 'relatorios', 'financeiro'],
  'saas_admin:Jurídico': ['admin', 'empresas', 'dashboard'],
  'tenant_user:Diretor': ['dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro', 'configuracoes'],
  'tenant_user:Gerente': ['dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios', 'financeiro'],
  'tenant_user:Coordenador de Escalas': ['dashboard', 'medicos', 'unidades', 'documentos', 'escala', 'relatorios'],
  'tenant_user:Escalista': ['dashboard', 'medicos', 'unidades', 'escala', 'relatorios'],
  'tenant_user:Financeiro': ['dashboard', 'escala', 'relatorios', 'financeiro'],
  'tenant_user:Jurídico': ['dashboard', 'medicos', 'documentos', 'relatorios'],
};

export const ADDITIONAL_PERMISSION_MODULES = [
  { key: 'medicos', label: 'Médicos', description: 'Cadastros, vínculos e dados profissionais' },
  { key: 'unidades', label: 'Unidades e setores', description: 'Unidades, setores e especialidades atendidas' },
  { key: 'documentos', label: 'Documentos', description: 'Pendências e documentação médica' },
  { key: 'escala', label: 'Escalas', description: 'Plantões, vagas e cobertura assistencial' },
  { key: 'financeiro', label: 'Financeiro', description: 'Valores, pagamentos e exportações financeiras' },
  { key: 'relatorios', label: 'Relatórios', description: 'Indicadores operacionais e exportação de dados' },
  { key: 'configuracoes', label: 'Configurações', description: 'Preferências operacionais da empresa' },
] as const;

export const ADDITIONAL_PERMISSION_KEYS = ADDITIONAL_PERMISSION_MODULES.map(item => item.key);

export function roleHasPermission(type: UserAccount['type'], role: string, permission: string) {
  return (ROLE_PERMISSIONS[`${type}:${role}`] || []).includes(permission);
}

export function getPermissionLevel(user: Pick<UserAccount, 'type' | 'role' | 'additionalPermissions'>, permission: string): PermissionLevel {
  if (roleHasPermission(user.type, user.role, permission)) return 'edit';
  return user.additionalPermissions?.[permission] || 'none';
}

export function canViewPermission(user: Pick<UserAccount, 'type' | 'role' | 'additionalPermissions'>, permission: string) {
  return getPermissionLevel(user, permission) !== 'none';
}

export function canEditPermission(user: Pick<UserAccount, 'type' | 'role' | 'additionalPermissions'>, permission: string) {
  return getPermissionLevel(user, permission) === 'edit';
}

export function sanitizeAdditionalPermissions(value: unknown, type: UserAccount['type'], role: string): AdditionalPermissions {
  if (type !== 'tenant_user' || !value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, level]) =>
    ADDITIONAL_PERMISSION_KEYS.includes(key as (typeof ADDITIONAL_PERMISSION_KEYS)[number]) &&
    (level === 'view' || level === 'edit') &&
    !roleHasPermission(type, role, key)
  )) as AdditionalPermissions;
}
