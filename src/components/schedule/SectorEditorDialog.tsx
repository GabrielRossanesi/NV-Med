'use client';

import { useId, useState } from 'react';
import Dialog from '@/components/Dialog';
import { canPerformAction } from '@/lib/permissions';
import { coveragePeriodLabel, sectorCoveragePeriods } from '@/lib/scheduling';
import { useStore } from '@/store/useStore';
import type { CoveragePeriodKind, Sector, Unit } from '@/types';

type Props = {
  unit: Unit; organizationName: string; specialties: string[]; sector?: Sector; initialSpecialty?: string;
  initialPeriod?: Sector['coveragePeriods'][number]; onClose: () => void; onSaved: (sector: Sector) => void;
};
const defaultCoverage = (kind: CoveragePeriodKind): Sector['coveragePeriods'][number] => ({
  kind, startTime: kind === 'day' ? '07:00' : '19:00', endTime: kind === 'day' ? '19:00' : '07:00', requiredDoctors: 1,
});

export default function SectorEditorDialog({ unit, organizationName, specialties, sector, initialSpecialty, initialPeriod, onClose, onSaved }: Props) {
  const id = useId();
  const store = useStore();
  const [name, setName] = useState(sector?.name || '');
  const [description, setDescription] = useState(sector?.description || '');
  const [status, setStatus] = useState<Sector['status']>(sector?.status || 'active');
  const [selected, setSelected] = useState(sector?.specialties || (initialSpecialty ? [initialSpecialty] : []));
  const [periods, setPeriods] = useState(sector ? sectorCoveragePeriods(sector) : [initialPeriod || defaultCoverage('day')]);
  const [error, setError] = useState('');
  const available = [...new Set([...specialties, ...(sector?.specialties || [])])];
  const canSave = canPerformAction(store.currentUser, 'unidades', sector ? 'edit' : 'create');

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave || store.saving) return;
    if (!name.trim()) return setError('Informe o nome do setor.');
    if (!periods.length || periods.some(period => period.startTime === period.endTime)) return setError('Selecione um período com horários diferentes.');
    const primary = periods[0];
    const payload = { name: name.trim(), description: description.trim(), specialties: selected, status, unitId: unit.id,
      defaultStartTime: primary.startTime, defaultEndTime: primary.endTime, requiredDoctors: primary.requiredDoctors, coveragePeriods: periods };
    const updated = sector && { ...payload, id: sector.id, organizationId: sector.organizationId };
    const saved = updated ? (await store.updateSector(updated) ? updated : null) : await store.addSector(payload);
    if (saved) onSaved(saved);
    else setError(useStore.getState().error || 'Não foi possível salvar o setor.');
  }

  return <Dialog title={sector ? 'Editar setor' : 'Novo setor'} onClose={() => !store.saving && onClose()}
    footer={<div className="flex justify-end gap-2"><button type="button" className="nv-button-secondary" disabled={store.saving} onClick={onClose}>Cancelar</button><button type="submit" form={id} className="nv-button" disabled={store.saving || !canSave}>{store.saving ? 'Salvando…' : 'Salvar setor'}</button></div>}>
    <form id={id} onSubmit={save} className="space-y-4">
      <p className="text-xs text-text-muted">{organizationName} · {unit.name}</p>
      <label className="nv-label">Nome do setor<input autoFocus className="nv-input" maxLength={100} required value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="nv-label">Descrição <span className="font-normal text-text-muted">(opcional)</span><textarea className="nv-input" rows={2} maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <fieldset><legend className="nv-label">Especialidades aceitas</legend>
        {available.length ? <div className="mt-2 flex max-h-36 flex-wrap gap-2 overflow-auto">{available.map(item => <label key={item} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm">
          <input type="checkbox" checked={selected.includes(item)} onChange={event => setSelected(event.target.checked ? [...selected, item] : selected.filter(value => value !== item))} />{item}
        </label>)}</div> : <p className="mt-2 text-xs text-text-muted">Cadastre especialidades nas configurações da empresa.</p>}
        <p className="mt-2 text-xs text-text-muted">Sem seleção, o setor usa as especialidades disponíveis para a unidade.</p>
      </fieldset>
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
      {sector && <label className="nv-label">Situação<select className="nv-input" value={status} onChange={event => setStatus(event.target.value as Sector['status'])}><option value="active">Ativo</option><option value="inactive">Inativo</option></select></label>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  </Dialog>;
}
