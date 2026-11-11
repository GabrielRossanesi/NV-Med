'use client';

import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, CircleMinus, UserRoundPlus } from 'lucide-react';

export type MobileDay = { day: string; open: number; deficit: number; confirmed: number; critical: number };
const weekdayLabels = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const dateLabel = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full' });
const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const badges = [
  { key: 'open', label: 'Vagas abertas', singular: 'vaga aberta', icon: UserRoundPlus, color: 'text-info' },
  { key: 'deficit', label: 'Turnos com déficit', singular: 'turno com déficit', icon: CircleMinus, color: 'text-warning' },
  { key: 'confirmed', label: 'Confirmados', singular: 'confirmado', icon: Check, color: 'text-success' },
  { key: 'critical', label: 'Conflitos ou pendências críticas', singular: 'conflito ou pendência crítica', icon: AlertTriangle, color: 'text-danger' },
] as const;

export default function MobileScheduleMonth({ date, today, offset, days, onSelect, onNavigate, children }: {
  date: string; today: string; offset: number; days: MobileDay[];
  onSelect: (day: string) => void; onNavigate: (direction: number) => void; children: React.ReactNode;
}) {
  const selected = days.find(item => item.day === date);
  const selectedDate = dateLabel.format(new Date(date + 'T12:00:00'));
  return <div className="min-w-0 space-y-4">
    <section className="nv-panel p-2.5" aria-label="Calendário mensal">
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-state-hover" aria-label="Mês anterior" onClick={() => onNavigate(-1)}><ChevronLeft size={19} aria-hidden="true"/></button>
        <h2 className="text-center text-sm font-semibold capitalize" aria-live="polite">{monthLabel.format(new Date(date + 'T12:00:00'))}</h2>
        <button type="button" className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-state-hover" aria-label="Próximo mês" onClick={() => onNavigate(1)}><ChevronRight size={19} aria-hidden="true"/></button>
      </div>
      <div className="grid grid-cols-7 gap-0.5" aria-label="Dias do mês">
        {weekdayLabels.map(label => <span key={label} aria-label={label} className="py-1 text-center text-[10px] font-semibold text-text-muted">{label.slice(0, 3)}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={index} aria-hidden="true"/>)}
        {days.map(item => {
          const isToday = item.day === today;
          const isSelected = item.day === date;
          const counts = badges.filter(badge => item[badge.key] > 0).map(badge => `${badge.label}: ${item[badge.key]}`);
          return <button key={item.day} type="button" aria-pressed={isSelected} aria-current={isToday ? 'date' : undefined}
            aria-label={[dateLabel.format(new Date(item.day + 'T12:00:00')), ...counts].join('. ')} onClick={() => onSelect(item.day)}
            className={`flex min-h-12 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border py-1 text-xs hover:bg-state-hover ${isSelected ? 'border-primary bg-primary/10 font-bold text-primary' : 'border-transparent font-medium'}`}>
            <span className={`grid size-5 place-items-center rounded-full tabular-nums ${isToday ? 'bg-primary font-semibold text-text-inverse' : ''}`}>{Number(item.day.slice(-2))}</span>
            <span className="grid min-h-3 grid-cols-2 gap-x-0.5" aria-hidden="true">{badges.filter(badge => item[badge.key] > 0).map(({ key, icon: Icon, color }) => <Icon key={key} size={10} strokeWidth={2.5} className={color}/>)}</span>
          </button>;
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-2 text-[10px] font-medium text-text-secondary">
        {badges.map(({ key, label, icon: Icon, color }) => <span key={key} className="inline-flex items-center gap-1"><Icon size={12} className={color} aria-hidden="true"/>{label}</span>)}
        <button type="button" onClick={() => onSelect(today)} className="ml-auto min-h-8 px-1 text-xs font-semibold text-primary">Hoje</button>
      </div>
    </section>
    <section aria-label="Plantões do dia" className="min-w-0 space-y-2.5">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarDays size={16} className="shrink-0 text-primary" aria-hidden="true"/><span className="capitalize">{selectedDate}</span></h2>
      {selected && badges.some(badge => selected[badge.key] > 0) && <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
        {badges.filter(badge => selected[badge.key] > 0).map(badge => <span key={badge.key}><strong className={badge.color}>{selected[badge.key]}</strong> {selected[badge.key] === 1 ? badge.singular : badge.label.toLowerCase()}</span>)}
      </p>}
      {children}
    </section>
  </div>;
}
