import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getScheduleDeletionTargets, vacateShift } from '../src/lib/scheduleDeletion.ts';

const sector = { id: 'sector', organizationId: 'org', unitId: 'unit', name: 'Emergência', defaultStartTime: '07:00', defaultEndTime: '19:00', requiredDoctors: 2, coveragePeriods: [{ kind: 'day', startTime: '07:00', endTime: '19:00', requiredDoctors: 1 }, { kind: 'night', startTime: '19:00', endTime: '07:00', requiredDoctors: 1 }] };
const base = { id: 'day-1', organizationId: 'org', unitId: 'unit', sectorId: 'sector', doctorId: 'doctor', date: '2026-09-29', startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed', paymentAmount: 500, paymentStatus: 'paid' };
const shifts = [base, { ...base, id: 'night-1', startTime: '19:00', endTime: '07:00' }, { ...base, id: 'day-2', date: '2026-09-30', doctorId: undefined }, { ...base, id: 'other-org', organizationId: 'other' }];
const selection = { scope: 'period', from: '2026-09-29', to: '2026-09-30', unitId: '', sectorId: '', kind: '', doctorId: '', shiftId: '' };

test('period deletion selects saved shifts in range and current organization only', () => {
  assert.deepEqual(getScheduleDeletionTargets(shifts, [sector], 'org', selection).map(shift => shift.id), ['day-1', 'night-1', 'day-2']);
  assert.deepEqual(getScheduleDeletionTargets(shifts, [sector], 'org', { ...selection, from: '2026-10-01' }), []);
});

test('turn deletion selects the chosen sector, date and coverage period', () => {
  const target = { ...selection, scope: 'turn', to: selection.from, sectorId: 'sector', kind: 'night' };
  assert.deepEqual(getScheduleDeletionTargets(shifts, [sector], 'org', target).map(shift => shift.id), ['night-1']);
  assert.deepEqual(getScheduleDeletionTargets(shifts, [sector], 'org', { ...target, kind: '' }), []);
});

test('doctor removal keeps the post and clears employment and financial assignment', () => {
  const targets = getScheduleDeletionTargets(shifts, [sector], 'org', { ...selection, scope: 'doctor', doctorId: 'doctor' });
  assert.deepEqual(targets.map(shift => shift.id), ['day-1', 'night-1']);
  const vacancy = vacateShift(base);
  assert.equal(vacancy.id, base.id);
  assert.equal(vacancy.doctorId, undefined);
  assert.equal(vacancy.status, 'open');
  assert.equal(vacancy.paymentAmount, 0);
  assert.equal(vacancy.paymentStatus, 'pending');
});
