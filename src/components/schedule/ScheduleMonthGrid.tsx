import ScheduleAllocationList from './ScheduleAllocationList';
import { List } from 'lucide-react';
import type { ScheduleAllocation } from '@/lib/scheduleCalendar';

export type ScheduleMonthDay = { day: string; filled: number; required: number; entries: ScheduleAllocation[]; fractional?: boolean };
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function ScheduleMonthGrid({ days, offset, selectedDate, today, onOpenDay, onOpenEntry, mode = 'month', filtered = false, vacanciesOnly = false }: {
  days: ScheduleMonthDay[]; offset: number; selectedDate: string; today: string; onOpenDay: (day: string) => void;
  onOpenEntry: (entry: ScheduleAllocation, day: string) => void;
  mode?: 'month' | 'week' | 'day'; filtered?: boolean; vacanciesOnly?: boolean;
}) {
  const columns = mode === 'day' ? 1 : 7;
  const headings = mode === 'month' ? weekdays : days.map(item => weekdays[new Date(`${item.day}T12:00:00`).getDay()]);
  const periodLabel = mode === 'month' ? 'mensal' : mode === 'week' ? 'semanal' : 'diário';
  return <div className="min-w-0 space-y-2">
    {filtered && <p className="text-xs text-text-muted">{vacanciesOnly ? 'Somente vagas disponíveis para cobertura.' : 'Somente plantões que correspondem aos filtros.'} A contagem mostra os resultados; consulte a cobertura total nos detalhes do dia.</p>}
    <div tabIndex={0} role="region" aria-label={`Calendário ${periodLabel} com médicos e vagas`} className={`relative min-w-0 overflow-auto rounded-xl border border-border bg-card-bg focus-visible:outline-2 focus-visible:outline-primary ${mode === 'month' ? '' : 'max-h-[75vh]'}`}>
      <table className={`w-full ${mode === 'day' ? '' : 'min-w-[56rem]'} table-fixed border-separate border-spacing-0`}>
        <caption className="sr-only">Médicos e vagas por dia · calendário {periodLabel}</caption>
        <thead className="sticky top-0 z-10 bg-card-bg"><tr>{headings.map((day, index) => <th key={index} scope="col" className="border-b border-border px-2 py-1.5 text-left text-xs font-semibold text-text-muted">{day}</th>)}</tr></thead>
        <tbody>{Array.from({ length: Math.ceil((offset + days.length) / columns) }, (_, row) => <tr key={row}>
          {Array.from({ length: columns }, (_, column) => {
            const item = days[row * columns + column - offset];
            if (!item) return <td key={column} className="border-b border-r border-border bg-surface-muted/25"/>;
            const label = new Date(`${item.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
            const coverage = item.fractional ? `${item.filled} de ${item.required} posições integralmente cobertas`
              : `${item.filled} médicos escalados para ${item.required} postos`;
            return <td key={item.day} className={`border-b border-r border-border p-1 align-top ${selectedDate === item.day ? 'bg-primary/[0.025] ring-1 ring-inset ring-primary/35' : ''}`}>
              <div className={`flex items-center justify-between gap-1 ${item.entries.length ? 'mb-1' : 'min-h-14 items-start'}`}>
                <button type="button" onClick={() => onOpenDay(item.day)} title={`Ver plantões de ${label}`} aria-label={`Ver plantões de ${label}`} aria-current={item.day === today ? 'date' : undefined}
                  className="inline-flex min-h-8 items-center gap-1 rounded-md px-0.5 text-text-secondary hover:bg-state-hover focus-visible:outline-offset-[-2px]">
                  <span className={`grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${item.day === today ? 'bg-primary text-text-inverse' : ''}`} aria-hidden="true">{Number(item.day.slice(-2))}</span>
                  <List size={13} aria-hidden="true"/>
                </button>
                  {item.required > 0 && (!filtered || item.entries.length > 0) && <span title={`Cobertura total: ${coverage}`} aria-label={filtered ? `${item.entries.length} resultados filtrados. Cobertura total: ${coverage}` : coverage} className="text-[10px] tabular-nums text-text-muted">{filtered ? `${item.entries.length} ${vacanciesOnly ? item.entries.length === 1 ? 'vaga' : 'vagas' : item.entries.length === 1 ? 'item' : 'itens'}` : `${item.filled}/${item.required}`}</span>}
              </div>
              <ScheduleAllocationList entries={item.entries} fullNames={mode !== 'month'} onOpen={entry => onOpenEntry(entry, item.day)}/>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
