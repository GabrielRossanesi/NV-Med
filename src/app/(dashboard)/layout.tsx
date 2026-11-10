import SaveFeedback from '@/components/SaveFeedback';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import StoreHydrator from '@/components/StoreHydrator';
import AppBackground from '@/components/AppBackground';
import DashboardChrome from '@/components/DashboardChrome';

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
      <AppBackground />
      <div className="flow-root min-h-screen text-text-primary">
        {/* Navigation Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <DashboardChrome>
          <Header />
          <SaveFeedback />
          <main className="nv-content mx-auto w-full min-w-0 max-w-[90rem] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </DashboardChrome>
      </div>
    </StoreHydrator>
  );
}
