import { Moon, Sun, UserRoundPlus } from 'lucide-react';
import { coveragePeriodLabel } from '@/lib/scheduling';
import type { ScheduleAllocation } from '@/lib/scheduleCalendar';

export default function ScheduleAllocationList({ entries, compact = false, fullNames = false }: { entries: ScheduleAllocation[]; compact?: boolean; fullNames?: boolean }) {
  return <span role="list" aria-label="Médicos e vagas do turno" className={`flex w-full min-w-0 flex-col ${compact ? 'gap-1' : 'gap-2'}`}>
    {entries.map(entry => {
      const Icon = entry.vacant ? UserRoundPlus : entry.kind === 'day' ? Sun : Moon;
      const context = `${coveragePeriodLabel(entry.kind)} · ${entry.startTime}–${entry.endTime}`;
      const vacancyTone = entry.vacancyState === 'available' ? 'border-danger/50 bg-danger/5 text-danger' : 'border-border bg-surface-muted/30 text-text-secondary';
      return <span role="listitem" key={entry.id} title={`${entry.name} · ${entry.sectorName ? `${entry.sectorName} · ` : ''}${context}`}
        className={`flex w-full min-w-0 items-start gap-1.5 ${compact ? `rounded-md border-l-2 px-2 py-2 ${entry.vacant ? vacancyTone : 'border-primary/35 bg-primary/5 text-text-primary'}` : entry.vacant ? 'text-danger' : 'text-text-primary'}`}>
        {(compact || entry.vacant) && <Icon size={12} aria-hidden="true" className="mt-0.5 shrink-0"/>}
        <span className="min-w-0 flex-1"><span className={`${compact ? 'text-xs leading-4' : 'text-sm leading-5'} ${compact && !fullNames ? 'line-clamp-2' : 'block'} break-words [overflow-wrap:anywhere] font-medium`}>{entry.name}</span>{entry.sectorName && <span className="mt-0.5 block break-words text-[10px] font-normal text-text-muted">{entry.sectorName}</span>}{compact && <span className="mt-1 block text-[10px] font-normal tabular-nums opacity-80">{entry.startTime}–{entry.endTime}</span>}</span>
      </span>;
    })}
  </span>;
}
