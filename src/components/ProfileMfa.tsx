'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';
import { notify } from '@/lib/notifications';
import { accountSecurityRequest, AccountSecurityError } from '@/lib/accountSecurityClient';
import Dialog from '@/components/Dialog';
import { AccountLoading, AccountSection, AccountValue } from '@/components/account/AccountSection';
import { AccountPassword, AccountSessions } from '@/components/account/AccountSecurityActions';

type Client = NonNullable<ReturnType<typeof createClient>>;
type Factor = { id: string; friendly_name?: string; factor_type: string };
type Enrollment = { id: string; qr: string };
type MfaStatus = { currentLevel: string | null; configured: boolean; factors: Factor[] };

export function useAccountMfa() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const invalidate = useCallback(() => { revision.current++; }, []);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const client = createClient();
      if (!client) throw new Error();
      const [factors, assurance] = await Promise.all([
        client.auth.mfa.listFactors(), client.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (factors.error || assurance.error) throw new Error();
      const verified = factors.data.all.filter(factor => factor.status === 'verified' && factor.factor_type !== 'recovery_code');
      if (request === revision.current) {
        setStatus({ configured: verified.length > 0,
          currentLevel: assurance.data.currentLevel, factors: verified });
        setError('');
      }
    } catch {
      if (request === revision.current) {
        setStatus(null);
        setError('Não foi possível consultar a verificação em duas etapas.');
      }
    }
  }, []);

  useEffect(() => {
    const client = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function queueRefresh() {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 0);
    }
    queueRefresh();
    const subscription = client?.auth.onAuthStateChange(event => {
      if (event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'USER_UPDATED') queueRefresh();
    });
    window.addEventListener('focus', queueRefresh);
    return () => {
      invalidate();
      clearTimeout(timer);
      window.removeEventListener('focus', queueRefresh);
      subscription?.data.subscription.unsubscribe();
    };
  }, [invalidate, refresh]);

  return { status, error, refresh };
}

function factorName(factor: Factor, index: number) {
  return factor.friendly_name || (factor.factor_type === 'totp' ? 'Aplicativo autenticador ' + (index + 1)
    : factor.factor_type === 'phone' ? 'Telefone'
      : factor.factor_type === 'webauthn' ? 'Chave de segurança' : 'Método de autenticação');
}

