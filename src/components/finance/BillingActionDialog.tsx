'use client';

import { useState, type FormEvent } from 'react';
import Dialog from '@/components/Dialog';
import { notify } from '@/lib/notifications';
import { saoPauloDate } from '@/lib/financeState';
import { billingMovementLabels, billingRpc, financialDate, hours, money, type BillingCatalog, type BillingInvoiceDetail,
  type BillingMovement, type BillingMovementKind, type BillingShift } from '@/lib/companyBilling';
import { signedPaymentReceipt, uploadFinanceReceipt } from '@/lib/shiftCashPayment';
import { canPerformAction } from '@/lib/permissions';
import { useStore } from '@/store/useStore';

export type BillingAction =
  | { kind: 'assess'; shift: BillingShift }
  | { kind: 'consolidate'; shifts: string[] }
  | { kind: 'close' | 'reopen' }
  | { kind: 'invoice'; invoice: BillingInvoiceDetail };

export default function BillingActionDialog({ action, catalog, organization, month, onClose, onChanged }: {
  action: BillingAction; catalog: BillingCatalog; organization: string; month: string;
  onClose: () => void; onChanged: () => void;
}) {
  const user = useStore(state => state.currentUser);
  const can = (key: Parameters<typeof canPerformAction>[2]) => canPerformAction(user, 'financeiro', key);
  const invoice = action.kind === 'invoice' ? action.invoice : undefined;
  const shift = action.kind === 'assess' ? action.shift : undefined;
  const [movement, setMovement] = useState<BillingMovementKind>();
  const [reversal, setReversal] = useState<BillingMovement>();
  const [requestId, setRequestId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const today = saoPauloDate();

  function chooseMovement(type: BillingMovementKind, item?: BillingMovement) {
    setError('');
    setRequestId(crypto.randomUUID());
    setReversal(item);
    setMovement(type);
  }

  async function downloadReceipt(path: string) {
    try {
      const element = document.createElement('a');
      element.href = await signedPaymentReceipt(path);
      element.rel = 'noopener noreferrer';
      element.click();
    } catch {
      notify.error('Comprovante indisponível.', { withinDialog: true });
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const field = (name: string) => String(fields.get(name) || '').trim();
    setBusy(true);
    setError('');
    const finish = notify.saving();
    try {
      if (shift) {
        const reset = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'reset';
        await billingRpc('nv_assess_shift_billing', { target: shift.id, worked: Number(field('worked')), payable: Number(field('payable')),
          billable: Number(field('billable')), reason: field('reason'), rate_id: field('rate') || null, reset_assessment: reset,
          revenue_override: field('revenue') || null, medical_override: field('medical') || null });
      } else if (action.kind === 'consolidate') {
        await billingRpc('nv_consolidate_billing', { org: organization, month, shift_ids: action.shifts, due_on: field('date') });
      } else if (action.kind === 'close' || action.kind === 'reopen') {
        await billingRpc('nv_close_billing_period', { org: organization, month, reopening: action.kind === 'reopen', reason: field('reason') });
      } else if (invoice && movement) {
        const receipt = await uploadFinanceReceipt(fields.get('receipt'), organization, requestId);
        await billingRpc('nv_post_billing_movement', { target: invoice.id, request_id: requestId, kind: movement,
          amount: field('amount') || null, posted_on: field('date'), note: field('reason'), receipt, reverse_id: reversal?.id });
      } else if (invoice) {
        await billingRpc('nv_issue_billing_invoice', { target: invoice.id, issued_on: field('date'), document_ref: field('reference') });
      }
      onClose();
      onChanged();
      notify.success('Operação financeira registrada.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a operação.');
    } finally {
      finish();
      setBusy(false);
    }
  }

  const isPeriod = action.kind === 'close' || action.kind === 'reopen';
  const issue = Boolean(invoice && !invoice.issued_on && can('billing_manage'));
  const title = { assess: 'Apurar plantão', consolidate: 'Consolidar faturamento', close: 'Fechar competência',
    reopen: 'Reabrir competência', invoice: 'Ficha do faturamento' }[action.kind];
  return <Dialog title={title} onClose={() => { if (!busy) onClose(); }} closeDisabled={busy} size={invoice ? 'lg' : 'md'}>
    <div className="space-y-5">
      {invoice && <>
        <dl className="grid grid-cols-2 gap-3 border-b border-border pb-4 text-sm sm:grid-cols-4">
          {[['Valor de origem', money.format(invoice.totals.billed)], ['Recebido', money.format(invoice.totals.received)],
            ['Saldo', money.format(invoice.totals.balance)], ['Vencimento', financialDate(invoice.due_on)]].map(([label, value]) =>
            <div key={label}><dt className="text-text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>)}
        </dl>
        {invoice.document_ref && <p className="text-sm">{invoice.document_ref} · Emitido em {financialDate(invoice.issued_on)}</p>}
        <details className="rounded-lg border border-border px-3">
          <summary className="cursor-pointer py-3 text-sm font-medium">Plantões do faturamento ({invoice.lines.length})</summary>
          <ul className="divide-y divide-border">
            {invoice.lines.map(line => <li key={line.shift_id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span>{financialDate(line.date)} · {line.doctor} {line.specialty && '· ' + line.specialty}</span>
              <span>{hours.format(line.billable_minutes / 60)} h · {money.format(line.revenue)}</span>
            </li>)}
          </ul>
        </details>
        {invoice.movements.length > 0 && <section aria-label="Repasses e ajustes">
          <h3 className="mb-2 text-sm font-semibold">Repasses e ajustes</h3>
          <ul className="divide-y divide-border">{invoice.movements.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
            <div><p className="font-medium">{billingMovementLabels[item.kind]} · {money.format(item.amount)}</p>
              <p className="text-xs text-text-muted">{financialDate(item.posted_on)} {item.note && '· ' + item.note}</p></div>
            <div className="flex flex-wrap gap-2">
              {item.receipt_path && <button className="nv-button-secondary" type="button" onClick={() => void downloadReceipt(item.receipt_path!)}>Comprovante</button>}
              {can('adjustment') && item.kind !== 'reversal' && !invoice.movements.some(row => row.reverses === item.id)
                && <button className="nv-button-secondary" type="button" onClick={() => chooseMovement('reversal', item)}>Estornar</button>}
            </div>
          </li>)}</ul>
        </section>}
        {invoice.issued_on && <div className="flex flex-wrap gap-2">
          {can('receipt') && <button type="button" className="nv-button" onClick={() => chooseMovement('receipt')}>Registrar repasse</button>}
          {can('adjustment') && (['discount','deduction','adjustment'] as const).map(type =>
            <button key={type} type="button" className="nv-button-secondary" onClick={() => chooseMovement(type)}>{billingMovementLabels[type]}</button>)}
        </div>}
      </>}
      {(!invoice || issue || movement) && <form className="space-y-4" onSubmit={save} aria-busy={busy}>
        {shift && <>
          <p className="text-sm">{shift.doctor} · {financialDate(shift.date)} · {hours.format(shift.planned_minutes / 60)} h previstas</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {([{ id: 'worked', label: 'Realizadas', value: shift.worked_minutes }, { id: 'payable', label: 'Remuneráveis', value: shift.payable_minutes },
              { id: 'billable', label: 'Faturáveis', value: shift.billable_minutes }]).map(input =>
              <label key={input.id} className="nv-label">{input.label} (min)
                <input className="nv-input" type="number" min={0} max={2880} name={input.id} required defaultValue={input.value ?? undefined}/>
              </label>)}
          </div>
          {!shift.contract_id && <label className="nv-label">Regra vigente<select name="rate" className="nv-input" required defaultValue="">
            <option value="">Confirme a regra</option>{catalog.rates?.filter(rate => rate.id === shift.suggested_rate).map(rate =>
              <option key={rate.id} value={rate.id}>{catalog.contracts.find(contract => contract.id === rate.contract_id)?.name} · desde {financialDate(rate.valid_from)}</option>)}
          </select></label>}
          {can('rates_edit') && <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm">Valores excepcionais por hora</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="nv-label">Receita (R$)<input className="nv-input" type="number" step="0.0001" min="0" name="revenue"/></label>
              <label className="nv-label">Custo médico (R$)<input className="nv-input" type="number" step="0.0001" min="0" name="medical"/></label>
            </div>
          </details>}
        </>}
        {action.kind === 'consolidate' && <p className="text-sm">Plantões selecionados para consolidação ({action.shifts.length})</p>}
        {isPeriod && <p className="text-sm">{action.kind === 'close' ? 'O fechamento protege os dados da competência.' : 'A reabertura permite ajustar apurações ainda disponíveis.'}</p>}
        {(action.kind === 'consolidate' || issue || movement) && <label className="nv-label">
          {action.kind === 'consolidate' ? 'Vencimento' : issue ? 'Data da emissão' : 'Data da movimentação'}
          <input name="date" className="nv-input" type="date" min={movement ? reversal?.posted_on || invoice?.issued_on || undefined : month}
            max={action.kind === 'consolidate' ? undefined : today} defaultValue={today} required/>
        </label>}
        {issue && <label className="nv-label">Referência do documento emitido<input className="nv-input" name="reference" maxLength={150} required/></label>}
        {movement && <p className="text-sm font-semibold">{billingMovementLabels[movement]}{reversal && ' · ' + money.format(reversal.amount)}</p>}
        {movement && movement !== 'reversal' && <>
          <label className="nv-label">Valor (R$)<input className="nv-input" name="amount" type="number" step="0.01"
            min={movement === 'adjustment' ? undefined : '0.01'} required/></label>
          <label className="nv-label">Comprovante (opcional)<input className="nv-input" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png"/></label>
        </>}
        {(shift || isPeriod || movement) && <label className="nv-label">{movement === 'receipt' ? 'Observações' : 'Justificativa'}
          <textarea className="nv-input" name="reason" required={movement !== 'receipt'} minLength={movement === 'receipt' ? undefined : 3} maxLength={1000}/>
        </label>}
        {error && <p className="nv-feedback text-danger" role="alert">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="nv-button" disabled={busy}>{isPeriod ? 'Confirmar' : 'Salvar'}</button>
          {shift?.assessed_at && <button type="submit" value="reset" className="nv-button-secondary" disabled={busy}>Desfazer apuração</button>}
        </div>
      </form>}
    </div>
  </Dialog>;
}
