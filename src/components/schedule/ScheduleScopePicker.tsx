import { CalendarDays } from 'lucide-react';
import { selectedScheduleSector } from '@/lib/scheduleCalendar';
import type { Sector, Unit } from '@/types';

export default function ScheduleScopePicker({ units, sectors, unitId, sectorId, onSelectUnit, onSelectSector }: {
  units: Unit[]; sectors: Sector[]; unitId: string; sectorId: string;
  onSelectUnit: (id: string) => void; onSelectSector: (id: string) => void;
}) {
  const activeUnits = units.filter(item => item.status === 'active');
  const unit = activeUnits.find(item => item.id === unitId);
  const availableSectors = unit ? sectors.filter(item => item.unitId === unit.id && item.organizationId === unit.organizationId && item.status === 'active') : [];
  const ready = Boolean(selectedScheduleSector(unitId, sectorId, units, sectors));
  return <section aria-label="Seleção da escala" className="space-y-5">
    <div className="grid gap-3 rounded-xl border border-border bg-card-bg p-4 sm:grid-cols-2">
      <label className="nv-label min-w-0">Unidade<select required className="nv-input min-w-0" value={unit ? unitId : ''} onChange={event => onSelectUnit(event.target.value)}>
        <option value="">Selecione a unidade</option>{activeUnits.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label className="nv-label min-w-0">Setor<select required disabled={!unit} className="nv-input min-w-0 disabled:cursor-not-allowed disabled:opacity-60" value={ready ? sectorId : ''} onChange={event => onSelectSector(event.target.value)}>
        <option value="">{unit && !availableSectors.length ? 'Nenhum setor ativo nesta unidade' : 'Selecione o setor'}</option>{availableSectors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
    </div>
    {!ready && <div role="status" className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-5 py-10 text-center">
      <CalendarDays size={24} className="text-text-muted" aria-hidden="true"/>
      <p className="text-sm text-text-secondary">Selecione a unidade e o setor para visualizar a escala.</p>
    </div>}
  </section>;
}
