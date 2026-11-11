import { coverageKindForShift, sectorCoveragePeriods } from './scheduling.ts';
import type { PaymentFrequency, Sector, SectorFinanceDefaults, Shift, ShiftAgreementSelection, ShiftRate, ShiftRateRow, ShiftRateScope } from '../types/index.ts';

export const shiftTypeLabels = { onsite: 'Presencial', oncall: 'Sobreaviso', telemedicine: 'Telemedicina' } as const;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatShiftMoney = (cents: number) => money.format(cents / 100);
export const formatShiftMoneyInput = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function parseMoneyCents(value: string) {
  const match = /^(\d{1,10})(?:[,.](\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : null;
}

function timeMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function shiftDurationMinutes(startTime: string, endTime: string) {
  return (1440 + timeMinutes(endTime) - timeMinutes(startTime)) % 1440;
}

const rateFields = ['sector_id', 'unit_id', 'specialty', 'turn', 'duration_minutes', 'shift_type'] as const;

export function hasRateAmount(row: ShiftRateRow): row is ShiftRateRow & ShiftRate {
  return row.amount_cents != null;
}

export function sectorFinanceDefaults(rates: ShiftRateRow[], sectorId?: string): SectorFinanceDefaults {
  const scoped = rates.filter(item => item.post_default && item.active && item.sector_id === sectorId);
  const general = scoped.find(item => item.turn === null);
  return { amount_cents: general?.amount_cents ?? null, day_cents: scoped.find(item => item.turn === 'day')?.amount_cents ?? null,
    night_cents: scoped.find(item => item.turn === 'night')?.amount_cents ?? null,
    frequency: general?.payment_frequency ?? null, notes: general?.financial_notes ?? '' };
}

export function chooseShiftRate(rates: ShiftRateRow[], shift: Shift, sector?: Pick<Sector, 'coveragePeriods' | 'defaultStartTime' | 'defaultEndTime' | 'requiredDoctors'>, doctorSpecialty?: string) {
  const context: ShiftRateScope = {
    sector_id: shift.sectorId || null,
    unit_id: shift.unitId || null,
    specialty: shift.specialty || doctorSpecialty || null,
    turn: coverageKindForShift(shift, sector ? sectorCoveragePeriods(sector) : []),
    duration_minutes: shiftDurationMinutes(shift.startTime, shift.endTime),
    shift_type: shift.type,
  };
  let winner: ShiftRate | undefined;
  let best = -1;
  for (const rate of rates) {
    if (!hasRateAmount(rate) || !rate.active || rate.organization_id !== shift.organizationId || !rateFields.every(field => rate[field] == null || rate[field] === context[field])) continue;
    const score = rateFields.reduce((value, field) => value * 2 + Number(rate[field] != null), 0) * 2 + Number(!rate.post_default);
    if (score > best) { winner = rate; best = score; }
  }
  return winner;
}

export function rateScopeLabel(rate: ShiftRateScope, unitName?: string, sectorName?: string) {
  const place = rate.sector_id ? sectorName || 'Posto específico' : rate.unit_id ? unitName || 'Unidade específica' : 'Empresa';
  const duration = rate.duration_minutes;
  return [place, rate.specialty, rate.turn === 'night' ? 'Noturno' : rate.turn === 'day' ? 'Diurno' : null,
    duration ? (duration % 60 ? `${duration} min` : `${duration / 60} h`) : null,
    rate.shift_type ? shiftTypeLabels[rate.shift_type] : null].filter(Boolean).join(' · ');
}

export type AgreementDraft = {
  mode: 'keep' | 'default' | 'manual' | 'override';
  amount: string;
  frequency: PaymentFrequency;
  frequencyEdited?: boolean;
  reason: string;
  overrideReason: string;
};

export function initialAgreementDraft(shift?: Shift): AgreementDraft {
  return { mode: shift?.id || shift?.doctorId || shift?.paymentAgreement ? 'keep' : 'default', amount: shift?.paymentAmount == null ? '' : formatShiftMoneyInput(Math.round(shift.paymentAmount * 100)),
    frequency: shift?.paymentFrequency || 'on_delivery', reason: '', overrideReason: shift?.paymentAgreement?.override_reason || '' };
}

export function buildAgreementSelection(draft: AgreementDraft, rate?: ShiftRate, previous?: Shift, adjustment = false): ShiftAgreementSelection | undefined {
  const frequency = draft.frequency;
  if (draft.mode === 'keep' && previous && frequency === (previous.paymentFrequency || 'on_delivery') && !adjustment) return undefined;
  const mode = draft.mode === 'default' && !rate ? 'manual' : draft.mode;
  if (adjustment && mode === 'keep') throw new Error('Selecione como o valor acordado será corrigido.');
  if (!previous && mode === 'manual' && !draft.amount.trim()) {
    if (!draft.frequencyEdited && frequency === 'on_delivery') return undefined;
    return { mode: 'keep', frequency, rate_id: null, rate_cents: null, reason: '', override_reason: '' };
  }
  if (mode === 'manual' && rate) throw new Error('Há um valor padrão neste recorte. Aplique a referência ou marque valor diferenciado para manter o valor digitado.');
  const reason = draft.reason.trim();
  const overrideReason = draft.overrideReason.trim();
  if (previous && reason.length < 3) throw new Error('Informe o motivo da alteração financeira.');
  if (mode === 'override' && !rate) throw new Error('Sem referência aplicável, informe o valor combinado sem marcar valor diferenciado.');
  if (mode === 'override' && overrideReason.length < 3) throw new Error('Informe a justificativa do valor diferenciado.');
  const amount = mode === 'manual' || mode === 'override' ? parseMoneyCents(draft.amount) : undefined;
  if (amount === null) throw new Error('Informe um valor em reais, com até duas casas decimais.');
  return {
    mode, frequency, amount_cents: amount, rate_id: rate?.id || null, rate_cents: rate?.amount_cents ?? null,
    reason, override_reason: overrideReason,
    expected_amount_cents: previous?.paymentAmount == null ? undefined : Math.round(previous.paymentAmount * 100),
    expected_frequency: previous ? previous.paymentFrequency || 'on_delivery' : undefined,
    expected_changed_at: previous?.paymentAgreement?.changed_at,
  };
}

export function buildRequiredPjAgreement(draft: AgreementDraft, rate?: ShiftRate) {
  const selection = buildAgreementSelection(draft, rate);
  if (!selection || selection.mode === 'keep') {
    throw new Error('Informe o valor combinado e confirme a modalidade de pagamento do plantão PJ.');
  }
  return selection;
}
