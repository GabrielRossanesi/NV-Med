import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageDays, coverageWeeks, dashboardAgenda, dashboardPayments, dashboardRange, dashboardShiftMatches, doctorsWithDocumentIssues, moveDashboardMonth } from '../src/lib/dashboardOverview.ts';

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

test('balances include older PJ shifts and exclude other employment, vacancies, cancellations and paid items', () => {
  const today = '2026-11-10';
  const shift = { doctorId: 'a', employmentType: 'pj', status: 'completed', date: '2026-10-28', paymentStatus: 'pending', paymentAmount: 100, paymentDueDate: '2026-10-30' };
  const shifts = [shift,
    { ...shift, date: today, paymentFrequency: 'monthly', paymentAmount: 200, paymentDueDate: today },
    { ...shift, date: today, paymentStatus: 'paid' },
    { ...shift, status: 'cancelled' },
    { ...shift, doctorId: undefined },
    { ...shift, employmentType: 'clt', paymentAmount: 1300 },
    { ...shift, employmentType: 'concursado', paymentAmount: 1400 },
    { ...shift, employmentType: undefined, paymentAmount: 1500 },
    { ...shift, paymentAmount: undefined },
  ];
  assert.deepEqual(dashboardPayments(shifts, today), {
    pending: 300, overdue: 100, onDelivery: { count: 1, amount: 100 }, paidThisMonth: 1, nextDue: [[today, 200]],
  });
});

test('dashboard periods include the first and last calendar dates and roll across years', () => {
  const today = '2026-12-31';
  assert.deepEqual(dashboardRange(today, 'today'), { start: today, end: today, length: 1 });
  assert.deepEqual(dashboardRange(today, 'tomorrow'), { start: '2027-01-01', end: '2027-01-01', length: 1 });
  assert.deepEqual(dashboardRange(today, 'week'), { start: today, end: '2027-01-06', length: 7 });
  for (const [month, days] of [['2026-02', 28], ['2028-02', 29], ['2026-11', 30], ['2026-12', 31]]) {
    assert.deepEqual(dashboardRange(today, 'month', month), { start: `${month}-01`, end: `${month}-${days}`, length: days });
  }
  assert.equal(moveDashboardMonth('2026-12', 1), '2027-01');
  assert.equal(moveDashboardMonth('2027-01', -1), '2026-12');
});

test('monthly bars preserve totals and delimit partial weeks without adding days outside the month', () => {
  const { start, end, length } = dashboardRange('2026-11-10', 'month');
  const shifts = [
    { id: 'a', date: start, status: 'confirmed', doctorId: 'doctor' },
    { id: 'b', date: end, status: 'open' },
    { id: 'c', date: '2026-12-01', status: 'confirmed', doctorId: 'doctor' },
    { id: 'd', date: end, status: 'cancelled', doctorId: 'doctor' },
  ];
  const weeks = coverageWeeks(coverageDays(start, [], shifts, length, true));
  assert.equal(weeks.length, 6);
  assert.equal(weeks[0].day, start);
  assert.equal(weeks.at(-1).end, end);
  assert.equal(weeks.reduce((sum, week) => sum + week.required, 0), 2);
  assert.equal(weeks.reduce((sum, week) => sum + week.deficit, 0), 1);
});

test('unit and specialty filters preserve explicit attribution and exclude ambiguous vacancies', () => {
  const doctors = new Map([['d', { specialty: 'Cirurgia' }]]);
  const sectors = new Map([['one', { specialties: ['Cirurgia'] }], ['many', { specialties: ['Cirurgia', 'Pediatria'] }]]);
  const shift = { unitId: 'u', sectorId: 'many', doctorId: 'd' };
  assert.equal(dashboardShiftMatches(shift, 'u', 'Cirurgia', doctors, sectors), true);
  assert.equal(dashboardShiftMatches(shift, 'other', 'Cirurgia', doctors, sectors), false);
  assert.equal(dashboardShiftMatches({ ...shift, specialty: 'Pediatria' }, 'u', 'Cirurgia', doctors, sectors), false);
  assert.equal(dashboardShiftMatches({ ...shift, doctorId: undefined }, 'u', 'Cirurgia', doctors, sectors), false);
  assert.equal(dashboardShiftMatches({ ...shift, doctorId: undefined, sectorId: 'one' }, 'u', 'Cirurgia', doctors, sectors), true);
});

test('agenda keeps overnight shifts in the daily view and lists each monthly shift once by its start', () => {
  const night = { id: 'night', date: '2026-10-31', startTime: '19:00', endTime: '07:00', doctorId: 'd', status: 'confirmed' };
  const first = { ...night, id: 'first', date: '2026-11-01', startTime: '07:00', endTime: '19:00' };
  const last = { ...night, id: 'last', date: '2026-11-30' };
  const shifts = [last, { ...first, status: 'cancelled' }, first, night];
  assert.deepEqual(dashboardAgenda(shifts, '2026-11-01', '2026-11-01', true).map(item => item.id), ['night', 'first']);
  assert.deepEqual(dashboardAgenda(shifts, '2026-11-01', '2026-11-30', false).map(item => item.id), ['first', 'last']);
});
