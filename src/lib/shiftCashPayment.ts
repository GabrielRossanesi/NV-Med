import { createClient } from '@/lib/supabase/client';
import { portalError } from '@/lib/doctorPortal';
import { parseMoneyCents } from '@/lib/shiftPricing';

export const paymentMethods = {
  pix: 'Pix', transfer: 'Transferência', cash: 'Dinheiro', other: 'Outra',
};
type PaymentMethod = keyof typeof paymentMethods;

export interface ShiftCashPayment {
  id: string;
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  note: string;
  receipt?: string;
}
export interface ShiftPaymentMovement extends ShiftCashPayment {
  reversal_of: string | null;
  receipt_path: string | null;
}

const receiptTypes: Record<string, string> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
};

export async function readCashPayment(form: FormData, organization: string, id: string): Promise<ShiftCashPayment> {
  const cents = parseMoneyCents(String(form.get('cashAmount') || ''));
  const method = String(form.get('cashMethod') || '') as PaymentMethod;
  const date = String(form.get('cashDate') || '');
  if (!cents || !date || !Object.hasOwn(paymentMethods, method)) throw new Error('Informe o valor, a data e a forma do pagamento.');
  const payment: ShiftCashPayment = { id, amount: cents / 100, paid_on: date, method, note: String(form.get('cashNote') || '').trim() };
  const receipt = await uploadFinanceReceipt(form.get('cashReceipt'), organization, id);
  return { ...payment, receipt };
}

export async function uploadFinanceReceipt(file: FormDataEntryValue | null, organization: string, id: string) {
  if (!(file instanceof File) || !file.size) return undefined;
  const extension = receiptTypes[file.type];
  if (!extension || file.size > 10 * 1024 * 1024) throw new Error('Anexe um comprovante PDF, JPG ou PNG de até 10 MB.');
  const client = createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const path = organization + '/' + id + '.' + extension;
  const { error } = await client.storage.from('finance-receipts').upload(path, file, { contentType: file.type });
  if (error) {
    const { data } = await client.storage.from('finance-receipts').exists(path);
    if (!data) throw new Error('Não foi possível anexar o comprovante.');
  }
  return path;
}

export async function registerShiftPayment(target: string, payment: ShiftCashPayment) {
  return changePayment(target, payment.id, payment.amount, payment.paid_on, payment.method, payment.note, payment.receipt);
}

export async function reverseShiftPayment(target: string, movement: string, requestId: string, date: string, note: string) {
  return changePayment(target, requestId, null, date, null, note, undefined, movement);
}

async function changePayment(target: string, id: string, amount: number | null, date: string,
  method: string | null, note: string, receipt?: string, reverseId?: string) {
  const client = createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { error } = await client.rpc('nv_register_shift_payment', {
    target, request_id: id, amount, paid_on: date, method, note, receipt, reverse_id: reverseId,
  });
  if (error) throw new Error(portalError(error));
}

export async function listShiftPaymentMovements(target: string): Promise<ShiftPaymentMovement[]> {
  const client = createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { data, error } = await client.rpc('nv_shift_payment_movements', { target });
  if (error) throw new Error(portalError(error));
  return data;
}

export async function signedPaymentReceipt(path: string) {
  const client = createClient();
  if (!client) throw new Error('Conexão indisponível.');
  const { data, error } = await client.storage.from('finance-receipts').createSignedUrl(path, 60, { download: true });
  if (error) throw new Error('Não foi possível abrir o comprovante.');
  return data.signedUrl;
}
