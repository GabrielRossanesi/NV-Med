'use client';
import { AlertCircle, CheckCircle2, LoaderCircle, X } from 'lucide-react';
import { useStore } from '@/store/useStore';

export default function SaveFeedback() {
  const { saving, error, notice, clearFeedback } = useStore();
  if (!saving && !error && !notice) return null;
  const Icon = saving ? LoaderCircle : error ? AlertCircle : CheckCircle2;
  return (
    <div className="sticky top-16 z-30 mx-auto w-full max-w-[90rem] px-4 pt-3 sm:px-6 lg:px-8">
      <div className={`nv-feedback items-center justify-between ${saving ? 'text-info' : error ? 'text-danger' : 'text-success'}`}>
        <div role={error && !saving ? 'alert' : 'status'} className="flex min-w-0 items-center gap-2">
          <Icon size={17} className={saving ? 'shrink-0 motion-safe:animate-spin' : 'shrink-0'} aria-hidden="true" />
          <span className="wrap-anywhere">{saving ? 'Salvando…' : error || notice}</span>
        </div>
        {!saving && <button type="button" aria-label="Fechar mensagem" onClick={clearFeedback} className="-my-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-lg hover:bg-state-hover"><X size={16} aria-hidden="true" /></button>}
      </div>
    </div>
  );
}
