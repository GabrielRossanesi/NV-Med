'use client';

import { useEffect, useState } from 'react';
import { Copy, ExternalLink, KeyRound, LockKeyhole, MailPlus, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { authFlowUrl } from '@/lib/appOrigin';
import { withAbortTimeout } from '@/lib/requestTimeout';
import Dialog from './Dialog';

type Access = { email: string; linked: boolean; status: 'not_released' | 'pending' | 'active' | 'blocked'; last_sign_in_at: string | null; can_manage: boolean; revision: string; record_inactive: boolean; auth_blocked: boolean };
type Action = 'invite' | 'reset' | 'email' | 'block' | 'unblock';
const statuses = { not_released: 'Não liberado', pending: 'Convite pendente', active: 'Ativo', blocked: 'Bloqueado' };
const actions: Record<Action, string> = { invite: 'Liberar acesso ao portal', reset: 'Redefinir senha', email: 'Alterar e-mail de acesso', block: 'Bloquear acesso', unblock: 'Desbloquear acesso' };

export default function DoctorPortalAccess({ doctorId, organizationId, revision, onChanged }: {
  doctorId: string; organizationId: string; revision: number; onChanged: () => void;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await createClient()?.rpc('nv_doctor_access', { target: doctorId });
        if (!result || result.error) throw new Error('Não foi possível consultar o acesso ao portal.');
        if (live) setAccess(result.data);
      } catch (failure) { if (live) setError((failure as Error).message); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [doctorId, revision, reload]);
  function open(next: Action) { setAction(next); setError(''); setNotice(''); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!access || !action) return;
    const email = new FormData(event.currentTarget).get('email');
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await withAbortTimeout(signal => fetch('/api/admin/doctors/' + encodeURIComponent(doctorId) + '/access', {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email, revision: access.revision, confirmed: true }),
      }), { timeoutMs: 45_000, message: 'A solicitação demorou demais. Atualize o status antes de tentar novamente.' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível concluir a ação.');
      setNotice(result.message); setAction(null); onChanged();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); setReload(v => v + 1); }
  }
  async function copy() {
    if (!access) return;
    try {
      await navigator.clipboard.writeText(`E-mail: ${access.email}\nPortal Médico: ${authFlowUrl('/portal', window.location.origin, organizationId).href}`);
      setNotice('E-mail e URL do portal copiados.'); setError('');
    } catch { setError('Não foi possível copiar. Copie o e-mail e o endereço do portal manualmente.'); }
  }
  return <section className="nv-panel space-y-5 p-4 sm:p-6" aria-label="Acesso ao Portal Médico">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="nv-section-title flex items-center gap-2"><ShieldCheck size={19} className="text-primary"/>Acesso ao Portal Médico</h3><p className="mt-1 text-xs text-text-muted">A liberação do portal é individual e independente do cadastro e das escalas.</p></div>
      <a className="nv-button-secondary" href={'/portal?empresa=' + encodeURIComponent(organizationId)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>Acesso ao portal</a>
    </div>
    {loading && <p role="status" className="text-sm text-text-muted">Consultando acesso…</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {!access && !loading && <button className="nv-button-secondary" onClick={() => { setError(''); setLoading(true); setReload(v => v + 1); }}>Tentar novamente</button>}
    {access && <>
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        {access.can_manage && <div className="min-w-0"><dt className="text-text-muted">E-mail de acesso</dt><dd className="mt-1 break-all font-medium">{access.email || 'Não informado'}</dd></div>}
        <div><dt className="text-text-muted">Status da conta</dt><dd className={'nv-badge mt-1 ' + (access.status === 'active' ? 'bg-success/10 text-success' : access.status === 'blocked' ? 'bg-danger/10 text-danger' : 'bg-surface-muted text-text-secondary')}>{statuses[access.status]}</dd></div>
        {access.can_manage && <div><dt className="text-text-muted">Último acesso</dt><dd className="mt-1">{access.last_sign_in_at ? new Date(access.last_sign_in_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : 'Nenhum acesso registrado'}</dd></div>}
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {access.can_manage && <>
          {(access.status === 'not_released' || access.status === 'pending') && <button className="nv-button" disabled={busy} onClick={() => open('invite')}><MailPlus size={16}/>{access.status === 'not_released' ? actions.invite : 'Reenviar convite'}</button>}
          <button className="nv-button-secondary" disabled={busy} onClick={() => open('email')}>{actions.email}</button>
          {access.status === 'active' && <button className="nv-button-secondary" disabled={busy} onClick={() => open('reset')}><KeyRound size={16}/>{actions.reset}</button>}
          {access.linked && <button className="nv-button-secondary" disabled={busy} onClick={() => open(access.auth_blocked ? 'unblock' : 'block')}><LockKeyhole size={16}/>{access.auth_blocked ? actions.unblock : actions.block}</button>}
        </>}
        {access.can_manage && <button className="nv-button-secondary" onClick={() => void copy()} disabled={!access.email}><Copy size={16}/>Copiar dados de acesso</button>}
      </div>
      {!access.can_manage && <p className="text-xs text-text-muted">A gestão deste acesso exige permissão específica.</p>}
      {access.record_inactive && <p className="text-xs text-warning">O cadastro médico está inativo. Reative o cadastro para permitir o uso do portal; desbloquear a conta não altera essa situação.</p>}
    </>}
    {action && access && <Dialog title={action === 'invite' && access.linked ? 'Reenviar convite de acesso' : actions[action]} onClose={() => { if (!busy) setAction(null); }}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-sm text-text-secondary">{action === 'invite' ? 'Será enviado um link seguro para o médico definir a própria senha. O cadastro, o credenciamento e os vínculos existentes serão preservados.' : action === 'reset' ? 'Será enviado um link de redefinição para o e-mail cadastrado. A senha atual permanece privada.' : action === 'email' ? 'O novo e-mail será aplicado à autenticação e aos cadastros vinculados a esta conta.' : action === 'block' ? 'O acesso será bloqueado em todas as empresas vinculadas a esta conta. O cadastro e as escalas serão preservados.' : 'A conta será desbloqueada em todas as empresas vinculadas. O status do cadastro e o credenciamento continuam sendo verificados.'}</p>
        {action === 'email' ? <label className="nv-label">Novo e-mail de acesso<input className="nv-input" name="email" type="email" defaultValue={access.email} maxLength={254} required disabled={busy}/></label>
          : <p className="break-all text-sm font-semibold">{access.email || 'Cadastre um e-mail válido antes de liberar o acesso.'}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={busy} onClick={() => setAction(null)}>Cancelar</button><button className="nv-button" disabled={busy || (action !== 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(access.email))}>{busy ? 'Processando…' : 'Confirmar operação'}</button></div>
      </form>
    </Dialog>}
  </section>;
}
