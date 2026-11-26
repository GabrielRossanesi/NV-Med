'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { requestShiftLocation } from '@/lib/shiftAttendance';

type Kind = 'check_in' | 'check_out';
type Summary = {
  configured: boolean; allow_manual: boolean; can_record: boolean;
  events: { kind: Kind; at: string; result: 'inside_perimeter' | 'manual_approved' | 'gps_confirmed' }[];
  requests: { id?: string; kind: Kind; source?: 'manual' | 'gps'; status: 'pending' | 'approved' | 'rejected' | 'superseded'; review_note?: string }[];
};
export const presenceLabels = { check_in: 'Check-in', check_out: 'Check-out' } as const;
const requestLabels = { pending: 'aguardando análise', approved: 'aprovada', rejected: 'rejeitada', superseded: 'encerrada' } as const;

export default function PresencePanel({ shiftId, doctor = false }: { shiftId: string; doctor?: boolean }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [kind, setKind] = useState<Kind>('check_in');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (client) void client.rpc('nv_presence_summary', { target: shiftId }).then(result => {
      if (!active) return;
      if (result.error) setError('Não foi possível consultar os registros de presença.');
      else if (!result.data) setError('Os registros de presença estão indisponíveis para este acesso.');
      else setData(result.data);
    });
    return () => { active = false; };
  }, [shiftId, revision]);
  async function record(eventKind: Kind) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const location = await requestShiftLocation(navigator.geolocation, window.isSecureContext);
      const result = await createClient()?.rpc('nv_record_attendance', {
        target: shiftId, event_kind: eventKind, lat: location.latitude, lon: location.longitude, precision_m: location.accuracy,
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      setNotice(eventKind === 'check_out' ? 'Check-out enviado para confirmação da coordenação.' : 'Check-in declarado.');
      setRevision(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a presença.');
    } finally {
      setBusy(false);
    }
  }
  async function requestManual(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await createClient()?.rpc('nv_request_attendance_exception', {
        target: shiftId, event_kind: hasIn ? 'check_out' : kind, explanation: new FormData(event.currentTarget).get('reason'),
      });
      if (!result) throw new Error('Conexão indisponível.');
      if (result.error) throw new Error(portalError(result.error));
      setNotice('Solicitação enviada à coordenação.');
      setManual(false);
      setRevision(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível enviar a solicitação.');
    } finally {
      setBusy(false);
    }
  }
  const hasIn = data?.events.some(item => item.kind === 'check_in');
  const hasOut = data?.events.some(item => item.kind === 'check_out');
  const checkoutPending = data?.requests.some(item => item.kind === 'check_out' && item.status === 'pending' && item.source === 'gps');
  const canRecord = doctor && data?.can_record && data.configured && !hasOut && !checkoutPending;
  const canManual = canRecord && data.allow_manual;
  return <section className="space-y-3 border-t border-border pt-4">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><MapPin size={17} className="text-primary"/>Presença</h3>
    {!data && !error && <p className="text-sm text-text-muted">Carregando presença…</p>}
    {data && !data.events.length && !data.requests.length && <p className="text-sm text-text-muted">Nenhum registro de presença.</p>}
    {data?.events.map(item => <p key={item.kind} className="text-sm">
      {presenceLabels[item.kind]} · {new Date(item.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
      {item.kind === 'check_in' && item.result === 'inside_perimeter' && ' · Localização declarada'}
      {item.result === 'gps_confirmed' && ' · Confirmado pela coordenação'}
      {item.result === 'manual_approved' && ' · Registro manual aprovado'}
    </p>)}
    {data?.requests.map((item, index) => <p key={item.id ?? index} className="text-sm text-text-muted">
      {item.source === 'gps' ? 'Declaração de check-out' : `Solicitação manual de ${presenceLabels[item.kind].toLowerCase()}`} {requestLabels[item.status]}{item.review_note && ' · ' + item.review_note}
    </p>)}
    {doctor && data?.can_record && !data.configured && <p className="text-sm text-text-muted">A unidade ainda precisa configurar o registro de presença.</p>}
    {canRecord && <div className="flex flex-wrap gap-2">
      <button className="nv-button" type="button" disabled={busy} onClick={() => void record(hasIn ? 'check_out' : 'check_in')}>
        {busy ? 'Registrando…' : hasIn ? 'Declarar check-out' : 'Declarar check-in'}
      </button>
      {canManual && <button className="nv-button-secondary" type="button" onClick={() => setManual(value => !value)}>Solicitar registro manual</button>}
    </div>}
    {canManual && manual && <form onSubmit={requestManual} className="space-y-3">
      <label className="nv-label">Tipo de registro<select className="nv-input" value={hasIn ? "check_out" : kind} onChange={event => setKind(event.target.value as Kind)}>
        {!hasIn && <option value="check_in">Check-in</option>}<option value="check_out">Check-out</option>
      </select></label>
      <label className="nv-label">Justificativa<textarea className="nv-input" name="reason" required minLength={10} maxLength={1000} rows={3}/></label>
      <button className="nv-button-secondary" disabled={busy}>Enviar à coordenação</button>
    </form>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
  </section>;
}
