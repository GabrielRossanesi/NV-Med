'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { fetchInitialDataFromSupabase } from '@/services/supabaseService';
import { createClient } from '@/lib/supabase/client';
import { useResolvedTheme } from '@/components/account/useResolvedTheme';
import { usePathname } from 'next/navigation';

export default function StoreHydrator({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const profileSegment = /^\/medicos\/([^/]+)$/.exec(pathname)?.[1];
  const doctorId = profileSegment && profileSegment !== 'credenciamento' ? decodeURIComponent(profileSegment) : '';
  const scope = doctorId ? `doctor:${doctorId}` : pathname === '/medicos' ? 'directory' : 'full';
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [error, setError] = useState('');
  const theme = useResolvedTheme();
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = doctorId ? setTimeout(() => controller.abort(), 25_000) : undefined;
    const client = createClient();
    async function load() {
      try {
        await useStore.persist.rehydrate();
        localStorage.removeItem('nv-med-storage');
        if (!active) return;
        const data = await fetchInitialDataFromSupabase(doctorId
          ? { doctorId, organizationId: useStore.getState().activeOrganizationId, signal: controller.signal }
          : scope === 'directory' ? 'directory' : 'full');
        if (active) {
          useStore.getState().syncWithCloud(data);
          await useStore.getState().loadAccountPreferences();
          if (active) setLoadedScope(scope);
        }
      } catch (e) { if (active) { useStore.getState().clearSession(); setError(controller.signal.aborted ? 'O carregamento demorou demais. Tente novamente.' : e instanceof Error ? e.message : 'Falha ao carregar dados.'); } }
      finally { clearTimeout(timeout); }
    }
    void load();
    const subscription = client?.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { useStore.getState().clearSession(); window.location.replace('/login'); }
    });
    return () => { active = false; controller.abort(); clearTimeout(timeout); subscription?.data.subscription.unsubscribe(); };
  }, [scope, doctorId]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    return () => document.documentElement.classList.remove('dark');
  }, [theme]);
  if (error) return <main className="min-h-screen flex items-center justify-center p-6"><div className="nv-panel max-w-md space-y-4 p-6"><h1 className="text-xl font-semibold">Não foi possível abrir o painel</h1><p role="alert" className="text-text-secondary">{error}</p><div className="flex flex-wrap gap-2"><button className="nv-button" onClick={() => window.location.reload()}>Tentar novamente</button><button className="nv-button-secondary" onClick={async () => { await createClient()?.auth.signOut(); window.location.replace('/login'); }}>Voltar ao login</button></div></div></main>;
  if (loadedScope !== scope) return <div role="status" className="flex min-h-svh items-center justify-center gap-3 text-sm text-text-secondary"><LoaderCircle size={18} className="text-primary motion-safe:animate-spin" aria-hidden="true"/>Carregando seus dados…</div>;
  return <>{children}</>;
}
