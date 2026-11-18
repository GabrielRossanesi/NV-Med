'use client';

import { useState } from 'react';
import Link from 'next/link';
import Dialog from '@/components/Dialog';
import { absenceKindLabels, absenceStatusLabels, type AbsenceImpact, type DoctorAbsence, type MasterOverview } from '@/lib/masterSchedule';
import { localDate } from '@/lib/scheduling';
import { previewAbsence, saveAbsence, publishMasterCoverage } from '@/services/masterScheduleService';
import type { Doctor } from '@/types';
import { useScheduleEdit, useScheduleDraft } from './ScheduleEditGuard';

const impactLabels = { open: 'Abrir cobertura', preserve: 'Preservar atribuição', protected: 'Revisão administrativa necessária', planned: 'Ocorrência futura', restore: 'Tentar restaurar o médico fixo' };
const formatDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR');
export default function DoctorAbsenceManager({ organization, doctors, data, doctorId, canManage, onChanged, onOpenShift }: {
  organization: string; doctors: Doctor[]; data: MasterOverview; doctorId?: string; canManage: boolean;
  onChanged: () => Promise<void>; onOpenShift?: (id: string) => void;
}) {
  const guard = useScheduleEdit();
  const [editor, setEditor] = useState<{ previous?: DoctorAbsence; cancelling: boolean } | null>(null);
  const [draft, setDraft] = useState<Partial<DoctorAbsence>>({});
  const [preview, setPreview] = useState<{ token: string; impacts: AbsenceImpact[] }>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useScheduleDraft('absence-editor', editor ? JSON.stringify([draft, editor.cancelling, preview?.token]) : null, busy, () => setEditor(null));
  const fixedDoctors = new Set(data.rules.map(rule => rule.definition.doctor_id));
  function open(previous?: DoctorAbsence, cancelling = false) {
    setDraft(previous || { doctor_id: doctorId || '', kind: 'vacation', start_date: localDate(), end_date: localDate(), start_time: null, end_time: null, note: '' });
    setPreview(undefined); setConfirmed(false); setError(''); setNotice(''); setEditor({ previous, cancelling });
  }
  function change(next: Partial<DoctorAbsence>) { setDraft(current => ({ ...current, ...next })); setPreview(undefined); setConfirmed(false); }
  async function review(event: React.FormEvent) {
    event.preventDefault(); if (!editor) return;
    setError(''); setBusy(true);
    try { setPreview(await previewAbsence(organization, draft, editor.previous?.id || null, editor.cancelling)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível consultar os plantões afetados.'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!editor || !preview || !confirmed || !guard.check()) return;
    setBusy(true); setError('');
    try {
      const result = await guard.run(() => saveAbsence(organization, draft, editor.previous?.id || null, editor.previous?.revision || 0, preview.token, editor.cancelling));
      if (!result) return;
      await onChanged(); setEditor(null);
      setNotice(`${result.changed} plantões atualizados; ${result.preserved} atribuições preservadas; ${result.blocked} precisam de revisão administrativa.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível aplicar a ausência.'); setPreview(undefined); setConfirmed(false); }
    finally { setBusy(false); }
  }
  async function publish(shift: string, enabled: boolean) {
    if (!guard.check()) return;
    setBusy(true); setError('');
    try { await guard.run(() => publishMasterCoverage(shift, enabled)); await onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a oferta.'); }
    finally { setBusy(false); }
  }
  if (!canManage) return null;
  return <section aria-label="Férias e afastamentos" className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="nv-section-title">Férias e afastamentos</h2><p className="mt-1 text-xs text-text-muted">A recorrência original é preservada. Revise os plantões antes de aplicar uma ausência.</p></div><button type="button" className="nv-button-secondary" disabled={!guard.unlocked || !fixedDoctors.size} onClick={() => open()}>Registrar ausência</button></div>
    {notice && <p role="status" className="rounded-lg border border-border p-3 text-sm text-text-secondary">{notice}</p>}
    {!editor && error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="divide-y divide-border rounded-xl border border-border bg-card-bg">
      {data.absences.map(absence => <div key={absence.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{doctors.find(d => d.id === absence.doctor_id)?.name || 'Médico'} · {absenceKindLabels[absence.kind]}</h3><p className="mt-1 text-xs text-text-secondary">{formatDay(absence.start_date)} a {formatDay(absence.end_date)} · {absence.start_time ? `${absence.start_time}–${absence.end_time}` : 'Período integral'} · {absenceStatusLabels[absence.status]}</p>
          {absence.note && <p className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-xs text-text-muted">{absence.note}</p>}</div>
        {absence.status !== 'cancelled' && <div className="flex gap-3"><button type="button" disabled={!guard.unlocked} className="min-h-10 text-xs font-semibold text-primary" onClick={() => open(absence)}>Editar e revisar</button><button type="button" disabled={!guard.unlocked} className="min-h-10 text-xs font-semibold text-danger" onClick={() => open(absence, true)}>Cancelar e revisar</button></div>}
      </div>)}
      {!data.absences.length && <p className="p-5 text-sm text-text-muted">Nenhuma ausência registrada para este recorte.</p>}
    </div>
    {data.affected?.length > 0 && <details className="rounded-xl border border-border bg-card-bg p-4"><summary className="cursor-pointer text-sm font-semibold">Plantões afetados e coberturas · {data.affected.length}</summary><div className="mt-3 divide-y divide-border">{data.affected.map(item => <div key={`${item.absence_id}-${item.shift_id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs"><span>{formatDay(item.date)} · {item.state === 'open' ? 'Vaga aberta' : item.state === 'blocked' ? 'Revisão necessária' : item.state === 'restored' ? 'Atribuição restaurada' : 'Substituição preservada'}</span><div className="flex flex-wrap items-center gap-3">{item.state === 'open' && <button type="button" disabled={busy || !guard.unlocked} className="min-h-9 font-semibold text-primary" onClick={() => void publish(item.shift_id, !item.published)}>{item.published ? 'Manter pendente de cobertura' : 'Abrir para candidaturas'}</button>}{onOpenShift ? <button type="button" className="min-h-9 font-semibold text-primary" onClick={() => onOpenShift(item.shift_id)}>Abrir plantão</button> : <Link className="min-h-9 content-center font-semibold text-primary" href={'/escala?' + new URLSearchParams({ shiftId: item.shift_id, date: item.date, unitId: item.unit_id, sectorId: item.sector_id || '' })}>Abrir plantão</Link>}</div></div>)}</div></details>}
    {editor && <Dialog title={editor.cancelling ? 'Revisar cancelamento de ausência' : editor.previous ? 'Editar ausência' : 'Registrar ausência'} size="lg" onClose={() => !busy && guard.transition(() => setEditor(null))}>
      <form data-schedule-edit onSubmit={review} aria-busy={busy}><fieldset disabled={!guard.unlocked || busy} className="space-y-5">
        <fieldset disabled={busy || editor.cancelling} className="grid gap-4 sm:grid-cols-2">
          <label className="nv-label sm:col-span-2">Médico<select className="nv-input" required disabled={Boolean(doctorId || editor.previous)} value={draft.doctor_id || ''} onChange={e => change({ doctor_id: e.target.value })}><option value="">Selecione o médico fixo</option>{doctors.filter(d => fixedDoctors.has(d.id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label className="nv-label">Tipo<select className="nv-input" value={draft.kind} onChange={e => change({ kind: e.target.value as DoctorAbsence['kind'] })}>{Object.entries(absenceKindLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!draft.start_time} onChange={e => change({ start_time: e.target.checked ? null : '07:00', end_time: e.target.checked ? null : '19:00' })}/>Período integral</label>
          <label className="nv-label">Data inicial<input className="nv-input" type="date" required value={draft.start_date || ''} onChange={e => change({ start_date: e.target.value })}/></label>
          <label className="nv-label">Data final<input className="nv-input" type="date" required min={draft.start_date} value={draft.end_date || ''} onChange={e => change({ end_date: e.target.value })}/></label>
          {draft.start_time && <><label className="nv-label">Início da indisponibilidade diária<input className="nv-input" type="time" required value={draft.start_time} onChange={e => change({ start_time: e.target.value })}/></label><label className="nv-label">Término<input className="nv-input" type="time" required value={draft.end_time || ''} onChange={e => change({ end_time: e.target.value })}/></label></>}
          <label className="nv-label sm:col-span-2">Observação privada opcional<textarea className="nv-input" rows={2} maxLength={1000} value={draft.note || ''} onChange={e => change({ note: e.target.value })}/><span className="text-xs font-normal text-text-muted">Visível apenas à gestão autorizada e ao próprio médico. Não aparece na grade nem nas ofertas a outros profissionais.</span></label>
        </fieldset>
        <p className="text-xs text-text-muted">A situação é calculada pelas datas: programada, ativa ou encerrada. Intervalos de horário se repetem em cada dia informado e podem atravessar a meia-noite.</p>
        <button className="nv-button-secondary" disabled={busy}>{busy ? 'Consultando…' : 'Consultar prévia dos plantões'}</button>
        {preview && <section className="space-y-3 border-t border-border pt-4"><h3 className="text-sm font-semibold">Prévia · {preview.impacts.length} ocorrências</h3><div className="max-h-64 overflow-auto rounded-lg border border-border">{preview.impacts.map((item, index) => <p key={`${item.shift_id || item.rule_id}-${index}`} className="border-b border-border px-3 py-2 text-xs last:border-0">{formatDay(item.date)} · {item.start_time}–{item.end_time} · <strong>{impactLabels[item.action]}</strong></p>)}{!preview.impacts.length && <p className="p-3 text-xs text-text-muted">Nenhum plantão já gerado é afetado. Novas ocorrências respeitarão a ausência.</p>}</div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>Conferi os plantões, inclusive os já publicados, e confirmo a aplicação. Substitutos e registros consolidados serão preservados.</span></label>
          <button type="button" className="nv-button" disabled={busy || !confirmed} onClick={() => void apply()}>{busy ? 'Aplicando…' : editor.cancelling ? 'Confirmar cancelamento' : 'Aplicar ausência'}</button>
        </section>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </fieldset></form>
    </Dialog>}
  </section>;
}
