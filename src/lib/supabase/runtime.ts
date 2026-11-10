import 'server-only';
import { validateSupabaseEnvironment } from './environment';

export function hasVerifiedSupabaseRuntime() {
  const { mode, origin } = validateSupabaseEnvironment(process.env);
  if (mode !== process.env.NVMED_BUILT_MODE || origin !== process.env.NVMED_BUILT_SUPABASE_ORIGIN) {
    throw new Error('Destino Supabase diferente do destino validado no build.');
  }
  return Boolean(origin);
}
