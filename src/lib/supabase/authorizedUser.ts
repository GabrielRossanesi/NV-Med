import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getAuthorizedUser(client: SupabaseClient) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  // The RPC reads live Auth metadata and profile state, independent of JWT age.
  const { data, error: accessError } = await client.rpc('nv_session_ready');
  return !accessError && data === true ? user : null;
}

export const administrativeMfaMessage = 'Confirme a verificação em duas etapas em Minha conta para continuar.';

export async function getAdministrativeMfaSession(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.rpc('nv_admin_mfa_session');
  return !error && typeof data === 'string' ? data : null;
}
