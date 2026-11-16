import { Moon, Sun, UserRoundPlus } from 'lucide-react';
import { coveragePeriodLabel } from '@/lib/scheduling';
import type { ScheduleAllocation } from '@/lib/scheduleCalendar';

export default function ScheduleAllocationList({ entries, compact = false }: { entries: ScheduleAllocation[]; compact?: boolean }) {
  return <span role="list" aria-label="Médicos e vagas do turno" className={`flex w-full min-w-0 flex-col ${compact ? 'gap-1' : 'gap-2'}`}>
    {entries.map(entry => {
      const Icon = entry.vacant ? UserRoundPlus : entry.kind === 'day' ? Sun : Moon;
      const context = `${coveragePeriodLabel(entry.kind)} · ${entry.startTime}–${entry.endTime}`;
      return <span role="listitem" key={entry.id} title={`${entry.name} · ${context}`}
        className={`flex min-w-0 items-start gap-1.5 ${compact ? `rounded-md border-l-2 px-2 py-1 ${entry.vacant ? 'border-danger/50 bg-danger/5 text-danger' : 'border-primary/35 bg-primary/5 text-text-primary'}` : entry.vacant ? 'text-danger' : 'text-text-primary'}`}>
        {(compact || entry.vacant) && <Icon size={12} aria-hidden="true" className="mt-0.5 shrink-0"/>}
        <span className={compact ? 'min-w-0 flex-1 truncate text-xs font-medium leading-4' : 'min-w-0 break-words text-sm font-medium leading-5'}>{entry.name}</span>
        {compact && <span className="shrink-0 text-[10px] tabular-nums opacity-75">{entry.startTime}</span>}
      </span>;
    })}
  </span>;
}
