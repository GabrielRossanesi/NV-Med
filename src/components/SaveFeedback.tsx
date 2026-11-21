'use client';
import { LoaderCircle } from 'lucide-react';
import { useStore } from '@/store/useStore';

export default function SaveFeedback() {
  const saving = useStore(state => state.saving);
  return (
    <div role="status" className={saving ? 'mx-auto w-full max-w-[112rem] px-4 pb-2 sm:px-6 xl:px-9' : 'sr-only'}>
      {saving && <p className="nv-feedback items-center gap-2 text-info">
        <LoaderCircle size={17} className="shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        Salvando…
      </p>}
    </div>
  );
}
