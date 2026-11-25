'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { scheduleSectors, type SectorSelection } from '@/lib/scheduleScope';
import type { Sector, Unit } from '@/types';

const fieldClass = 'nv-input h-11 appearance-none pe-9 leading-5';
const chevronClass = 'pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-text-muted';

export default function ScheduleScopePicker({ units, sectors, unitId, sectorId, selection, onSelectUnit, onSelectSector, onSelectSectors, compact = false }: {
  units: Unit[]; sectors: Sector[]; unitId: string; sectorId?: string; selection?: SectorSelection;
  onSelectUnit: (id: string) => void; onSelectSector?: (id: string) => void; onSelectSectors?: (value: SectorSelection) => void;
  compact?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const sectorField = useRef<HTMLDivElement>(null);
  const sectorButton = useRef<HTMLButtonElement>(null);
  const value = selection ?? (sectorId ? [sectorId] : []);
  const activeUnits = units.filter(item => item.status === 'active');
  const unit = activeUnits.find(item => item.id === unitId);
  const available = scheduleSectors(unitId, 'all', units, sectors);
  const selected = scheduleSectors(unitId, value, units, sectors);
  const expanded = open && Boolean(unit);
  const selectionLabel = value === 'all' && unit ? 'Todos os setores'
    : selected.length === 1 ? selected[0].name
    : selected.length ? `${selected.length} setores selecionados` : 'Selecione os setores';

  useEffect(() => {
    if (!expanded) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !sectorField.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [expanded]);

  function change(next: SectorSelection) { onSelectSectors?.(next); if (onSelectSector) onSelectSector(next === 'all' ? '' : next[0] || ''); }
  return <section aria-label="Seleção da escala" className={compact ? 'w-full min-w-0 sm:max-w-2xl sm:flex-[1_1_23rem]' : 'space-y-5'}>
    <div className={compact ? 'grid items-start gap-2 min-[360px]:grid-cols-2' : 'grid items-start gap-3 rounded-xl border border-border bg-card-bg p-4 sm:grid-cols-2'}>
      <div className={compact ? 'min-w-0 space-y-1' : 'min-w-0 space-y-2'}>
        <label htmlFor={`${id}-unit`} className="nv-label">Unidade</label>
        <div className="relative">
          <select id={`${id}-unit`} required className={fieldClass} value={unit ? unitId : ''} onChange={event => {
            setSearch('');
            setOpen(false);
            onSelectUnit(event.target.value);
          }}>
            <option value="">Selecione a unidade</option>
            {activeUnits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <ChevronDown size={16} aria-hidden="true" className={chevronClass}/>
        </div>
      </div>
      <div ref={sectorField} className={compact ? 'min-w-0 space-y-1' : 'min-w-0 space-y-2'} onKeyDown={event => {
        if (event.key !== 'Escape' || !expanded) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        sectorButton.current?.focus();
      }} onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}>
        <span id={`${id}-sectors-label`} className="nv-label">Setores</span>
        <div className="relative">
          <button ref={sectorButton} type="button" disabled={!unit} aria-expanded={expanded}
            aria-labelledby={`${id}-sectors-label ${id}-sectors-value`} aria-controls={`${id}-sectors-options`}
            title={selectionLabel}
            className={`${fieldClass} block cursor-pointer bg-input-bg text-left disabled:cursor-not-allowed disabled:opacity-50`}
            onClick={() => setOpen(current => !current)}>
            <span id={`${id}-sectors-value`} className="block truncate">{selectionLabel}</span>
            <ChevronDown size={16} aria-hidden="true" className={`${chevronClass}${expanded ? ' rotate-180' : ''}`}/>
          </button>
          <div id={`${id}-sectors-options`} hidden={!expanded}
            className="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain rounded-xl border border-border bg-card-bg p-3 shadow-strong">
            <fieldset className="min-w-0 space-y-3">
              <legend className="sr-only">Setores da unidade</legend>
              <label className="nv-label">Pesquisar setor<input className="nv-input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome do setor"/></label>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={value === 'all'} onChange={event => change(event.target.checked ? 'all' : [])}/>Todos os setores</label>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {available.filter(item => item.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(item => <label key={item.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={selected.some(s => s.id === item.id)} onChange={event => change(event.target.checked ? [...selected.map(s => s.id), item.id] : selected.filter(s => s.id !== item.id).map(s => s.id))}/>{item.name}</label>)}
                {unit && !available.length && <p className="text-xs text-text-muted">Nenhum setor ativo nesta unidade.</p>}
              </div>
              <button type="button" className="min-h-10 text-xs font-semibold text-primary" onClick={() => change([])}>Limpar seleção</button>
              <p role="status" className="text-xs text-text-muted">{selected.length} {selected.length === 1 ? 'setor selecionado' : 'setores selecionados'}{value === 'all' ? ' · Inclui novos setores autorizados desta unidade.' : ''}</p>
            </fieldset>
          </div>
        </div>
      </div>
    </div>
    {!selected.length && <div role="status" className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-5 py-10 text-center"><CalendarDays size={24} className="text-text-muted" aria-hidden="true"/><p className="text-sm text-text-secondary">Selecione a unidade e pelo menos um setor para visualizar a escala.</p></div>}
  </section>;
}
