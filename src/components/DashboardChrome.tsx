'use client';

import { useStore } from '@/store/useStore';

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const collapsed = useStore((state) => state.sidebarCollapsed);

  return (
    <div className={`flex min-h-screen flex-1 flex-col pb-20 transition-[padding] duration-200 md:pb-0 ${collapsed ? 'md:pl-[72px]' : 'md:pl-60'}`}>
      {children}
    </div>
  );
}
