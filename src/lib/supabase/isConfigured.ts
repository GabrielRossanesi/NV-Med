/**
 * Verifica se as credenciais do Supabase foram configuradas no ambiente.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NVMED_BUILT_SUPABASE_ORIGIN && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
