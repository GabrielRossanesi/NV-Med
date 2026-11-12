'use client';

import { useId, useState } from 'react';
import Dialog from '@/components/Dialog';
import { canEditPermission, canPerformAction, canViewPermission } from '@/lib/permissions';
import { coveragePeriodLabel, paymentFrequencyLabels, sectorCoveragePeriods } from '@/lib/scheduling';
import { formatShiftMoneyInput, parseMoneyCents, sectorFinanceDefaults } from '@/lib/shiftPricing';
import { useShiftRates } from '@/components/schedule/ShiftFinancialDetails';
import { useStore } from '@/store/useStore';
import type { CoveragePeriodKind, PaymentFrequency, Sector, SectorFinanceDefaults, Unit } from '@/types';

type Props = {
  unit: Unit; organizationName: string; specialties: string[]; sector?: Sector; initialSpecialty?: string;
  initialPeriod?: Sector['coveragePeriods'][number]; onClose: () => void; onSaved: (sector: Sector) => void;
};
const defaultCoverage = (kind: CoveragePeriodKind): Sector['coveragePeriods'][number] => ({
  kind, startTime: kind === 'day' ? '07:00' : '19:00', endTime: kind === 'day' ? '19:00' : '07:00', requiredDoctors: 1,
});
type FinanceDraft = { amount: string; day: string; night: string; frequency: PaymentFrequency | ''; notes: string };
const moneyInput = (cents: number | null) => cents == null ? '' : formatShiftMoneyInput(cents);

