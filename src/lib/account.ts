import { canPerformAction, canViewPermission } from '@/lib/permissions';
import type { UserAccount } from '@/types';
import { defaultDoctorListing, type DoctorListingPreferences } from './doctorDirectory';

export const accountHomePages = [
  { value: '/dashboard', label: 'Visão geral', permission: 'dashboard' },
  { value: '/escala', label: 'Escalas', permission: 'escala' },
  { value: '/documentos', label: 'Documentos', permission: 'documentos' },
  { value: '/relatorios', label: 'Relatórios', permission: 'relatorios' },
] as const;

export type AccountPreferences = {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  density: 'comfortable' | 'compact';
  scheduleView: 'calendar' | 'list';
  homePage: '' | (typeof accountHomePages)[number]['value'];
  documentAlerts: boolean;
  applicationAlerts: boolean;
  doctorListing: DoctorListingPreferences;
};

export const defaultAccountPreferences: AccountPreferences = {
  theme: 'light',
  sidebarCollapsed: true,
  density: 'comfortable',
  scheduleView: 'calendar',
  homePage: '',
  documentAlerts: true,
  applicationAlerts: true,
  doctorListing: defaultDoctorListing,
};

export function accountHomeOptions(user: Pick<UserAccount, 'type' | 'role' | 'additionalPermissions'>) {
  return accountHomePages.filter(page => canViewPermission(user, page.permission));
}

export function canReceiveAccountApplications(user: UserAccount) {
  return user.type === 'tenant_user' && ['Diretor', 'Gerente', 'Coordenador de Escalas'].includes(user.role)
    && canPerformAction(user, 'escala', 'approve');
}

export function formatAccountPhone(value: string) {
  const clean = value.replace(/\D/g, '');
  const digits = clean.length > 11 && clean.startsWith('55') ? clean.slice(2) : clean;
  if (!digits) return '';
  if (digits.length < 3) return '(' + digits;
  const prefixLength = digits.length === 11 ? 7 : 6;
  const prefix = '(' + digits.slice(0, 2) + ') ' + digits.slice(2, prefixLength);
  return digits.length > prefixLength ? prefix + '-' + digits.slice(prefixLength) : prefix;
}

export function isAccountPhone(value: string) {
  return value === '' || /^\(\d{2}\) \d{4,5}-\d{4}$/.test(value);
}
