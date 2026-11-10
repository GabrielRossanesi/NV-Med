'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

const widthClasses = { md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' } as const;

export default function Dialog({ title, children, onClose, size = 'md' }: { title: string; children: React.ReactNode; onClose: () => void; size?: keyof typeof widthClasses }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return (
    <dialog ref={ref} onCancel={onClose} aria-labelledby={titleId} className={`nv-dialog m-auto max-h-[90dvh] w-[calc(100%-2rem)] ${widthClasses[size]} overflow-y-auto rounded-2xl border border-border p-0`}>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-modal-bg py-2 pl-4 pr-2 sm:pl-6 sm:pr-3">
        <h2 id={titleId} className="nv-section-title">{title}</h2>
        <button type="button" aria-label="Fechar" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-state-hover hover:text-text-primary">
          <X size={19} aria-hidden="true" />
        </button>
      </header>
      <div className="p-4 sm:p-6">{children}</div>
    </dialog>
  );
}
