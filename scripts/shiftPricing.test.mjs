import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgreementSelection, chooseShiftRate, initialAgreementDraft, parseMoneyCents, shiftDurationMinutes } from '../src/lib/shiftPricing.ts';

const shift = { organizationId: 'a', unitId: 'u', sectorId: 's', doctorId: 'd', specialty: 'Cirurgia', startTime: '19:00', endTime: '07:00', type: 'onsite' };
const general = { id: 'general', organization_id: 'a', amount_cents: 95000, active: true };
const unit = { ...general, id: 'unit', unit_id: 'u', specialty: 'Cirurgia' };
const post = { ...unit, id: 'post', sector_id: 's', turn: 'night', duration_minutes: 720, shift_type: 'onsite', amount_cents: 120000 };

test('currency parsing uses exact integer cents and rejects extra precision and negatives', () => {
  for (const [input, result] of [['0', 0], ['1200,05', 120005], ['1200.5', 120050], ['9999999999,99', 999999999999], ['10,005', null], ['-1', null], ['1e3', null], ['', null]]) {
    assert.equal(parseMoneyCents(input), result);
  }
  assert.equal(shiftDurationMinutes('19:00', '07:00'), 720);
});

test('rate specificity honors scope, specialty, turn, duration and type in order', () => {
  assert.equal(chooseShiftRate([post, general, unit], shift).id, 'post');
  assert.equal(chooseShiftRate([post, general, unit], { ...shift, type: 'oncall' }).id, 'unit');
  assert.equal(chooseShiftRate([post, general, unit], { ...shift, unitId: 'other' }).id, 'general');
  assert.equal(chooseShiftRate([{ ...post, organization_id: 'b' }, { ...unit, active: false }], shift), undefined);
  assert.equal(chooseShiftRate([{ ...unit, specialty: undefined, turn: 'night' }, unit], shift).id, 'unit');
});

test('defaults apply to new agreements while existing values and manually entered values are preserved', () => {
  const previous = { ...shift, paymentAmount: 1100, paymentFrequency: 'on_delivery' };
  assert.equal(buildAgreementSelection(initialAgreementDraft(previous), post, previous), undefined);
  assert.equal(buildAgreementSelection(initialAgreementDraft(), post).rate_cents, 120000);
  const typed = { ...initialAgreementDraft(), mode: 'manual', amount: '1100,10' };
  assert.equal(buildAgreementSelection(typed).amount_cents, 110010);
  assert.throws(() => buildAgreementSelection(typed, post), /valor diferenciado/);
  assert.equal(typed.amount, '1100,10');
  for (const amount of ['1450,00', '1000,00']) {
    const selection = buildAgreementSelection({ ...typed, mode: 'override', amount, overrideReason: 'Valor negociado' }, post);
    assert.equal(selection.amount_cents, parseMoneyCents(amount));
  }
});

test('a change of modality sends the recorded financial baseline and requires a reason', () => {
  const previous = { ...shift, paymentAmount: 1200, paymentFrequency: 'on_delivery', paymentAgreement: { changed_at: '2026-11-10T13:00:00Z' } };
  const draft = { ...initialAgreementDraft(previous), frequency: 'monthly' };
  assert.throws(() => buildAgreementSelection(draft, post, previous), /motivo/);
  const selection = buildAgreementSelection({ ...draft, reason: 'Acordo mensal' }, post, previous);
  assert.equal(selection.mode, 'keep');
  assert.equal(selection.expected_amount_cents, 120000);
  assert.equal(selection.expected_changed_at, previous.paymentAgreement.changed_at);
});
