'use client';

import { Monitor } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Dialog from '@/components/Dialog';
import { AccountLoading, AccountSection } from './AccountSection';
import { accountDateTime, accountSecurityRequest, AccountSecurityError } from '@/lib/accountSecurityClient';
import { getPasswordChecks } from '@/lib/passwordPolicy';
import { createClient } from '@/lib/supabase/client';
import { notify } from '@/lib/notifications';

const passwordLabels = {
  length: '12 a 72 caracteres',
  lowercase: 'Letra minúscula',
  uppercase: 'Letra maiúscula',
  number: 'Número',
  symbol: 'Símbolo',
  noWhitespace: 'Sem espaços',
};

type StepUp = { onStepUp?: () => void };

function StepUpMessage({ onStepUp }: StepUp) {
  return onStepUp ? <button type="button" className="nv-button-secondary" onClick={onStepUp}>Verificar sessão</button>
    : <p className="text-sm text-text-secondary">Entre novamente com sua senha e repita a operação.</p>;
}

export function AccountPassword({ onStepUp }: StepUp) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [nonce, setNonce] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showNonce, setShowNonce] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [open, setOpen] = useState(false);
  const [requiresStepUp, setRequiresStepUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requirements = getPasswordChecks(password);
  const lengthValid = new TextEncoder().encode(password).length <= 72 && requirements.length;
  const matching = password === confirmation;
  const ready = lengthValid && Object.values(requirements).every(Boolean) && matching &&
    (!showNonce || nonce.length >= 6) && (!showCurrent || Boolean(currentPassword));

  function close() {
    setOpen(false);
    setPassword('');
    setConfirmation('');
    setNonce('');
    setCurrentPassword('');
    setShowNonce(false);
    setCodeSent(false);
    setShowCurrent(false);
    setError('');
  }

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    setRequiresStepUp(false);
    const finish = notify.saving();
    try {
      await accountSecurityRequest({
        operation: 'password', password, confirmation,
        ...(showNonce && { nonce }), ...(showCurrent && { currentPassword }),
      });
      close();
      notify.success('Senha atualizada.');
    } catch (failure) {
      if (failure instanceof AccountSecurityError) {
        if (failure.code === 'step_up') {
          setOpen(false);
          setRequiresStepUp(true);
          return;
        }
        if (failure.code === 'nonce') setShowNonce(true);
        if (failure.code === 'current_password') setShowCurrent(true);
      }
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a senha.');
    } finally { finish(); setBusy(false); }
  }

  async function requestCode() {
    setBusy(true);
    setError('');
    try {
      await accountSecurityRequest({ operation: 'passwordChallenge' });
      setCodeSent(true);
      notify.success('Código de confirmação enviado.', { withinDialog: true });
    } catch (failure) {
      if (failure instanceof AccountSecurityError && failure.code === 'step_up') {
        setOpen(false);
        setRequiresStepUp(true);
      } else setError('Não foi possível enviar o código. Tente novamente.');
    } finally { setBusy(false); }
  }

  return <AccountSection id="senha" title="Senha de acesso">
    <div className="flex flex-wrap gap-2">
      <button type="button" className="nv-button-secondary" onClick={() => setOpen(true)}>Alterar senha</button>
      {requiresStepUp && <StepUpMessage onStepUp={onStepUp} />}
    </div>
    {open && <Dialog title="Alterar senha" closeDisabled={busy} onClose={close}>
      <form onSubmit={update} className="space-y-4">
        {showCurrent && <label className="nv-label">Senha atual
          <input className="nv-input" type="password" autoComplete="current-password" value={currentPassword}
            maxLength={256} onChange={event => setCurrentPassword(event.target.value)} disabled={busy} required />
        </label>}
        <label className="nv-label">Nova senha
          <input className="nv-input" type="password" autoComplete="new-password" value={password} maxLength={72}
            onChange={event => setPassword(event.target.value)} aria-describedby="account-password-requirements" disabled={busy} required autoFocus />
        </label>
        <ul id="account-password-requirements" className="grid gap-1 text-xs sm:grid-cols-2">
          {(Object.keys(requirements) as (keyof typeof requirements)[]).map(key => {
            const met = key === 'length' ? lengthValid : Boolean(password) && requirements[key];
            return <li key={key} className={met ? 'text-success' : 'text-text-muted'}>
              <span className="sr-only">{met ? 'Atendido. ' : 'Pendente. '}</span><span aria-hidden="true">{met ? '✓ ' : '○ '}</span>{passwordLabels[key]}
            </li>;
          })}
        </ul>
        <label className="nv-label">Confirmar nova senha
          <input className="nv-input" type="password" autoComplete="new-password" value={confirmation}
            maxLength={72} onChange={event => setConfirmation(event.target.value)} required disabled={busy}
            aria-invalid={Boolean(confirmation) && !matching} />
          {confirmation && !matching && <span className="text-sm text-danger">As senhas precisam ser iguais.</span>}
        </label>
        {showNonce && <div className="space-y-2">
          <button type="button" className="nv-button-secondary" onClick={() => void requestCode()} disabled={busy}>
            {codeSent ? 'Reenviar código' : 'Enviar código de confirmação'}
          </button>
          <label className="nv-label">Código de confirmação
            <input className="nv-input" value={nonce} onChange={event => setNonce(event.target.value.replace(/\D/g, '').slice(0, 10))}
              autoComplete="one-time-code" inputMode="numeric" disabled={busy} required />
          </label>
        </div>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="nv-button-secondary" onClick={close} disabled={busy}>Cancelar</button>
          <button className="nv-button" disabled={!ready || busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
        </div>
      </form>
    </Dialog>}
  </AccountSection>;
}

type Session = { key: number; current: boolean; createdAt: string; browser?: string; system?: string };

export function AccountSessions({ onStepUp }: StepUp) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [requiresStepUp, setRequiresStepUp] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const load = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    let active = true;
    const client = createClient();
    async function read() {
      try {
        const result = await client?.rpc('nv_account_sessions');
        if (!result || result.error) throw new Error();
        if (active) { setSessions(result.data); setLoadError(false); }
      } catch { if (active) setLoadError(true); }
    }
    void read();
    const subscription = client?.auth.onAuthStateChange(event => {
      if (event === 'MFA_CHALLENGE_VERIFIED') load();
    });
    return () => { active = false; subscription?.data.subscription.unsubscribe(); };
  }, [load, revision]);

  async function revoke() {
    setError('');
    setBusy(true);
    const finish = notify.saving();
    try {
      await accountSecurityRequest({ operation: 'revoke' });
      setConfirm(false);
      setRequiresStepUp(false);
      load();
      notify.success('Outras sessões encerradas.');
    } catch (failure) {
      if (failure instanceof AccountSecurityError && failure.code === 'step_up') {
        setConfirm(false);
        setRequiresStepUp(true);
      } else setError(failure instanceof Error ? failure.message : 'Não foi possível encerrar as sessões.');
    } finally { finish(); setBusy(false); }
  }

  return <AccountSection id="sessoes" title="Sessões e dispositivos">
    {!sessions && !loadError && <AccountLoading label="Consultando sessões" />}
    {loadError && <div className="space-y-2">
      <p role="alert" className="text-sm text-danger">Não foi possível consultar as sessões.</p>
      <button type="button" className="nv-button-secondary" onClick={load}>Tentar novamente</button>
    </div>}
    {!loadError && sessions && (sessions.length === 0 ? <p className="text-sm text-text-muted">Nenhuma sessão foi encontrada.</p>
      : <>
        <ul className="divide-y divide-border">
          {sessions.slice(0, 20).map(session => <li key={session.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3 text-sm">
            <div className="flex items-start gap-3">
              <Monitor size={18} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
              <div>
                <p className="font-medium">{session.browser || session.system || 'Dispositivo não identificado'}
                  {session.browser && session.system ? ' · ' + session.system : ''}</p>
                {session.current && <p className="text-primary">Sessão atual</p>}
              </div>
            </div>
            <time dateTime={session.createdAt} className="text-text-muted">Aberta em {accountDateTime.format(new Date(session.createdAt))}</time>
          </li>)}
        </ul>
        {sessions.length > 20 && <p className="text-sm text-text-muted">Mostrando as 20 sessões mais recentes, incluindo esta sessão.</p>}
        {sessions.some(session => !session.current) && <div className="flex flex-wrap gap-2">
          <button type="button" className="nv-button-secondary" onClick={() => { setError(''); setConfirm(true); }}>Encerrar outras sessões</button>
          {requiresStepUp && <StepUpMessage onStepUp={onStepUp} />}
        </div>}
      </>)}
    {confirm && <Dialog title="Encerrar outras sessões?" closeDisabled={busy} onClose={() => setConfirm(false)}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="nv-button-secondary" onClick={() => setConfirm(false)} disabled={busy} autoFocus>Cancelar</button>
        <button type="button" className="nv-button" onClick={() => void revoke()} disabled={busy}>{busy ? 'Encerrando…' : 'Encerrar outras sessões'}</button>
      </div>}>
      <p className="text-sm text-text-secondary">Esta sessão continuará aberta. As outras perderão o acesso quando o token atual expirar.</p>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </Dialog>}
  </AccountSection>;
}
