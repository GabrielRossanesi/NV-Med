import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import StoreHydrator from '@/components/StoreHydrator';
import DashboardChrome from '@/components/DashboardChrome';
import type { Viewport } from 'next';

export const viewport: Viewport = { viewportFit: 'cover' };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = await createClient();
  if (!client) redirect('/login');
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect('/login');
  if (user.app_metadata?.must_change_password === true) redirect('/definir-senha?required=1');
  const { data: staff } = await client.from('user_accounts').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (!staff) redirect('/portal');
  return (
    <StoreHydrator>
      <div className="nv-app-shell text-text-primary">
        <Sidebar />

        <DashboardChrome>
          <a href="#conteudo" className="nv-skip-link">Pular para o conteúdo</a>
          <Header />
          <main id="conteudo" tabIndex={-1} className="nv-content isolate mx-auto w-full min-w-0 max-w-[112rem] flex-1 px-4 py-6 max-md:py-3 sm:px-6 xl:px-9 xl:py-8">
            {children}
          </main>
        </DashboardChrome>
      </div>
    </StoreHydrator>
  );
}