export default function ProfileMfa({ status, error, refresh }: ReturnType<typeof useAccountMfa>) {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [remove, setRemove] = useState<Factor | null>(null);
  const [selection, setSelection] = useState('');
  const [code, setCode] = useState('');
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const factors = status?.factors ?? [];
  const totp = factors.filter(factor => factor.factor_type === 'totp');
  const factorId = enrollment?.id || totp.find(factor => factor.id === selection)?.id || totp[0]?.id;
  const verified = status?.currentLevel === 'aal2';

  async function run(action: (client: Client) => Promise<void>) {
    const client = createClient();
    if (!client || busy) return;
    setBusy(true);
    setIssue('');
    try { await action(client); }
    catch (failure) {
      if (failure instanceof AccountSecurityError && failure.code === 'step_up') {
        setRemove(null);
        if (totp.length) {
          setCode('');
          setVerifyOpen(true);
          notify.info('Confirme um código do autenticador para continuar.', { withinDialog: true });
        } else setIssue('Entre novamente com sua senha e repita a operação.');
      } else setIssue(failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.');
    } finally { setBusy(false); }
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) return;
    void run(async client => {
      const { error: failure } = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (failure) throw new Error('Código inválido ou expirado. Confira o aplicativo e tente novamente.');
      const registered = Boolean(enrollment);
      setEnrollment(null);
      setVerifyOpen(false);
      setCode('');
      await refresh();
      notify.success(registered ? 'Autenticador cadastrado.' : 'Sessão verificada.');
    });
  }

  function openConfirmation() {
    setCode('');
    setIssue('');
    setVerifyOpen(true);
  }

  function cancelEnrollment() {
    if (!enrollment) return;
    void run(async client => {
      const { error: failure } = await client.auth.mfa.unenroll({ factorId: enrollment.id });
      if (failure) throw new Error('Não foi possível cancelar o cadastro. Tente novamente.');
      setEnrollment(null);
      setCode('');
    });
  }

  function revoke(factor: Factor) {
    void run(async client => {
      await accountSecurityRequest({ operation: 'remove', factorId: factor.id });
      setRemove(null);
      const { error: refreshError } = await client.auth.refreshSession();
      await refresh();
      notify.success('Autenticador removido.');
      if (refreshError) notify.warning('Entre novamente para atualizar a verificação desta sessão.');
    });
  }

  return <>
    <AccountSection id="verificacao-em-duas-etapas" title="Verificação em duas etapas">
      {!status && !error && <AccountLoading label="Consultando autenticadores" />}
      {error && <div className="space-y-2">
        <p role="alert" className="text-sm text-danger">{error}</p>
        <button type="button" className="nv-button-secondary" onClick={() => void refresh()}>Tentar novamente</button>
      </div>}
      {status && <>
        <dl className="grid gap-4 sm:grid-cols-2">
          <AccountValue label="Proteção da conta">{status.configured ? 'Configurada' : 'Não configurada'}</AccountValue>
          <AccountValue label="Sessão atual">{verified ? 'Verificada em duas etapas'
            : status.currentLevel === 'aal1' ? 'Sem verificação em duas etapas' : 'Nível indisponível'}</AccountValue>
        </dl>
        <div className="border-t border-border pt-3">
          <h3 className="text-sm font-semibold">Autenticadores cadastrados <span className="ml-1 font-normal text-text-muted">({factors.length})</span></h3>
          {factors.length === 0 ? <p className="mt-2 text-sm text-text-muted">Nenhum autenticador cadastrado.</p>
            : <ul className="mt-1 divide-y divide-border">{factors.map((factor, index) => <li key={factor.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="break-all">{factorName(factor, index)}</span>
              {factor.factor_type === 'totp' && totp.length > 1 && <button type="button" className="nv-button-secondary min-h-11"
                disabled={busy} aria-label={'Remover ' + factorName(factor, index)} onClick={() => { setIssue(''); setRemove(factor); }}>Remover</button>}
            </li>)}</ul>}
        </div>
        <div className="flex flex-wrap gap-2">
          {totp.length > 0 && <button type="button" className="nv-button-secondary" onClick={openConfirmation} disabled={busy}>
            {verified ? 'Renovar verificação' : 'Verificar sessão'}
          </button>}
          <button type="button" className={totp.length ? 'nv-button-secondary' : 'nv-button'} disabled={busy}
            onClick={() => void run(async () => {
              const result = await accountSecurityRequest({ operation: 'enroll' });
              setEnrollment(result.enrollment);
              setCode('');
            })}>{busy && !remove && !enrollment && !verifyOpen ? 'Aguarde…'
              : totp.length ? 'Adicionar autenticador' : 'Cadastrar autenticador'}</button>
        </div>
        {totp.length === 1 && <p className="text-sm text-text-muted">Para remover o último aplicativo, confirme outro autenticador primeiro.</p>}
      </>}
      {issue && !enrollment && !verifyOpen && !remove && <p role="alert" className="text-sm text-danger">{issue}</p>}
    </AccountSection>

    <AccountPassword onStepUp={totp.length ? openConfirmation : undefined} />
    <AccountSessions onStepUp={totp.length ? openConfirmation : undefined} />
    <AccountSection id="recuperacao" title="Recuperação de conta">
      <p className="text-sm text-text-secondary">Cadastre um autenticador em outro dispositivo. Se perder todos os autenticadores, procure o responsável pelo acesso da sua organização.</p>
    </AccountSection>

    {(enrollment || verifyOpen) && <Dialog title={enrollment ? 'Cadastrar autenticador' : 'Verificar sessão'} closeDisabled={busy}
      onClose={() => enrollment ? cancelEnrollment() : setVerifyOpen(false)}>
      <form className="space-y-4" onSubmit={verify}>
        {enrollment && <>
          <p className="text-sm text-text-secondary">Escaneie o QR Code no aplicativo autenticador. A confirmação pode encerrar outras sessões.</p>
          <Image src={enrollment.qr} alt="QR Code de cadastro do autenticador" width={176} height={176}
            unoptimized className="max-w-full rounded bg-white p-2" />
        </>}
        {!enrollment && totp.length > 1 && <label className="nv-label">Autenticador
          <select className="nv-input" value={factorId} disabled={busy} onChange={event => { setSelection(event.target.value); setCode(''); }}>
            {totp.map((factor, index) => <option key={factor.id} value={factor.id}>{factorName(factor, index)}</option>)}
          </select>
        </label>}
        <label className="nv-label">Código de seis dígitos
          <input className="nv-input" value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" autoFocus />
        </label>
        {issue && <p role="alert" className="text-sm text-danger">{issue}</p>}
        <button className="nv-button" disabled={busy || code.length !== 6}>{busy ? 'Processando…' : 'Confirmar código'}</button>
      </form>
    </Dialog>}
    {remove && <Dialog title="Remover autenticador?" onClose={() => setRemove(null)} closeDisabled={busy}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="nv-button-secondary" onClick={() => setRemove(null)} disabled={busy} autoFocus>Cancelar</button>
        <button type="button" className="nv-button" onClick={() => revoke(remove)} disabled={busy}>{busy ? 'Removendo…' : 'Remover autenticador'}</button>
      </div>}>
      <p className="text-sm text-text-secondary">O aplicativo deixa de gerar códigos válidos. Você pode precisar verificar esta sessão novamente.</p>
      {issue && <p role="alert" className="mt-2 text-sm text-danger">{issue}</p>}
    </Dialog>}
  </>;
}

