import { X } from 'lucide-react';
import { type CoverageSpan, calculateFractionalCoverage, coverageDuration, coverageMinutes, coverageSpan } from '@/lib/fractionalCoverage';
import type { CoveragePeriodKind, Doctor, Shift } from '@/types';

interface TimelineSegment extends CoverageSpan {
  shift?: Shift;
  name: string;
  vacant: boolean;
}

export default function ShiftCoverageTimeline({ planned, capacity, segments, doctors, timeZone, kind, onClose, onOpen, preview }: {
  planned: CoverageSpan;
  capacity: number;
  segments: Shift[];
  doctors: Doctor[];
  timeZone: string;
  kind: CoveragePeriodKind;
  onClose: () => void;
  onOpen?: (shift: Shift) => void;
  preview: boolean;
}) {
  const current: TimelineSegment[] = segments.flatMap(shift => {
    const span = coverageSpan(shift);
    if (!span || shift.status === 'cancelled') return [];
    const vacant = !shift.doctorId;
    return [{ ...span, shift, vacant, name: vacant ? 'Vaga aberta' : doctors.find(doctor => doctor.id === shift.doctorId)?.name || 'Médico escalado' }];
  });
  const assigned = current.filter(segment => !segment.vacant);
  const totals = calculateFractionalCoverage(planned, capacity, assigned);
  const savedGaps = current.filter(segment => segment.vacant);
  const gaps: TimelineSegment[] = !preview ? savedGaps : (totals?.gaps || []).map(span => {
    const saved = savedGaps.findIndex(item => item.start === span.start && item.end === span.end);
    return saved === -1 ? { ...span, vacant: true, name: 'Vaga aberta' } : savedGaps.splice(saved, 1)[0];
  });
  const timeline = [...assigned, ...gaps].sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const duration = planned.end - planned.start;
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const range = (span: CoverageSpan) => `${time.format(span.start)}–${time.format(span.end)}`;
  const ticks = [...new Set([planned.start, planned.end, ...timeline.flatMap(item => [item.start, item.end])])].sort((a, b) => a - b);
  const metrics = totals && [
    ['Previstas', totals.plannedMinutes], ['Cobertas', totals.coveredMinutes], ['Descobertas', totals.uncoveredMinutes],
  ] as const;

  return <section id="shift-coverage-panel" className="min-w-0 space-y-4" aria-labelledby="shift-coverage-heading">
    <div className="flex items-start justify-between gap-2">
      <div>
        <h3 id="shift-coverage-heading" className="text-base font-semibold">Cobertura do posto</h3>
        <p className="mt-1 text-sm tabular-nums text-text-secondary">{range(planned)}</p>
      </div>
      <button type="button" aria-label="Recolher cobertura" onClick={onClose}
        className="grid size-10 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover"><X size={17} aria-hidden="true"/></button>
    </div>
    {totals && metrics ? <>
      <dl className="grid grid-cols-3 gap-2 border-y border-border py-3" aria-live="polite">
        {metrics.map(([name, minutes]) => <div key={name}>
          <dt className="text-xs text-text-muted">{name}</dt>
          <dd className={`mt-1 text-base font-semibold tabular-nums ${name === 'Descobertas' && minutes ? 'text-danger' : ''}`}>{coverageDuration(minutes)}</dd>
        </div>)}
      </dl>
      <div aria-hidden="true">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-y-1">
          {timeline.map((segment, index) => {
            let lane = laneEnds.findIndex(end => end <= segment.start);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = segment.end;
            const width = (segment.end - segment.start) / duration * 100;
            const style = { gridArea: `${lane + 1} / 1`, width: `${width}%`, marginInlineStart: `${(segment.start - planned.start) / duration * 100}%` };
            const showLabel = width >= (segment.vacant ? 15 : 27);
            return <div key={segment.shift?.id || index} style={style} data-schedule-tone={segment.vacant ? 'available' : kind}
              className="nv-coverage-segment nv-schedule-entry flex min-h-12 min-w-0 flex-col justify-center overflow-hidden rounded-sm text-xs font-medium">
              {showLabel && <span className={`px-1 ${segment.vacant ? 'leading-3' : 'truncate'}`}>{segment.name}</span>}
              {showLabel && <span className="truncate px-1 pt-0.5 font-normal tabular-nums">{segment.vacant ? coverageDuration(coverageMinutes(segment)) : range(segment)}</span>}
            </div>;
          })}
        </div>
        <div className="relative h-11 text-[11px] tabular-nums text-text-secondary">
          {ticks.map((at, index) => <span key={at} className="absolute flex flex-col items-center"
            style={{ left: `${(at - planned.start) / duration * 100}%`, transform: index === 0 ? undefined : index === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            <span className="h-1 w-px bg-border"/>
            {(index === 0 || index === ticks.length - 1 || ticks.length <= 5) &&
              <span className={index !== 0 && index !== ticks.length - 1 ? 'mt-3' : ''}>{time.format(at)}</span>}
          </span>)}
        </div>
      </div>
      <ul aria-label="Intervalos do posto" className="divide-y divide-border text-sm">
        {timeline.map((segment, index) => {
          const caption = <><span className={`min-w-0 break-words font-medium ${segment.vacant ? 'text-danger' : ''}`}>{segment.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-text-secondary">{range(segment)}{segment.vacant && ` · ${coverageDuration(coverageMinutes(segment))}`}</span></>;
          return <li key={segment.shift?.id || index}>
            {onOpen && segment.shift && segment.vacant ?
              <button type="button" className="flex min-h-10 w-full flex-wrap items-center justify-between gap-x-2 rounded text-left hover:bg-state-hover"
                onClick={() => onOpen(segment.shift!)}>{caption}</button>
              : <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-2">{caption}</div>}
          </li>;
        })}
      </ul>
      {preview && !gaps.length && <p className="text-sm text-text-secondary">Nenhuma vaga será gerada.</p>}
    </> : <p role="status" className="nv-feedback text-danger">Confira os horários e a capacidade do posto.</p>}
  </section>;
}
