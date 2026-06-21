'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@/store/useStore';

export default function StoreHydrator({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const theme = useStore((state) => state.theme);

  useEffect(() => {
    // Trigger Zustand rehydration from localStorage
    const hydrate = async () => {
      await useStore.persist.rehydrate();
      setHydrated(true);
    };
    hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [theme, hydrated]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050607] text-[#f8fafc]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-primary/20 border-t-teal-500" />
            <div className="absolute text-xs font-bold text-primary font-mono">NV</div>
          </div>
          <p className="text-xs font-medium tracking-widest text-text-muted uppercase animate-pulse">
            Carregando NV Med
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
