'use client';

import { AlertTriangle, Clock3, Moon, Sun } from 'lucide-react';
import { hasConflict, shiftInterval } from '@/lib/scheduling';
import type { Doctor, Sector, Shift, Unit } from '@/types';

interface Props {
  doctors: Doctor[];
  sectors: Sector[];
  units: Unit[];
  shifts: Shift[];
  allShifts: Shift[];
  month: string;
  canSeeFinancial: boolean;
  onEdit: (shift: Shift) => void;
}

function durationHours(shift: Shift) {
  const interval = shiftInterval(shift);
  return (interval.end - interval.start) / 3_600_000;
}

export default function ScheduleDoctorView({ doctors, sectors, units, shifts, allShifts, month, canSeeFinancial, onEdit }: Props) {
  const assigned = shifts.filter(shift => shift.doctorId);
  const groups = doctors.map(doctor => ({ doctor, items: assigned.filter(shift => shift.doctorId === doctor.id) })).filter(group => group.items.length);
  const totalHours = assigned.reduce((sum, shift) => sum + durationHours(shift), 0);
  const hoursLabel = (hours: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(hours)}h`;
  return <section className="space-y-4" aria-label="Escala por médico">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4"><div><h2 className="text-base font-semibold">Plantões por médico</h2><p className="mt-1 text-xs text-text-muted">{new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · carga horária prevista nos plantões visíveis</p></div><p className="text-xs font-medium text-text-secondary">{groups.length} médicos · {assigned.length} plantões · {hoursLabel(totalHours)}</p></div>
    {groups.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-bg">{groups.map(({ doctor, items }) => {
      const hours = items.reduce((sum, shift) => sum + durationHours(shift), 0);
      const conflicts = items.filter(shift => hasConflict(shift, allShifts)).length;
      const pending = items.filter(shift => shift.status === 'pending').length;
      const amount = items.reduce((sum, shift) => sum + Number(shift.paymentAmount || 0), 0);
      return <div key={doctor.id} className="grid gap-3 p-4 lg:grid-cols-[200px_120px_minmax(0,1fr)] lg:items-start"><div><h3 className="text-sm font-semibold text-text-primary">{doctor.name}</h3><p className="mt-0.5 text-xs text-text-muted">{doctor.specialty}</p><div className="mt-2 flex flex-wrap gap-x-3 text-[11px]"><span className="flex items-center gap-1 font-medium text-text-secondary"><Clock3 size={12}/>{hoursLabel(hours)}</span>{pending > 0 && <span className="text-warning">{pending} pendente{pending === 1 ? '' : 's'}</span>}{conflicts > 0 && <span className="flex items-center gap-1 text-danger"><AlertTriangle size={12}/>{conflicts} conflito{conflicts === 1 ? '' : 's'}</span>}</div>{canSeeFinancial && <p className="mt-2 text-xs text-text-secondary">Previsto: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount)}</p>}</div><p className="text-xs text-text-muted lg:pt-0.5">{items.length} {items.length === 1 ? 'plantão' : 'plantões'} no mês</p><div className="flex flex-wrap gap-2">{items.map(shift => { const unit = units.find(item => item.id === shift.unitId); const sector = sectors.find(item => item.id === shift.sectorId); const Icon = shift.startTime >= '18:00' || shift.startTime < '06:00' ? Moon : Sun; return <button key={shift.id} type="button" onClick={() => onEdit(shift)} title={`${unit?.name || 'Unidade'} · ${sector?.name || shift.sector || 'Setor'} · ${shift.startTime}–${shift.endTime}`} className="min-h-12 rounded-lg border border-border bg-surface-muted/25 px-3 py-1.5 text-left transition hover:border-primary/40 hover:bg-primary/5"><span className="flex items-center gap-1 text-xs font-semibold"><Icon size={12} className="text-text-muted"/>{new Date(`${shift.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')} · {shift.startTime}</span><span className="mt-0.5 block max-w-36 truncate text-[10px] text-text-muted">{sector?.name || shift.sector || unit?.name || 'Setor'}</span></button>; })}</div></div>;
    })}</div> : <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-text-muted">Nenhum médico escalado corresponde aos filtros neste mês.</div>}
  </section>;
}
