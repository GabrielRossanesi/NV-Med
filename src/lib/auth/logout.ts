import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/store/useStore';

export async function logoutCurrentSession() {
  if (!window.dispatchEvent(new Event('nv:account-signout', { cancelable: true }))) return;
  try {
    const client = createClient();
    if (client) {
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
  } catch {
    window.dispatchEvent(new Event('nv:account-signout-failed'));
    throw new Error('Não foi possível sair da conta. Tente novamente.');
  }

  useStore.getState().clearSession();
  window.location.replace('/login');
}
