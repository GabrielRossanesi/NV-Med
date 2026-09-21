import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPasswordChecks, isStrongPassword } from '../src/lib/passwordPolicy.ts';

test('accepts a strong temporary password', () => assert.equal(isStrongPassword('NvMed!Acesso2026'), true));
test('rejects passwords without every required character class', () => {
  assert.equal(isStrongPassword('nvmed!acesso2026'), false);
  assert.equal(isStrongPassword('NVMED!ACESSO2026'), false);
  assert.equal(isStrongPassword('NvMedAcesso2026'), false);
  assert.equal(isStrongPassword('NvMed!Acesso'), false);
});
test('rejects short, long and whitespace passwords', () => {
  assert.equal(isStrongPassword('Nv!2026a'), false);
  assert.equal(isStrongPassword(`Nv!2${'a'.repeat(69)}`), false);
  assert.equal(getPasswordChecks('NvMed! Acesso2026').noWhitespace, false);
});
