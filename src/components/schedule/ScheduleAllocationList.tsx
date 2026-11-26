import { Moon, Sun } from 'lucide-react';
import type { ScheduleAllocation } from '@/lib/scheduleCalendar';
import { coveragePeriodLabel } from '@/lib/scheduling';

export default function ScheduleAllocationList({ entries, fullNames, onOpen }: {
  entries: ScheduleAllocation[];
  fullNames: boolean;
  onOpen: (entry: ScheduleAllocation) => void;
}) {
  if (!entries.length) return null;

  return <ul className="flex min-w-0 flex-col gap-1">
    {entries.map(entry => {
      const Icon = entry.kind === 'day' ? Sun : Moon;
      const time = `${entry.startTime}–${entry.endTime}`;
      const description = [entry.name, entry.sectorName, coveragePeriodLabel(entry.kind), time, entry.duration].filter(Boolean).join(' · ');
      return <li key={entry.id} className="min-w-0">
        <button type="button" title={description}
          data-schedule-tone={entry.vacant ? entry.vacancyState : entry.kind}
          onClick={() => onOpen(entry)}
          className="nv-schedule-entry flex min-h-10 w-full min-w-0 items-start gap-1 rounded-md px-1.5 py-1 text-left">
          <Icon size={12} aria-hidden="true" className="mt-0.5 shrink-0"/>
          <span className="min-w-0 flex-1">
            <span className={`${fullNames ? 'block' : 'line-clamp-2'} wrap-anywhere text-xs leading-4 font-semibold`}>{entry.name}</span>
            <span className="flex flex-wrap gap-x-1.5 wrap-anywhere text-[11px] leading-[0.875rem]">
              <span className="tabular-nums">{time}</span>
              {entry.duration && <span>{entry.duration}</span>}
              {entry.sectorName && <span>{entry.sectorName}</span>}
              <span className="sr-only">{coveragePeriodLabel(entry.kind)}</span>
            </span>
          </span>
        </button>
      </li>;
    })}
  </ul>;
}
