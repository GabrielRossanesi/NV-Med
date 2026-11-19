import ScheduleAllocationList from './ScheduleAllocationList';
import type { ScheduleAllocation } from '@/lib/scheduleCalendar';

export type ScheduleMonthDay = { day: string; filled: number; required: number; entries: ScheduleAllocation[] };
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function ScheduleMonthGrid({ days, offset, selectedDate, today, onOpenDay, mode = 'month', filtered = false, vacanciesOnly = false }: {
  days: ScheduleMonthDay[]; offset: number; selectedDate: string; today: string; onOpenDay: (day: string) => void;
  mode?: 'month' | 'week' | 'day'; filtered?: boolean; vacanciesOnly?: boolean;
}) {
  const columns = mode === 'day' ? 1 : 7;
  const headings = mode === 'month' ? weekdays : days.map(item => weekdays[new Date(`${item.day}T12:00:00`).getDay()]);
  const periodLabel = mode === 'month' ? 'mensal' : mode === 'week' ? 'semanal' : 'diário';
  return <div className="space-y-3">
    {mode !== 'day' && <p className="text-xs text-text-muted md:hidden">Deslize na horizontal para ver os dias.</p>}
    {filtered && <p className="text-xs text-text-muted">{vacanciesOnly ? 'Somente vagas disponíveis para cobertura.' : 'Somente plantões que correspondem aos filtros.'} A contagem mostra os resultados; consulte a cobertura total nos detalhes do dia.</p>}
    <div tabIndex={0} role="region" aria-label={`Calendário ${periodLabel} com médicos e vagas`} className="relative max-h-[75vh] min-w-0 overflow-auto rounded-xl border border-border bg-card-bg focus-visible:outline-2 focus-visible:outline-primary">
      <table className={`w-full ${mode === 'day' ? '' : 'min-w-[1120px]'} table-fixed border-separate border-spacing-0`}>
        <caption className="sr-only">Médicos e vagas por dia · calendário {periodLabel}</caption>
        <thead className="sticky top-0 z-10 bg-card-bg"><tr>{headings.map((day, index) => <th key={index} scope="col" className="border-b border-border px-3 py-3 text-left text-xs font-semibold text-text-muted">{day}</th>)}</tr></thead>
        <tbody>{Array.from({ length: Math.ceil((offset + days.length) / columns) }, (_, row) => <tr key={row}>
          {Array.from({ length: columns }, (_, column) => {
            const item = days[row * columns + column - offset];
            if (!item) return <td key={column} className="border-b border-r border-border bg-surface-muted/25"/>;
            const label = new Date(`${item.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
            return <td key={item.day} className={`h-px border-b border-r border-border p-0 align-top ${selectedDate === item.day ? 'bg-primary/[0.025]' : ''}`}>
              <button type="button" onClick={() => onOpenDay(item.day)} title={`Abrir escala de ${label}`} aria-current={item.day === today ? 'date' : undefined}
                className={`relative flex h-full min-h-36 w-full min-w-0 flex-col gap-2.5 p-2 text-left transition-colors hover:bg-state-hover focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${selectedDate === item.day ? 'ring-1 ring-inset ring-primary/35' : ''}`}>
                <span className="flex w-full items-center justify-between gap-2"><span className={`grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums ${item.day === today ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`}><span className="sr-only">{label}</span><span aria-hidden="true">{Number(item.day.slice(-2))}</span></span>
                  {item.required > 0 && (!filtered || item.entries.length > 0) && <span title={`Cobertura total: ${item.filled} médicos escalados para ${item.required} postos`} aria-label={filtered ? `${item.entries.length} resultados filtrados. Cobertura total: ${item.filled} de ${item.required} postos` : `${item.filled} médicos escalados para ${item.required} postos`} className="text-[10px] tabular-nums text-text-muted">{filtered ? `${item.entries.length} ${vacanciesOnly ? item.entries.length === 1 ? 'vaga' : 'vagas' : item.entries.length === 1 ? 'item' : 'itens'}` : `${item.filled}/${item.required}`}</span>}
                </span>
                <ScheduleAllocationList entries={item.entries} compact fullNames={mode !== 'month'}/>
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
