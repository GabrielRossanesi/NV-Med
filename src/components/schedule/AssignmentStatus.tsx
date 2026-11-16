import { Check, CircleHelp, Clock3 } from 'lucide-react';
import { assignmentConfirmation } from '@/lib/scheduleCalendar';
import type { Shift } from '@/types';

export default function AssignmentStatus({ status }: { status: Shift['status'] }) {
  const state = assignmentConfirmation(status);
  const Icon = state.tone === 'success' ? Check : state.tone === 'warning' ? Clock3 : CircleHelp;
  const color = state.tone === 'success' ? 'text-success' : state.tone === 'warning' ? 'text-warning' : 'text-text-muted';
  return <span className={`inline-flex items-start gap-1 text-[11px] leading-4 ${color}`}>
    <Icon size={13} className="mt-px shrink-0" aria-hidden="true"/>{state.label}
  </span>;
}
