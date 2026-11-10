import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function getAuthorizedUser(client: SupabaseClient) {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  // The RPC reads live Auth metadata and profile state, independent of JWT age.
  const { data, error: accessError } = await client.rpc('nv_session_ready');
  return !accessError && data === true ? user : null;
}
