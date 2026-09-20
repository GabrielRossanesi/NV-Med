'use client';

import { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import Dialog from './Dialog';

type DeleteConfirmDialogProps = {
  title: string;
  itemName: string;
  description: string;
  impacts: string[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (confirmation: string) => Promise<void>;
};

export default function DeleteConfirmDialog({ title, itemName, description, impacts, busy, onClose, onConfirm }: DeleteConfirmDialogProps) {
  const [confirmation, setConfirmation] = useState('');
  const matches = confirmation.trim() === itemName.trim();

  return (
    <Dialog title={title} onClose={() => !busy && onClose()}>
      <div className="space-y-5">
        <div className="flex gap-3 rounded-xl border border-danger/25 bg-danger/8 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div>
            <p className="text-sm font-semibold text-danger">Esta ação é permanente</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">{description}</p>
          </div>
        </div>

        <ul className="space-y-2 text-sm text-text-secondary">
          {impacts.map((impact) => <li key={impact} className="flex gap-2"><span className="text-danger">•</span><span>{impact}</span></li>)}
        </ul>

        <label className="nv-label">
          Digite <strong className="select-all text-text-primary">{itemName}</strong> para confirmar
          <input className="nv-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus autoComplete="off" />
        </label>

        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <button type="button" className="nv-button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="nv-button bg-danger hover:brightness-95" disabled={!matches || busy} onClick={() => onConfirm(confirmation)}>
            <Trash2 className="h-4 w-4" /> {busy ? 'Excluindo…' : 'Excluir permanentemente'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
