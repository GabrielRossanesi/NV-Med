import { canPerformAction, isScheduleAdministrator } from './permissions.ts';
import type { UserAccount } from '../types/index.ts';

type EditorUser = Pick<UserAccount, 'id' | 'authUserId' | 'organizationId' | 'type' | 'role' | 'status' | 'additionalPermissions'>;
export function canUseScheduleEditor(user: EditorUser, organizationId: string, session: { userId: string; organizationId: string }) {
  return Boolean(organizationId) && session.organizationId === organizationId && session.userId === (user.authUserId || user.id)
    && user.status === 'active' && (user.type === 'saas_admin' || user.organizationId === organizationId)
    && isScheduleAdministrator(user) && canPerformAction(user, 'escala', 'edit');
}
