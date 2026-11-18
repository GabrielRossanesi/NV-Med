'use client';
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { scheduleSectors, type SectorSelection } from '@/lib/scheduleScope';
import type { Sector, Unit } from '@/types';

export default function ScheduleScopePicker({ units, sectors, unitId, sectorId, selection, onSelectUnit, onSelectSector, onSelectSectors }: {
  units: Unit[]; sectors: Sector[]; unitId: string; sectorId?: string; selection?: SectorSelection;
  onSelectUnit: (id: string) => void; onSelectSector?: (id: string) => void; onSelectSectors?: (value: SectorSelection) => void;
}) {
  const [search, setSearch] = useState('');
  const value = selection ?? (sectorId ? [sectorId] : []);
  const activeUnits = units.filter(item => item.status === 'active');
  const unit = activeUnits.find(item => item.id === unitId);
  const available = scheduleSectors(unitId, 'all', units, sectors);
  const selected = scheduleSectors(unitId, value, units, sectors);
  function change(next: SectorSelection) { onSelectSectors?.(next); if (onSelectSector) onSelectSector(next === 'all' ? '' : next[0] || ''); }
  return <section aria-label="Seleção da escala" className="space-y-5">
    <div className="grid items-start gap-3 rounded-xl border border-border bg-card-bg p-4 sm:grid-cols-2">
      <label className="nv-label min-w-0">Unidade<select required className="nv-input min-w-0" value={unit ? unitId : ''} onChange={event => { setSearch(''); onSelectUnit(event.target.value); }}>
        <option value="">Selecione a unidade</option>{activeUnits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <details className="min-w-0 rounded-lg border border-border bg-card-bg">
        <summary className="min-h-11 cursor-pointer px-3 py-2 text-sm font-medium">Setores · {value === 'all' && unit ? 'Todos os setores' : selected.length ? `${selected.length} ${selected.length === 1 ? 'selecionado' : 'selecionados'}` : 'Selecione os setores'}</summary>
        <fieldset disabled={!unit} className="space-y-3 border-t border-border p-3 disabled:opacity-50">
          <legend className="sr-only">Setores da unidade</legend>
          <label className="nv-label">Pesquisar setor<input className="nv-input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome do setor"/></label>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={value === 'all'} onChange={event => change(event.target.checked ? 'all' : [])}/>Todos os setores</label>
          <div className="max-h-64 space-y-1 overflow-y-auto">{available.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(item => <label key={item.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={selected.some(s => s.id === item.id)} onChange={event => change(event.target.checked ? [...selected.map(s => s.id), item.id] : selected.filter(s => s.id !== item.id).map(s => s.id))}/>{item.name}</label>)}{unit && !available.length && <p className="text-xs text-text-muted">Nenhum setor ativo nesta unidade.</p>}</div>
          <button type="button" className="min-h-10 text-xs font-semibold text-primary" onClick={() => change([])}>Limpar seleção</button>
          <p role="status" className="text-xs text-text-muted">{selected.length} {selected.length === 1 ? 'setor selecionado' : 'setores selecionados'}{value === 'all' ? ' · Inclui novos setores autorizados desta unidade.' : ''}</p>
        </fieldset>
      </details>
    </div>
    {!selected.length && <div role="status" className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-5 py-10 text-center"><CalendarDays size={24} className="text-text-muted" aria-hidden="true"/><p className="text-sm text-text-secondary">Selecione a unidade e pelo menos um setor para visualizar a escala.</p></div>}
  </section>;
}
