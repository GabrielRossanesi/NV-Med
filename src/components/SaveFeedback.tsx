'use client';
import { useStore } from '@/store/useStore';
export default function SaveFeedback() {
  const { saving, error, notice, clearFeedback } = useStore();
  if (!saving && !error && !notice) return null;
  return <div role={error ? 'alert' : 'status'} className={`sticky top-14 z-40 flex items-center justify-between gap-4 border-b px-5 py-3 text-sm ${error ? 'bg-card-bg border-danger text-danger' : 'bg-card-bg border-border text-primary'}`}><span>{saving ? 'Salvando…' : error || notice}</span>{!saving && <button aria-label="Fechar mensagem" onClick={clearFeedback}>✕</button>}</div>;
}
