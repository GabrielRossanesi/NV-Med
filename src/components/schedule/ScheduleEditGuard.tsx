'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import Dialog from '@/components/Dialog';
import { canUseScheduleEditor } from '@/lib/scheduleEditAccess';
import { scheduleIdleMs, scheduleLeaseValid } from '@/lib/scheduleScope';
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
    if (!allowedNow() || state.current.locking || !scheduleLeaseValid(state.current.unlocked, state.current.last, Date.now())) {
      lock(); return false;
    }
    return true;
  }, [allowedNow, lock]);
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
      if (state.current.locking || !scheduleLeaseValid(state.current.unlocked, state.current.last, Date.now())) {
        state.current.locking = true;
        setTimeout(() => { if (mounted.current && state.current.unlocked && state.current.locking) lock(); }, 0);
      }
    }
  }, [check, isSaving, lock]);
  useEffect(() => {
    if (!unlocked) return;
    let timer: number | undefined;
    function recheck() {
      window.clearTimeout(timer);
      if (!state.current.unlocked) return;
      const now = Date.now();
      if (state.current.locking || !allowedNow() || !scheduleLeaseValid(true, state.current.last, now)) {
        lock();
        // Finish a pending lock once an in-flight save settles.
        if (state.current.unlocked) timer = window.setTimeout(recheck, 500);
        return;
      }
      timer = window.setTimeout(recheck, state.current.last + scheduleIdleMs - now);
    }
    function onReturn() {
      if (document.visibilityState === 'visible') recheck();
    }
    function onPageHide() {
      if (state.current.unlocked) lock();
    }

    recheck();
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onReturn);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('focus', onReturn);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onReturn);
    };
  }, [allowedNow, lock, unlocked]);
  useEffect(() => {
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
    document.addEventListener('click', navigation, true);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('popstate', traverse, true);
    return () => { document.removeEventListener('click', navigation, true); window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', traverse, true); };
  }, [hasDirty, isSaving, lock, transition]);
  useEffect(() => { if (!allowed && state.current.unlocked) lock(); }, [allowed, lock]);
  function enable() { if (!allowedNow()) return; state.current = { unlocked: true, last: Date.now(), pending: 0, locking: false }; next.current = null; setUnlocked(true); setPrompt(null); }
  return <Context.Provider value={{ unlocked: allowed && unlocked, allowed, busy, check, touch, run, transition, register, lock, askUnlock: () => allowed && setPrompt('unlock') }}>
    <div onChangeCapture={event => {
      if (!(event.target as Element).closest('[data-schedule-edit]') || !check()) return;
      state.current.last = Date.now();
      changedInEvent.current = true;
      armHistory();
    }} onClickCapture={event => {
      const button = (event.target as Element).closest('button:enabled');
      if (button?.closest('[data-schedule-edit]')) touch();
    }}>{children}</div>
    {prompt && <Dialog variant="confirmation" confirmationTone={prompt === 'unlock' ? 'success' : 'warning'} title={prompt === 'unlock' ? 'Ativar modo edição?' : 'Alterações não salvas'} onClose={() => setPrompt(null)}><div className="space-y-4"><p className="text-sm text-text-secondary">{!allowed ? 'Sua permissão de edição não está disponível. O formulário foi preservado; nenhuma gravação será permitida até a autorização ser restabelecida.' : prompt === 'unlock' ? 'As ações ficarão disponíveis conforme suas permissões. A escala será bloqueada após 5 minutos sem atividade de edição, incluindo o tempo em segundo plano.' : 'A edição foi bloqueada e seu rascunho foi preservado. Retome para conferir e salvar no formulário ou descarte as alterações.'}</p><div className="flex flex-wrap gap-2"><button type="button" className="nv-button" disabled={!allowed || busy} onClick={enable}>{prompt === 'unlock' ? 'Confirmar desbloqueio' : 'Retomar para salvar'}</button>{prompt === 'draft' && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => { for (const draft of drafts.current.values()) draft.discard(); drafts.current.clear(); changedInEvent.current = false; state.current.unlocked = false; setUnlocked(false); setPrompt(null); const action = next.current; next.current = null; action?.(); }}>Descartar e bloquear</button>}<button type="button" className="nv-button-secondary" onClick={() => { next.current = null; setPrompt(null); }}>{prompt === 'unlock' ? 'Cancelar' : 'Manter rascunho bloqueado'}</button></div></div></Dialog>}
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
