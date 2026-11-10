'use client';

import { useStore } from '@/store/useStore';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import styles from './DashboardNavigation.module.css';

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const collapsed = useStore((state) => state.sidebarCollapsed);
  const pathname = usePathname();
  const workspace = useRef<HTMLDivElement>(null);

  useEffect(() => {
    workspace.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div ref={workspace} className={styles.workspace} data-collapsed={collapsed}>
      {children}
    </div>
  );
}
