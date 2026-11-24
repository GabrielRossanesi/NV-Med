import CompanyFinance from '@/components/finance/CompanyFinance';

export default async function Page({ searchParams }: { searchParams: Promise<{ aba?: string; mes?: string }> }) {
  const query = await searchParams;
  const tab = query.aba === 'receivable' || query.aba === 'rates' ? query.aba : 'billing';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(query.mes || '') ? query.mes : undefined;
  return <CompanyFinance tab={tab} initialMonth={month}/>;
}
