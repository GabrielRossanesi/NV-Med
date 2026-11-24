import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';

export interface BillingClient { id: string; name: string }
export interface BillingContract extends BillingClient { client_id: string }
export interface BillingRate {
  id: string; contract_id: string; unit_id: string | null; sector_id: string | null; specialty: string | null;
  shift_type: string | null; shift_period: string | null; day_kind: string | null;
  valid_from: string; valid_until: string | null;
  revenue_rate: number; medical_rate: number; revenue_premium: number; medical_premium: number;
}
export interface BillingCatalog { clients: BillingClient[]; contracts: BillingContract[]; rates: BillingRate[] | null }
export interface BillingShift {
  id: string; date: string; start_time: string; end_time: string; unit_id: string; sector_id: string | null;
  specialty: string | null; doctor: string; doctor_id: string; ended: boolean;
  contract_id: string | null; invoice_id: string | null; suggested_rate: string | null;
  planned_minutes: number; worked_minutes: number | null; payable_minutes: number | null; billable_minutes: number | null;
  assessed_at: string | null; expected_revenue: number | null; assessed_revenue: number | null; medical_cost: number | null;
}
export interface BillingTotals {
  billed: number; medical_cost: number; received: number; discounts: number; deductions: number; adjustments: number; balance: number;
}
export interface BillingInvoice extends BillingTotals {
  id: string; month: string; contract_id: string; unit_id: string; sector_id: string | null;
  due_on: string; issued_on: string | null; document_ref: string | null;
}
export type BillingMovementKind = 'receipt' | 'discount' | 'deduction' | 'adjustment' | 'reversal';
export interface BillingMovement {
  id: string; kind: BillingMovementKind; amount: number; posted_on: string; note: string | null;
  receipt_path: string | null; reverses: string | null;
}
export interface BillingInvoiceDetail extends BillingInvoice {
  totals: BillingTotals;
  lines: { shift_id: string; date: string; specialty: string | null; doctor: string; billable_minutes: number;
    payable_minutes: number; revenue: number; medical_cost: number }[];
  movements: BillingMovement[];
}
export interface BillingPeriod {
  shifts: BillingShift[]; invoices: BillingInvoice[]; closed_at: string | null;
}

export const billingMovementLabels: Record<BillingMovementKind, string> = {
  receipt: 'Repasse', discount: 'Desconto', deduction: 'Glosa', adjustment: 'Ajuste', reversal: 'Estorno',
};
export const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const hours = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export function financialDate(value: string | null) {
  return value ? value.split('T')[0].split('-').reverse().join('/') : '—';
}

export async function billingRpc<Result = void>(action: string, args: Record<string, unknown>): Promise<Result> {
  const client = createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { data, error } = await client.rpc(action, args);
  if (error) throw new Error(portalError(error));
  return data as Result;
}
