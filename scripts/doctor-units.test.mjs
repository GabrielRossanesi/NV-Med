import test from 'node:test';
import assert from 'node:assert/strict';
import { doctorHasOperationalUnit, getDoctorOperationalUnitIds } from '../src/lib/doctorUnits.ts';

const shifts = [
  { doctorId: 'doctor-a', unitId: 'unit-1', status: 'confirmed' },
  { doctorId: 'doctor-a', unitId: 'unit-2', status: 'completed' },
  { doctorId: 'doctor-a', unitId: 'unit-2', status: 'confirmed' },
  { doctorId: 'doctor-a', unitId: 'unit-3', status: 'cancelled' },
  { doctorId: 'doctor-b', unitId: 'unit-4', status: 'confirmed' },
];

test('derives a doctor units from active shift history without duplicates', () => {
  assert.deepEqual(getDoctorOperationalUnitIds(shifts, 'doctor-a'), ['unit-1', 'unit-2']);
});

test('matches unit filters from operational shifts and ignores cancellations', () => {
  assert.equal(doctorHasOperationalUnit(shifts, 'doctor-a', 'unit-2'), true);
  assert.equal(doctorHasOperationalUnit(shifts, 'doctor-a', 'unit-3'), false);
  assert.equal(doctorHasOperationalUnit(shifts, 'doctor-a', ''), true);
});
