'use client';

import { useEffect, useRef, useState } from 'react';
import Dialog from '@/components/Dialog';

export function useAccountLeaveGuard(enabled: boolean) {
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const confirmed = useRef(false);
  function confirmLeave() {
    confirmed.current = true;
    leave?.();
  }

  useEffect(() => {
    if (!enabled) return;
    const current = { url: location.href, state: history.state };
    function unload(event: BeforeUnloadEvent) {
      if (confirmed.current) return;
      event.preventDefault();
      event.returnValue = '';
    }
    function openLink(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const destination = new URL(link.href);
      if (!['http:', 'https:'].includes(destination.protocol)) return;
      if (destination.origin === location.origin && destination.pathname === location.pathname
        && destination.search === location.search) return;
      event.preventDefault();
      event.stopPropagation();
      setLeave(() => () => location.assign(destination.href));
    }
    function traverse(event: PopStateEvent) {
      const destination = location.href;
      if (new URL(destination).pathname === new URL(current.url).pathname) return;
      event.stopImmediatePropagation();
      history.pushState(current.state, '', current.url);
      setLeave(() => () => location.replace(destination));
    }
    function signOut(event: Event) {
      if (!window.confirm('Sair da conta e descartar as alterações do perfil?')) event.preventDefault();
      else confirmed.current = true;
    }
    function signOutFailed() { confirmed.current = false; }
    window.addEventListener('beforeunload', unload);
    window.addEventListener('popstate', traverse, true);
    window.addEventListener('nv:account-signout', signOut);
    window.addEventListener('nv:account-signout-failed', signOutFailed);
    document.addEventListener('click', openLink, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('popstate', traverse, true);
      window.removeEventListener('nv:account-signout', signOut);
      window.removeEventListener('nv:account-signout-failed', signOutFailed);
      document.removeEventListener('click', openLink, true);
      confirmed.current = false;
    };
  }, [enabled]);

  return { leave, setLeave, confirmLeave };
}

export function AccountLeaveDialog({ saving, onCancel, onConfirm }: { saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog title="Descartar alterações?" onClose={onCancel} footer={<div className="flex flex-wrap justify-end gap-2">
    <button type="button" className="nv-button-secondary" onClick={onCancel} autoFocus>Continuar editando</button>
    <button type="button" className="nv-button" onClick={onConfirm} disabled={saving}>Descartar alterações</button>
  </div>}>
    <p className="text-sm text-text-secondary">{saving ? 'Aguarde o salvamento antes de sair.' : 'As alterações no perfil ainda não foram salvas.'}</p>
  </Dialog>;
}
