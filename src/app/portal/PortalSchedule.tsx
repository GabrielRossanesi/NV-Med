'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Repeat2, XCircle } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import PresencePanel from '@/components/schedule/PresencePanel';

type Status = 'open' | 'exchange' | 'confirmed' | 'cancelled' | 'completed' | 'pending';
type ApplicationStatus = 'pending' | 'selected' | 'not_selected' | 'cancelled';
type Shift = {
  id: string; date: string; start_time: string; end_time: string; organization: string; unit: string;
  sector: string; specialty?: string; status: Status; notes?: string; assigned_to_me: boolean;
  upcoming: boolean; application?: ApplicationStatus;
};
type Application = Omit<Shift, 'status'> & { status: ApplicationStatus };
const shiftStyles = {
  open: { label: 'Vaga aberta', color: 'text-danger', icon: AlertCircle },
  exchange: { label: 'Disponível para troca', color: 'text-warning', icon: Repeat2 },
  confirmed: { label: 'Confirmado', color: 'text-success', icon: CheckCircle2 },
  cancelled: { label: 'Cancelado', color: 'text-text-muted', icon: XCircle },
  completed: { label: 'Concluído', color: 'text-text-muted', icon: CheckCircle2 },
  pending: { label: 'Aguardando confirmação', color: 'text-warning', icon: Clock3 },
};
const applicationLabels: Record<ApplicationStatus, string> = {
  pending: 'Aguardando decisão', selected: 'Aprovada', not_selected: 'Não selecionada', cancelled: 'Cancelada',
};
const displayDate = (value: string) => new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { dateStyle: 'full' });
const monthLabel = (year: number, month: number) => new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

