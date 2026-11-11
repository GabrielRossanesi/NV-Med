'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarX2, ClipboardCheck, Repeat2, UserRoundPlus, type LucideIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Counts = {
  today: string;
  enrollments: number | null;
  exchanges: number | null;
  applications: number | null;
  checkins_pending: number | null;
};

export function useOperationalCounts(organization: string, enabled: boolean) {
  const [result, setResult] = useState<{ counts: Counts | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!organization || !enabled) return;
    const client = createClient();
    let active = true;
    void (async () => {
      try {
        const response = await client?.rpc('nv_operational_counts', { org: organization });
        if (!response || response.error || !response.data) throw new Error();
        if (active) setResult({ counts: response.data, error: false });
      } catch {
        if (active) setResult({ counts: null, error: true });
      }
    })();
    return () => { active = false; };
  }, [organization, enabled]);
  return enabled ? result : null;
}

type Metric = {
  label: string;
  value: number | null;
  href: string;
  icon: LucideIcon;
  action: string;
  highlight?: boolean;
};

function MetricCard({ label, value, href, icon: Icon, action, highlight }: Metric) {
  const tone = highlight ? (value ? 'text-danger bg-danger/10' : 'text-primary bg-primary/10') : 'text-accent bg-accent/10';
  return <Link href={href} className={`group flex min-w-0 flex-col rounded-2xl border p-3.5 shadow-soft transition-[background-color,border-color,box-shadow] hover:border-primary/35 hover:shadow-medium motion-reduce:transition-none max-md:p-3 sm:p-5 ${highlight ? 'border-accent/25 bg-[var(--dashboard-wash)]' : 'border-card-border bg-card-bg'}`}>
    <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon size={18} aria-hidden="true" /></span>
      <p className={`text-3xl font-semibold leading-none tracking-[-0.06em] tabular-nums sm:text-4xl ${highlight && value ? 'text-danger' : 'text-text-primary'}`}>
        {value ?? <span aria-label="Carregando indicador" className="text-text-muted">—</span>}
      </p>
      <ArrowUpRight size={16} aria-hidden="true" className="ml-auto hidden shrink-0 self-start text-text-muted group-hover:text-primary min-[390px]:block" />
    </div>
    <p className="mt-3 flex-1 text-sm font-semibold leading-snug text-text-primary max-md:mt-2">{label}</p>
    <p className="mt-2 text-xs font-medium leading-snug text-text-muted group-hover:text-primary max-md:mt-1">{action}</p>
  </Link>;
}

export default function OperationalIndicators({ today, gaps, canSeeSchedule, canSeeDoctors, result }: {
  today: string; gaps: number; canSeeSchedule: boolean; canSeeDoctors: boolean;
  result: ReturnType<typeof useOperationalCounts>;
}) {
  const counts = result?.counts;
  const loading = result === null;
  const metrics: Metric[] = [];
  if (canSeeSchedule) {
    metrics.push({ label: 'Postos descobertos hoje', value: gaps, href: `/escala?date=${today}&coverage=deficit`, icon: CalendarX2, action: 'Ver cobertura do dia', highlight: true });
    if (loading || counts?.exchanges != null) metrics.push({ label: 'Solicitações de troca', value: counts?.exchanges ?? null, href: '/escala/candidaturas?filtro=exchange', icon: Repeat2, action: 'Revisar trocas' });
    if (loading || counts?.applications != null) metrics.push({ label: 'Candidaturas aguardando decisão', value: counts?.applications ?? null, href: '/escala/candidaturas?filtro=applications', icon: UserRoundPlus, action: 'Analisar candidaturas' });
  }
  if (canSeeDoctors && (loading || counts?.enrollments != null)) metrics.push({ label: 'Credenciamentos pendentes', value: counts?.enrollments ?? null, href: '/medicos/credenciamento', icon: ClipboardCheck, action: 'Abrir credenciamento' });
  if (!metrics.length && !result?.error) return null;

  return <section aria-labelledby="operational-title">
    <h2 id="operational-title" className="nv-section-title">Visão operacional</h2>
    <p className="mb-3 mt-1 text-sm text-text-muted">Cobertura de hoje e solicitações que aguardam análise.</p>
    <div className="nv-priority-grid grid grid-cols-2 gap-3 max-[349px]:grid-cols-1 max-md:gap-2 lg:gap-4">
      {metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}
    </div>
    {result?.error && <p role="alert" className="mt-3 text-sm text-warning">Não foi possível consultar as filas de aprovação. Os dados da escala continuam disponíveis.</p>}
  </section>;
}
