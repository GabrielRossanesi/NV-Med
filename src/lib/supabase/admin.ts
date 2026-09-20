import 'server-only';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';

/**
 * Cliente com privilégios administrativos (service_role) para execução segura exclusiva na Vercel (backend).
 * NUNCA exponha esta chave no frontend.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createSupabaseAdmin(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
