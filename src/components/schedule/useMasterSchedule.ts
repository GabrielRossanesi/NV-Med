'use client';
import { useCallback, useEffect, useState } from 'react';
import { masterOverview } from '@/services/masterScheduleService';
import type { MasterOverview } from '@/lib/masterSchedule';

export function useMasterSchedule(org: string, unit: string | null = null, sector: string | null = null, doctor: string | null = null) {
  const key = JSON.stringify([org, unit, sector, doctor]);
  const [result, setResult] = useState<{ key: string; data?: MasterOverview; error?: string }>();
  const reload = useCallback(async () => {
    const data = await masterOverview(org, unit, sector, doctor);
    setResult({ key: JSON.stringify([org, unit, sector, doctor]), data });
  }, [org, unit, sector, doctor]);
  useEffect(() => {
    let live = true;
    void masterOverview(org, unit, sector, doctor).then(data => {
      if (live) setResult({ key, data });
    }).catch(error => { if (live) setResult({ key, error: error instanceof Error ? error.message : 'Não foi possível carregar a Escala Master.' }); });
    return () => { live = false; };
  }, [org, unit, sector, doctor, key]);
  return { data: result?.key === key ? result.data : undefined, error: result?.key === key ? result.error : undefined, reload };
}
