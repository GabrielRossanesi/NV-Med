'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { canViewPermission } from '@/lib/permissions';
import { useStore } from '@/store/useStore';

type Counts = {
  today: string; from: string; to: string; enrollments: number | null;
  docs_pending: number | null; docs_expiring: number | null; open: number; exchanges: number | null;
  applications: number | null; shifts_today: number; checkins_pending: number | null; completed: number;
  payments_pending: number | null; payments_overdue: number | null;
};

export default function OperationalIndicators({ organization }: { organization: string }) {
  const user = useStore(state => state.currentUser);
  const isSimulating = useStore(state => state.isSimulating);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const client = createClient();
    let active = true;
    if (client && organization) void client.rpc('nv_operational_counts', { org: organization }).then(result => {
      if (!active) return;
      if (result.error) setError(true);
      else setCounts(result.data);
    });
    return () => { active = false; };
  }, [organization]);

  if (!counts) return error ? <p role="alert" className="nv-feedback text-warning">Os indicadores operacionais estão indisponíveis.</p> : null;
  const report = (from: string, to: string, filters: Record<string, string> = {}) =>
    '/relatorios/plantoes?' + new URLSearchParams({ empresa: organization, inicio: from, fim: to, ...filters }).toString();
  const cards = [
    { label: 'Cadastros médicos aguardando aprovação', count: counts.enrollments, href: '/medicos/credenciamento' },
    { label: 'Documentos pendentes', count: counts.docs_pending, href: '/documentos?status=pending_only' },
    { label: 'Documentos vencidos ou a vencer', count: counts.docs_expiring, href: '/documentos?status=expiring' },
    { label: 'Vagas em aberto', count: counts.open, href: report(counts.today, counts.to, { situacao: 'open' }) },
    { label: 'Solicitações de troca', count: counts.exchanges, href: '/escala/candidaturas?filtro=exchange' },
    { label: 'Candidaturas aguardando decisão', count: counts.applications, href: '/escala/candidaturas?filtro=applications' },
    { label: 'Plantões do dia', count: counts.shifts_today, href: report(counts.today, counts.today, { situacao: 'active' }) },
    { label: 'Check-ins pendentes hoje', count: counts.checkins_pending, href: report(counts.today, counts.today, { presenca: 'pending' }) },
    { label: 'Plantões finalizados', count: counts.completed, href: report(counts.from, counts.today, { situacao: 'completed' }) },
    { label: 'Pagamentos pendentes', count: counts.payments_pending, href: report(counts.from, counts.to, { pagamento: 'unpaid' }) },
    { label: 'Pagamentos vencidos', count: counts.payments_overdue, href: report(counts.from, counts.to, { pagamento: 'overdue' }) },
  ];
  const visibleCards = cards.filter(item => item.count != null && (
    isSimulating || canViewPermission(user, item.href.split(/[/?]/)[1])
  ));
  if (!visibleCards.length) return null;
  return <section className="nv-panel overflow-hidden" aria-label="Fila operacional">
    <header className="px-4 py-4 sm:px-5"><h2 className="nv-section-title">Fila operacional</h2>
      <p className="mt-1 text-sm text-text-muted">Vagas dos próximos dois meses, plantões concluídos do último mês e pagamentos do período operacional.</p></header>
    <div className="grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
      {visibleCards.map(item => <Link key={item.label} href={item.href}
        className="group flex min-h-16 items-center justify-between gap-3 bg-card-bg px-4 py-3 transition-colors hover:bg-table-row-hover focus-visible:outline-offset-[-3px] sm:px-5">
        <span className="text-sm font-medium text-text-secondary group-hover:text-text-primary">{item.label}</span>
        <span className="flex shrink-0 items-center gap-2 text-xl font-semibold tabular-nums">{item.count}<ArrowUpRight size={15} className="text-text-muted group-hover:text-primary" aria-hidden="true"/></span>
      </Link>)}
    </div>
  </section>;
}
