'use client';

import { useEffect, useState } from 'react';
import { ArrowRightLeft, History, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { employmentLabel, employmentLabels, paymentFrequencyLabels } from '@/lib/scheduling';
import { canEditPermission } from '@/lib/permissions';
import { buildRequiredPjAgreement, chooseShiftRate, formatShiftMoney, initialAgreementDraft, sectorFinanceDefaults } from '@/lib/shiftPricing';
import { useStore } from '@/store/useStore';
import type { EmploymentType, Shift, ShiftType } from '@/types';
import EmploymentBadge from './EmploymentBadge';
import { ShiftAgreementFields, useShiftRates } from './ShiftFinancialDetails';

type Candidate = { id: string; name: string; crm: string; uf: string };
type Opportunity = {
  id: string; shift_id: string; date: string; start_time: string; end_time: string; unit: string;
  sector: string; specialty?: string; original?: string; employment?: EmploymentType; settled?: boolean; unit_id: string; sector_id: string; shift_type: ShiftType; kind: 'vacancy' | 'exchange'; candidates: Candidate[];
};
type HistoryItem = { id: number; at: string; previous?: string; next?: string; actor?: string; previous_employment?: EmploymentType; next_employment?: EmploymentType };

function Decision({ item, organization, onSaved }: { item: Opportunity; organization: string; onSaved: (message: string) => void }) {
  const [employment, setEmployment] = useState<EmploymentType | ''>('');
  const [draft, setDraft] = useState(() => initialAgreementDraft());
  const currentUser = useStore(state => state.currentUser);
  const sector = useStore(state => state.sectors.find(value => value.id === item.sector_id && value.organizationId === organization));
  const canEditFinance = canEditPermission(currentUser, 'financeiro');
  const rates = useShiftRates(organization, employment === 'pj' && canEditFinance);
  const [candidate, setCandidate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const candidateSpecialty = useStore(state => state.doctors.find(doctor => doctor.id === candidate && doctor.organizationId === organization)?.specialty);
  const proposed: Shift = {
    id: item.shift_id, organizationId: organization, unitId: item.unit_id, sectorId: item.sector_id, doctorId: candidate,
    specialty: item.specialty, date: item.date, startTime: item.start_time, endTime: item.end_time, type: item.shift_type, status: 'confirmed',
  };
  const reference = chooseShiftRate(rates.rates, proposed, sector, candidateSpecialty);
  const frequency = sectorFinanceDefaults(rates.rates, item.sector_id).frequency;
  const agreementDraft = !draft.frequencyEdited && frequency ? { ...draft, frequency } : draft;

  function selectCandidate(next: string) {
    setCandidate(next);
    setEmployment('');
    setDraft(initialAgreementDraft());
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    if (!candidate || !employment || item.settled || busy) return;
    setError('');
    try {
      if (employment === 'pj' && (!canEditFinance || !rates.ready)) {
        throw new Error('Confirme o acordo PJ com acesso financeiro e consulte o valor padrão antes de aprovar.');
      }
      const agreement = employment === 'pj' ? buildRequiredPjAgreement(agreementDraft, reference) : null;
      const cents = agreement?.mode === 'default' ? reference?.amount_cents : agreement?.amount_cents;
      const payment = agreement && cents != null ? ` · ${formatShiftMoney(cents)} · ${paymentFrequencyLabels[agreement.frequency]}` : '';
      if (!window.confirm(`Confirmar o médico selecionado? ${employmentLabel(employment)}${payment}`)) return;
      setBusy(true);
      const result = await createClient()?.rpc('nv_select_shift_candidate', {
        target: item.id, candidate, employment, employer: fields.get('employer'), agreement,
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
    <div className="flex flex-wrap items-center gap-2 text-sm">{item.original && <span>Responsável atual · {item.original}</span>}
      <EmploymentBadge employment={item.employment} provisional={item.kind === 'vacancy'}/>
    </div>
    {item.settled && <p className="text-sm text-warning">Regularize o pagamento registrado antes de aprovar a troca.</p>}
    {item.candidates.length === 0 ? <p className="text-sm text-text-muted">Nenhuma candidatura pendente.</p> : <form onSubmit={save} className="space-y-3">
      <label className="nv-label">Candidatos ({item.candidates.length})
        <select className="nv-input" value={candidate} onChange={event => selectCandidate(event.target.value)} required>
          <option value="">Selecione um médico</option>
          {item.candidates.map(person => <option key={person.id} value={person.id}>{person.name} · CRM {person.crm}/{person.uf}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="nv-label">Modalidade de contratação<select aria-label="Modalidade de contratação" className="nv-input" required value={employment} onChange={event => {
          setEmployment(event.target.value as EmploymentType || '');
          setDraft(initialAgreementDraft());
        }}>
          <option value="">Selecione</option>{Object.entries(employmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="nv-label">Empregador<input className="nv-input" name="employer" maxLength={150} required={employment === 'pj'}/></label>
      </div>
      {employment === 'pj' && (canEditFinance ? (rates.ready
        ? <ShiftAgreementFields draft={agreementDraft} onChange={setDraft} rate={reference} requireAmount dueFor={proposed}/>
        : <p className="text-sm text-text-muted" role="status">{rates.error || 'Consultando valores padrão…'}{rates.error && <button type="button" className="ml-2 underline" onClick={rates.reload}>Tentar novamente</button>}</p>)
        : <p className="text-sm text-warning">A confirmação de um acordo PJ exige permissão financeira.</p>)}
      <button className="nv-button" disabled={busy || item.settled || (employment === 'pj' && (!canEditFinance || !rates.ready))}>{busy ? 'Registrando…' : 'Aprovar candidato'}</button>
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
    {queue?.map(item => <Decision key={item.id} item={item} organization={organization} onSaved={message => {
      setNotice(message);
      setRevision(value => value + 1);
      onChanged?.();
    }}/>)}
    {shiftId && <div className="space-y-2 border-t border-border pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History size={16}/>Histórico de responsáveis e contratações</h3>
      {history.length === 0 && <p className="text-sm text-text-muted">Nenhuma mudança de responsável registrada.</p>}
      <ul className="divide-y divide-border">{history.map(event => <li key={event.id} className="py-2 text-sm">
        <p>{event.previous || 'Vaga aberta'} → {event.next || 'Vaga aberta'}</p>
        {(event.previous_employment || event.next_employment) && <p className="text-xs text-text-secondary">{employmentLabel(event.previous_employment)} → {employmentLabel(event.next_employment)}</p>}
        <p className="text-xs text-text-muted">{new Date(event.at).toLocaleString('pt-BR')}{event.actor && ' · ' + event.actor}</p>
      </li>)}</ul>
    </div>}
  </section>;
}
