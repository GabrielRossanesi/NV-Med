'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Shift } from '@/types';

const empty = new Set<string>();
export function useAvailableScheduleVacancies(organization: string, shifts: Shift[], revision: number) {
  const [result, setResult] = useState<{ organization: string; shifts: Shift[]; revision: number; ids: Set<string>; error?: string }>();
  useEffect(() => {
    let active = true;
    const client = createClient();
    if (!client || !organization) return;
    const load = async () => {
      const { data, error } = await client.rpc('nv_schedule_available_vacancies', { org: organization });
      if (active) setResult({ organization, shifts, revision, ids: new Set(error ? [] : data as string[]), error: error ? 'Não foi possível verificar as vagas disponíveis. Tente atualizar a página.' : undefined });
    };
    void load().catch(() => { if (active) setResult({ organization, shifts, revision, ids: empty, error: 'Não foi possível verificar as vagas disponíveis. Tente atualizar a página.' }); });
    const timer = window.setInterval(() => void load().catch(() => {}), 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [organization, shifts, revision]);
  const current = result?.organization === organization && result.shifts === shifts && result.revision === revision ? result : undefined;
  return { ids: current?.ids || empty, loading: !current, error: current?.error };
}
