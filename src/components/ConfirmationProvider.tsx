'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import ConfirmationDialog, { type ConfirmationOptions } from './ConfirmationDialog';
import { notify } from '@/lib/notifications';

type Request = { options: ConfirmationOptions; resolve: (accepted: boolean) => void };
const ConfirmationContext = createContext<((options: ConfirmationOptions) => Promise<boolean>) | null>(null);

export default function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef<Request | null>(null);
  const submitting = useRef(false);
  const confirm = useCallback((options: ConfirmationOptions) => {
    if (current.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => { const next = { options, resolve }; current.current = next; setRequest(next); });
  }, []);
  const close = useCallback((accepted: boolean) => {
    const previous = current.current;
    if (!previous || closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      current.current = null; setRequest(null); setClosing(false); previous.resolve(accepted); closeTimer.current = null;
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120);
  }, []);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); current.current?.resolve(false); current.current = null; }, []);
  async function accept() {
    const selected = current.current;
    if (!selected || submitting.current || closeTimer.current) return;
    submitting.current = true; setBusy(true);
    try {
      if (await selected.options.onConfirm?.() !== false) close(true);
    } catch {
      notify.error('Não foi possível concluir a ação.', { description: 'Tente novamente.', persistent: true });
    } finally { submitting.current = false; setBusy(false); }
  }
  return <ConfirmationContext.Provider value={confirm}>{children}{request && <ConfirmationDialog {...request.options} busy={busy} closing={closing}
    onClose={() => { if (!submitting.current) close(false); }} onConfirm={() => void accept()}/>}</ConfirmationContext.Provider>;
}

export function useConfirmation() {
  const confirm = useContext(ConfirmationContext);
  if (!confirm) throw new Error('ConfirmationProvider ausente.');
  return confirm;
}
