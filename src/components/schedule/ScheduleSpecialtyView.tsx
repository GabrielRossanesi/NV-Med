'use client';

import { AlertTriangle, Clock3 } from 'lucide-react';
import { hasConflict, shiftInterval } from '@/lib/scheduling';
import type { Doctor, Shift } from '@/types';

export default function ScheduleSpecialtyView({ doctors, shifts, allShifts, month, onEdit }: { doctors: Doctor[]; shifts: Shift[]; allShifts: Shift[]; month: string; onEdit: (shift: Shift) => void }) {
  const doctorById = new Map(doctors.map(doctor => [doctor.id, doctor]));
  const assigned = shifts.filter(shift => shift.doctorId);
  const specialties = [...new Set(assigned.map(shift => shift.specialty || doctorById.get(shift.doctorId || '')?.specialty || 'Sem especialidade'))].sort();
  const duration = (shift: Shift) => { const interval = shiftInterval(shift); return (interval.end - interval.start) / 3_600_000; };
  const hours = (value: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}h`;
  return <section className="space-y-4" aria-label="Escala por especialidade"><div className="border-b border-border pb-4"><h2 className="text-base font-semibold">Plantões por especialidade</h2><p className="mt-1 text-xs text-text-muted">{new Date(`${month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} · distribuição dos plantões visíveis</p></div>
    {specialties.length ? <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-bg">{specialties.map(specialty => {
      const items = assigned.filter(shift => (shift.specialty || doctorById.get(shift.doctorId || '')?.specialty || 'Sem especialidade') === specialty);
      const doctorCount = new Set(items.map(shift => shift.doctorId)).size;
      const conflicts = items.filter(shift => hasConflict(shift, allShifts)).length;
      return <div key={specialty} className="grid gap-3 p-4 lg:grid-cols-[220px_minmax(0,1fr)]"><div><h3 className="text-sm font-semibold text-text-primary">{specialty}</h3><p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-text-muted"><span>{doctorCount} médicos</span><span>{items.length} plantões</span><span className="inline-flex items-center gap-1"><Clock3 size={11}/>{hours(items.reduce((sum, shift) => sum + duration(shift), 0))}</span></p>{conflicts > 0 && <p className="mt-1 flex items-center gap-1 text-[11px] text-danger"><AlertTriangle size={12}/>{conflicts} conflito{conflicts === 1 ? '' : 's'}</p>}</div><div className="flex flex-wrap gap-2">{items.sort((a, b) => a.date.localeCompare(b.date)).map(shift => <button key={shift.id} type="button" onClick={() => onEdit(shift)} className="min-h-11 rounded-lg border border-border bg-surface-muted/25 px-3 py-1.5 text-left transition hover:border-primary/40 hover:bg-primary/5"><span className="block text-xs font-semibold">{new Date(`${shift.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')} · {shift.startTime}–{shift.endTime}</span><span className="mt-0.5 block max-w-40 truncate text-[10px] text-text-muted">{doctorById.get(shift.doctorId || '')?.name || 'Médico'}</span></button>)}</div></div>;
    })}</div> : <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center text-sm text-text-muted">Nenhum plantão com médico corresponde aos filtros neste mês.</div>}
  </section>;
}
