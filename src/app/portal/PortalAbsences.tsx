'use client';
import { useState } from 'react';
import { myAbsences } from '@/services/masterScheduleService';
import { absenceKindLabels, absenceStatusLabels } from '@/lib/masterSchedule';

export default function PortalAbsences() {
  const [data, setData] = useState<Awaited<ReturnType<typeof myAbsences>>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setError('');
    try { setData(await myAbsences()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível consultar suas ausências.'); }
    finally { setBusy(false); }
  }
  return <details className="nv-panel p-4 sm:p-5" onToggle={event => { if (event.currentTarget.open && !data && !busy) void load(); }}>
    <summary className="cursor-pointer text-sm font-semibold">Minhas férias e afastamentos</summary>
    <p className="mt-3 text-xs text-text-muted">Ausências registradas pela gestão e seus plantões afetados. Para solicitar uma alteração, entre em contato com a coordenação.</p>
    {busy && <p role="status" className="mt-3 text-sm text-text-muted">Carregando…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}<button type="button" className="ml-2 underline" onClick={() => void load()}>Tentar novamente</button></p>}
    <div className="mt-4 divide-y divide-border">{data?.map(absence => <article key={absence.id} className="space-y-2 py-4"><h3 className="text-sm font-semibold">{absenceKindLabels[absence.kind]} · {absenceStatusLabels[absence.status]}</h3><p className="text-xs text-text-secondary">{new Date(`${absence.start_date}T12:00:00`).toLocaleDateString('pt-BR')} a {new Date(`${absence.end_date}T12:00:00`).toLocaleDateString('pt-BR')} · {absence.start_time ? `${absence.start_time}–${absence.end_time}` : 'Período integral'}</p>{absence.note && <p className="whitespace-pre-wrap break-words text-xs text-text-muted">{absence.note}</p>}<ul className="space-y-1 text-xs text-text-secondary">{absence.shifts.map(shift => <li key={shift.shift_id}>{new Date(`${shift.date}T12:00:00`).toLocaleDateString('pt-BR')} · {shift.state === 'restored' ? 'Retorno à atribuição original' : shift.state === 'covered' || shift.state === 'preserved' ? 'Cobertura registrada' : 'Cobertura em organização pela gestão'}</li>)}</ul></article>)}{data?.length === 0 && <p className="py-4 text-sm text-text-muted">Nenhuma ausência registrada.</p>}</div>
  </details>;
}
