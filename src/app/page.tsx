import { redirect } from 'next/navigation';
import { accountHomePages } from '@/lib/account';
import { createClient } from '@/lib/supabase/server';

export default async function RootPage() {
  const preferences = await (await createClient())?.rpc('nv_account_preferences');
  const home = accountHomePages.find(page => page.value === preferences?.data?.homePage);
  redirect(home?.value || '/dashboard');
}
