'use client';

import { useState } from 'react';
import Dialog from '@/components/Dialog';
import { ShiftAgreementFields, useShiftRates } from './ShiftFinancialDetails';
import { buildRequiredPjAgreement, chooseShiftRate, initialAgreementDraft } from '@/lib/shiftPricing';
import { localDate, employmentLabels } from '@/lib/scheduling';
import { masterDates, type MasterDefinition, type MasterRule } from '@/lib/masterSchedule';
import { saveMasterRule } from '@/services/masterScheduleService';
import type { Doctor, Sector, Shift, Unit } from '@/types';
import { useScheduleEdit, useScheduleDraft } from './ScheduleEditGuard';

export default function MasterRuleEditor({ organization, unitId, sectorId, doctors, units, sectors, rule, effectiveDate, canFinance, onClose, onSaved }: {
  organization: string; unitId: string; sectorId: string; doctors: Doctor[]; units: Unit[]; sectors: Sector[];
  rule?: MasterRule; effectiveDate?: string; canFinance: boolean; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const guard = useScheduleEdit();
  const today = localDate();
  const sector = sectors.find(item => item.id === (rule?.definition.sector_id || sectorId));
  const [spec, setSpec] = useState<MasterDefinition>(() => rule?.definition || {
    doctor_id: '', unit_id: unitId, sector_id: sectorId, specialty: sector?.primarySpecialty || '',
    start_time: sector?.defaultStartTime || '07:00', end_time: sector?.defaultEndTime || '19:00',
    frequency: 'weeks', interval_weeks: 1, weekdays: [new Date(`${today}T12:00:00`).getDay()],
    start_date: today, anchor_date: today, end_date: null, employment_type: 'clt', employer_name: null, type: 'onsite',
  });
  const [since, setSince] = useState([today, rule?.effective_from || '', effectiveDate || ''].sort().at(-1)!);
  const [horizon, setHorizon] = useState(rule?.horizon_months || 3);
  const [agreement, setAgreement] = useState(() => initialAgreementDraft());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useScheduleDraft(`master-rule:${rule?.id || 'new'}`, JSON.stringify([spec, since, horizon, agreement]), busy, onClose);
  const rates = useShiftRates(organization, canFinance && spec.employment_type === 'pj');
  const prototype: Shift = { id: '', organizationId: organization, doctorId: spec.doctor_id, unitId: spec.unit_id,
    sectorId: spec.sector_id, specialty: spec.specialty, date: since, startTime: spec.start_time, endTime: spec.end_time, type: spec.type, status: 'pending' };
  const selectedSector = sectors.find(item => item.id === spec.sector_id);
  const rate = chooseShiftRate(rates.rates, prototype, selectedSector);
  const end = new Date(`${today}T12:00:00`); end.setMonth(end.getMonth() + horizon + 1, 0);
  const dates = masterDates(spec, rule ? since : today, localDate(end));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!guard.check()) return; setBusy(true); setError('');
    try {
      if (!spec.weekdays.length) throw new Error('Selecione pelo menos um dia da semana.');
      const finance = spec.employment_type === 'pj' ? buildRequiredPjAgreement(agreement, rate) : null;
      const result = await guard.run(() => saveMasterRule(organization, rule?.id || null, spec, rule?.revision || 0, rule ? since : spec.start_date, horizon, finance, confirmed));
      if (!result) return;
      await onSaved(); onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a recorrência.'); }
    finally { setBusy(false); }
  }
  return <Dialog title={rule ? 'Editar recorrência' : 'Cadastrar médico fixo'} size="lg" onClose={() => !busy && guard.transition(onClose)}>
    <form data-schedule-edit onSubmit={save} aria-busy={busy}><fieldset disabled={!guard.unlocked || busy} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="nv-label sm:col-span-2">Médico responsável<select className="nv-input" required disabled={Boolean(rule)} value={spec.doctor_id} onChange={e => setSpec({ ...spec, doctor_id: e.target.value })}>
          <option value="">Selecione o médico</option>{doctors.filter(d => d.organizationId === organization && (d.status === 'active' || d.id === spec.doctor_id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
        <label className="nv-label">Unidade<select className="nv-input" required value={spec.unit_id} onChange={e => setSpec({ ...spec, unit_id: e.target.value, sector_id: '', specialty: '' })}>
          {units.filter(u => u.status === 'active').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></label>
        <label className="nv-label">Setor<select className="nv-input" required value={spec.sector_id} onChange={e => { const s = sectors.find(s => s.id === e.target.value); setSpec({ ...spec, sector_id: e.target.value, specialty: s?.primarySpecialty || '' }); }}>
          <option value="">Selecione o setor</option>{sectors.filter(s => s.unitId === spec.unit_id && s.status === 'active').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></label>
        <p className="text-xs text-text-muted sm:col-span-2">Especialidade do setor: <strong>{spec.specialty || 'Configure a especialidade principal antes de salvar.'}</strong></p>
        <label className="nv-label">Início<input className="nv-input" type="time" required value={spec.start_time} onChange={e => setSpec({ ...spec, start_time: e.target.value })}/></label>
        <label className="nv-label">Término<input className="nv-input" type="time" required value={spec.end_time} onChange={e => setSpec({ ...spec, end_time: e.target.value })}/></label>
        {spec.end_time < spec.start_time && <p className="text-xs text-primary sm:col-span-2">O plantão termina no dia seguinte.</p>}
        <label className="nv-label">Frequência<select className="nv-input" value={spec.frequency === 'monthly' ? 'monthly' : String(spec.interval_weeks)} onChange={e => setSpec({ ...spec, frequency: e.target.value === 'monthly' ? 'monthly' : 'weeks', interval_weeks: e.target.value === 'monthly' ? 1 : Number(e.target.value) })}>
          <option value="1">Semanal</option><option value="2">Quinzenal</option><option value="monthly">Mensal</option>{spec.interval_weeks > 2 && <option value={spec.interval_weeks}>A cada {spec.interval_weeks} semanas</option>}
        </select></label>
        {spec.frequency === 'weeks' && <label className="nv-label">Intervalo em semanas<input className="nv-input" type="number" min={1} max={52} required value={spec.interval_weeks} onChange={e => setSpec({ ...spec, interval_weeks: Number(e.target.value) })}/></label>}
        <label className="nv-label">Primeiro dia da recorrência<input className="nv-input" type="date" required value={spec.start_date} onChange={e => setSpec({ ...spec, start_date: e.target.value })}/></label>
        <label className="nv-label">Data de referência<input className="nv-input" type="date" required max={spec.start_date} value={spec.anchor_date} onChange={e => setSpec({ ...spec, anchor_date: e.target.value })}/></label>
        <label className="nv-label">Data final opcional<input className="nv-input" type="date" min={spec.start_date} value={spec.end_date || ''} onChange={e => setSpec({ ...spec, end_date: e.target.value || null })}/></label>
        <label className="nv-label">Meses futuros a gerar<input className="nv-input" type="number" min={1} max={12} required value={horizon} onChange={e => setHorizon(Number(e.target.value))}/></label>
      </div>
      <fieldset><legend className="nv-label">Dias da semana</legend><div className="mt-2 flex flex-wrap gap-3">{['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((label, day) => <label key={day} className="flex min-h-10 items-center gap-1.5 text-sm"><input type="checkbox" checked={spec.weekdays.includes(day)} onChange={e => setSpec({ ...spec, weekdays: e.target.checked ? [...spec.weekdays, day] : spec.weekdays.filter(d => d !== day) })}/>{label}</label>)}</div></fieldset>
      <p className="text-xs leading-5 text-text-muted">{spec.frequency === 'monthly' ? 'O mês usa a mesma posição da semana da data de referência. Meses sem essa ocorrência são pulados.' : 'A alternância usa a semana da data de referência, inclusive na virada do mês e do ano.'}</p>
      <div className="grid gap-4 sm:grid-cols-2"><label className="nv-label">Contratação<select className="nv-input" value={spec.employment_type} onChange={e => setSpec({ ...spec, employment_type: e.target.value as MasterDefinition['employment_type'] })}>{Object.entries(employmentLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="nv-label">Modalidade do plantão<select className="nv-input" value={spec.type} onChange={e => setSpec({ ...spec, type: e.target.value as MasterDefinition['type'] })}><option value="onsite">Presencial</option><option value="oncall">Sobreaviso</option><option value="telemedicine">Telemedicina</option></select></label></div>
      {spec.employment_type === 'pj' && <>
        <label className="nv-label">Empresa PJ<input className="nv-input" required maxLength={150} value={spec.employer_name || ''} onChange={e => setSpec({ ...spec, employer_name: e.target.value })}/></label>
        {canFinance ? <ShiftAgreementFields draft={agreement} onChange={setAgreement} rate={rate} requireAmount/> : <p role="alert" className="text-sm text-warning">A criação ou revisão de recorrências PJ exige edição financeira.</p>}
        {rates.error && <p role="alert" className="text-sm text-danger">{rates.error}</p>}
      </>}
      {rule && <label className="nv-label">Alterar ocorrências a partir de<input className="nv-input" type="date" min={[today, rule.effective_from].sort().at(-1)} required value={since} onChange={e => setSince(e.target.value)}/></label>}
      <section className="rounded-lg border border-border bg-surface-muted/30 p-4"><h3 className="text-sm font-semibold">Próximas datas · {dates.length} ocorrências</h3><p className="mt-2 text-xs leading-6 text-text-secondary">{dates.slice(0, 8).map(d => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR')).join(' · ') || 'Confira as datas e os dias selecionados.'}{dates.length > 8 ? ' …' : ''}</p><p className="mt-2 text-xs text-text-muted">Plantões realizados, pagamentos consolidados e alterações manuais serão preservados. Novas atribuições ficam aguardando confirmação.</p></section>
      {rule && <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>Confirmo a revisão das ocorrências futuras a partir da data informada, incluindo as já publicadas.</span></label>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={busy} onClick={() => guard.transition(onClose)}>Cancelar</button><button className="nv-button" disabled={busy || !spec.specialty || spec.employment_type === 'pj' && (!canFinance || !rates.ready)}>{busy ? 'Salvando…' : 'Salvar recorrência e gerar plantões'}</button></div>
    </fieldset></form>
  </Dialog>;
}
