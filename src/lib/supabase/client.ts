import { createBrowserClient } from '@supabase/ssr';
import { isSupabaseConfigured } from './isConfigured';

/**
 * Retorna o cliente Supabase para execução no navegador (Frontend).
 * Se as credenciais não estiverem presentes, retorna null para fallback seguro.
 */
export function createClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createBrowserClient(supabaseUrl, supabaseKey);
}
