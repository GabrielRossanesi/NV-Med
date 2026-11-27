'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useStore } from '@/store/useStore';
import { canViewPermission } from '@/lib/permissions';
import { createClient } from '@/lib/supabase/client';
import { workspaceDay } from '@/lib/workspaceScope';
import type { DocumentOverview, FinanceOverview, OperationalCounts } from '@/lib/workspaceOverview';

type Snapshot<T> = { key?: string; data?: T; error?: string };
type Overview = { documents: Snapshot<DocumentOverview>; finance: Snapshot<FinanceOverview>;
  operational: Snapshot<OperationalCounts>; reload: () => void };
const Context = createContext<Overview>({ documents: {}, finance: {}, operational: {}, reload: () => {} });
export const useWorkspaceOverview = () => useContext(Context);

function CompanyOverview({ children }: { children: React.ReactNode }) {
  const org = useStore(state => state.activeOrganizationId), user = useStore(state => state.currentUser);
  const revision = useStore(state => state.workspaceRevision);
  const alertEnabled = useStore(state => state.accountPreferences.documentAlerts);
  const pathname = usePathname();
  const [documents, setDocuments] = useState<Snapshot<DocumentOverview>>({});
  const [finance, setFinance] = useState<Snapshot<FinanceOverview>>({});
  const [operational, setOperational] = useState<Snapshot<OperationalCounts>>({});
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  const permissions = JSON.stringify([user.type, user.role, user.additionalPermissions]);
  const key = `${org}/${revision}/${refresh}/${workspaceDay()}/${permissions}`;
  const needDocuments = (alertEnabled && canViewPermission(user, 'documentos'))
    || pathname === '/dashboard' && canViewPermission(user, 'documentos')
    || pathname === '/escala' && canViewPermission(user, 'escala');
  const needFinance = pathname === '/dashboard' && canViewPermission(user, 'financeiro');
  const needOperational = pathname === '/dashboard'
    && (canViewPermission(user, 'escala') || canViewPermission(user, 'medicos'));
  useEffect(() => {
    if (!org || !needDocuments && !needFinance) return;
    let active = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25_000);
    const part = needDocuments && needFinance ? 'all' : needDocuments ? 'documents' : 'finance';
    void fetch('/api/workspace/overview?' + new URLSearchParams({ org, part }), { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const value = await response.json();
        if (!active) return;
        const doc = part === 'all' ? value.documents : value;
        const money = part === 'all' ? value.finance : value;
        if (needDocuments) setDocuments(doc ? { key, data: doc } : { key, error: 'Não foi possível consultar a documentação.' });
        if (needFinance) setFinance(money ? { key, data: money } : { key, error: 'Não foi possível consultar o resumo financeiro.' });
      }).catch(() => {
        if (!active) return;
        if (needDocuments) setDocuments({ key, error: 'Não foi possível consultar a documentação.' });
        if (needFinance) setFinance({ key, error: 'Não foi possível consultar o resumo financeiro.' });
      }).finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [org, needDocuments, needFinance, key]);
  useEffect(() => {
    if (!org || !needOperational) return;
    let active = true;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25_000);
    void (async () => {
      try {
        const result = await createClient()?.rpc('nv_operational_counts', { org }).abortSignal(controller.signal);
        if (!result || result.error || typeof result.data?.today !== 'string') throw new Error();
        if (active) setOperational({ key, data: result.data });
      } catch {
        if (active) setOperational({ key, error: 'Não foi possível consultar as filas de aprovação.' });
      } finally { clearTimeout(timeout); }
    })();
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [org, needOperational, key]);
  return <Context.Provider value={{ documents: documents.key === key ? documents : {}, finance: finance.key === key ? finance : {},
    operational: operational.key === key ? operational : {}, reload }}>{children}</Context.Provider>;
}
export default function WorkspaceOverviewProvider({ children }: { children: React.ReactNode }) {
  const org = useStore(state => state.activeOrganizationId), user = useStore(state => state.currentUser.id);
  return <CompanyOverview key={`${user}/${org}`}>{children}</CompanyOverview>;
}
