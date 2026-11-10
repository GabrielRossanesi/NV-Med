export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'correction_requested';

export const enrollmentStatusLabels: Record<EnrollmentStatus, string> = {
  pending: 'Pendente de aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  correction_requested: 'Correções solicitadas',
};

export function portalError(error: { code?: string; message: string }) {
  return ['22023', '23505', '42501'].includes(error.code || '') && !error.message.startsWith('permission denied')
    ? error.message
    : 'Não foi possível concluir a operação. Tente novamente.';
}
