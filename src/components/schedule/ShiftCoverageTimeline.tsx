'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, X } from 'lucide-react';
import { coverageClock, coverageDraftInterval, type CoverageDraftSegment, type editCoverageSegment } from '@/lib/coverageDraft';
import { coverageDuration, coverageMinutes, type CoverageSpan } from '@/lib/fractionalCoverage';
import type { CoveragePeriodKind, Doctor, Shift } from '@/types';

export interface CoverageAssignment {
  shift?: Shift;
  doctorId?: string;
  interval: { date: string; startTime: string; endTime: string };
}

export function CoverageSplitEditor({ shift, span, timeZone, doctors, eligible, onApply, onBack }: {
  shift: Shift;
  span: CoverageSpan;
  timeZone: string;
  doctors: Doctor[];
  eligible: (assignment: CoverageAssignment) => Promise<string[]>;
  onApply: (assignments: CoverageAssignment[]) => string | undefined;
  onBack: () => void;
}) {
  const [division, setDivision] = useState(coverageClock(span.start + Math.floor(coverageMinutes(span) / 2) * 60_000, timeZone));
  const [doctorId, setDoctorId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ key: string; ids: string[]; firstAllowed: boolean; error?: string }>();
  const first = coverageDraftInterval(coverageClock(span.start, timeZone), division, span, timeZone);
  const second = first && coverageDraftInterval(division, coverageClock(span.end, timeZone), { start: first.end, end: span.end }, timeZone);
  const key = first && second ? JSON.stringify({ first, second }) : '';
  useEffect(() => {
    if (!key) return;
    let current = true;
    const { first, second } = JSON.parse(key) as { first: CoverageAssignment['interval']; second: CoverageAssignment['interval'] };
    Promise.all([eligible({ shift, interval: first }), eligible({ interval: second })]).then(([firstIds, ids]) => {
      if (current) setResult({ key, ids, firstAllowed: firstIds.includes(shift.doctorId!) });
    }).catch(() => {
      if (current) setResult({ key, ids: [], firstAllowed: false, error: 'Não foi possível consultar os médicos elegíveis.' });
    });
    return () => { current = false; };
  }, [eligible, key, shift]);
  const checked = result?.key === key ? result : undefined;
  const allowed = checked?.firstAllowed && (!doctorId || checked.ids.includes(doctorId));
  return <div className="space-y-3" aria-labelledby="coverage-split-heading">
    <h3 id="coverage-split-heading" className="text-sm font-semibold">Dividir plantão</h3>
    <label className="nv-label">Horário da divisão<input className="nv-input" type="time" value={division}
      onChange={event => { setDivision(event.target.value); setError(''); }}/></label>
    <label className="nv-label">Médico do segundo intervalo<select className="nv-input" value={doctorId} disabled={!checked || Boolean(checked.error)}
      onChange={event => { setDoctorId(event.target.value); setError(''); }}>
      <option value="">Deixar como vaga aberta</option>
      {doctorId && !checked?.ids.includes(doctorId) && <option value={doctorId} disabled>{doctors.find(item => item.id === doctorId)?.name || 'Médico selecionado'}</option>}
      {doctors.filter(item => checked?.ids.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    {!key ? <p role="status" className="text-xs text-danger">Informe um horário entre o início e o término da alocação.</p>
      : !checked ? <p role="status" className="text-xs text-text-secondary">Consultando médicos elegíveis…</p>
        : checked.error ? <p role="status" className="text-xs text-danger">{checked.error}</p>
          : !allowed && <p role="status" className="text-xs text-danger">A divisão proposta tem um médico inelegível para o intervalo.</p>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="nv-button" disabled={!allowed} onClick={() => {
        if (!first || !second) return;
        setError(onApply([{ shift, doctorId: shift.doctorId, interval: first }, ...(doctorId ? [{ doctorId, interval: second }] : [])]) || '');
      }}>Aplicar divisão</button>
      <button type="button" className="nv-button-secondary" onClick={onBack}>Voltar à alocação</button>
    </div>
  </div>;
}

export default function ShiftCoverageTimeline({ result, doctors, timeZone, kind, selectedKey, selectedId, onClose, restriction, canEdit, canAdd, onSelect, busy }: {
  result: ReturnType<typeof editCoverageSegment>;
  doctors: Doctor[];
  timeZone: string;
  kind: CoveragePeriodKind;
  selectedKey?: string;
  selectedId?: string;
  onClose: () => void;
  restriction: (shift?: Shift) => string | undefined;
  canEdit: boolean;
  canAdd: boolean;
  onSelect: (segment: CoverageDraftSegment, split?: boolean) => void;
  busy: boolean;
}) {
  const [chooseAllocation, setChooseAllocation] = useState(false);
  const timeline = result?.segments || [];
  const selected = (item: CoverageDraftSegment) => item.key === selectedKey || Boolean(selectedId && item.shift?.id === selectedId);
  const time = (at: number) => coverageClock(at, timeZone);
  const range = (span: CoverageSpan) => `${time(span.start)}–${time(span.end)}`;
  const name = (item: CoverageDraftSegment) => item.shift?.doctorId
    ? doctors.find(doctor => doctor.id === item.shift?.doctorId)?.name || 'Médico escalado' : 'Vaga aberta';
  const select = (item: CoverageDraftSegment, split = false) => {
    setChooseAllocation(false);
    onSelect(item, split);
  };
  const laneEnds: number[] = [];
  const writableVacancy = timeline.find(item => !item.shift?.doctorId && !restriction(item.shift));
  const writableAllocations = timeline.filter(item => item.shift?.doctorId && !restriction(item.shift));
  const canAddDoctor = canEdit && (canAdd || Boolean(writableVacancy?.shift)) && (Boolean(writableVacancy) || writableAllocations.length > 0);

  return <section id="shift-coverage-panel" className="min-w-0 space-y-4" aria-labelledby="shift-coverage-heading">
    <div className="flex items-start justify-between gap-2">
      <div><h3 id="shift-coverage-heading" className="text-base font-semibold">Cobertura do posto</h3>
        {result && <p className="mt-1 text-sm tabular-nums text-text-secondary">{range(result.span)}</p>}</div>
      <button type="button" aria-label="Recolher cobertura" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover"><X size={17} aria-hidden="true"/></button>
    </div>
    {result ? <fieldset disabled={busy} className="min-w-0 space-y-3">
      <dl className="grid grid-cols-3 gap-2 border-y border-border py-3" aria-live="polite">
        {([['Previstas', result.totals.plannedMinutes], ['Cobertas', result.totals.coveredMinutes], ['Descobertas', result.totals.uncoveredMinutes]] as const).map(([label, minutes]) =>
          <div key={label}><dt className="text-xs text-text-muted">{label}</dt>
            <dd className={`mt-1 text-base font-semibold tabular-nums ${label === 'Descobertas' && minutes ? 'text-danger' : ''}`}>{coverageDuration(minutes)}</dd></div>)}
      </dl>
      <div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-y-1" aria-label="Barra de cobertura">
          {timeline.map(segment => {
            let lane = laneEnds.findIndex(end => end <= segment.start);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = segment.end;
            const duration = result.span.end - result.span.start;
            const width = (segment.end - segment.start) / duration * 100;
            return <button type="button" key={segment.key} onClick={() => select(segment)} aria-pressed={selected(segment)}
              aria-label={`${name(segment)}, ${range(segment)}`} title={`${name(segment)}, ${range(segment)}`}
              style={{ gridArea: `${lane + 1} / 1`, width: `${width}%`, marginInlineStart: `${(segment.start - result.span.start) / duration * 100}%` }}
              data-schedule-tone={segment.shift?.doctorId ? kind : 'available'} className="nv-coverage-segment nv-schedule-entry min-h-11 min-w-0 overflow-hidden rounded-sm text-xs font-medium hover:brightness-95 aria-pressed:outline-2 aria-pressed:-outline-offset-2 aria-pressed:outline-primary">
              {width >= 24 && <span aria-hidden="true" className="block truncate px-1">{name(segment)}</span>}
            </button>;
          })}
        </div>
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] tabular-nums text-text-secondary"><span>{time(result.span.start)}</span><span>{time(result.span.end)}</span></div>
      </div>
      <ul aria-label="Intervalos do posto" className="divide-y divide-border">
        {timeline.map(segment => <li key={segment.key}>
          <button type="button" aria-pressed={selected(segment)} onClick={() => select(segment)} data-coverage-key={segment.key}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-state-hover aria-pressed:bg-primary/10">
            <span className="min-w-0 flex-1 break-words text-sm font-medium">{name(segment)}</span>
            <span className="shrink-0 text-right text-xs tabular-nums text-text-secondary">{range(segment)}<span className="block">{coverageDuration(coverageMinutes(segment))}</span></span>
            {!restriction(segment.shift) && <Pencil size={14} className="shrink-0 text-text-muted" aria-hidden="true"/>}
          </button>
        </li>)}
      </ul>
      {canAddDoctor && <button type="button" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-primary" onClick={() => {
        if (writableVacancy) select(writableVacancy);
        else if (writableAllocations.length === 1) select(writableAllocations[0], coverageMinutes(writableAllocations[0]) > 1);
        else setChooseAllocation(true);
      }}><Plus size={16} aria-hidden="true"/>Adicionar médico</button>}
      {chooseAllocation && <p role="status" className="text-sm text-text-secondary">Selecione uma alocação para dividir ou substituir o médico.</p>}
    </fieldset> : <p role="status" className="nv-feedback text-danger">Confira os horários e a capacidade do posto.</p>}
  </section>;
}
