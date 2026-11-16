import ScheduleAllocationList from './ScheduleAllocationList';
import type { ScheduleAllocation } from '@/lib/scheduleCalendar';

export type ScheduleMonthDay = { day: string; filled: number; required: number; entries: ScheduleAllocation[] };
const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function ScheduleMonthGrid({ days, offset, selectedDate, today, onOpenDay }: {
  days: ScheduleMonthDay[]; offset: number; selectedDate: string; today: string; onOpenDay: (day: string) => void;
}) {
  return <div className="space-y-3">
    <p className="text-xs text-text-muted md:hidden">Deslize na horizontal para ver os dias. Toque em uma data para abrir os detalhes.</p>
    <div tabIndex={0} role="region" aria-label="Calendário mensal com médicos e vagas" className="relative max-h-[75vh] min-w-0 overflow-auto rounded-xl border border-border bg-card-bg focus-visible:outline-2 focus-visible:outline-primary">
      <table className="w-full min-w-[1120px] table-fixed border-separate border-spacing-0">
        <caption className="sr-only">Médicos e vagas por dia do mês</caption>
        <thead className="sticky top-0 z-10 bg-card-bg"><tr>{weekdays.map(day => <th key={day} scope="col" className="border-b border-border px-3 py-3 text-left text-xs font-semibold text-text-muted">{day}</th>)}</tr></thead>
        <tbody>{Array.from({ length: Math.ceil((offset + days.length) / 7) }, (_, row) => <tr key={row}>
          {Array.from({ length: 7 }, (_, column) => {
            const item = days[row * 7 + column - offset];
            if (!item) return <td key={column} className="border-b border-r border-border bg-surface-muted/25"/>;
            const label = new Date(`${item.day}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
            return <td key={item.day} className={`border-b border-r border-border p-0 align-top ${selectedDate === item.day ? 'bg-primary/[0.025]' : ''}`}>
              <button type="button" onClick={() => onOpenDay(item.day)} title={`Abrir escala de ${label}`} aria-current={item.day === today ? 'date' : undefined}
                className={`relative flex min-h-36 w-full min-w-0 flex-col gap-2.5 p-2 text-left transition-colors hover:bg-state-hover focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none ${selectedDate === item.day ? 'ring-1 ring-inset ring-primary/35' : ''}`}>
                <span className="flex w-full items-center justify-between gap-2"><span className={`grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums ${item.day === today ? 'bg-primary text-text-inverse' : 'text-text-secondary'}`}><span className="sr-only">{label}</span><span aria-hidden="true">{Number(item.day.slice(-2))}</span></span>
                  {item.required > 0 && <span aria-label={`${item.filled} médicos escalados para ${item.required} postos`} className="text-[10px] tabular-nums text-text-muted">{item.filled}/{item.required}</span>}
                </span>
                <ScheduleAllocationList entries={item.entries} compact/>
                {!item.entries.length && <span className="text-[11px] text-text-muted">Sem plantões</span>}
              </button>
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
