'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Entry = { id: number; actor_name: string; action: string; changed_fields: string[]; details: { previous_email?: string; email?: string; previous_status?: string; status?: string }; created_at: string };
const statusLabels: Record<string, string> = { active: 'Ativo', pending: 'Pendente', inactive: 'Inativo' };
const labels: Record<string, string> = {
  profile_updated: 'Perfil atualizado', account_linked: 'Conta vinculada ao cadastro', email_changed: 'E-mail de acesso alterado',
  access_blocked: 'Acesso bloqueado', access_unblocked: 'Acesso desbloqueado', credential_prepared: 'Cadastro preparado para credenciamento',
  credential_approved: 'Credenciamento aprovado', credential_rejected: 'Credenciamento rejeitado', credential_correction_requested: 'Correções cadastrais solicitadas',
};
const fields: Record<string, string> = { name: 'Nome', phone: 'Telefone', email: 'E-mail', address: 'Endereço', crm: 'CRM', crm_uf: 'UF', cpf: 'CPF', rqe: 'RQE', specialty: 'Especialidade principal', status: 'Status', contract_model: 'Contratação', contract_signed: 'Contrato assinado', approved_specialties: 'Especialidades autorizadas', requested_specialties: 'Especialidades para análise', linked_units: 'Unidades autorizadas', birth_date: 'Nascimento' };
function actionLabel(action: string) {
  if (labels[action]) return labels[action];
  const [verb, result] = action.split('_');
  const operation = ({ invite: 'Convite', reset: 'Redefinição de senha', email: 'Alteração de e-mail', block: 'Bloqueio', unblock: 'Desbloqueio' } as Record<string, string>)[verb] || verb;
  return `${operation} · ${({ requested: 'solicitado', sent: 'concluído', failed: 'falhou' } as Record<string, string>)[result] || result}`;
}
export default function DoctorProfileHistory({ doctorId, revision }: { doctorId: string; revision: number }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await createClient()?.rpc('nv_doctor_history', { target: doctorId });
      if (!live) return;
      if (!result || result.error) setError('Não foi possível carregar o histórico.');
      else { setEntries(result.data); setError(''); }
    })().catch(() => { if (live) setError('Não foi possível carregar o histórico.'); });
    return () => { live = false; };
  }, [doctorId, revision]);
  return <section className="nv-panel space-y-4 p-4 sm:p-6">
    <h3 className="nv-section-title">Histórico de alterações</h3>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!entries && !error && <p role="status" className="text-sm text-text-muted">Carregando histórico…</p>}
    {entries?.length === 0 && <p className="text-sm text-text-muted">Nenhuma alteração registrada após a implantação desta funcionalidade.</p>}
    <ol className="divide-y divide-border">{entries?.map(entry => <li key={entry.id} className="space-y-1 py-3 text-sm">
      <p className="font-medium">{actionLabel(entry.action)}</p><p className="text-xs text-text-muted">{new Date(entry.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · {entry.actor_name}</p>
      {entry.changed_fields.length > 0 && <p className="text-xs text-text-secondary">{entry.changed_fields.map(field => fields[field] || field).join(', ')}</p>}
      {entry.details.email && <p className="break-all text-xs text-text-secondary">{entry.details.previous_email} → {entry.details.email}</p>}
      {entry.details.previous_status && entry.details.status && <p className="text-xs text-text-secondary">{statusLabels[entry.details.previous_status] || entry.details.previous_status} → {statusLabels[entry.details.status] || entry.details.status}</p>}
    </li>)}</ol>
  </section>;
}
