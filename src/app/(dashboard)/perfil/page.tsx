import type { Metadata } from 'next';
import AccountPage from '@/components/account/AccountPage';

export const metadata: Metadata = { title: 'Minha conta | NV Med' };

export default function ProfilePage() {
  return <AccountPage />;
}