export default function SectorEditorDialog({ unit, organizationName, specialties, sector, initialSpecialty, initialPeriod, onClose, onSaved }: Props) {
  const id = useId();
  const store = useStore();
  const [name, setName] = useState(sector?.name || '');
  const [description, setDescription] = useState(sector?.description || '');
  const [status, setStatus] = useState<Sector['status']>(sector?.status || 'active');
  const [primarySpecialty, setPrimarySpecialty] = useState(sector?.primarySpecialty || initialSpecialty || '');
  const [periods, setPeriods] = useState(sector ? sectorCoveragePeriods(sector) : [initialPeriod || defaultCoverage('day')]);
  const [error, setError] = useState('');
  const [referenceTime] = useState(Date.now);
  const [financialDraft, setFinancialDraft] = useState<FinanceDraft>();
  const company = store.organizations.find(item => item.id === unit.organizationId);
  const available = specialties.filter(item => company?.settings.specialties.includes(item));
  const affected = sector && primarySpecialty !== sector.primarySpecialty ? store.shifts.filter(item => item.sectorId === sector.id
    && item.organizationId === unit.organizationId && !['cancelled', 'completed'].includes(item.status)
    && new Date(item.date + 'T' + item.endTime).getTime() + (item.endTime < item.startTime ? 86_400_000 : 0) > referenceTime
    && item.specialty !== primarySpecialty) : [];
  const canSave = canPerformAction(store.currentUser, 'unidades', sector ? 'edit' : 'create');
  const canSeeFinance = canViewPermission(store.currentUser, 'financeiro');
  const canEditFinance = canSave && canEditPermission(store.currentUser, 'financeiro');
  const rateQuery = useShiftRates(unit.organizationId, Boolean(sector) && canSeeFinance);
  const configured = sectorFinanceDefaults(rateQuery.rates, sector?.id);
  const finance = financialDraft ?? { amount: moneyInput(configured.amount_cents), day: moneyInput(configured.day_cents),
    night: moneyInput(configured.night_cents), frequency: configured.frequency || '', notes: configured.notes };
  const changeFinance = (patch: Partial<FinanceDraft>) => setFinancialDraft({ ...finance, ...patch });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || store.saving) return;
    if (!name.trim()) return setError('Informe o nome do setor.');
    if (!available.includes(primarySpecialty)) return setError('Escolha uma especialidade ativa da empresa para este setor.');
    if (affected.length) return setError('Regularize os plantões futuros e as trocas antes de alterar a especialidade do setor.');
    if (!periods.length || periods.some(period => period.startTime === period.endTime)) return setError('Selecione um período com horários diferentes.');
    const primary = periods[0];
    const payload = { name: name.trim(), description: description.trim(), primarySpecialty,
      specialties: [...new Set([...(sector?.specialties || []), primarySpecialty])], status, unitId: unit.id,
      defaultStartTime: primary.startTime, defaultEndTime: primary.endTime, requiredDoctors: primary.requiredDoctors, coveragePeriods: periods };
    const updated = sector && { ...payload, id: sector.id, organizationId: sector.organizationId };
    let defaults: SectorFinanceDefaults | undefined;
    if (financialDraft && canEditFinance) {
      const value = (text: string) => text.trim() ? parseMoneyCents(text) : null;
      const day = periods.some(period => period.kind === 'day') ? finance.day : '';
      const night = periods.some(period => period.kind === 'night') ? finance.night : '';
      if ([finance.amount, day, night].some(text => text.trim() && value(text) == null)) {
        return setError('Informe os valores em reais, com até duas casas decimais.');
      }
      defaults = { amount_cents: value(finance.amount), day_cents: value(day), night_cents: value(night), frequency: finance.frequency || null, notes: finance.notes.trim() };
    }
    const saved = updated ? (await store.updateSector(updated, defaults) ? updated : null) : await store.addSector(payload, defaults);
    if (saved) onSaved(saved);
    else setError(useStore.getState().error || 'Não foi possível salvar o setor.');
  }

  return <Dialog title={sector ? 'Editar setor' : 'Novo setor'} onClose={() => !store.saving && onClose()}
    footer={<div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={onClose}>Cancelar</button><button type="submit" form={id} className="nv-button" disabled={store.saving || !canSave}>{store.saving ? 'Salvando…' : 'Salvar setor'}</button></div>}>
    <form id={id} onSubmit={save} className="space-y-4">
      <p className="text-xs text-text-muted">{organizationName} · {unit.name}</p>
      <label className="nv-label">Nome do setor<input autoFocus className="nv-input" maxLength={100} required value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="nv-label">Descrição <span className="font-normal text-text-muted">(opcional)</span><textarea className="nv-input" rows={2} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label className="nv-label">Especialidade principal<select required className="nv-input" value={primarySpecialty} onChange={event => setPrimarySpecialty(event.target.value)}>
        <option value="">Selecione</option>{primarySpecialty && !available.includes(primarySpecialty) && <option value={primarySpecialty} disabled>{primarySpecialty} (indisponível)</option>}
        {available.map(item => <option key={item} value={item}>{item}</option>)}
      </select><span className="mt-2 block text-xs font-normal text-text-muted">Define a especialidade de novos plantões. Vínculos legados e históricos são preservados.</span></label>
      {!available.length && <p className="text-xs text-text-muted">Cadastre especialidades nas configurações da empresa e confira as autorizações da unidade.</p>}
      {Boolean(affected.length) && <div role="alert" className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-text-secondary">
        Alteração bloqueada: {affected.length} plantão(ões) futuro(s) ou em andamento usam outra especialidade. Regularize as escalas, candidaturas e trocas antes de continuar.
        <ul className="mt-2 space-y-1">{affected.slice(0, 5).map(item => <li key={item.id}>{item.date} · {item.startTime}–{item.endTime} · {store.doctors.find(doctor => doctor.id === item.doctorId)?.name || 'Vaga aberta'} · {item.specialty || 'Sem especialidade'}</li>)}</ul>
      </div>}
      <fieldset><legend className="nv-label">Cobertura do setor</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">{(['day', 'night'] as const).map(kind => {
          const period = periods.find(item => item.kind === kind);
          const change = (patch: Partial<Sector['coveragePeriods'][number]>) => setPeriods(periods.map(item => item.kind === kind ? { ...item, ...patch } : item));
          return <div key={kind} className="rounded-xl border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={Boolean(period)} onChange={() => setPeriods(period ? periods.filter(item => item.kind !== kind) : [...periods, defaultCoverage(kind)])} />{coveragePeriodLabel(kind)}</label>
            {period && <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="nv-label">Início<input type="time" className="nv-input" required value={period.startTime} onChange={event => change({ startTime: event.target.value })} /></label>
              <label className="nv-label">Fim<input type="time" className="nv-input" required value={period.endTime} onChange={event => change({ endTime: event.target.value })} /></label>
              <label className="nv-label col-span-2">Médicos esperados<input type="number" min={1} max={99} required className="nv-input" value={period.requiredDoctors} onChange={event => change({ requiredDoctors: Number(event.target.value) })} /></label>
            </div>}
          </div>;
        })}</div>
      </fieldset>
      {canSeeFinance && (sector || canEditFinance) && <fieldset className="min-w-0 space-y-3 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-semibold">Configuração financeira</legend>
        <p className="text-xs text-text-muted">Referências para novos plantões. Uma regra em Valores de plantões pode ter prioridade no mesmo recorte. Valores já acordados são preservados.</p>
        {sector && !rateQuery.ready ? <p role="status" className="text-xs text-text-muted">{rateQuery.error || 'Carregando referências…'}{rateQuery.error && <button type="button" className="ml-2 text-primary underline" onClick={rateQuery.reload}>Tentar novamente</button>}</p> :
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="nv-label">Valor padrão do plantão (R$)<input className="nv-input" inputMode="decimal" placeholder="Sem valor padrão" readOnly={!canEditFinance} value={finance.amount} onChange={event => changeFinance({ amount: event.target.value })}/></label>
              <label className="nv-label">Modalidade padrão<select aria-label="Modalidade padrão" className="nv-input" disabled={!canEditFinance} value={finance.frequency} onChange={event => changeFinance({ frequency: event.target.value as FinanceDraft['frequency'] })}><option value="">Sem modalidade padrão</option>{Object.entries(paymentFrequencyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              {(['day', 'night'] as const).filter(kind => periods.some(period => period.kind === kind)).map(kind => <label key={kind} className="nv-label">Valor {coveragePeriodLabel(kind).toLowerCase()} (R$)
                <input className="nv-input" inputMode="decimal" placeholder="Usar valor padrão" readOnly={!canEditFinance} value={finance[kind]} onChange={event => changeFinance({ [kind]: event.target.value })}/></label>)}
            </div>
            <label className="nv-label">Observações financeiras<textarea className="nv-input" maxLength={1000} rows={2} placeholder="Opcional" readOnly={!canEditFinance} value={finance.notes} onChange={event => changeFinance({ notes: event.target.value })}/></label>
          </>}
      </fieldset>}
      <label className="nv-label">Situação<select className="nv-input" value={status} onChange={event => setStatus(event.target.value as Sector['status'])}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  </Dialog>;
}
