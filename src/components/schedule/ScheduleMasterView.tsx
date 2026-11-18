'use client';

import { useState } from 'react';
import { AlertTriangle, CalendarClock, Pause, Plus, RefreshCw } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { useMasterSchedule } from './useMasterSchedule';
import MasterRuleEditor from './MasterRuleEditor';
import DoctorAbsenceManager from './DoctorAbsenceManager';
import { generateMaster, masterRuleStatus, publishMasterCoverage } from '@/services/masterScheduleService';
import { employmentLabels } from '@/lib/scheduling';
import { masterStatusLabels, type MasterRule } from '@/lib/masterSchedule';
import type { Doctor, Sector, Unit } from '@/types';
import { useScheduleEdit, useScheduleDraft } from './ScheduleEditGuard';

export type MasterEditRequest = { ruleId: string; date?: string; nonce: number };
export default function ScheduleMasterView({ organization, unitId, sectorId, sectorIds, doctors, units, sectors, canCreate, canEdit, canApprove, canFinance, canViewHistory = false, canManageAbsences,
  editRequest, onChanged, onOpenShift }: {
  organization: string; unitId: string; sectorId: string; doctors: Doctor[]; units: Unit[]; sectors: Sector[];
  sectorIds?: string[]; canViewHistory?: boolean; canManageAbsences?: boolean;
  canCreate: boolean; canEdit: boolean; canApprove: boolean; canFinance: boolean; editRequest?: MasterEditRequest | null;
  onChanged: () => Promise<void>; onOpenShift: (id: string) => void;
}) {
  const { data, error, reload } = useMasterSchedule(organization, unitId, sectorId || null, null, sectorIds);
  const guard = useScheduleEdit();
  const [editor, setEditor] = useState<{ rule?: MasterRule; date?: string } | null>(null);
  const [dismissedRequest, setDismissedRequest] = useState(0);
  const [statusEditor, setStatusEditor] = useState<{ rule: MasterRule; state: string } | null>(null);
  const [decision, setDecision] = useState<'keep' | 'open'>('keep');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [actionError, setActionError] = useState('');
  useScheduleDraft('master-status', statusEditor ? JSON.stringify([statusEditor.rule.id, decision, confirmed]) : null, busy, () => setStatusEditor(null));
  const requestedRule = editRequest && dismissedRequest !== editRequest.nonce ? data?.rules.find(rule => rule.id === editRequest.ruleId) : undefined;
  const activeEditor = editor || (requestedRule ? { rule: requestedRule, date: editRequest?.date } : null);
  async function changed() { await Promise.all([reload(), onChanged()]); }
  async function generate() {
    if (!guard.check()) return;
    setBusy(true); setActionError('');
    try { const result = await guard.run(() => generateMaster(organization, null, unitId, sectorId, sectorIds)); if (!result) return; await changed(); setFeedback(`${result.generated} plantões gerados; ${result.coverage} precisam de cobertura; ${result.preserved} preservados; ${result.blocked} aguardam revisão.`); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Falha na geração.'); }
    finally { setBusy(false); }
  }
  async function saveStatus() {
    if (!statusEditor || !confirmed || !guard.check()) return;
    setBusy(true); setActionError('');
    try { await guard.run(() => masterRuleStatus(statusEditor.rule.id, statusEditor.state, statusEditor.rule.revision, decision, true)); await changed(); setStatusEditor(null); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Não foi possível alterar a recorrência.'); }
    finally { setBusy(false); }
  }
  async function publish(id: string, enabled: boolean) {
    if (!guard.check()) return;
    setBusy(true); setActionError('');
    try { await guard.run(() => publishMasterCoverage(id, enabled)); await changed(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Não foi possível atualizar a oferta.'); }
    finally { setBusy(false); }
  }
  if (error) return <div role="alert" className="rounded-xl border border-danger/25 p-5 text-sm text-danger">{error}</div>;
  if (!data) return <p role="status" className="py-10 text-sm text-text-muted">Carregando recorrências…</p>;
  return <div className="space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="nv-section-title">Rotina dos médicos fixos</h2><p className="mt-1 max-w-2xl text-sm text-text-secondary">As recorrências geram plantões na Escala Geral. Substituições e ajustes de cada ocorrência são preservados.</p></div><div className="flex flex-wrap gap-2">{canCreate && <><button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void generate()}><RefreshCw size={15}/>Gerar e conferir</button><button type="button" className="nv-button" onClick={() => setEditor({})}><Plus size={15}/>Cadastrar médico fixo</button></>}</div></header>
    {!data.cron_enabled && <p role="status" className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 p-3 text-xs leading-5 text-warning"><AlertTriangle size={15} className="mt-0.5 shrink-0"/>A geração diária ainda não está habilitada neste ambiente. A gravação de uma regra gera os plantões, e a geração manual continua disponível.</p>}
    {feedback && <p role="status" className="text-sm text-text-secondary">{feedback}</p>}
    {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-bg">
      {data.rules.map(rule => <article key={rule.id} className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold">{doctors.find(d => d.id === rule.definition.doctor_id)?.name || 'Médico fixo'}</h3><span className="text-xs text-text-muted">{masterStatusLabels[rule.status]}</span></div>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-text-secondary"><CalendarClock size={14}/>{rule.definition.frequency === 'monthly' ? 'Mensal' : rule.definition.interval_weeks === 1 ? 'Semanal' : `A cada ${rule.definition.interval_weeks} semanas`} · {rule.definition.weekdays.map(day => ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][day]).join(', ')} · {rule.definition.start_time}–{rule.definition.end_time}</p>
          <p className="mt-1 text-xs text-text-muted">{rule.definition.specialty} · {employmentLabels[rule.definition.employment_type]} · Geração até {rule.horizon_months} meses à frente</p>
          <p className="mt-1 text-xs text-text-muted">Início: {new Date(`${rule.definition.start_date}T12:00:00`).toLocaleDateString('pt-BR')}{rule.definition.end_date ? ` · Fim: ${new Date(`${rule.definition.end_date}T12:00:00`).toLocaleDateString('pt-BR')}` : ' · Sem data final'}</p>
        </div>
        {canEdit && rule.status !== 'ended' && <div className="flex flex-wrap gap-3 self-start text-xs font-semibold">{canCreate && <button type="button" className="min-h-10 text-primary" onClick={() => setEditor({ rule })}>Editar recorrência</button>}
          <button type="button" className="inline-flex min-h-10 items-center gap-1 text-text-secondary" onClick={() => { setStatusEditor({ rule, state: rule.status === 'active' ? 'suspended' : 'active' }); setDecision('keep'); setConfirmed(false); }}><Pause size={13}/>{rule.status === 'active' ? 'Suspender' : 'Reativar'}</button>
          <button type="button" className="min-h-10 text-danger" onClick={() => { setStatusEditor({ rule, state: 'ended' }); setDecision('keep'); setConfirmed(false); }}>Encerrar</button></div>}
      </article>)}
      {!data.rules.length && <div className="p-8 text-center"><CalendarClock size={23} className="mx-auto text-text-muted"/><p className="mt-3 text-sm text-text-secondary">Nenhum médico fixo cadastrado neste setor.</p><p className="mt-1 text-xs text-text-muted">Os plantões existentes continuam na Escala Geral.</p></div>}
    </div>
    {data.occurrences.some(o => o.state === 'coverage' || o.state === 'blocked') && <section className="space-y-3"><h2 className="nv-section-title">Ocorrências que precisam de atenção</h2><div className="divide-y divide-border rounded-xl border border-border bg-card-bg">{data.occurrences.filter(o => o.state === 'coverage' || o.state === 'blocked').map(o => {
      return <div key={`${o.rule_id}-${o.date}`} className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs"><span>{new Date(`${o.date}T12:00:00`).toLocaleDateString('pt-BR')} · {o.issue || 'Revisar geração'}</span><div className="flex flex-wrap gap-3">{o.shift_id && <><button type="button" className="min-h-9 font-semibold text-primary" onClick={() => onOpenShift(o.shift_id!)}>{canEdit ? 'Designar substituto / ver plantão' : 'Ver plantão'}</button>{canEdit && canApprove && <button type="button" disabled={busy} className="min-h-9 font-semibold text-primary" onClick={() => void publish(o.shift_id!, !o.published)}>{o.published ? 'Manter pendente de cobertura' : 'Abrir para candidaturas'}</button>}</>}</div></div>;
    })}</div></section>}
    <DoctorAbsenceManager organization={organization} doctors={doctors} data={data} canManage={canManageAbsences ?? (canEdit && canApprove)} onChanged={changed} onOpenShift={onOpenShift}/>
    {canViewHistory && <details className="rounded-xl border border-border bg-card-bg p-4"><summary className="cursor-pointer text-sm font-semibold">Histórico de alterações</summary><div className="mt-3 divide-y divide-border">{data.audit.map(entry => <p key={entry.id} className="py-2 text-xs text-text-secondary">{new Date(entry.created_at).toLocaleString('pt-BR')} · {auditLabel(entry.action)}</p>)}{!data.audit.length && <p className="mt-3 text-xs text-text-muted">Nenhuma alteração registrada.</p>}</div></details>}
    {activeEditor && <MasterRuleEditor key={`${activeEditor.rule?.id || 'new'}:${activeEditor.date || ''}`} organization={organization} unitId={unitId} sectorId={sectorId} units={units} sectors={sectors} doctors={doctors} rule={activeEditor.rule} effectiveDate={activeEditor.date} canFinance={canFinance} onClose={() => { setEditor(null); setDismissedRequest(editRequest?.nonce || 0); }} onSaved={changed}/>}
    {statusEditor && <Dialog title={`${statusEditor.state === 'ended' ? 'Encerrar' : statusEditor.state === 'suspended' ? 'Suspender' : 'Reativar'} recorrência`} onClose={() => !busy && guard.transition(() => setStatusEditor(null))}><fieldset data-schedule-edit disabled={!guard.unlocked || busy} className="space-y-5"><label className="nv-label">Plantões futuros<select className="nv-input" value={decision} onChange={e => setDecision(e.target.value as 'keep' | 'open')}><option value="keep">Preservar os plantões já gerados</option><option value="open">Liberar apenas ocorrências futuras sem ajustes manuais</option></select></label><p className="text-xs leading-5 text-text-muted">Registros realizados, pagamentos consolidados, candidaturas e substituições são preservados. Postos reaproveitados são liberados; postos criados pela regra são cancelados, sem exclusão do histórico.</p><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>Confirmo o tratamento dos plantões futuros, inclusive os já publicados.</label>{actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}<button type="button" className="nv-button" disabled={busy || !confirmed} onClick={() => void saveStatus()}>{busy ? 'Salvando…' : 'Confirmar alteração'}</button></fieldset></Dialog>}
  </div>;
}

export function auditLabel(action: string) {
  return ({ rule_created: 'Recorrência criada', rule_edited: 'Recorrência revisada', rule_suspended: 'Recorrência suspensa', rule_ended: 'Recorrência encerrada', rule_active: 'Recorrência reativada', occurrence_generated: 'Plantão gerado', occurrence_manual: 'Ocorrência ajustada manualmente', occurrence_retired: 'Ocorrência futura liberada', absence_created: 'Ausência registrada', absence_edited: 'Ausência alterada', absence_cancelled: 'Ausência cancelada', absence_coverage_opened: 'Posto sinalizado para cobertura', absence_assignment_restored: 'Atribuição do médico fixo restaurada', coverage_changed: 'Atribuição de cobertura alterada', coverage_published: 'Vaga aberta para candidaturas', coverage_pending: 'Cobertura mantida pendente', generation_scheduled: 'Geração diária executada', generation_failed: 'Geração diária precisa de revisão' } as Record<string, string>)[action] || 'Alteração da escala';
}
