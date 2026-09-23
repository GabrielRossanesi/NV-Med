'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Activity } from 'lucide-react';
import { withPromiseTimeout } from '@/lib/requestTimeout';
export default function LoginPage() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('passwordUpdated') === '1') {
      window.history.replaceState({}, '', '/login');
      const noticeTimer = window.setTimeout(() => setNotice('Sua senha foi atualizada. Entre com a nova senha para continuar.'), 0);
      return () => window.clearTimeout(noticeTimer);
    }
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const client = createClient(); if (!client) throw new Error('O acesso ainda não foi configurado pelo administrador.');
      const { error } = await withPromiseTimeout(
        client.auth.signInWithPassword({ email: email.trim(), password }),
        { timeoutMs: 15_000, message: 'O login demorou mais que o esperado. Verifique sua conexão e tente novamente.' }
      );
      if (error) throw new Error('Não foi possível entrar. Confira seu e-mail e senha.');
      window.location.assign('/escala');
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha de conexão. Tente novamente.'); setBusy(false); }
  }
  async function recover() {
    if (!email.trim()) { setError('Preencha seu e-mail para recuperar o acesso.'); return; }
    setBusy(true); setError(''); setNotice('');
    try { const client = createClient(); if (!client) throw new Error('Acesso ainda não configurado.');
      const { error } = await withPromiseTimeout(
        client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/definir-senha' }),
        { timeoutMs: 15_000, message: 'A solicitação demorou mais que o esperado. Tente novamente.' }
      );
      if (error) throw new Error('Não foi possível solicitar o link. Tente novamente em instantes.');
      setNotice('Se o e-mail estiver cadastrado, você receberá um link para definir sua senha.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha de conexão.'); } finally { setBusy(false); }
  }
  return <main className="min-h-screen grid place-items-center p-5 bg-background"><section className="w-full max-w-md rounded-2xl border border-border bg-card-bg p-7 sm:p-10 shadow-soft"><div className="flex items-center gap-3 mb-10"><Activity className="text-primary h-8 w-8"/><span className="text-xl font-bold">NV Med</span></div><h1 className="text-2xl font-semibold tracking-tight">Sua escala, organizada.</h1><p className="mt-2 mb-7 text-text-secondary text-sm">Entre para gerenciar médicos, unidades e plantões.</p><form onSubmit={login} className="space-y-5"><label className="nv-label">E-mail<input className="nv-input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label className="nv-label">Senha<input className="nv-input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p role="alert" className="text-sm text-danger">{error}</p>}{notice && <p role="status" className="text-sm text-primary">{notice}</p>}<button className="nv-button w-full" disabled={busy}>{busy ? 'Aguarde…' : 'Entrar'}</button><button type="button" className="text-sm text-primary w-full py-2" disabled={busy} onClick={recover}>Primeiro acesso ou esqueci minha senha</button></form><p className="mt-7 text-xs text-text-muted">Seu acesso é liberado pelo administrador da empresa.</p></section></main>;
}
