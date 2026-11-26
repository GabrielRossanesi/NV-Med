'use client';
import { useEffect, useId, useRef } from 'react';
import { X, CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { registerNotificationDialog } from '@/lib/notifications';
import Notifications from './Notifications';

const widthClasses = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;
const contextIcons = { success: CircleCheck, danger: CircleAlert, warning: TriangleAlert, info: Info };

export default function Dialog({ title, children, onClose, size = 'md', footer, headerActions, aside, closeDisabled = false, closing = false, variant = 'default', icon, confirmationTone = 'info' }: { title: string; children: React.ReactNode; onClose: () => void; size?: keyof typeof widthClasses; footer?: React.ReactNode; headerActions?: React.ReactNode; aside?: React.ReactNode; closeDisabled?: boolean; closing?: boolean; variant?: 'default' | 'confirmation'; icon?: React.ReactNode; confirmationTone?: keyof typeof contextIcons }) {
  const ref = useRef<HTMLDialogElement>(null);
  const ContextIcon = contextIcons[confirmationTone];
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    const viewport = window.visualViewport;
    function fitViewport() {
      if (!dialog || !viewport || viewport.scale !== 1) return;
      dialog.style.setProperty('--nv-dialog-viewport', `${viewport.height}px`);
      dialog.style.top = `${viewport.offsetTop}px`;
      const hiddenBottom = `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`;
      dialog.style.bottom = hiddenBottom;
      dialog.style.setProperty('--nv-toast-keyboard-offset', hiddenBottom);
    }
    dialog.showModal();
    const unregisterNotifications = registerNotificationDialog(titleId);
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    viewport?.addEventListener('scroll', fitViewport);
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      viewport?.removeEventListener('scroll', fitViewport);
      unregisterNotifications();
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected && document.activeElement === document.body) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [titleId]);
  return (
    <dialog ref={ref} data-closing={closing || undefined} data-confirm-tone={variant === 'confirmation' ? confirmationTone : undefined} onCancel={event => { event.preventDefault(); if (!closeDisabled) onClose(); }} aria-labelledby={titleId} className={`nv-dialog ${variant === 'confirmation' ? 'nv-confirmation' : ''} m-auto max-h-[calc(var(--nv-dialog-viewport,100dvh)_-_1rem)] w-[calc(100%_-_1rem)] ${aside ? 'max-w-xl lg:max-w-5xl' : widthClasses[size]} overflow-hidden rounded-2xl border border-border p-0 sm:w-[calc(100%_-_2rem)]`}>
      <div className="flex max-h-[min(90dvh,calc(var(--nv-dialog-viewport,100dvh)_-_1rem))] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-modal-bg py-2 pl-4 pr-2 sm:pl-6 sm:pr-3">
          <div className="flex min-w-0 items-center gap-3">{icon ?? (variant === 'confirmation' ? <span className={`nv-confirm-icon nv-confirm-${confirmationTone}`}><ContextIcon size={22} aria-hidden="true"/></span> : null)}<h2 id={titleId} className="nv-section-title">{title}</h2></div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <button type="button" aria-label="Fechar" onClick={onClose} disabled={closeDisabled} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover hover:text-text-primary disabled:opacity-50">
              <X size={19} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className={`min-h-0 overflow-y-auto overscroll-contain ${aside ? 'lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:overflow-hidden' : ''}`}>
          <div className={`min-w-0 p-4 sm:p-6 ${aside ? 'lg:overflow-y-auto lg:overscroll-contain' : ''}`}>{children}</div>
          {aside && <div className="min-w-0 border-t border-border bg-surface-muted/30 p-4 sm:p-6 lg:overflow-y-auto lg:overscroll-contain lg:border-s lg:border-t-0">{aside}</div>}
        </div>
        {footer && <footer className="shrink-0 border-t border-border bg-modal-bg px-4 py-3 sm:px-6">{footer}</footer>}
      </div>
      <Notifications id={titleId} />
    </dialog>
  );
}
