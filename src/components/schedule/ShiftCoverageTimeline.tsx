'use client';

import { useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Scissors, X } from 'lucide-react';
import { coverageClock, coverageDraftInterval, editCoverageSegment, type CoverageDraftSegment } from '@/lib/coverageDraft';
import { coverageDuration, coverageMinutes, type CoverageSpan } from '@/lib/fractionalCoverage';
import type { CoveragePeriodKind, CoveragePlan, Doctor, Shift } from '@/types';

export interface CoverageSelection {
  segment: CoverageDraftSegment;
  mode: 'edit' | 'split';
}

export interface CoverageAssignment {
  shift?: Shift;
  doctorId?: string;
  interval: { date: string; startTime: string; endTime: string };
}

interface EditorProps {
  selection: CoverageSelection;
  limits: CoverageSpan;
  timeZone: string;
  doctors: Doctor[];
  warning: (id: string) => boolean;
  restriction?: string;
  canAdd: boolean;
  canRemove: boolean;
  eligible: (assignment: CoverageAssignment) => Promise<string[]>;
  onMode: (mode: CoverageSelection['mode']) => void;
  onApply: (assignments: CoverageAssignment[]) => string | undefined;
  onRemove: () => string | undefined;
}

function SegmentEditor({ selection, limits, timeZone, doctors, warning, restriction, canAdd, canRemove, eligible, onMode, onApply, onRemove }: EditorProps) {
  const { segment, mode } = selection;
  const isSplit = mode === 'split';
  const assigned = Boolean(segment.shift?.doctorId);
  const segmentStart = coverageClock(segment.start, timeZone);
  const segmentEnd = coverageClock(segment.end, timeZone);
  const [start, setStart] = useState(segmentStart);
  const [end, setEnd] = useState(segmentEnd);
  const [division, setDivision] = useState(coverageClock(segment.start + Math.floor(coverageMinutes(segment) / 2) * 60_000, timeZone));
  const [doctorId, setDoctorId] = useState(segment.shift?.doctorId || '');
  const [error, setError] = useState('');
  const [checked, setChecked] = useState<{ key: string; ids: string[]; firstAllowed: boolean; error?: string }>();
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  const first = isSplit ? coverageDraftInterval(segmentStart, division, segment, timeZone) : undefined;
  const second = isSplit && first ? coverageDraftInterval(division, segmentEnd, { start: first.end, end: segment.end }, timeZone) : undefined;
  const interval = isSplit ? second : coverageDraftInterval(start, end, assigned ? limits : segment, timeZone);
  const query = !restriction && interval ? JSON.stringify({ interval, first }) : '';
  useEffect(() => {
    if (!query) return;
    let current = true;
    const { interval, first } = JSON.parse(query) as { interval: CoverageAssignment['interval']; first?: CoverageAssignment['interval'] };
    Promise.all([
      eligible({ shift: isSplit ? undefined : segment.shift, interval }),
      first ? eligible({ shift: segment.shift, interval: first }) : undefined,
    ]).then(([ids, firstIds]) => {
      if (current) setChecked({ key: query, ids, firstAllowed: !firstIds || firstIds.includes(segment.shift!.doctorId!) });
    }).catch(() => {
      if (current) setChecked({ key: query, ids: [], firstAllowed: false, error: 'Não foi possível consultar os médicos elegíveis.' });
    });
    return () => { current = false; };
  }, [eligible, isSplit, query, retry, segment.shift]);

  const result = checked?.key === query ? checked : undefined;
  const unchanged = !isSplit && start === segmentStart && end === segmentEnd && doctorId === segment.shift?.doctorId;
  const unavailable = Boolean(doctorId && result && !result.error && !result.ids.includes(doctorId) && !unchanged);
  const allowed = Boolean(interval && result && !result.error && result.firstAllowed && !unavailable && !unchanged && (isSplit || doctorId));
  const title = isSplit ? 'Dividir plantão' : assigned ? 'Editar alocação' : 'Preencher vaga';

  return <section className="space-y-3 border-t border-border pt-4" aria-labelledby="coverage-editor-heading" data-schedule-edit>
    <h4 id="coverage-editor-heading" ref={heading} tabIndex={-1} className="text-sm font-semibold outline-none">{title}</h4>
    {restriction ? <p className="text-sm text-text-secondary">{restriction}</p> : <>
      <div className="grid grid-cols-2 gap-2">
        {isSplit ? <label className="nv-label col-span-2">Horário da divisão
          <input className="nv-input" type="time" value={division} onChange={event => { setDivision(event.target.value); setError(''); }}/>
        </label> : <>
          <label className="nv-label min-w-0">Início<input className="nv-input" type="time" value={start}
            onChange={event => { setStart(event.target.value); setError(''); }}/></label>
          <label className="nv-label min-w-0">Término<input className="nv-input" type="time" value={end}
            onChange={event => { setEnd(event.target.value); setError(''); }}/></label>
        </>}
      </div>
      <label className="nv-label">{isSplit ? 'Médico do segundo intervalo' : 'Médico responsável'}
        <select className="nv-input" value={doctorId} disabled={!result || Boolean(result.error)} onChange={event => { setDoctorId(event.target.value); setError(''); }}>
          <option value="">{isSplit ? 'Deixar como vaga aberta' : 'Selecione o médico'}</option>
          {doctorId && !result?.ids.includes(doctorId) && <option value={doctorId} disabled>{doctors.find(item => item.id === doctorId)?.name || 'Médico selecionado'}</option>}
          {doctors.filter(item => result?.ids.includes(item.id)).map(item => <option key={item.id} value={item.id}>
            {item.name}{warning(item.id) ? ' · atenção documental' : ''}
          </option>)}
        </select>
      </label>
      {!interval ? <p role="status" className="text-xs text-danger">{isSplit ? 'Informe um horário entre o início e o término da alocação.' : 'Informe horários dentro do intervalo disponível.'}</p>
        : !result ? <p role="status" className="text-xs text-text-secondary">Consultando médicos elegíveis…</p>
          : result.error ? <p role="status" className="text-xs text-danger">{result.error} <button type="button" onClick={() => { setChecked(undefined); setRetry(value => value + 1); }} className="text-primary underline">Tentar novamente</button></p>
            : !result.firstAllowed ? <p role="status" className="text-xs text-danger">O médico atual não está elegível para o primeiro intervalo.</p>
              : unavailable ? <p role="status" className="text-xs text-danger">O médico selecionado não está elegível para este horário. Revise o horário ou escolha outro médico.</p>
                : !result.ids.length && !doctorId ? <p role="status" className="text-xs text-text-secondary">Nenhum médico elegível para este intervalo.</p> : null}
      {doctorId && !unavailable && warning(doctorId) && <p className="text-xs text-warning">Há pendências documentais que não bloqueiam este intervalo.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="nv-button min-h-10" disabled={!allowed} onClick={() => {
          if (!interval || !allowed) return;
          const assignments = isSplit && first
            ? [{ shift: segment.shift, doctorId: segment.shift?.doctorId, interval: first }, ...(doctorId ? [{ doctorId, interval }] : [])]
            : [{ shift: segment.shift, doctorId, interval }];
          setError(onApply(assignments) || '');
        }}>{isSplit ? 'Aplicar divisão' : 'Aplicar alteração'}</button>
        {isSplit ? <button type="button" className="nv-button-secondary min-h-10" onClick={() => onMode('edit')}>Editar alocação</button>
          : assigned && <>
            {canAdd && coverageMinutes(segment) > 1 && <button type="button" className="nv-button-secondary min-h-10" onClick={() => onMode('split')}><Scissors size={15} aria-hidden="true"/>Dividir plantão</button>}
            {canRemove && <button type="button" className="min-h-10 px-2 text-sm font-medium text-danger" onClick={() => setError(onRemove() || '')}>Remover alocação</button>}
          </>}
      </div>
    </>}
  </section>;
}

export default function ShiftCoverageTimeline({ plan, segments, doctors, timeZone, kind, onClose, restriction, canEdit, canAdd, canRemove, warning,
  eligible, onApply, onRemove, busy }: {
  plan: CoveragePlan;
  segments: Shift[];
  doctors: Doctor[];
  timeZone: string;
  kind: CoveragePeriodKind;
  onClose: () => void;
  restriction: (shift?: Shift) => string | undefined;
  canEdit: boolean;
  canAdd: boolean;
  canRemove: boolean;
  warning: (id: string) => boolean;
  eligible: EditorProps['eligible'];
  onApply: EditorProps['onApply'];
  onRemove: (shift: Shift) => string | undefined;
  busy: boolean;
}) {
  const [selection, setSelection] = useState<{ key: string; mode: CoverageSelection['mode'] }>();
  const [chooseAllocation, setChooseAllocation] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    if (selection || returnFocus.current === null) return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') || [])];
    (items.find(item => item.dataset.coverageKey === returnFocus.current) || items[0])?.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [selection]);
  const result = editCoverageSegment(plan, timeZone, segments);
  const timeline = result?.segments || [];
  const selected = timeline.find(item => item.key === selection?.key);
  const time = (at: number) => coverageClock(at, timeZone);
  const range = (span: CoverageSpan) => `${time(span.start)}–${time(span.end)}`;
  const name = (item: CoverageDraftSegment) => item.shift?.doctorId
    ? doctors.find(doctor => doctor.id === item.shift?.doctorId)?.name || 'Médico escalado' : 'Vaga aberta';
  const select = (item: CoverageDraftSegment, mode: CoverageSelection['mode'] = 'edit') => {
    setChooseAllocation(false);
    setSelection({ key: item.key, mode });
  };
  function finish(message: string | undefined) {
    if (message || !selected) return message;
    returnFocus.current = selected.key;
    setSelection(undefined);
  }
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
            const vacant = !segment.shift?.doctorId;
            return <button type="button" key={segment.key} onClick={() => select(segment)} aria-pressed={selected?.key === segment.key}
              aria-label={`${name(segment)}, ${range(segment)}`} title={`${name(segment)}, ${range(segment)}`}
              style={{ gridArea: `${lane + 1} / 1`, width: `${width}%`, marginInlineStart: `${(segment.start - result.span.start) / duration * 100}%` }}
              data-schedule-tone={vacant ? 'available' : kind} className="nv-coverage-segment nv-schedule-entry min-h-11 min-w-0 overflow-hidden rounded-sm text-xs font-medium hover:brightness-95 aria-pressed:outline-2 aria-pressed:-outline-offset-2 aria-pressed:outline-primary">
              {width >= 24 && <span aria-hidden="true" className="block truncate px-1">{name(segment)}</span>}
            </button>;
          })}
        </div>
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] tabular-nums text-text-secondary"><span>{time(result.span.start)}</span><span>{time(result.span.end)}</span></div>
      </div>
      <ul ref={list} aria-label="Intervalos do posto" className="divide-y divide-border">
        {timeline.map(segment => <li key={segment.key}>
          <button type="button" aria-pressed={selected?.key === segment.key} onClick={() => select(segment)} data-coverage-key={segment.key}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-state-hover aria-pressed:bg-primary/10">
            <span className="min-w-0 flex-1 break-words text-sm font-medium">{name(segment)}</span>
            <span className="shrink-0 text-right text-xs tabular-nums text-text-secondary">{range(segment)}<span className="block">{coverageDuration(coverageMinutes(segment))}</span></span>
            {canEdit && <Pencil size={14} className="shrink-0 text-text-muted" aria-hidden="true"/>}
          </button>
        </li>)}
      </ul>
      {canAddDoctor && <button type="button" className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-primary" onClick={() => {
        if (writableVacancy) select(writableVacancy);
        else if (writableAllocations.length === 1) select(writableAllocations[0], coverageMinutes(writableAllocations[0]) > 1 ? 'split' : 'edit');
        else { setSelection(undefined); setChooseAllocation(true); }
      }}><Plus size={16} aria-hidden="true"/>Adicionar médico</button>}
      {chooseAllocation && <p role="status" className="text-sm text-text-secondary">Selecione uma alocação para dividir ou substituir o médico.</p>}
      {selected && selection && <SegmentEditor key={`${selected.key}-${selected.start}-${selected.end}-${selected.shift?.doctorId}-${selection.mode}`}
        selection={{ segment: selected, mode: selection.mode }} limits={result.span} timeZone={timeZone} doctors={doctors} warning={warning}
        restriction={restriction(selected.shift)} canAdd={canAdd} canRemove={canRemove} eligible={eligible}
        onMode={mode => select(selected, mode)} onApply={changes => finish(onApply(changes))}
        onRemove={() => finish(onRemove(selected.shift!))}/>}
    </fieldset> : <p role="status" className="nv-feedback text-danger">Confira os horários e a capacidade do posto.</p>}
  </section>;
}
