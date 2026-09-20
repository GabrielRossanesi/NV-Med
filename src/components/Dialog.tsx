'use client';
import { useEffect, useRef } from 'react';
export default function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} onCancel={onClose} aria-labelledby="dialog-title" className="m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border border-border bg-card-bg text-text-primary p-0 backdrop:bg-black/60"><div className="flex items-center justify-between border-b border-border p-5"><h2 id="dialog-title" className="text-lg font-semibold">{title}</h2><button type="button" aria-label="Fechar" onClick={onClose} className="h-10 w-10 rounded-lg hover:bg-state-hover">✕</button></div><div className="p-5">{children}</div></dialog>;
}
