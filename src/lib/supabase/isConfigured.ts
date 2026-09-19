/**
 * Verifica se as credenciais do Supabase foram configuradas no ambiente.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return Boolean(
    url &&
    key &&
    url.trim() !== '' &&
    key.trim() !== '' &&
    !url.includes('sua-empresa') &&
    url.startsWith('http')
  );
}
