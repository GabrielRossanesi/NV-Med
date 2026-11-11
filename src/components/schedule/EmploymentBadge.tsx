import { employmentLabel } from '@/lib/scheduling';
import type { EmploymentType } from '@/types';

const tones = {
  pj: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  clt: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  concursado: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200',
};

export default function EmploymentBadge({ employment, provisional = false }: {
  employment?: EmploymentType | null;
  provisional?: boolean;
}) {
  return <span className={`nv-badge max-w-full whitespace-normal ${employment ? tones[employment] : 'bg-surface-muted text-text-muted'}`}>
    {employmentLabel(employment)}{employment && provisional ? ' · prevista' : ''}
  </span>;
}
