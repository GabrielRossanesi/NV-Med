import BillingOverview from '@/components/finance/BillingOverview';
import CompanyFinance from '@/components/finance/CompanyFinance';

export default async function Page({ searchParams }: { searchParams: Promise<{ aba?: string; mes?: string }> }) {
  const query = await searchParams;
  if (!query.aba || query.aba === 'overview' || query.aba === 'reports') return <BillingOverview reports={query.aba === 'reports'}/>;
  const tab = query.aba === 'receivable' || query.aba === 'rates' ? query.aba : 'billing';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.mes || '') ? query.mes : undefined;
  return <CompanyFinance tab={tab} initialMonth={month}/>;
}
