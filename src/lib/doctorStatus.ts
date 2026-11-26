import type { DoctorStatus } from '@/types';

export const doctorStatusActions = {
  active: { title: 'Ativar cadastro do médico?', confirmLabel: 'Ativar cadastro', success: 'Cadastro do médico ativado com sucesso.', tone: 'success', description: 'O médico passará a ter o cadastro ativo.' },
  pending: { title: 'Alterar cadastro para pendente?', confirmLabel: 'Alterar para pendente', success: 'Cadastro do médico alterado para pendente.', tone: 'warning', description: 'O cadastro ficará pendente para análise.' },
  inactive: { title: 'Inativar cadastro do médico?', confirmLabel: 'Inativar cadastro', success: 'Cadastro do médico inativado com sucesso.', tone: 'danger', description: 'O cadastro ficará inativo para novas atribuições.' },
} as const satisfies Record<DoctorStatus, object>;

// Only recognized business restrictions become UI copy. Never pass database text through.
export function doctorStatusError(error: { code?: string; message?: string; status?: number } | null | undefined) {
  if (error?.code === '42501' || error?.status === 403) return 'Você não possui permissão para alterar este cadastro.';
  if (error?.code === 'PGRST202') return 'A alteração de status ainda não está disponível. Solicite a atualização do sistema ao administrador.';
  if (error?.code === '22023' && error.message === 'Preencha a chave PIX e seu tipo antes de concluir o cadastro.') return 'Complete a chave PIX e seu tipo em Dados bancários antes de ativar o cadastro. Se não tiver acesso, procure o responsável financeiro.';
  if (error?.code === '22023' && error.message === 'O cadastro mudou. Reabra o formulário antes de salvar.') return 'O cadastro foi alterado por outra pessoa. Confira os dados atuais antes de tentar novamente.';
  return 'Não foi possível alterar o status do cadastro. Tente novamente.';
}

export function logDoctorStatusError(error: { code?: string; status?: number; name?: string } | null | undefined) {
  // Diagnostic metadata only: no medical identifiers, row values, SQL details or tokens.
  console.error('[NV Med] doctor.status', { code: error?.code || 'CONNECTION_ERROR', status: error?.status, name: error?.name });
}
