import BillingNav from '@/components/finance/BillingNav';
import ShiftReportPage from '../../relatorios/plantoes/ShiftReportPage';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const initial = Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));

  return <div className="space-y-4"><BillingNav active="reports"/><ShiftReportPage initial={initial} financial/></div>;
}
