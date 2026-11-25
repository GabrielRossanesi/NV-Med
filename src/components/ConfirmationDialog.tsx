'use client';

import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import Dialog from './Dialog';

export type ConfirmationTone = 'success' | 'danger' | 'warning' | 'info';
export type ConfirmationOptions = {
  title: string; description: ReactNode; confirmLabel: string; cancelLabel?: string; tone?: ConfirmationTone;
  onConfirm?: () => void | boolean | Promise<void | boolean>;
};
const icons = { success: CircleCheck, danger: CircleAlert, warning: TriangleAlert, info: Info };

export default function ConfirmationDialog({ title, description, confirmLabel, cancelLabel = 'Cancelar', tone = 'info', busy = false, closing = false, confirmDisabled = false, onClose, onConfirm, children }: Omit<ConfirmationOptions, 'onConfirm'> & {
  busy?: boolean; closing?: boolean; confirmDisabled?: boolean; onClose: () => void; onConfirm: () => void; children?: ReactNode;
}) {
  const Icon = icons[tone];
  return <Dialog title={title} size="sm" variant="confirmation" confirmationTone={tone} icon={<span className={`nv-confirm-icon nv-confirm-${tone}`}><Icon size={22} aria-hidden="true"/></span>}
    closeDisabled={busy || closing} closing={closing} onClose={onClose} footer={<div className="nv-confirm-actions">
      <button type="button" className="nv-button-secondary" disabled={busy || closing} onClick={onClose} autoFocus>{cancelLabel}</button>
      <button type="button" className={`nv-button nv-confirm-button nv-confirm-${tone}`} disabled={busy || closing || confirmDisabled} onClick={onConfirm} aria-busy={busy}>
        {busy && <LoaderCircle size={16} className="motion-safe:animate-spin" aria-hidden="true"/>}{busy ? 'Processando…' : confirmLabel}
      </button>
    </div>}>
    <div className="space-y-4"><div className="text-sm leading-6 text-text-secondary">{description}</div>{children}</div>
  </Dialog>;
}
