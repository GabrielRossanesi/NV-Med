'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { saoPauloDate } from '@/lib/financeState';
import { listShiftPaymentMovements, paymentMethods, reverseShiftPayment, signedPaymentReceipt, type ShiftPaymentMovement } from '@/lib/shiftCashPayment';
import { notify } from '@/lib/notifications';
import Dialog from '@/components/Dialog';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export default function ShiftPaymentMovements({ shiftId, canReverse, onChanged }: {
  shiftId: string; canReverse: boolean; onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<ShiftPaymentMovement[]>([]);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<ShiftPaymentMovement>();
  const [requestId, setRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    void listShiftPaymentMovements(shiftId).then(data => {
      if (current) setItems(data);
    }).catch(() => { if (current) setError('Não foi possível carregar as movimentações.'); });
    return () => { current = false; };
  }, [shiftId, revision]);

  async function showReceipt(path: string) {
    try {
      const link = await signedPaymentReceipt(path);
      const download = document.createElement('a');
      download.href = link;
      download.rel = 'noopener noreferrer';
      download.click();
    } catch {
      notify.error('Comprovante indisponível.', { withinDialog: true });
    }
  }

  async function reverse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    const finish = notify.saving();
    try {
      await reverseShiftPayment(shiftId, target.id, requestId, String(form.get('date')), String(form.get('reason')));
      setTarget(undefined);
      setRevision(value => value + 1);
      notify.success('Estorno registrado.', { withinDialog: true });
      await onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar o estorno.');
    } finally {
      finish();
      setBusy(false);
    }
  }

  return <>
    {items.length > 0 && <section aria-label="Transferências e estornos">
      <h3 className="mb-2 text-sm font-semibold">Transferências e estornos</h3>
      <ul className="divide-y divide-border">
        {items.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
          <div>
            <p className="font-medium">{currency.format(item.amount)} · {item.reversal_of ? 'Estorno' : paymentMethods[item.method]}</p>
            <p className="text-xs text-text-muted">{item.paid_on.split('-').reverse().join('/')}{item.note && ' · ' + item.note}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {item.receipt_path && <button className="nv-button-secondary" type="button" onClick={() => void showReceipt(item.receipt_path!)}>Comprovante</button>}
            {canReverse && item.amount > 0 && !items.some(reversal => reversal.reversal_of === item.id) && <button className="nv-button-secondary" type="button"
              onClick={() => { setError(''); setRequestId(crypto.randomUUID()); setTarget(item); }}>Estornar</button>}
          </div>
        </li>)}
      </ul>
    </section>}
    {!target && error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {target && <Dialog variant="confirmation" confirmationTone="danger" title="Estornar pagamento" onClose={() => { if (!busy) setTarget(undefined); }} closeDisabled={busy}>
      <form className="space-y-4" onSubmit={reverse}>
        <p className="text-sm">Valor do estorno {currency.format(target.amount)}</p>
        <label className="nv-label">Data do estorno<input className="nv-input" type="date" name="date"
          min={target.paid_on} max={saoPauloDate()} defaultValue={saoPauloDate()} required/></label>
        <label className="nv-label">Justificativa<textarea className="nv-input" name="reason" minLength={3} maxLength={1000} required/></label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button className="nv-button" disabled={busy}>Confirmar estorno</button>
      </form>
    </Dialog>}
  </>;
}
