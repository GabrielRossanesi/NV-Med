'use client';

import { useStore } from '@/store/useStore';
import styles from './DashboardNavigation.module.css';

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const collapsed = useStore((state) => state.sidebarCollapsed);
  const density = useStore((state) => state.accountPreferences.density);
  return (
    <div className={styles.workspace} data-collapsed={collapsed} data-density={density}>
      {children}
    </div>
  );
}
