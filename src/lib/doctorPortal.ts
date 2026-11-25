export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'correction_requested';

export const enrollmentStatusLabels: Record<EnrollmentStatus, string> = {
  pending: 'Pendente de aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  correction_requested: 'Correções solicitadas',
};

export function portalError(error: { code?: string; message: string }) {
  if (error.code === 'P0001' && error.message === 'Selecione um médico ativo da mesma empresa.') {
    return 'O cadastro do médico precisa estar ativo. Para vínculos provisórios, conclua o cadastro e o credenciamento.';
  }
  return ['22023', '23505', '42501'].includes(error.code || '') && !error.message.startsWith('permission denied')
    ? error.message
    : 'Não foi possível concluir a operação. Tente novamente.';
}
