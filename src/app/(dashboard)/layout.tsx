import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import StoreHydrator from '@/components/StoreHydrator';
import DashboardChrome from '@/components/DashboardChrome';
import WorkspaceDataBoundary from '@/components/WorkspaceDataBoundary';
import WorkspaceOverviewProvider from '@/components/WorkspaceOverviewProvider';
import type { Viewport } from 'next';
import { loadStaffBootstrap } from '@/lib/supabase/staffBootstrap';

export const viewport: Viewport = { viewportFit: 'cover' };

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = await createClient();
  const initial = await loadStaffBootstrap(client);
  if ('redirect' in initial) redirect(initial.redirect);
  return (
    <StoreHydrator initial={initial}><WorkspaceOverviewProvider>
      <div className="nv-app-shell text-text-primary">
        <Sidebar />

        <DashboardChrome>
          <a href="#conteudo" className="nv-skip-link">Pular para o conteúdo</a>
          <Header />
          <main id="conteudo" tabIndex={-1} className="nv-content isolate mx-auto w-full min-w-0 max-w-[112rem] flex-1 px-4 py-6 max-md:py-3 sm:px-6 xl:px-9 xl:py-8 [&:has(.nv-schedule)]:max-w-none">
            <WorkspaceDataBoundary>{children}</WorkspaceDataBoundary>
          </main>
        </DashboardChrome>
      </div>
    </WorkspaceOverviewProvider></StoreHydrator>
  );
}
