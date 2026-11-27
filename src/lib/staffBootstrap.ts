import type { Organization, UserAccount } from '@/types';
import type { AccountPreferences } from '@/lib/account';

export type StaffBootstrapData = { currentUser: UserAccount; organizations: Organization[] };
export type StaffBootstrap = {
  data?: StaffBootstrapData;
  error?: string;
  preferences: AccountPreferences | null;
  preferencesError: boolean;
};
