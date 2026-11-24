'use client';

import { useState, type FormEvent } from 'react';
import Dialog from '@/components/Dialog';
import { portalError } from '@/lib/doctorPortal';
import { notify } from '@/lib/notifications';
import { createClient } from '@/lib/supabase/client';
import type { Shift } from '@/types';

export default function ShiftApprovalDialog({ shift, onClose, onSaved }: {
  shift: Shift;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setErrorMessage('');
    setBusy(true);
    const finish = notify.saving();
    try {
      const client = createClient();
      if (!client) throw new Error('Conexão indisponível.');
      const { error } = await client.rpc('nv_approve_shift', {
        target: shift.id, revision: shift.approvalRevision, administrative: true, note: reason.trim(),
      });
      if (error) throw new Error(portalError(error));
      notify.success('Plantão aprovado pelo administrativo.');
      await onSaved();
    } catch (failure) {
      setErrorMessage(failure instanceof Error ? failure.message : 'Não foi possível aprovar o plantão.');
    } finally {
      finish();
      setBusy(false);
    }
  }

  return <Dialog title="Aprovar pelo administrativo" onClose={onClose} closeDisabled={busy}>
    <form className="space-y-4" onSubmit={approve} aria-busy={busy}>
      <p className="text-sm text-text-secondary">Sua aprovação será registrada em nome do médico alocado.</p>
      <label className="nv-label">Justificativa
        <textarea className="nv-input" required minLength={3} maxLength={1000}
          value={reason} onChange={event => setReason(event.target.value)} disabled={busy}/>
      </label>
      {errorMessage && <p role="alert" className="nv-feedback text-danger">{errorMessage}</p>}
      <button className="nv-button" type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Confirmar aprovação'}</button>
    </form>
  </Dialog>;
}
