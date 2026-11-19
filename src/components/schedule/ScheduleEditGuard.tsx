'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { canUseScheduleEditor } from '@/lib/scheduleEditAccess';
import { scheduleLeaseValid } from '@/lib/scheduleScope';
import { useStore } from '@/store/useStore';

type Draft = { dirty: boolean; saving: boolean; discard: () => void };
type Guard = { unlocked: boolean; busy: boolean; allowed: boolean; check: () => boolean; touch: () => void;
  run: <T>(operation: () => Promise<T>) => Promise<T | undefined>; transition: (action: () => void) => void;
  register: (id: string, draft: Draft | null) => void; askUnlock: () => void; lock: () => void };
const unavailable: Guard = { unlocked: false, busy: false, allowed: false, check: () => false, touch: () => {}, run: async () => undefined,
  transition: action => action(), register: () => {}, askUnlock: () => {}, lock: () => {} };
const Context = createContext<Guard>(unavailable);
export const useScheduleEdit = () => useContext(Context);

export function ScheduleEditBoundary({ children }: { children: React.ReactNode }) {
  const user = useStore(state => state.currentUser);
  const org = useStore(state => state.activeOrganizationId);
  const userId = user.authUserId || user.id;
  const allowed = canUseScheduleEditor(user, org, { userId, organizationId: org });
  // Permission changes lock the mounted editor; they must not erase its draft.
  return <Provider key={JSON.stringify([userId, org])} allowed={allowed} userId={userId} organizationId={org}>{children}</Provider>;
}
function Provider({ children, allowed, userId, organizationId }: { children: React.ReactNode; allowed: boolean; userId: string; organizationId: string }) {
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<'unlock' | 'draft' | null>(null);
  const state = useRef({ unlocked: false, last: 0, pending: 0, locking: false });
  const drafts = useRef(new Map<string, Draft>());
  const changedInEvent = useRef(false);
  const next = useRef<(() => void) | null>(null);
  const route = useRef<{ url: string; state: unknown } | null>(null);
  const sentinel = useRef(false);
  const mounted = useRef(true);
  const allowedNow = useCallback(() => {
    const current = useStore.getState();
    return mounted.current && canUseScheduleEditor(current.currentUser, current.activeOrganizationId, { userId, organizationId });
  }, [userId, organizationId]);
  const historyCleanup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armHistory = useCallback(() => {
    route.current = { url: location.href, state: history.state };
    if (!sentinel.current) { history.pushState(history.state, '', location.href); sentinel.current = true; }
  }, []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; if (historyCleanup.current) clearTimeout(historyCleanup.current); }; }, []);
  const register = useCallback((id: string, draft: Draft | null) => {
    if (historyCleanup.current) clearTimeout(historyCleanup.current);
    if (draft) {
      drafts.current.set(id, draft);
      if (draft.dirty) {
        armHistory();
      }
    } else {
      drafts.current.delete(id);
      if (!drafts.current.size) {
        changedInEvent.current = false;
        historyCleanup.current = setTimeout(() => { if (mounted.current && !drafts.current.size && sentinel.current) { sentinel.current = false; history.back(); } }, 0);
      }
    }
  }, [armHistory]);
  const hasDirty = useCallback(() => changedInEvent.current || [...drafts.current.values()].some(draft => draft.dirty), []);
  const isSaving = useCallback(() => state.current.pending > 0 || [...drafts.current.values()].some(draft => draft.saving), []);
  const lock = useCallback(() => {
    state.current.locking = true;
    if (isSaving()) return;
    state.current.unlocked = false; setUnlocked(false);
    if (hasDirty()) setPrompt('draft');
    else if (drafts.current.size) setPrompt('unlock');
    else { setPrompt(null); const action = next.current; next.current = null; action?.(); }
  }, [hasDirty, isSaving]);
  const check = useCallback(() => {
    if (!allowedNow() || document.visibilityState === 'hidden' || state.current.locking || !scheduleLeaseValid(state.current.unlocked, state.current.last, Date.now(), isSaving())) {
      lock(); return false;
    }
    return true;
  }, [allowedNow, isSaving, lock]);
  const touch = useCallback(() => { if (check()) state.current.last = Date.now(); }, [check]);
  const transition = useCallback((action: () => void) => {
    if (isSaving()) return;
    if (hasDirty()) { next.current = action; lock(); } else action();
  }, [hasDirty, isSaving, lock]);
  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (!check() || isSaving()) return undefined;
    route.current = { url: location.href, state: history.state };
    state.current.pending++; setBusy(true); state.current.last = Date.now();
    try { return await operation(); }
    finally {
      state.current.pending--; setBusy(false);
      if (state.current.locking || document.visibilityState === 'hidden' || Date.now() - state.current.last >= 60_000) setTimeout(lock, 0);
    }
  }, [check, isSaving, lock]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (state.current.unlocked && (!allowedNow() || !scheduleLeaseValid(true, state.current.last, Date.now(), isSaving()))) lock();
      else if (state.current.locking && !isSaving() && state.current.unlocked) lock();
    }, 500);
    const visibility = () => { if (document.visibilityState === 'hidden' && state.current.unlocked) lock(); };
    const unload = (event: BeforeUnloadEvent) => { if (hasDirty() || isSaving()) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const target = new URL(link.href, location.href);
      if (target.href === location.href || target.pathname === location.pathname && target.search === location.search) return;
      if (hasDirty() || isSaving()) { event.preventDefault(); event.stopPropagation(); transition(() => location.assign(target.href)); }
    };
    const traverse = (event: PopStateEvent) => {
      if ((!hasDirty() && !isSaving()) || !route.current) return;
      // Catch same-document history navigation before the App Router discards
      // the mounted editor. Cross-document exits use beforeunload above.
      const destination = location.href;
      event.stopImmediatePropagation();
      history.pushState(route.current.state, '', route.current.url);
      next.current = sentinel.current && destination === route.current.url
        ? () => { sentinel.current = false; history.go(-2); }
        : () => { sentinel.current = false; location.assign(destination); };
      lock();
    };
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('click', navigation, true);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('popstate', traverse, true);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('click', navigation, true); window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', traverse, true); };
  }, [allowedNow, hasDirty, isSaving, lock, transition]);
  useEffect(() => { if (!allowed && state.current.unlocked) lock(); }, [allowed, lock]);
  function enable() { if (!allowedNow() || document.visibilityState === 'hidden') return; state.current = { unlocked: true, last: Date.now(), pending: 0, locking: false }; next.current = null; setUnlocked(true); setPrompt(null); }
  return <Context.Provider value={{ unlocked: allowed && unlocked, allowed, busy, check, touch, run, transition, register, lock, askUnlock: () => allowed && setPrompt('unlock') }}>
    <div onChangeCapture={event => { if ((event.target as Element).closest('[data-schedule-edit]') && check()) { state.current.last = Date.now(); changedInEvent.current = true; armHistory(); } }} onClickCapture={event => { if ((event.target as Element).closest('[data-schedule-edit]')) touch(); }}>{children}</div>
    {prompt && <Dialog title={prompt === 'unlock' ? 'Ativar modo edição?' : 'Alterações não salvas'} onClose={() => setPrompt(null)}><div className="space-y-4"><p className="text-sm text-text-secondary">{!allowed ? 'Sua permissão de edição não está disponível. O formulário foi preservado; nenhuma gravação será permitida até a autorização ser restabelecida.' : prompt === 'unlock' ? 'As ações ficarão disponíveis conforme suas permissões. A escala será bloqueada após 60 segundos sem interação de edição ou ao colocar a aba em segundo plano.' : 'A edição foi bloqueada e seu rascunho foi preservado. Retome para conferir e salvar no formulário ou descarte as alterações.'}</p><div className="flex flex-wrap gap-2"><button type="button" className="nv-button" disabled={!allowed || busy} onClick={enable}>{prompt === 'unlock' ? 'Confirmar desbloqueio' : 'Retomar para salvar'}</button>{prompt === 'draft' && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => { for (const draft of drafts.current.values()) draft.discard(); drafts.current.clear(); changedInEvent.current = false; state.current.unlocked = false; setUnlocked(false); setPrompt(null); const action = next.current; next.current = null; action?.(); }}>Descartar e bloquear</button>}<button type="button" className="nv-button-secondary" onClick={() => { next.current = null; setPrompt(null); }}>{prompt === 'unlock' ? 'Cancelar' : 'Manter rascunho bloqueado'}</button></div></div></Dialog>}
  </Context.Provider>;
}
export function ScheduleEditControl() {
  const guard = useScheduleEdit();
  if (!guard.allowed) return null;
  const Icon = guard.unlocked ? LockKeyholeOpen : LockKeyhole;
  return <button type="button" disabled={guard.busy} className="nv-button-secondary" onClick={guard.unlocked ? guard.lock : guard.askUnlock}><Icon size={16} aria-hidden="true"/>{guard.unlocked ? 'Modo edição · Bloquear' : 'Edição bloqueada · Desbloquear'}</button>;
}
export function useScheduleDraft(id: string, fingerprint: string | null, saving: boolean, discard: () => void) {
  const { register } = useScheduleEdit();
  const initial = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (fingerprint === null) initial.current = null;
    else if (initial.current === null) initial.current = fingerprint;
    register(id, fingerprint === null ? null : { dirty: fingerprint !== initial.current, saving, discard });
    return () => register(id, null);
  }, [id, fingerprint, saving, discard, register]);
}
