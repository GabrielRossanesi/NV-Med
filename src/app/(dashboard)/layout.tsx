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
  return (
    <StoreHydrator>
      <AppBackground />
      <div className="min-h-screen text-text-primary">
        {/* Navigation Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <DashboardChrome>
          <Header />
          <SaveFeedback />
          <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </DashboardChrome>
      </div>
    </StoreHydrator>
  );
}
