import SaveFeedback from '@/components/SaveFeedback';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import Header from '@/components/Header';
import StoreHydrator from '@/components/StoreHydrator';
import AppBackground from '@/components/AppBackground';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = await createClient();
  if (!client) redirect('/login');
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect('/login');
  return (
    <StoreHydrator>
      <AppBackground />
      <div className="min-h-screen text-text-primary">
        {/* Navigation Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col md:pl-64 min-h-screen pb-16 md:pb-0">
          <Header />
          <SaveFeedback />
          <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    </StoreHydrator>
  );
}
