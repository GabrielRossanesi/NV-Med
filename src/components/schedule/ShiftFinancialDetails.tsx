'use client';

import { useEffect, useState } from 'react';
import { Clock3, WalletCards } from 'lucide-react';
import { financeState, financeStateLabels, saoPauloDate } from '@/lib/financeState';
import { paymentFrequencyLabels } from '@/lib/scheduling';
import { formatShiftMoney, rateScopeLabel, type AgreementDraft } from '@/lib/shiftPricing';
import { createClient } from '@/lib/supabase/client';
import { fetchShiftRates } from '@/services/supabaseService';
import type { PaymentFrequency, Shift, ShiftPaymentAgreement, ShiftRate } from '@/types';

export function useShiftRates(organization: string, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; rates: ShiftRate[]; error: string }>();
  const key = `${organization}/${revision}`;
  useEffect(() => {
    if (!organization || !enabled) return;
    let current = true;
    void fetchShiftRates(organization).then(rates => {
      if (current) setResult({ key, rates, error: '' });
    }).catch((error: Error) => {
      if (current) setResult({ key, rates: [], error: error.message });
    });
    return () => { current = false; };
  }, [organization, enabled, key]);
  const active = enabled && result?.key === key ? result : undefined;
  return { rates: active?.rates || [], error: active?.error, ready: Boolean(active && !active.error), reload: () => setRevision(value => value + 1) };
}

