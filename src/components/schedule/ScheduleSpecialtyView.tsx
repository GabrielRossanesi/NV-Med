'use client';

import { AlertTriangle, Clock3, Moon, Sun } from 'lucide-react';
import EmploymentBadge from './EmploymentBadge';
import { coverageKindForShift, coveragePeriodLabel, hasConflict, sectorCoveragePeriods, shiftInterval } from '@/lib/scheduling';
import type { Doctor, Sector, Shift } from '@/types';

export default function ScheduleSpecialtyView({ doctors, sectors, shifts, allShifts, month, onEdit }: { doctors: Doctor[]; sectors: Sector[]; shifts: Shift[]; allShifts: Shift[]; month: string; onEdit: (shift: Shift) => void }) {
  const doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));
  const sectorById = new Map(sectors.map(sector => [sector.id, sector]));
  const visible = shifts.filter(shift => shift.doctorId || shift.coveragePost && shift.status === 'open');
  const specialtyFor = (shift: Shift) => shift.specialty || doctorById.get(shift.doctorId || '')?.specialty || 'Sem especialidade';
  const specialties = [...new Set(visible.map(specialtyFor))].sort();
  const duration = (shift: Shift) => { const interval = shiftInterval(shift); return (interval.end - interval.start) / 3_600_000; };
  const hours = (value: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}h`;
  return <section className="space-y-4" aria-label="Escala por especialidade"><div className="border-b border-border pb-4"><h2 className="text-base font-semibold">Plantões por especialidade</h2><p className="mt-1 text-xs text-text-muted">{new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p></div>
    {specialties.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-bg">{specialties.map(specialty => {
      const items = visible.filter(shift => specialtyFor(shift) === specialty);
      const allocated = items.filter(shift => shift.doctorId);
      const doctorCount = new Set(allocated.map(shift => shift.doctorId)).size;
      const conflicts = items.filter(shift => hasConflict(shift, allShifts)).length;
      return <div key={specialty} className="grid gap-3 p-4 lg:grid-cols-[220px_minmax(0,1fr)]"><div><h3 className="text-sm font-semibold text-text-primary">{specialty}</h3><p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-text-muted"><span>{doctorCount} médicos</span><span>{items.length} trechos</span><span className="inline-flex items-center gap-1"><Clock3 size={11}/>{hours(allocated.reduce((sum, shift) => sum + duration(shift), 0))}</span></p>{conflicts > 0 && <p className="mt-1 flex items-center gap-1 text-[11px] text-danger"><AlertTriangle size={12}/>{conflicts} conflito{conflicts === 1 ? '' : 's'}</p>}</div>
        <div className="flex flex-wrap gap-2">{items.sort((a, b) => a.date.localeCompare(b.date)).map(shift => {
          const sector = sectorById.get(shift.sectorId || '');
          const kind = coverageKindForShift(shift, sector ? sectorCoveragePeriods(sector) : []);
          const Icon = kind === 'night' ? Moon : Sun;
          const name = shift.doctorId ? doctorById.get(shift.doctorId)?.name || 'Médico escalado' : 'Vaga descoberta';
          return <button key={shift.id} type="button" onClick={() => onEdit(shift)} data-schedule-tone={shift.doctorId ? kind : 'available'}
            title={name} className="nv-schedule-entry min-h-11 rounded-lg px-3 py-1.5 text-left">
            <span className="block max-w-44 wrap-anywhere text-xs font-semibold">{name}</span>
            <span className="mt-0.5 flex items-center gap-1 text-xs">
              <Icon size={12} aria-hidden="true"/><span className="sr-only">{coveragePeriodLabel(kind)}</span>
              {new Date(`${shift.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')} · {shift.startTime}–{shift.endTime}
            </span>
            <EmploymentBadge employment={shift.employmentType}/>
          </button>;
        })}</div>
      </div>;
    })}</div> : <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-text-muted">Nenhum plantão ou vaga corresponde aos filtros neste mês.</div>}
  </section>;
}
