'use client';

import { useEffect, useState } from 'react';
import { ArrowRightLeft, History, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { employmentLabels } from '@/lib/scheduling';

type Candidate = { id: string; name: string; crm: string; uf: string };
type Opportunity = {
  id: string; shift_id: string; date: string; start_time: string; end_time: string; unit: string;
  sector: string; specialty?: string; original?: string; kind: 'vacancy' | 'exchange'; candidates: Candidate[];
};
type HistoryItem = { id: number; at: string; previous?: string; next?: string; actor?: string };

function Decision({ item, onSaved }: { item: Opportunity; onSaved: (message: string) => void }) {
  const [employment, setEmployment] = useState('');
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const confirmMessage = 'Confirmar este médico como responsável pelo plantão?';
    if (!window.confirm(confirmMessage)) return;
    setBusy(true);
    setError('');
    try {
      const result = await createClient()?.rpc('nv_select_shift_candidate', {
        target: item.id, candidate, employment, employer: fields.get('employer'),
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      onSaved('Candidatura aprovada. O médico já consta na escala.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível aprovar a candidatura.');
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!window.confirm(item.kind === 'exchange' ? 'Encerrar a troca e manter o médico atual como responsável?' : 'Encerrar as candidaturas atuais e manter a vaga aberta?')) return;
    setBusy(true);
    setError('');
    try {
      const result = await createClient()?.rpc('nv_cancel_shift_opportunity', { target: item.id });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      onSaved(item.kind === 'exchange' ? 'Solicitação de troca encerrada.' : 'Candidaturas encerradas. A vaga segue aberta.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível encerrar a troca.');
    } finally {
      setBusy(false);
    }
  }
  return <article className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
    <p className={'flex items-center gap-2 text-sm font-semibold ' + (item.kind === 'exchange' ? 'text-warning' : 'text-danger')}>
      {item.kind === 'exchange' ? <ArrowRightLeft size={17}/> : <Users size={17}/>}
      {item.kind === 'exchange' ? 'Troca de plantão' : 'Vaga aberta'}
    </p>
    <h3 className="font-semibold">{item.unit} · {item.sector}</h3>
    <p className="text-sm text-text-muted">{item.date.split('-').reverse().join('/')} · {item.start_time}–{item.end_time}{item.specialty && ' · ' + item.specialty}</p>
    {item.original && <p className="text-sm">Responsável atual · {item.original}</p>}
    {item.candidates.length === 0 ? <p className="text-sm text-text-muted">Nenhuma candidatura pendente.</p> : <form onSubmit={save} className="space-y-3">
      <label className="nv-label">Candidatos ({item.candidates.length})
        <select className="nv-input" value={candidate} onChange={event => setCandidate(event.target.value)} required>
          <option value="">Selecione um médico</option>
          {item.candidates.map(person => <option key={person.id} value={person.id}>{person.name} · CRM {person.crm}/{person.uf}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="nv-label">Vínculo<select className="nv-input" required value={employment} onChange={event => setEmployment(event.target.value)}>
          <option value="">Selecione</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="nv-label">Empregador<input className="nv-input" name="employer" maxLength={150} required={employment === 'pj'}/></label>
      </div>
      <button className="nv-button" disabled={busy}>{busy ? 'Registrando…' : 'Aprovar candidato'}</button>
    </form>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button className="nv-button-secondary" type="button" disabled={busy} onClick={() => void cancel()}>
      {item.kind === 'exchange' ? 'Encerrar solicitação de troca' : 'Encerrar candidaturas atuais'}
    </button>
  </article>;
}

export default function ShiftSelectionPanel({ organization, shiftId, scope, onChanged }: {
  organization: string; shiftId?: string; scope?: 'exchange' | 'applications'; onChanged?: () => void;
}) {
  const [queue, setQueue] = useState<Opportunity[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const client = createClient();
    let active = true;
    if (client && organization) void Promise.all([
      client.rpc('nv_shift_selection_queue', { org: organization, target: shiftId || null, scope: scope || null }),
      shiftId ? client.rpc('nv_shift_history', { target: shiftId }) : Promise.resolve(null),
    ]).then(([opportunities, events]) => {
      if (!active) return;
      if (opportunities.error || events?.error) setError('Não foi possível carregar as candidaturas e o histórico.');
      else {
        setQueue(opportunities.data);
        setHistory(events?.data || []);
      }
    });
    return () => { active = false; };
  }, [organization, shiftId, scope, revision]);
  return <section className="space-y-3">
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!queue && !error && <p role="status" className="text-sm text-text-muted">Carregando candidaturas…</p>}
    {queue?.length === 0 && <p className="text-sm text-text-muted">Nenhuma oportunidade com candidaturas ou troca em andamento.</p>}
    {queue?.map(item => <Decision key={item.id} item={item} onSaved={message => {
      setNotice(message);
      setRevision(value => value + 1);
      onChanged?.();
    }}/>)}
    {shiftId && <div className="space-y-2 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History size={16}/>Histórico de responsáveis</h3>
      {history.length === 0 && <p className="text-sm text-text-muted">Nenhuma mudança de responsável registrada.</p>}
      <ul className="divide-y divide-border">{history.map(event => <li key={event.id} className="py-2 text-sm">
        <p>{event.previous || 'Vaga aberta'} → {event.next || 'Vaga aberta'}</p>
        <p className="text-xs text-text-muted">{new Date(event.at).toLocaleString('pt-BR')}{event.actor && ' · ' + event.actor}</p>
      </li>)}</ul>
    </div>}
  </section>;
}
