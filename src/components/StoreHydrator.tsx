'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';

export default function StoreHydrator({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Trigger Zustand rehydration from localStorage
    const hydrate = async () => {
      await useStore.persist.rehydrate();
      setHydrated(true);
    };
    hydrate();
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-teal-500/20 border-t-teal-500" />
            <div className="absolute text-xs font-bold text-teal-500 font-mono">VN</div>
          </div>
          <p className="text-xs font-medium tracking-widest text-slate-400 uppercase animate-pulse">
            Carregando VN Med
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
