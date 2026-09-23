'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { withPromiseTimeout } from '@/lib/requestTimeout';

const scheduleRows = [
  { time: '07:00', label: 'Clínica médica', meta: 'Equipe completa', status: 'confirmado' },
  { time: '13:00', label: 'Pediatria', meta: 'Troca de plantão', status: 'agendado' },
  { time: '19:00', label: 'Pronto atendimento', meta: 'Cobertura noturna', status: 'confirmado' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('passwordUpdated') === '1') {
      window.history.replaceState({}, '', '/login');
      const noticeTimer = window.setTimeout(
        () => setNotice('Sua senha foi atualizada. Entre com a nova senha para continuar.'),
        0,
      );
      return () => window.clearTimeout(noticeTimer);
    }
  }, []);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const client = createClient();
      if (!client) throw new Error('O acesso ainda não foi configurado pelo administrador.');
      const { error: signInError } = await withPromiseTimeout(
        client.auth.signInWithPassword({ email: email.trim(), password }),
        { timeoutMs: 15_000, message: 'O login demorou mais que o esperado. Verifique sua conexão e tente novamente.' },
      );
      if (signInError) throw new Error('Não foi possível entrar. Confira seu e-mail e senha.');
      window.location.assign('/escala');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Falha de conexão. Tente novamente.');
      setBusy(false);
    }
  }

  async function recover() {
    if (!email.trim()) {
      setError('Preencha seu e-mail para recuperar o acesso.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const client = createClient();
      if (!client) throw new Error('Acesso ainda não configurado.');
      const { error: recoveryError } = await withPromiseTimeout(
        client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/definir-senha' }),
        { timeoutMs: 15_000, message: 'A solicitação demorou mais que o esperado. Tente novamente.' },
      );
      if (recoveryError) throw new Error('Não foi possível solicitar o link. Tente novamente em instantes.');
      setNotice('Se o e-mail estiver cadastrado, você receberá um link para definir sua senha.');
    } catch (recoveryError) {
      setError(recoveryError instanceof Error ? recoveryError.message : 'Falha de conexão.');
    } finally {
      setBusy(false);
    }
  }

  const enter = reduceMotion ? undefined : { opacity: 0, y: 18 };

  return (
    <main className="min-h-screen bg-[#06100f] lg:grid lg:grid-cols-[minmax(0,1.12fr)_minmax(430px,0.88fr)]">
      <section className="relative hidden min-h-screen overflow-hidden bg-[#06100f] text-white lg:flex lg:flex-col lg:justify-between lg:px-[clamp(3rem,5vw,6rem)] lg:py-10">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(116,236,217,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(116,236,217,0.08)_1px,transparent_1px)] [background-size:48px_48px]" />
          <div className="absolute -left-32 top-1/4 h-96 w-96 rounded-full bg-teal-400/12 blur-[110px]" />
          <div className="absolute -bottom-32 right-0 h-[30rem] w-[30rem] rounded-full bg-emerald-300/8 blur-[130px]" />
        </div>

        <motion.div
          initial={enter}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 flex items-center gap-3"
        >
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-300 text-[#06100f] shadow-[0_12px_40px_rgba(45,212,191,0.18)]">
            <Activity size={23} strokeWidth={2.2} />
          </span>
          <span>
            <span className="block text-lg font-semibold tracking-tight">NV Med</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-200/70">Gestão médica</span>
          </span>
        </motion.div>

        <div className="relative z-10 my-8 max-w-2xl">
          <motion.p
            initial={enter}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mb-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-200"
          >
            <span className="h-px w-8 bg-teal-300/70" /> Operação conectada
          </motion.p>
          <motion.h1
            initial={enter}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.14, duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-2xl text-[clamp(2.7rem,4.4vw,4.75rem)] font-semibold leading-[0.96] tracking-[-0.055em]"
          >
            Escalas claras.<br />Operação sob controle.
          </motion.h1>
          <motion.p
            initial={enter}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 max-w-lg text-base leading-relaxed text-slate-300"
          >
            Médicos, unidades, documentos e plantões reunidos em uma rotina mais simples de acompanhar.
          </motion.p>
        </div>

        <motion.div
          initial={reduceMotion ? undefined : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.28, duration: 0.7 }}
          className="relative z-10 max-w-2xl border-t border-white/12 pt-5"
          aria-label="Visão resumida de uma escala"
        >
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-slate-400">Escala de hoje</p>
              <p className="mt-1 text-sm font-semibold text-white">Cobertura assistencial</p>
            </div>
            <span className="flex items-center gap-2 text-xs text-teal-200">
              <span className="relative flex h-2 w-2">
                <motion.span
                  className="absolute inline-flex h-full w-full rounded-full bg-teal-300"
                  animate={reduceMotion ? undefined : { opacity: [0.7, 0], scale: [1, 2.2] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-300" />
              </span>
              Atualizada agora
            </span>
          </div>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {scheduleRows.map((row, index) => (
              <motion.div
                key={row.time}
                initial={reduceMotion ? undefined : { opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.34 + index * 0.07, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-4 py-2.5"
              >
                <span className="font-mono text-xs text-slate-500">{row.time}</span>
                <span>
                  <span className="block text-sm font-medium text-slate-100">{row.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{row.meta}</span>
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-200">
                  <CheckCircle2 size={13} /> {row.status}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      <section className="relative flex min-h-screen items-center justify-center bg-[#f4f7f6] px-5 py-10 text-[#10211f] sm:px-10 lg:px-[clamp(3rem,6vw,6.5rem)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-teal-700/20 to-transparent lg:hidden" aria-hidden="true" />
        <motion.div
          initial={enter}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[27rem]"
        >
          <div className="mb-12 flex items-center gap-3 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#0f766e] text-white shadow-[0_12px_35px_rgba(15,118,110,0.18)]">
              <Activity size={23} strokeWidth={2.2} />
            </span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">NV Med</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-700">Gestão médica</span>
            </span>
          </div>

          <header className="mb-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Acesso à plataforma</p>
            <h2 className="text-4xl font-semibold tracking-[-0.045em] text-[#10211f] sm:text-[2.7rem]">Bem-vindo de volta.</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">Entre com seu e-mail corporativo para continuar sua operação.</p>
          </header>

          <form onSubmit={login} className="space-y-5">
            <label className="block text-sm font-medium text-[#263a36]">
              E-mail
              <span className="relative mt-2 block">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  className="h-13 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-4 text-[15px] text-[#10211f] outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="voce@empresa.com.br"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </span>
            </label>

            <label className="block text-sm font-medium text-[#263a36]">
              Senha
              <span className="relative mt-2 block">
                <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  className="h-13 w-full rounded-xl border border-slate-300 bg-white pl-12 pr-12 text-[15px] text-[#10211f] outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Digite sua senha"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-[#263a36] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>

            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">
                {error}
              </motion.p>
            )}
            {notice && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="status" className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm leading-relaxed text-teal-800">
                {notice}
              </motion.p>
            )}

            <button
              className="group flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-[#0f766e] px-5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(15,118,110,0.18)] transition hover:bg-[#115e59] hover:shadow-[0_16px_34px_rgba(15,118,110,0.24)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-teal-700 disabled:cursor-wait disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Entrando…' : 'Entrar'}
              {!busy && <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />}
            </button>

            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-center gap-2 text-sm font-medium text-teal-800 transition hover:text-teal-950 hover:underline hover:underline-offset-4 disabled:cursor-wait disabled:opacity-60"
              disabled={busy}
              onClick={recover}
            >
              <KeyRound size={15} /> Primeiro acesso ou esqueci minha senha
            </button>
          </form>

          <div className="mt-10 border-t border-slate-200 pt-6">
            <div className="flex items-start gap-3 text-xs leading-relaxed text-slate-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
              <p>Seu acesso é individual e liberado pelo administrador da sua empresa.</p>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-400" aria-label="Recursos da plataforma">
              <span className="flex items-center gap-1.5"><CalendarDays size={13} /> Escalas</span>
              <span className="flex items-center gap-1.5"><Stethoscope size={13} /> Corpo clínico</span>
              <span className="flex items-center gap-1.5"><Building2 size={13} /> Unidades</span>
            </div>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
