'use client';

import { useEffect, useRef, useState } from 'react';
import ConfirmationDialog from '@/components/ConfirmationDialog';
import { useConfirmation } from '@/components/ConfirmationProvider';
import { logoutCurrentSession } from '@/lib/auth/logout';

export function useAccountLeaveGuard(enabled: boolean) {
  const confirm = useConfirmation();
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
      if (confirmed.current) return;
      event.preventDefault();
      void confirm({ title: 'Sair e descartar alterações?', description: 'As alterações no perfil ainda não foram salvas.', tone: 'danger', confirmLabel: 'Descartar e sair', onConfirm: async () => {
        confirmed.current = true;
        await logoutCurrentSession();
      } });
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
  }, [enabled, confirm]);

  return { leave, setLeave, confirmLeave };
}

export function AccountLeaveDialog({ saving, onCancel, onConfirm }: { saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <ConfirmationDialog title="Descartar alterações?" tone="danger" busy={saving} confirmLabel="Descartar alterações" cancelLabel="Continuar editando"
    onClose={onCancel} onConfirm={onConfirm} description={saving ? 'Aguarde o salvamento antes de sair.' : 'As alterações no perfil ainda não foram salvas.'}/>;
}
