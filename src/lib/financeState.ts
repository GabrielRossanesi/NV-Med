import type { Shift } from '@/types';

export const financeStateLabels = { pending: 'Pendente', scheduled: 'Programado', paid: 'Pago', partial: 'Pago parcialmente', overdue: 'Em atraso', cancelled: 'Cancelado', unassigned: 'Sem médico' };
export type FinanceState = keyof typeof financeStateLabels;

export function paymentBalance(shift: Pick<Shift, 'status' | 'paymentAmount' | 'paidAmount' | 'paymentStatus'>) {
  if (shift.status === 'cancelled' || shift.paymentAmount == null) return 0;
  return Math.max(0, Math.round(shift.paymentAmount * 100) - Math.round((shift.paidAmount
    ?? (shift.paymentStatus === 'paid' ? shift.paymentAmount : 0)) * 100)) / 100;
}

export function financeState(shift: Pick<Shift, 'status' | 'paymentStatus' | 'paymentDueDate' | 'paymentAmount' | 'paidAmount'>, today: string): FinanceState {
  if (shift.paymentStatus === 'paid') return paymentBalance(shift) > 0 ? 'partial' : 'paid';
  if (shift.status === 'cancelled') return 'cancelled';
  if (!shift.paymentDueDate) return 'pending';
  return shift.paymentDueDate < today ? 'overdue' : 'scheduled';
}

export function saoPauloDate(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
