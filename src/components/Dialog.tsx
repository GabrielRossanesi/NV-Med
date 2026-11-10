'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const widthClasses = { md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

export default function Dialog({ title, children, onClose, size = 'md', footer }: { title: string; children: React.ReactNode; onClose: () => void; size?: keyof typeof widthClasses; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const viewport = window.visualViewport;
    function fitViewport() {
      if (!dialog || !viewport || viewport.scale !== 1) return;
      dialog.style.setProperty('--nv-dialog-viewport', `${viewport.height}px`);
      dialog.style.top = `${viewport.offsetTop}px`;
      dialog.style.bottom = `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`;
    }
    dialog.showModal();
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    viewport?.addEventListener('scroll', fitViewport);
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      viewport?.removeEventListener('scroll', fitViewport);
      dialog.close();
    };
  }, []);
  return (
    <dialog ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby={titleId} className={`nv-dialog m-auto max-h-[calc(var(--nv-dialog-viewport,100dvh)_-_1rem)] w-[calc(100%_-_1rem)] ${widthClasses[size]} overflow-hidden rounded-2xl border border-border p-0 sm:w-[calc(100%_-_2rem)]`}>
      <div className="flex max-h-[min(90dvh,calc(var(--nv-dialog-viewport,100dvh)_-_1rem))] flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-modal-bg py-2 pl-4 pr-2 sm:pl-6 sm:pr-3">
          <h2 id={titleId} className="nv-section-title">{title}</h2>
          <button type="button" aria-label="Fechar" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover hover:text-text-primary">
            <X size={19} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6">{children}</div>
        {footer && <footer className="shrink-0 border-t border-border bg-modal-bg px-4 py-3 sm:px-6">{footer}</footer>}
      </div>
    </dialog>
  );
}
