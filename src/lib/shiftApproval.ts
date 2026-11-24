import type { Shift, ShiftApproval } from '@/types';

export const shiftApprovalLabels: Record<ShiftApproval, string> = {
  pending: 'Aguardando confirmação',
  doctor: 'Confirmado pelo médico',
  administrative: 'Aprovado pelo administrativo',
  automatic: 'Aprovado automaticamente',
  legacy: 'Aprovação legada sem origem registrada',
};

export const automaticShiftApprovalMessage = 'Plantão aprovado automaticamente por expiração do prazo de confirmação.';

export function shiftEditRestriction(shift: Shift | undefined, ended: boolean, canEditPast: boolean) {
  if (!shift || !ended) return '';
  if (shift.approvalSource === 'doctor' || shift.approvalSource === 'legacy') {
    return 'Os dados operacionais deste plantão encerrado estão protegidos pela confirmação.';
  }
  if (!canEditPast) return 'Seu acesso não permite editar plantões encerrados.';
  if (shift.paymentStatus === 'paid' || shift.paidAt || shift.paidAmount != null) {
    return 'Use o fluxo de ajuste financeiro para alterar este plantão com pagamento registrado.';
  }
  return '';
}
