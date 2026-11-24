import { saoPauloDate } from '@/lib/financeState';
import { paymentMethods } from '@/lib/shiftCashPayment';

export default function ShiftCashPaymentFields({ amount }: { amount?: number }) {
  const today = saoPauloDate();
  return <fieldset className="grid gap-3 sm:grid-cols-2">
    <label className="nv-label">Valor pago (R$)
      <input className="nv-input" name="cashAmount" required inputMode="decimal" defaultValue={amount?.toFixed(2)}/>
    </label>
    <label className="nv-label">Data do pagamento
      <input className="nv-input" name="cashDate" type="date" required defaultValue={today} max={today}/>
    </label>
    <label className="nv-label">Forma de pagamento
      <select className="nv-input" name="cashMethod" required>
        <option value="">Selecione</option>
        {Object.entries(paymentMethods).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
      </select>
    </label>
    <label className="nv-label">Comprovante (opcional)
      <input className="nv-input min-w-0" name="cashReceipt" type="file" accept="application/pdf,image/jpeg,image/png"/>
    </label>
    <label className="nv-label sm:col-span-2">Observações
      <textarea className="nv-input" name="cashNote" maxLength={1000} rows={2}/>
    </label>
  </fieldset>;
}
