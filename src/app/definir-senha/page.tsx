'use client';

import { useEffect, useState } from 'react';
import { Activity, Check, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getPasswordChecks, isStrongPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy';
import { withAbortTimeout, withPromiseTimeout } from '@/lib/requestTimeout';

const labels: Record<keyof ReturnType<typeof getPasswordChecks>, string> = {
  length: `${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres`, lowercase: 'Letra minúscula', uppercase: 'Letra maiúscula', number: 'Número', symbol: 'Símbolo', noWhitespace: 'Sem espaços',
};

export default function SetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const checks = getPasswordChecks(password);

  useEffect(() => {
    async function init() {
      const client = createClient();
      if (!client) { setError('Acesso não configurado.'); return; }
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error: exchangeError } = await client.auth.exchangeCodeForSession(code);
        window.history.replaceState({}, '', '/definir-senha');
        if (exchangeError) { setError('Link inválido ou expirado. Solicite outro na tela de login.'); return; }
      }
      const { data } = await client.auth.getUser();
      if (!data.user?.email) setError('Abra o link recebido por e-mail ou entre com a senha temporária.');
      else { setEmail(data.user.email); setReady(true); }
    }
    void init();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!isStrongPassword(password)) { setError('A senha ainda não atende a todos os requisitos.'); return; }
    if (password !== confirmation) { setError('As senhas precisam ser iguais.'); return; }
    setBusy(true);
    setError('');
    let passwordUpdated = false;
    try {
      const client = createClient();
      if (!client || !email) throw new Error('Sua sessão não está pronta. Entre novamente com a senha temporária.');
      const response = await withAbortTimeout(
        signal => fetch('/api/account/password', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }), signal }),
        { timeoutMs: 20_000, message: 'A troca de senha demorou mais que o esperado. Verifique sua conexão e tente novamente.' }
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a nova senha.');
      passwordUpdated = true;
      const { data: signedIn, error: signInError } = await withPromiseTimeout(
        client.auth.signInWithPassword({ email, password }),
        { timeoutMs: 15_000, message: 'Sua senha foi atualizada, mas a entrada automática demorou demais.' }
      );
      if (signInError || !signedIn.user || signedIn.user.app_metadata?.must_change_password === true) {
        window.location.replace('/login?passwordUpdated=1');
        return;
      }
      window.location.replace('/escala');
    } catch (saveError) {
      if (passwordUpdated) {
        window.location.replace('/login?passwordUpdated=1');
        return;
      }
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar.');
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-background p-5">
      <section className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3"><Activity className="h-8 w-8 text-primary"/><span className="text-xl font-bold">NV Med</span></div>
        <form onSubmit={save} className="space-y-5 rounded-2xl border border-border bg-card-bg p-7 shadow-soft sm:p-9">
          <div><h1 className="text-2xl font-semibold tracking-tight">Crie sua senha pessoal</h1><p className="mt-2 text-sm text-text-secondary">Substitua a senha temporária antes de acessar o painel.</p></div>
          {error && <p role="alert" className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}
          <label className="nv-label">Nova senha
            <div className="relative mt-2"><input className="nv-input pr-11" type={visible ? 'text' : 'password'} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setVisible(value => !value)} className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-text-muted hover:bg-state-hover" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}>{visible ? <EyeOff size={16}/> : <Eye size={16}/>}</button></div>
          </label>
          <label className="nv-label">Confirmar senha<input className="nv-input mt-2" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} required value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
          <div className="grid grid-cols-2 gap-2">{Object.entries(checks).map(([key, valid]) => <span key={key} className={`flex items-center gap-1.5 text-xs ${valid ? 'text-primary' : 'text-text-muted'}`}><Check size={13}/>{labels[key as keyof typeof checks]}</span>)}</div>
          <div className="flex gap-2 rounded-xl border border-border bg-surface-muted/50 p-3 text-sm text-text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary"/><span>Esta senha será conhecida somente por você.</span></div>
          <button className="nv-button w-full" disabled={!ready || busy || !isStrongPassword(password) || password !== confirmation}>{busy ? 'Salvando…' : 'Salvar senha e entrar'}</button>
          <a className="block py-1 text-center text-sm text-primary" href="/login">Voltar ao login</a>
        </form>
      </section>
    </main>
  );
}
