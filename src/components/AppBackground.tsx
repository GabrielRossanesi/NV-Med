'use client';

import { useStore } from '@/store/useStore';

export default function AppBackground() {
  const { theme } = useStore();

  if (theme === 'light') {
    return (
      <div className="fixed inset-0 -z-50 w-full h-full overflow-hidden bg-background pointer-events-none select-none">
        {/* Subtle top light-teal highlight */}
        <div className="absolute top-0 left-1/4 w-[500px] h-[300px] bg-teal-500/5 rounded-full filter blur-[80px]" />
        {/* Subtle mesh grid */}
        <div className="absolute inset-0 mesh-grid-light opacity-80" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 -z-50 w-full h-full overflow-hidden bg-background pointer-events-none select-none">
      {/* Background radial glow blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] rounded-full bg-teal-500/10 dark:bg-teal-500/8 filter blur-[120px] animate-glow-slow-1" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-teal-400/5 dark:bg-teal-400/5 filter blur-[120px] animate-glow-slow-2" />
      <div className="absolute top-[40%] right-[10%] w-[450px] h-[450px] rounded-full bg-cyan-500/5 dark:bg-cyan-500/4 filter blur-[100px]" />
      
      {/* Precision medical/tech grid overlay */}
      <div className="absolute inset-0 mesh-grid opacity-30" />
      
      {/* Subtle organic noise layer */}
      <div className="absolute inset-0 noise-layer" />
    </div>
  );
}
