'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { createClient } from '@/lib/supabase/client';

type Factor = { id: string; friendly_name?: string };
type Enrollment = { id: string; qrCode: string; secret: string };
type MfaStatus = { verified: boolean; factors: Factor[] };

async function readMfaStatus(client: NonNullable<ReturnType<typeof createClient>>): Promise<MfaStatus> {
  const [{ data: factors, error: listError }, { data: assurance, error: assuranceError }] = await Promise.all([
    client.auth.mfa.listFactors(),
    client.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (listError) throw new Error('Não foi possível consultar seus autenticadores.');
  if (assuranceError) throw new Error('Não foi possível conferir a verificação desta sessão.');
  return { verified: assurance.currentLevel === 'aal2' && factors.totp.length > 0, factors: factors.totp };
}

export default function ProfileMfa() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [selection, setSelection] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client) void readMfaStatus(client).then(
      result => { if (active) setStatus(result); },
      () => { if (active) setError('Não foi possível consultar seus autenticadores.'); },
    );
    return () => { active = false; };
  }, []);

  async function run(action: (client: NonNullable<ReturnType<typeof createClient>>) => Promise<void>) {
    const client = createClient();
    if (!client || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(client); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível concluir a verificação.'); }
    finally { setBusy(false); }
  }

  const factors = status?.factors ?? [];
  const factorId = enrollment?.id || factors.find(factor => factor.id === selection)?.id || factors[0]?.id;

  function enroll() {
    return run(async client => {
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', issuer: 'NV Med' });
      if (error) throw new Error('Não foi possível cadastrar um autenticador. Confira sua sessão e tente novamente.');
      const svgPrefix = 'data:image/svg+xml;utf-8,';
      const svg = data.totp.qr_code.slice(svgPrefix.length);
      setEnrollment({ id: data.id, qrCode: svgPrefix + encodeURIComponent(svg), secret: data.totp.secret });
      setCode('');
    });
  }

  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) return;
    return run(async client => {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw new Error('Código inválido ou expirado. Confira o aplicativo e tente novamente.');
      setEnrollment(null);
      setCode('');
      const next = await readMfaStatus(client);
      setStatus(next);
      if (!next.verified) throw new Error('A confirmação ainda não está disponível. Verifique a sessão e tente novamente.');
      setNotice('Verificação em duas etapas confirmada nesta sessão.');
    });
  }

  function cancelEnrollment() {
    if (!enrollment) return;
    return run(async client => {
      const { error } = await client.auth.mfa.unenroll({ factorId: enrollment.id });
      if (error) throw new Error('Não foi possível cancelar o cadastro deste autenticador.');
      setEnrollment(null);
      setCode('');
    });
  }

  function revoke(factor: Factor) {
    if (!status?.verified || factors.length < 2 || !window.confirm('Remover este autenticador da sua conta?')) return;
    return run(async client => {
      const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw new Error('Não foi possível remover este autenticador.');
      setStatus({ verified: false, factors: factors.filter(item => item.id !== factor.id) });
      const { error: refreshError } = await client.auth.refreshSession();
      if (refreshError) throw new Error('Autenticador removido. Entre novamente para confirmar a sessão.');
      setStatus(await readMfaStatus(client));
      setNotice('Autenticador removido.');
    });
  }

  return <section id="verificacao-em-duas-etapas" className="space-y-4 rounded-2xl border border-border bg-card-bg p-6 md:p-8" aria-labelledby="mfa-heading">
    <div>
      <h2 id="mfa-heading" className="text-base font-semibold">Verificação em duas etapas</h2>
      <p className="mt-1 text-sm text-text-muted">Confirme um código do autenticador para realizar operações administrativas protegidas.</p>
    </div>
    {!status && !error && <p role="status" className="text-sm text-text-muted">Consultando autenticadores…</p>}
    {!status && error && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void run(async client => setStatus(await readMfaStatus(client)))}>Tentar novamente</button>}
    {status && <p className="text-sm font-medium">{status.verified ? 'Sessão verificada' : factors.length ? 'Aguardando confirmação nesta sessão' : 'Autenticador ainda não cadastrado'}</p>}
    {enrollment && <div className="space-y-2">
      <p className="text-sm">Escaneie o QR Code no aplicativo autenticador ou digite a chave de configuração.</p>
      <Image src={enrollment.qrCode} alt="QR Code do autenticador" width={176} height={176} unoptimized className="rounded bg-white p-2" />
      <details className="text-sm"><summary className="cursor-pointer font-medium">Mostrar chave de configuração</summary><code className="mt-2 block select-all break-all">{enrollment.secret}</code></details>
    </div>}
    {(enrollment || (factorId && !status?.verified)) && <form onSubmit={verify} className="max-w-sm space-y-3">
      {!enrollment && factors.length > 1 && <label className="nv-label">Autenticador
        <select className="nv-input" disabled={busy} value={factorId} onChange={event => { setSelection(event.target.value); setCode(''); }}>
          {factors.map((factor, index) => <option key={factor.id} value={factor.id}>{factor.friendly_name || `Autenticador ${index + 1}`}</option>)}
        </select>
      </label>}
      <label className="nv-label">Código de seis dígitos
        <input className="nv-input" disabled={busy} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="nv-button" disabled={busy || code.length !== 6}>Confirmar código</button>
        {enrollment && <button type="button" className="nv-button-secondary" disabled={busy} onClick={cancelEnrollment}>Cancelar cadastro</button>}
      </div>
    </form>}
    {status && !enrollment && (!factors.length || status.verified) && <button type="button" className="nv-button-secondary" disabled={busy} onClick={enroll}>
      {factors.length ? 'Adicionar outro autenticador' : 'Cadastrar autenticador'}
    </button>}
    {status?.verified && !enrollment && factors.length > 1 && <ul className="divide-y divide-border">
      {factors.map((factor, index) => <li key={factor.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span>{factor.friendly_name || `Autenticador ${index + 1}`}</span>
        <button type="button" className="nv-button-secondary" disabled={busy} aria-label={`Remover ${factor.friendly_name || `autenticador ${index + 1}`}`} onClick={() => void revoke(factor)}>Remover</button>
      </li>)}
    </ul>}
    {!enrollment && <p className="text-xs text-text-muted">Cadastre um autenticador em outro dispositivo para recuperar o acesso se perder o principal. Se perder todos, solicite recuperação ao responsável pelo acesso da empresa.</p>}
    {busy && <p role="status" className="text-sm text-text-muted">Processando…</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </section>;
}
