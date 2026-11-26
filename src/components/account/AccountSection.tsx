import type { ReactNode } from 'react';
import styles from './Account.module.css';

export function AccountSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section id={id} aria-labelledby={id + '-title'} className={styles.section}>
    <h2 id={id + '-title'} className="nv-section-title">{title}</h2>
    <div className="min-w-0 space-y-4">{children}</div>
  </section>;
}

export function AccountLoading({ label }: { label: string }) {
  return <div role="status" className="space-y-3">
    <span className="sr-only">{label}</span>
    <span aria-hidden="true" className="block h-4 max-w-44 rounded bg-surface-muted motion-safe:animate-pulse" />
    <span aria-hidden="true" className="block h-4 max-w-72 rounded bg-surface-muted motion-safe:animate-pulse" />
  </div>;
}

export function AccountValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0">
    <dt className="text-sm text-text-muted">{label}</dt>
    <dd className="mt-1 break-words text-sm font-medium">{children}</dd>
  </div>;
}
