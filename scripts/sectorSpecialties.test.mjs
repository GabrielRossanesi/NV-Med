import test from 'node:test';
import assert from 'node:assert/strict';
import { scopedSpecialties } from '../src/lib/sectorSpecialties.ts';

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
