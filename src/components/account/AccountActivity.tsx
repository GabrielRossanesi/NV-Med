'use client';

import { Activity, Camera, KeyRound, LogIn, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { accountDateTime } from '@/lib/accountSecurityClient';
import { createClient } from '@/lib/supabase/client';
import { AccountLoading, AccountSection } from './AccountSection';

const events = {
  login: ['Login realizado', LogIn],
  logout: ['Encerramento de sessão', LogOut],
  mfa_verified: ['Verificação em duas etapas concluída', ShieldCheck],
  factor_added: ['Autenticador cadastrado', ShieldCheck],
  factor_removed: ['Autenticador removido', ShieldCheck],
  password_changed: ['Senha alterada', KeyRound],
  recovery_requested: ['Recuperação de acesso solicitada', KeyRound],
  profile_updated: ['Dados do perfil atualizados', UserRound],
  avatar_updated: ['Foto de perfil alterada', Camera],
} as const;

type AccountEvent = { id: string; event_key: keyof typeof events; occurred_at: string };

export default function AccountActivity() {
  const [items, setItems] = useState<AccountEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const revision = useRef(0);
  const invalidate = useCallback(() => { revision.current++; }, []);
  const load = useCallback(async (cursor?: string) => {
    const request = ++revision.current;
    setBusy(true);
    setError(false);
    try {
      const response = await createClient()?.rpc('nv_account_activity', cursor ? { before_id: cursor } : {});
      if (!response || response.error) throw new Error();
      if (request !== revision.current) return;
      const page = (response.data as AccountEvent[]).slice(0, 20);
      setItems(previous => cursor ? [...previous, ...page] : page);
      setNext(response.data.length > 20 ? page.at(-1)!.id : null);
    } catch { if (request === revision.current) setError(true); }
    finally { if (request === revision.current) setBusy(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); invalidate(); };
  }, [invalidate, load]);

  return <AccountSection id="historico" title="Histórico da conta">
    <p className="text-sm text-text-muted">Eventos registrados nos últimos 90 dias.</p>
    {items.length === 0 && !error && (busy ? <AccountLoading label="Carregando atividades" />
      : <p className="nv-empty">Nenhuma atividade registrada neste período.</p>)}
    <ol className="divide-y divide-border">{items.map(item => {
      const [description, Icon] = events[item.event_key] ?? ['Atividade de segurança', Activity];
      return <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-3.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Icon size={18} className="mt-0.5 text-text-muted" aria-hidden="true" />
        <span className="font-medium">{description}</span>
        <time dateTime={item.occurred_at} className="col-start-2 text-text-muted sm:col-start-3">{accountDateTime.format(new Date(item.occurred_at))}</time>
      </li>;
    })}</ol>
    {error && <p role="alert" className="text-sm text-danger">Não foi possível carregar as atividades.</p>}
    {(next || error) && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void load(next ?? undefined)}>
      {busy ? 'Carregando…' : error ? 'Tentar novamente' : 'Carregar mais'}
    </button>}
    {busy && items.length > 0 && <span role="status" className="sr-only">Carregando mais atividades.</span>}
  </AccountSection>;
}
