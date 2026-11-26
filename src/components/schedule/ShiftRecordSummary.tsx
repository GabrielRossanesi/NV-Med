import { shiftTypeLabels } from '@/lib/shiftPricing';
import type { Shift } from '@/types';
import EmploymentBadge from './EmploymentBadge';
import { shiftApprovalLabels, automaticShiftApprovalMessage } from '@/lib/shiftApproval';
import { ChevronDown } from 'lucide-react';

export const shiftRecordStatusLabels = { open: 'Vaga aberta', confirmed: 'Confirmado', pending: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado' };

export default function ShiftRecordSummary({ shift, organization, unit, sector, doctor, vacancyLabel }: {
  shift: Shift; organization?: string; unit?: string; sector?: string; doctor?: string; vacancyLabel?: string;
}) {
  const assignee = shift.doctorId ? doctor || 'Médico escalado' : vacancyLabel || 'Posto sem médico';
  const status = shift.status === 'open' && !shift.doctorId && vacancyLabel !== 'Vaga aberta' ? 'Aberto' : shiftRecordStatusLabels[shift.status];
  const date = shift.date.split('-').reverse().join('/');
  const time = `${shift.startTime}–${shift.endTime}`;
  const details = [
    ['Empresa', organization], ['Unidade', unit], ['Posto', sector || shift.sector], ['Especialidade', shift.specialty],
    ['Médico responsável', assignee], ['Situação', status],
    ...(shift.doctorId && shift.approvalSource ? [['Aprovação', shiftApprovalLabels[shift.approvalSource]]] : []),
    ['Data', date], ['Horário', time],
    ['Cobertura', shift.coverageMode === 'adhoc' ? 'Avulsa' : 'Regular'], ['Modalidade assistencial', shiftTypeLabels[shift.type]],
  ];
  return <details className="group rounded-lg border border-border bg-surface-muted/25">
    <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-xs hover:bg-state-hover [&::-webkit-details-marker]:hidden">
      <span className="inline-flex items-center gap-1.5 font-semibold"><ChevronDown size={14} aria-hidden="true" className="group-open:rotate-180"/>Dados operacionais</span>
      <span className="min-w-0 flex-1 wrap-anywhere text-text-secondary">{assignee} · {date} · {time}</span>
    </summary>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border p-3 text-xs sm:grid-cols-3">
      <div><dt className="text-text-muted">Modalidade de contratação</dt><dd className="mt-1"><EmploymentBadge employment={shift.employmentType} provisional={!shift.doctorId}/></dd></div>
      {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-text-muted">{label}</dt><dd className="mt-1 wrap-anywhere font-medium">{value || '—'}</dd></div>)}
    </dl>
    {shift.approvalSource === 'automatic' && <p className="px-3 pb-3 text-xs text-text-muted">{automaticShiftApprovalMessage}</p>}
  </details>;
}
