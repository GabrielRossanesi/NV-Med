import type { Shift } from '@/types';

export const financeStateLabels = { pending: 'Pendente', scheduled: 'Programado', paid: 'Pago', overdue: 'Em atraso', cancelled: 'Cancelado' };
export type FinanceState = keyof typeof financeStateLabels;

export function financeState(shift: Pick<Shift, 'status' | 'paymentStatus' | 'paymentDueDate'>, today: string): FinanceState {
  if (shift.paymentStatus === 'paid') return 'paid';
  if (shift.status === 'cancelled') return 'cancelled';
  if (!shift.paymentDueDate) return 'pending';
  return shift.paymentDueDate < today ? 'overdue' : 'scheduled';
}

export function saoPauloDate(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
