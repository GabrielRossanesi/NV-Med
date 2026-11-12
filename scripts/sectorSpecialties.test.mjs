import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileShiftDoctor, scopedSpecialties, selectShiftSector } from '../src/lib/sectorSpecialties.ts';

test('offers the company catalog in unrestricted units and filters by both links when present', () => {
  const company = ['Cirurgia Geral', 'Pediatria', 'Cardiologia'];
  assert.deepEqual(scopedSpecialties(company, []), ['Cardiologia', 'Cirurgia Geral', 'Pediatria']);
  assert.deepEqual(scopedSpecialties(company, ['Pediatria', 'Cardiologia', 'Externas'], ['Cirurgia Geral', 'Pediatria']), ['Pediatria']);
  assert.deepEqual(scopedSpecialties(company, ['Externas']), []);
});

test('respects legacy linked specialties when the company catalog is empty', () => {
  assert.deepEqual(scopedSpecialties([], [], ['Pediatria']), ['Pediatria']);
  assert.deepEqual(scopedSpecialties([], ['Pediatria'], ['Cardiologia']), []);
});

const shift = { id: '', organizationId: 'a', unitId: 'u', sectorId: 'old', doctorId: 'd', specialty: 'Old',
  date: '2030-02-01', startTime: '09:00', endTime: '17:00', status: 'confirmed', employmentType: 'pj',
  employerName: 'Empresa PJ', paymentAmount: 1700, paymentFrequency: 'monthly', notes: 'Preservar' };
const sector = { id: 's', organizationId: 'a', unitId: 'u', status: 'active', name: 'Setor',
  primarySpecialty: 'Cirurgia', specialties: ['Pediatria', 'Cirurgia'] };

test('sector selection uses only the configured principal and preserves the rest of the draft', () => {
  const selected = selectShiftSector(shift, sector);
  assert.deepEqual(selected, { ...shift, sectorId: 's', sector: 'Setor', specialty: 'Cirurgia' });
  assert.equal(shift.specialty, 'Old');
  assert.equal(selectShiftSector(shift, { ...sector, primarySpecialty: undefined }).specialty, '');
});

test('rejects a foreign company, foreign unit or inactive sector', () => {
  for (const patch of [{ organizationId: 'b' }, { unitId: 'v' }, { status: 'inactive' }]) {
    assert.throws(() => selectShiftSector(shift, { ...sector, ...patch }), /mesma empresa e unidade/);
  }
});

test('revalidating a sector keeps eligible doctors and clears incompatible ones without losing the agreement', () => {
  const selected = selectShiftSector(shift, sector);
  assert.strictEqual(reconcileShiftDoctor(selected, ['d']), selected);
  assert.deepEqual(reconcileShiftDoctor(selected, ['other']), { ...selected, doctorId: undefined, status: 'open' });
  const vacancy = { ...selected, doctorId: undefined, status: 'open' };
  assert.strictEqual(reconcileShiftDoctor(vacancy, []), vacancy);
});

test('ad hoc drafts can remove the sector and select an explicit specialty', () => {
  const selected = selectShiftSector({ ...shift, coverageMode: 'adhoc' });
  assert.equal(selected.sectorId, undefined);
  assert.equal(selected.specialty, '');
  assert.equal(selected.date, shift.date);
});
