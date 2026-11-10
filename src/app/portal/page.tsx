import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PortalHome from './PortalHome';

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const { empresa } = await searchParams;
  const organization = typeof empresa === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(empresa) ? empresa : '';
  const client = await createClient();
  const { data } = client ? await client.auth.getUser() : { data: null };
  const user = data?.user;
  if (user?.app_metadata?.must_change_password === true) redirect('/definir-senha?required=1');
  return <PortalHome email={user?.email || ''} initialOrganization={organization} />;
}
