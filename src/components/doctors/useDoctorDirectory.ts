'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useStore } from '@/store/useStore';
import type { DirectoryQuery, DirectoryResult } from '@/lib/doctorDirectory';

export function directoryError(code?: string) {
  if (code === '42501') return 'Confira as permissões e a verificação em duas etapas em Minha conta.';
  if (code === '22023') return 'Confira os filtros e a seleção e tente novamente.';
  if (code === 'PGRST202') return 'A atualização da listagem ainda não está disponível no banco deste ambiente.';
  return 'Não foi possível carregar a listagem. Tente novamente.';
}

export function useDoctorDirectory(organization: string, query: DirectoryQuery) {
  const [revision, setRevision] = useState(0);
  const doctors = useStore(state => state.doctors);
  const documents = useStore(state => state.documents);
  const shifts = useStore(state => state.shifts);
  const key = JSON.stringify([organization, query, revision]);
  const [state, setState] = useState<{ key: string; company: string; result: DirectoryResult | null; error: string }>({ key: '', company: '', result: null, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    const request: [string, DirectoryQuery, number] = JSON.parse(key);
    void (async () => {
      const client = createClient();
      const response = await client?.rpc('nv_doctor_directory', { org: request[0], filters: request[1].filters,
        page: request[1].page, page_size: request[1].pageSize, sort_by: request[1].sort, descending: request[1].descending }).abortSignal(controller.signal);
      if (controller.signal.aborted) return;
      if (!response || response.error) setState({ key, company: organization, result: null, error: directoryError(response?.error?.code) });
      else {
        const result = response.data as DirectoryResult;
        setState({ key, company: organization, result, error: '' });
        useStore.setState({ doctorDirectorySummary: { organizationId: organization, documentIssues: result.permissions.documents ? result.indicators.documents : 0 } });
      }
    })().catch(() => { if (!controller.signal.aborted) setState({ key, company: organization, result: null, error: directoryError() }); });
    return () => controller.abort();
  }, [key, organization, doctors, documents, shifts]);
  return { data: state.key === key && state.company === organization ? state.result : null,
    context: state.company === organization ? state.result : null,
    error: state.key === key ? state.error : '', loading: state.key !== key,
    refresh: () => setRevision(value => value + 1) };
}
