'use client';

import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import AccessGuard from '@/components/AccessGuard';
import ShiftSelectionPanel from '@/components/schedule/ShiftSelectionPanel';
import { useStore } from '@/store/useStore';
import { fetchInitialDataFromSupabase } from '@/services/supabaseService';

function CandidateQueue() {
  const organization = useStore(state => state.activeOrganizationId);
  const filter = useSearchParams().get('filtro');
  const scope = filter === 'exchange' || filter === 'applications' ? filter : undefined;
  return <AccessGuard requiredPermission="escala" action="approve"><div className="space-y-5">
    <header className="border-b border-border pb-4">
      <Link href="/escala" className="text-sm font-semibold text-primary underline">Voltar à escala</Link>
      <h1 className="mt-2 text-2xl font-bold">Candidaturas e trocas</h1>
      <p className="mt-1 text-sm text-text-muted">Analise candidatos a vagas e substituições na empresa selecionada.</p>
      <Link href="/escala/presenca" className="mt-2 inline-block text-sm font-semibold text-primary underline">Analisar registros manuais de presença</Link>
    </header>
    {scope && <Link href="/escala/candidaturas" className="text-sm font-semibold text-primary underline">Ver todas as oportunidades</Link>}
    <ShiftSelectionPanel key={organization + scope} organization={organization} scope={scope} onChanged={() => {
      void fetchInitialDataFromSupabase().then(useStore.getState().syncWithCloud).catch(() => {});
    }}/>
  </div></AccessGuard>;
}

export default function CandidateQueuePage() {
  return <Suspense fallback={<p role="status">Carregando fila…</p>}><CandidateQueue/></Suspense>;
}
