import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageDays, dashboardPayments, doctorsWithDocumentIssues } from '../src/lib/dashboardOverview.ts';

test('daily coverage preserves a regular deficit when a different turn is overstaffed', () => {
  const day = '2026-11-10';
  const sector = { id: 'sector', coveragePeriods: [
    { kind: 'day', startTime: '07:00', endTime: '19:00', requiredDoctors: 1 },
    { kind: 'night', startTime: '19:00', endTime: '07:00', requiredDoctors: 1 },
  ] };
  const shift = { date: day, sectorId: sector.id, startTime: '07:00', endTime: '19:00', status: 'confirmed' };
  const shifts = [{ ...shift, doctorId: 'a' }, { ...shift, doctorId: 'b' }, { ...shift, status: 'cancelled', startTime: '19:00', endTime: '07:00', doctorId: 'c' }];
  assert.deepEqual(coverageDays(day, [sector], shifts, 2), [
    { day, required: 2, deficit: 1 },
    { day: '2026-11-11', required: 2, deficit: 2 },
  ]);
});

test('document issues count a doctor once, include missing required files and honor unit scope', () => {
  const doctors = [{ id: 'a', name: 'Ana', linkedUnits: [] }, { id: 'b', name: 'Bruno', linkedUnits: [] }];
  const requirements = [{ type: 'crm', required: true, unitIds: ['u1'] }, { type: 'diploma', required: true, unitIds: ['u1'] }];
  const shifts = [{ doctorId: 'a', unitId: 'u1', status: 'confirmed' }, { doctorId: 'b', unitId: 'u1', status: 'cancelled' }];
  const issues = doctorsWithDocumentIssues(doctors, [{ doctorId: 'a', type: 'crm', status: 'expired' }], shifts, new Date('2026-11-10T12:00:00').getTime(), requirements, 30);
  assert.deepEqual(issues.map(({ doctor, expired, pending }) => [doctor.id, expired, pending]), [['a', 1, 2]]);
});

test('on-delivery balances include older unpaid shifts and exclude vacancies, cancellations and paid items', () => {
  const today = '2026-11-10';
  const shift = { doctorId: 'a', status: 'completed', date: '2026-10-28', paymentStatus: 'pending', paymentAmount: 100, paymentDueDate: '2026-10-30' };
  const shifts = [shift,
    { ...shift, date: today, paymentFrequency: 'monthly', paymentAmount: 200, paymentDueDate: today },
    { ...shift, date: today, paymentStatus: 'paid' },
    { ...shift, status: 'cancelled' },
    { ...shift, doctorId: undefined },
  ];
  assert.deepEqual(dashboardPayments(shifts, today), {
    pending: 300, overdue: 100, onDelivery: { count: 1, amount: 100 }, paidThisMonth: 1, nextDue: [[today, 200]],
  });
});