export function ShiftAgreementFields({ draft, onChange, rate, previous, adjustment = false }: {
  draft: AgreementDraft; onChange: (draft: AgreementDraft) => void; rate?: ShiftRate; previous?: Shift; adjustment?: boolean;
}) {
  const editing = Boolean(previous?.doctorId);
  const differentiated = draft.mode === 'override' || (draft.mode === 'keep' && previous?.paymentAgreement?.mode === 'override');
  const usingDefault = draft.mode === 'default' && Boolean(rate);
  const frozen = draft.mode === 'keep' || usingDefault;
  const requiresReason = editing && (draft.mode !== 'keep' || draft.frequency !== (previous?.paymentFrequency || 'on_delivery'));
  return <fieldset className="min-w-0 space-y-3 rounded-xl border border-border p-4">
    <legend className="px-1 text-sm font-semibold">Acordo financeiro</legend>
    {rate ? <div className="rounded-lg bg-surface-muted/60 p-3 text-xs leading-relaxed text-text-secondary">
      <strong className="block text-sm text-text-primary">Padrão aplicável · {formatShiftMoney(rate.amount_cents)}</strong>
      {rateScopeLabel(rate)}
      {draft.mode !== 'default' && <button type="button" className="ml-2 min-h-9 font-semibold text-primary hover:underline" onClick={() => onChange({ ...draft, mode: 'default' })}>Aplicar padrão</button>}
    </div> : <p className="text-xs text-text-muted">Sem referência para este recorte. Informe o valor acordado.</p>}
    {draft.mode === 'keep' && <p className="text-xs text-text-muted">O valor registrado será mantido. Para alterá-lo, aplique a referência ou escolha um valor diferenciado.</p>}
    {draft.mode === 'manual' && rate && <p className="text-xs font-medium text-warning">O valor digitado foi mantido. Aplique o padrão ou marque valor diferenciado para salvá-lo.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="nv-label">Modalidade de pagamento<select className="nv-input" disabled={adjustment} value={draft.frequency} onChange={event => onChange({ ...draft, frequency: event.target.value as PaymentFrequency })}>
        {Object.entries(paymentFrequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="nv-label">Valor combinado (R$)<input className="nv-input" inputMode="decimal" placeholder="0,00" required={!frozen} readOnly={frozen}
        value={usingDefault ? (rate!.amount_cents / 100).toFixed(2) : draft.amount}
        onChange={event => onChange({ ...draft, mode: draft.mode === 'override' ? 'override' : 'manual', amount: event.target.value })} /></label>
    </div>
    {!rate && draft.mode === 'keep' && <button type="button" className="min-h-9 text-sm font-semibold text-primary hover:underline" onClick={() => onChange({ ...draft, mode: 'manual' })}>Editar valor combinado</button>}
    <label className="flex min-h-9 items-center gap-2 text-sm font-medium">
      <input type="checkbox" checked={differentiated} onChange={event => onChange({ ...draft, mode: event.target.checked ? 'override' : rate ? 'default' : 'manual',
        amount: event.target.checked && usingDefault ? (rate!.amount_cents / 100).toFixed(2) : draft.amount })} /> Valor diferenciado
    </label>
    {draft.mode === 'override' && <label className="nv-label">Justificativa do valor diferenciado<textarea className="nv-input" rows={2} required minLength={3} maxLength={1000}
      value={draft.overrideReason} onChange={event => onChange({ ...draft, overrideReason: event.target.value })} /></label>}
    {requiresReason && <label className="nv-label">{adjustment ? 'Motivo do ajuste administrativo' : 'Motivo da alteração financeira'}<textarea className="nv-input" rows={2} required minLength={3} maxLength={1000}
      value={draft.reason} onChange={event => onChange({ ...draft, reason: event.target.value })} /></label>}
  </fieldset>;
}

const displayMoney = (amount?: number | null) => amount == null ? '—' : formatShiftMoney(Math.round(amount * 100));
const displayDate = (date?: string) => date ? date.split('-').reverse().join('/') : '—';
const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });

export function ShiftFinancialDetails({ shift, applicableRate }: { shift: Shift; applicableRate?: ShiftRate }) {
  const agreement = shift.paymentAgreement;
  const paid = shift.paymentStatus === 'paid';
  const details = [
    ['Modalidade', paymentFrequencyLabels[shift.paymentFrequency || 'on_delivery']],
    ['Valor combinado', displayMoney(shift.paymentAmount)],
    ['Referência registrada', agreement?.rate ? `${formatShiftMoney(agreement.rate.amount_cents)} · ${rateScopeLabel(agreement.rate)}` : 'Sem referência registrada'],
    ...(applicableRate && (applicableRate.id !== agreement?.rate?.id || applicableRate.amount_cents !== agreement?.rate?.amount_cents)
      ? [['Padrão atual aplicável', `${formatShiftMoney(applicableRate.amount_cents)} · ${rateScopeLabel(applicableRate)}`]] : []),
    ['Vencimento', displayDate(shift.paymentDueDate)],
    ['Situação do pagamento', financeStateLabels[financeState(shift, saoPauloDate())]],
    ['Valor efetivamente pago', paid ? displayMoney(shift.paidAmount ?? shift.paymentAmount) : '—'],
    ['Data do pagamento', shift.paidAt ? displayDate(saoPauloDate(new Date(shift.paidAt))) : '—'],
    ['Acordo definido em', agreement ? dateTime.format(new Date(agreement.changed_at)) : '—'],
  ];
  return <section className="space-y-3 rounded-xl border border-border bg-surface-muted/35 p-4" aria-label="Dados financeiros registrados">
    <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold"><WalletCards size={17} aria-hidden="true" className="text-primary" /> Dados financeiros
      {agreement?.mode === 'override' && <span className="nv-badge bg-accent/10 text-accent">Valor diferenciado</span>}
    </h3>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
      {details.map(([label, value]) => <div className="min-w-0" key={label}><dt className="text-text-muted">{label}</dt><dd className="mt-1 wrap-anywhere font-medium text-text-primary">{value}</dd></div>)}
    </dl>
    {agreement?.override_reason && <p className="whitespace-pre-wrap text-xs text-text-secondary"><strong>Justificativa do valor diferenciado</strong> · {agreement.override_reason}</p>}
    {shift.paymentNote && <p className="whitespace-pre-wrap text-xs text-text-secondary"><strong>Observação do pagamento</strong> · {shift.paymentNote}</p>}
  </section>;
}

type PaymentSnapshot = { amount: number; status: string; frequency: PaymentFrequency; agreement?: ShiftPaymentAgreement; reason?: string; note?: string; paid_amount?: number | null };
type HistoryItem = { id: number; actor_name: string | null; changed_at: string; previous: PaymentSnapshot | null; next: PaymentSnapshot };

export function ShiftPaymentHistory({ shiftId }: { shiftId: string }) {
  const [entries, setEntries] = useState<HistoryItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  async function load(before?: number) {
    setBusy(true);
    setError('');
    try {
      const result = await createClient()?.rpc('nv_shift_payment_history', { target: shiftId, before_id: before ?? null });
      if (!result || result.error) throw new Error();
      const page = result.data as HistoryItem[];
      setEntries(current => before ? [...(current || []), ...page] : page);
      setHasMore(page.length === 20);
    } catch { setError('Não foi possível consultar o histórico financeiro.'); }
    finally { setBusy(false); }
  }

  return <section className="space-y-2" aria-label="Histórico financeiro">
    {!entries && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void load()}><Clock3 size={16} aria-hidden="true" />{busy ? 'Carregando…' : 'Consultar histórico financeiro'}</button>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {entries?.length === 0 && <p className="text-sm text-text-muted">Nenhuma alteração financeira registrada.</p>}
    {Boolean(entries?.length) && <ol className="divide-y divide-border rounded-xl border border-border">
      {entries?.map(entry => <li key={entry.id} className="space-y-1 px-3 py-2 text-xs">
        <p className="font-semibold">{entry.next.agreement?.kind === 'paid_adjustment' && entry.next.agreement.changed_at !== entry.previous?.agreement?.changed_at ? 'Ajuste administrativo · ' : ''}{entry.actor_name || 'Conta indisponível'} · {dateTime.format(new Date(entry.changed_at))}</p>
        <p className="text-text-secondary">{displayMoney(entry.previous?.amount)} → {displayMoney(entry.next.amount)} · {paymentFrequencyLabels[entry.next.frequency]} · {entry.next.status === 'paid' ? 'Pago' : 'Pendente'}</p>
        {entry.next.paid_amount != null && <p className="text-text-muted">Valor efetivamente pago · {displayMoney(entry.next.paid_amount)}</p>}
        <p className="whitespace-pre-wrap text-text-muted">{entry.next.agreement?.changed_at !== entry.previous?.agreement?.changed_at ? entry.next.agreement?.reason || entry.next.agreement?.override_reason : entry.next.reason || entry.next.note}</p>
      </li>)}
    </ol>}
    {hasMore && <button type="button" className="nv-button-secondary" disabled={busy} onClick={() => void load(entries?.at(-1)?.id)}>{busy ? 'Carregando…' : 'Carregar registros anteriores'}</button>}
  </section>;
}
