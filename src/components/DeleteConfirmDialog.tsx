'use client';

import { useState } from 'react';
import ConfirmationDialog from './ConfirmationDialog';

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
    <ConfirmationDialog title={title} description={description} tone="danger" busy={busy} confirmLabel="Excluir permanentemente"
      confirmDisabled={!matches} onClose={onClose} onConfirm={() => void onConfirm(confirmation)}>
      <div className="space-y-5">
        <p className="text-sm font-medium text-danger">Esta ação é permanente.</p>

        <ul className="space-y-2 text-sm text-text-secondary">
          {impacts.map((impact) => <li key={impact} className="flex gap-2"><span className="text-danger">•</span><span>{impact}</span></li>)}
        </ul>

        <label className="nv-label">
          Digite <strong className="select-all text-text-primary">{itemName}</strong> para confirmar
          <input className="nv-input" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus autoComplete="off" />
        </label>

      </div>
    </ConfirmationDialog>
  );
}
