'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AccessGuard from '@/components/AccessGuard';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { useStore } from '@/store/useStore';

type Request = { id: string; kind: 'check_in' | 'check_out'; date: string; time: string; unit: string; doctor: string; reason: string };

function Queue({ organization }: { organization: string }) {
  const [queue, setQueue] = useState<Request[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client && organization) void client.rpc('nv_attendance_queue', { org: organization }).then(result => {
      if (!active) return;
      if (result.error) setError('Não foi possível consultar as solicitações.');
      else setQueue(result.data);
    });
    return () => { active = false; };
  }, [organization]);
  async function review(event: React.FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const approve = form.get('decision') === 'approve';
    if (!window.confirm(approve ? 'Confirmar o registro excepcional de presença?' : 'Rejeitar o registro excepcional de presença?')) return;
    setBusy(id);
    setError('');
    setNotice('');
    try {
      const result = await createClient()?.rpc('nv_review_attendance', { target: id, approve, note: form.get('note') });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      setQueue(current => current?.filter(item => item.id !== id) || []);
      setNotice('Decisão de presença registrada.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a decisão.');
    } finally {
      setBusy('');
    }
  }
  return <section className="space-y-4">
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!queue && !error && <p role="status" className="text-sm text-text-muted">Carregando solicitações…</p>}
    {queue?.length === 0 && <p className="text-sm text-text-muted">Nenhum registro manual aguardando análise.</p>}
    {queue?.map(item => <article key={item.id} className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
      <h2 className="font-semibold">{item.kind === 'check_in' ? 'Check-in' : 'Check-out'} · {item.doctor}</h2>
      <p className="text-sm text-text-muted">{item.unit} · {item.date.split('-').reverse().join('/')} · {item.time}</p>
      <p className="whitespace-pre-wrap text-sm">{item.reason}</p>
      <form onSubmit={event => void review(event, item.id)} className="space-y-3">
        <label className="nv-label">Decisão<select className="nv-input" name="decision"><option value="approve">Aprovar</option><option value="reject">Rejeitar</option></select></label>
        <label className="nv-label">Justificativa<textarea className="nv-input" name="note" required minLength={10} maxLength={1000} rows={2}/></label>
        <button className="nv-button" disabled={Boolean(busy)}>{busy === item.id ? 'Registrando…' : 'Confirmar decisão'}</button>
      </form>
    </article>)}
  </section>;
}
export default function AttendancePage() {
  const organization = useStore(state => state.activeOrganizationId);
  return <AccessGuard requiredPermission="escala"><div className="space-y-5">
    <header className="border-b border-border pb-4">
      <Link href="/escala" className="text-sm font-semibold text-primary underline">Voltar à escala</Link>
      <h1 className="mt-2 text-2xl font-bold">Registros manuais de presença</h1>
    </header>
    <Queue key={organization} organization={organization}/>
  </div></AccessGuard>;
}