function shiftDate(year: number, month: number, day: number) {
  return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

function StatusLabel({ status }: { status: Status }) {
  const { icon: Icon, label, color } = shiftStyles[status];
  return <span className={'inline-flex items-center gap-1.5 text-xs font-semibold ' + color}><Icon size={15}/>{label}</span>;
}

function ShiftDetail({ shift, onClose, onSaved }: { shift: Shift; onClose: () => void; onSaved: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canExchange = shift.assigned_to_me && shift.upcoming && (shift.status === 'confirmed' || shift.status === 'exchange');
  const canApply = !shift.assigned_to_me && shift.upcoming && (shift.status === 'open' || shift.status === 'exchange');
  const cancel = shift.assigned_to_me ? shift.status === 'exchange' : shift.application === 'pending';
  async function act() {
    setBusy(true);
    setError('');
    try {
      const client = createClient();
      if (!client) throw new Error('Conexão indisponível.');
      const result = canExchange
        ? await client.rpc('nv_request_exchange', { target: shift.id, cancel_request: cancel })
        : await client.rpc('nv_apply_for_shift', { target: shift.id, cancel_application: cancel });
      if (result.error) throw new Error(portalError(result.error));
      onSaved(canExchange ? (cancel ? 'Solicitação de troca cancelada.' : 'Troca publicada. Você segue responsável até a aprovação.') :
        (cancel ? 'Candidatura cancelada.' : 'Candidatura enviada à coordenação.'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar o plantão.');
    } finally {
      setBusy(false);
    }
  }
  return <Dialog title={shift.assigned_to_me ? 'Gerenciar plantão' : 'Detalhes do plantão'} onClose={onClose}>
    <div className="space-y-4">
      <div><p className="text-sm text-text-muted">{displayDate(shift.date)}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{shift.start_time}–{shift.end_time}</p></div>
      <StatusLabel status={shift.status}/>
      <dl className="grid grid-cols-2 gap-3 border-y border-border py-4 text-sm">
        {Object.entries({ Empresa: shift.organization, Unidade: shift.unit, Posto: shift.sector, Especialidade: shift.specialty || 'Geral' }).map(([label, value]) =>
          <div key={label}><dt className="text-text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
      </dl>
      {shift.notes && <p className="whitespace-pre-wrap text-sm">{shift.notes}</p>}
      {shift.application && <p className="text-sm">Candidatura · {applicationLabels[shift.application]}</p>}
      {canExchange && <p className="text-sm text-text-muted">Sua responsabilidade pelo plantão termina quando a coordenação aprovar um substituto.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {(canExchange || canApply) && <button type="button" className="nv-button" disabled={busy} onClick={() => void act()}>
        {busy ? 'Registrando…' : canExchange ? (cancel ? 'Cancelar solicitação de troca' : 'Solicitar troca') : (cancel ? 'Cancelar candidatura' : 'Enviar candidatura')}
      </button>}
      {shift.assigned_to_me && <PresencePanel shiftId={shift.id} doctor/>}
    </div>
  </Dialog>;
}

export default function PortalSchedule() {
  const [today] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [tab, setTab] = useState<'agenda' | 'schedule' | 'applications'>('agenda');
  const [schedule, setSchedule] = useState<Shift[] | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [year, monthNumber] = month.split('-').map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const first = shiftDate(year, monthNumber, 1);
  const last = shiftDate(year, monthNumber, days);
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  useEffect(() => {
    let current = true;
    const client = createClient();
    if (client) void (async () => {
      const result = tab === 'applications'
        ? await client.rpc('nv_portal_applications')
        : await client.rpc('nv_portal_schedule', { from_date: first, to_date: last, mine: tab === 'agenda' });
      if (!current) return;
      if (result.error) setError('Não foi possível carregar os plantões.');
      else if (tab === 'applications') setApplications(result.data);
      else setSchedule(result.data);
    })();
    return () => { current = false; };
  }, [first, last, tab, revision]);
  function navigate(offset: number) {
    const next = new Date(year, monthNumber - 1 + offset, 1);
    const value = shiftDate(next.getFullYear(), next.getMonth() + 1, 1);
    setMonth(value.slice(0, 7));
    setDay(value);
    setSchedule(null);
    setError('');
  }
  const grouped = new Map<string, Shift[]>();
  for (const shift of schedule || []) {
    const existing = grouped.get(shift.date) || [];
    existing.push(shift);
    grouped.set(shift.date, existing);
  }
  return <section className="space-y-4 rounded-2xl border border-border bg-card-bg p-4 sm:p-6">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarDays size={21} className="text-primary"/>Plantões</h2>
    <nav aria-label="Visualizações dos plantões" className="flex flex-wrap gap-2">
      {(['agenda', 'schedule', 'applications'] as const).map(value => <button key={value} type="button"
        aria-pressed={tab === value} className={tab === value ? 'nv-button' : 'nv-button-secondary'} onClick={() => {
          if (tab === value) return;
          setTab(value); setSchedule(null); setApplications(null); setError(''); setNotice('');
        }}>{value === 'agenda' ? 'Minha agenda' : value === 'schedule' ? 'Escalas' : 'Minhas candidaturas'}</button>)}
    </nav>
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {tab === 'applications' ? <>
      {!applications && !error && <p role="status" className="text-sm text-text-muted">Carregando candidaturas…</p>}
      {applications?.length === 0 && <p className="text-sm text-text-muted">Suas candidaturas aparecerão aqui.</p>}
      <ul className="divide-y divide-border">{applications?.map(item => <li key={item.id} className="space-y-1 py-3">
        <p className="font-semibold">{item.unit} · {item.sector}</p><p className="text-sm text-text-muted">{displayDate(item.date)} · {item.start_time}–{item.end_time} · {item.organization}</p>
        <p className="text-sm font-medium">{applicationLabels[item.status]}</p>
      </li>)}</ul>
    </> : <>
      <div className="flex items-center justify-between">
        <button className="nv-button-secondary" type="button" onClick={() => navigate(-1)} aria-label="Mês anterior"><ChevronLeft size={18}/></button>
        <h3 className="font-semibold capitalize">{monthLabel(year, monthNumber)}</h3>
        <button className="nv-button-secondary" type="button" onClick={() => navigate(1)} aria-label="Próximo mês"><ChevronRight size={18}/></button>
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(value => <span key={value} className="py-1 text-center text-xs text-text-muted">{value}</span>)}
        {Array.from({ length: firstWeekday }, (_, i) => <span key={'blank-' + i} aria-hidden="true"/>)}
        {Array.from({ length: days }, (_, i) => {
          const date = shiftDate(year, monthNumber, i + 1);
          const count = grouped.get(date)?.length || 0;
          return <button key={date} type="button" aria-pressed={day === date}
            aria-current={today === date ? 'date' : undefined} aria-label={displayDate(date) + ', ' + count + ' plantões'}
            className={'min-h-11 rounded-lg border text-sm tabular-nums ' + (day === date ? 'border-primary bg-primary/10 font-bold' : 'border-border hover:bg-state-hover')}
            onClick={() => setDay(date)}>{i + 1}{count > 0 && <span className="block text-[10px] font-semibold text-primary">{count}</span>}</button>;
        })}
      </div>
      <div className="border-t border-border pt-3">
        <h3 className="text-sm font-semibold capitalize">{displayDate(day)}</h3>
        {!schedule && !error && <p role="status" className="mt-2 text-sm text-text-muted">Carregando plantões…</p>}
        {schedule && !grouped.get(day)?.length && <p className="mt-2 text-sm text-text-muted">Nenhum plantão nesta data.</p>}
        <ul className="divide-y divide-border">{grouped.get(day)?.map(item => <li key={item.id}>
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg p-3 text-left hover:bg-state-hover" onClick={() => setSelected(item)}>
            <span><strong className="block text-sm">{item.start_time}–{item.end_time} · {item.unit}</strong>
              <span className="block text-xs text-text-muted">{item.organization} · {item.sector}{item.specialty && ' · ' + item.specialty}</span></span>
            <StatusLabel status={item.status}/>
          </button>
        </li>)}</ul>
      </div>
    </>}
    {selected && <ShiftDetail shift={selected} onClose={() => setSelected(null)} onSaved={message => {
      setSelected(null); setNotice(message); setRevision(value => value + 1);
    }}/>}
  </section>;
}
