import { shiftTypeLabels } from '@/lib/shiftPricing';
import type { Shift } from '@/types';
import EmploymentBadge from './EmploymentBadge';

export const shiftRecordStatusLabels = { open: 'Vaga aberta', confirmed: 'Confirmado', pending: 'Aguardando confirmação', completed: 'Concluído', cancelled: 'Cancelado' };

export default function ShiftRecordSummary({ shift, organization, unit, sector, doctor }: {
  shift: Shift; organization?: string; unit?: string; sector?: string; doctor?: string;
}) {
  const details = [
    ['Empresa', organization], ['Unidade', unit], ['Posto', sector || shift.sector], ['Especialidade', shift.specialty],
    ['Médico responsável', doctor || (shift.doctorId ? 'Médico escalado' : 'Vaga aberta')], ['Situação', shiftRecordStatusLabels[shift.status]],
    ['Data', shift.date.split('-').reverse().join('/')], ['Horário', `${shift.startTime}–${shift.endTime}`],
    ['Cobertura', shift.coverageMode === 'adhoc' ? 'Avulsa' : 'Regular'], ['Modalidade assistencial', shiftTypeLabels[shift.type]],
  ];
  return <section aria-label="Dados operacionais do plantão" className="rounded-xl border border-border bg-surface-muted/35 p-4">
    <h3 className="mb-3 text-sm font-semibold">Dados operacionais</h3>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
      <div><dt className="text-text-muted">Modalidade de contratação</dt><dd className="mt-1"><EmploymentBadge employment={shift.employmentType} provisional={!shift.doctorId}/></dd></div>
      {details.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-text-muted">{label}</dt><dd className="mt-1 wrap-anywhere font-medium">{value || '—'}</dd></div>)}
    </dl>
  </section>;
}
