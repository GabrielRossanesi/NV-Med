import { type CoverageSpan, calculateFractionalCoverage, coverageDuration, coverageMinutes, coverageSpan } from '@/lib/fractionalCoverage';
import { shiftApprovalLabels } from '@/lib/shiftApproval';
import type { Doctor, Shift } from '@/types';

interface TimelineSegment extends CoverageSpan {
  shift?: Shift;
  name: string;
}

export default function ShiftCoverageTimeline({ planned, capacity, segments, doctors, timeZone, selectedId, onOpen, canAllocate = false, preview = false }: {
  planned: CoverageSpan;
  capacity: number;
  segments: Shift[];
  doctors: Doctor[];
  timeZone: string;
  selectedId: string;
  onOpen?: (shift: Shift) => void;
  canAllocate?: boolean;
  preview?: boolean;
}) {
  const current: TimelineSegment[] = segments.filter(item => item.status !== 'cancelled').flatMap(shift => {
    const interval = coverageSpan(shift);
    if (!interval) return [];
    return [{
      ...interval, shift,
      name: shift.doctorId ? doctors.find(item => item.id === shift.doctorId)?.name || 'Médico escalado' : 'Vaga descoberta',
    }];
  });
  const assigned = current.filter(item => item.shift?.doctorId);
  const totals = calculateFractionalCoverage(planned, capacity, assigned);
  if (!totals) return <p role="status" className="nv-feedback text-danger">Confira os horários. Os intervalos precisam caber no posto e respeitar a capacidade.</p>;
  const timeline: TimelineSegment[] = (preview ? [...assigned, ...totals.gaps.map(span => ({ ...span, name: 'Vaga descoberta' }))] : current)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const laneEnds: number[] = [];
  const doctorsAssigned = new Set(assigned.map(item => item.shift?.doctorId)).size;
  const percent = Math.round(100 * totals.coveredMinutes / totals.plannedMinutes);
  const state = totals.uncoveredMinutes === 0 ? 'Integralmente coberto' : totals.coveredMinutes ? 'Parcialmente coberto' : 'Sem cobertura';
  const duration = planned.end - planned.start;
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const nightStart = time.format(planned.start);
  const tone = (segment: TimelineSegment) => !segment.shift?.doctorId ? 'available' : nightStart >= '18:00' || nightStart < '06:00' ? 'night' : 'day';
  const label = (segment: TimelineSegment) => {
    const approval = segment.shift?.doctorId && segment.shift.approvalSource;
    return [segment.name, `${time.format(segment.start)}–${time.format(segment.end)}`, coverageDuration(coverageMinutes(segment)),
      approval && shiftApprovalLabels[approval]].filter(Boolean).join(' · ');
  };
  const vacancy = current.find(item => !item.shift?.doctorId);
  const metrics = [
    ['Previstas', coverageDuration(totals.plannedMinutes)], ['Cobertas', coverageDuration(totals.coveredMinutes)],
    ['Descobertas', coverageDuration(totals.uncoveredMinutes)], ['Médicos', doctorsAssigned],
  ];

  return <section className="space-y-2.5 rounded-xl border border-border p-3" aria-label={preview ? 'Prévia da cobertura' : 'Cobertura do posto'}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{preview ? 'Prévia da cobertura' : 'Cobertura do posto'}</h3>
      <p className={`text-xs font-medium ${totals.uncoveredMinutes ? 'text-danger' : 'text-success'}`}>{state} · {percent}%</p>
    </div>
    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
      {metrics.map(([name, value]) => <div key={name}><dt className="text-text-muted">{name}</dt><dd className="mt-0.5 font-semibold tabular-nums">{value}</dd></div>)}
    </dl>
    <div className="grid gap-1 rounded-md bg-surface-muted/30 p-0.5" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
      {timeline.map((segment, index) => {
        let lane = laneEnds.findIndex(end => end <= segment.start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = segment.end;
        const width = (segment.end - segment.start) / duration * 100;
        const left = (segment.start - planned.start) / duration * 100;
        const style = { gridArea: `${lane + 1} / 1`, width: `${width}%`, marginInlineStart: `${left}%` };
        const className = 'nv-schedule-entry min-h-9 overflow-hidden rounded-sm px-1 text-left text-xs font-medium outline-offset-[-2px]';
        return onOpen && segment.shift
          ? <button key={segment.shift.id} type="button" onClick={() => onOpen(segment.shift!)} aria-label={label(segment)} title={label(segment)}
            data-schedule-tone={tone(segment)} aria-current={segment.shift.id === selectedId ? 'true' : undefined}
            className={`${className} ${segment.shift.id === selectedId ? 'ring-1 ring-inset ring-primary' : ''}`} style={style}>
            {width >= 18 && <span className="block truncate">{segment.name}</span>}
            {width >= 27 && <span className="block text-[11px] font-normal tabular-nums">{time.format(segment.start)}–{time.format(segment.end)}</span>}
          </button>
          : <div key={segment.shift?.id || index} data-schedule-tone={tone(segment)} title={label(segment)} aria-hidden="true"
            className={`${className} flex items-center`} style={style}>{width >= 18 && <span className="truncate">{segment.name}</span>}</div>;
      })}
    </div>
    <div className="flex justify-between text-xs tabular-nums text-text-muted"><span>{time.format(planned.start)}</span><span>{time.format(planned.end)}</span></div>
    <details>
      <summary className="cursor-pointer rounded text-xs font-semibold text-text-secondary">Intervalos e aprovações</summary>
      <ul className="mt-1 space-y-1 text-xs">{timeline.map((segment, index) =>
        <li key={segment.shift?.id || index}>{segment.shift && onOpen
          ? <button type="button" className="min-h-9 rounded px-1 text-left hover:bg-state-hover" onClick={() => onOpen(segment.shift!)}>{label(segment)}</button>
          : <span>{label(segment)}</span>}</li>)}</ul>
    </details>
    {canAllocate && vacancy?.shift && onOpen && <button type="button" className="nv-button-secondary min-h-9 text-xs" onClick={() => onOpen(vacancy.shift!)}>Adicionar alocação</button>}
  </section>;
}
