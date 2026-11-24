export const companyFinanceReports = {
  billing_client: 'Faturamento por contratante',
  billing_contract: 'Faturamento por contrato',
  billing_unit: 'Faturamento por unidade e setor',
  hours: 'Horas faturáveis e remuneráveis',
  payments: 'Pagamentos médicos',
  receipts: 'Repasses recebidos e pendentes',
  gross_contract: 'Resultado bruto por contrato',
  gross_unit: 'Resultado bruto por unidade e especialidade',
  monthly: 'Fechamento financeiro mensal',
} as const;
export type CompanyFinanceReport = keyof typeof companyFinanceReports;
export const companyFinanceFilterKeys = ['unit','sector','client','contract','doctor','specialty','state'] as const;
export type CompanyFinanceRegime = 'competence' | 'cash';

export interface CompanyOverview {
  expected_revenue: number | null; assessed_revenue: number | null; billed: number | null;
  medical_cost: number | null; received: number | null; receivable: number | null; overdue: number | null;
  paid: number | null; payable: number | null; gross_result: number | null; gross_margin: number | null;
  net_cash: number | null; worked_minutes: number | null; billable_minutes: number | null;
  paid_count: number; payable_count: number; missing_count: number; invoice_count: number;
  invoice_scope_limited: boolean;
  timeline: { month: string; revenue: number | null; cost: number | null }[];
  periods: { month: string; closed_at: string | null }[];
}

export const cashFinanceReports: CompanyFinanceReport[] = ['payments','receipts'];

export function completeMonthRange(first: string, last: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(first) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(last)) return null;
  const [year, month] = last.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return first + '-01' <= end ? { start: first + '-01', end } : null;
}
