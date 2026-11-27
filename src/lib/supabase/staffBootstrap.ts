import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaffBootstrap } from '@/lib/staffBootstrap';
import { mapOrgFromDb, mapUserFromDb, type DbOrganization, type DbUserAccount } from '@/services/supabaseService';

// Request-local only: never cache a staff profile or preferences between users.
export async function loadStaffBootstrap(client: SupabaseClient | null): Promise<StaffBootstrap | { redirect: string }> {
  if (!client) return { redirect: '/login' };
  try {
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return { redirect: '/login' };
    if (user.app_metadata?.must_change_password === true) return { redirect: '/definir-senha?required=1' };
    const [profile, session] = await Promise.all([
      client.from('user_accounts').select('*').eq('auth_user_id', user.id).eq('status', 'active').maybeSingle(),
      client.rpc('nv_session_ready'),
    ]);
    if (profile.error || session.error) throw new Error();
    if (session.data !== true) return { redirect: '/login' };
    if (!profile.data) return { redirect: '/portal' };
    const staff = profile.data as DbUserAccount;
    if (staff.auth_user_id !== user.id || staff.status !== 'active') throw new Error();
    if (staff.type !== 'saas_admin' && !staff.organization_id) throw new Error();
    const currentUser = mapUserFromDb(staff);
    currentUser.email = user.email || currentUser.email;

    async function organizations() {
      const rows: DbOrganization[] = [];
      for (let offset = 0; ; offset += 500) {
        let query = client!.from('organizations').select('*').order('id').range(offset, offset + 499);
        if (staff.type !== 'saas_admin') query = query.eq('id', staff.organization_id!);
        const { data, error } = await query.overrideTypes<DbOrganization[], { merge: false }>();
        if (error) throw new Error();
        rows.push(...data);
        if (data.length < 500) return rows.map(mapOrgFromDb);
      }
    }
    const avatar = async () => {
      if (!currentUser.avatar) return;
      const { data } = await client!.storage.from('profile-avatars').createSignedUrl(currentUser.avatar, 3600);
      currentUser.avatar = data?.signedUrl || '';
    };
    const [companies, preferences] = await Promise.all([
      organizations(), client.rpc('nv_account_preferences'), avatar(),
    ]);
    return { data: { currentUser, organizations: companies }, preferences: preferences.error ? null : preferences.data,
      preferencesError: Boolean(preferences.error) };
  } catch {
    return { error: 'Não foi possível carregar sua sessão. Tente novamente.', preferences: null, preferencesError: true };
  }
}
