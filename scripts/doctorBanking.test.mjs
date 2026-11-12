import test from 'node:test';
import assert from 'node:assert/strict';
import { bankingFromForm, emptyBanking, normalizeBanking, normalizePixKey } from '../src/lib/doctorBanking.ts';
import { canPerformAction, sanitizeAdditionalPermissions } from '../src/lib/permissions.ts';

test('PIX accepts CPF, numeric/alphanumeric CNPJ, email, E.164 and UUID v4', () => {
  for (const [type, value, expected] of [
    ['cpf', '529.982.247-25', '52998224725'],
    ['cnpj', '11.222.333/0001-81', '11222333000181'],
    ['cnpj', '00.000.000/E08G-12', '00000000E08G12'],
    ['email', '  Medico@Example.COM ', 'medico@example.com'],
    ['phone', '(11) 99999-9999', '+5511999999999'],
    ['phone', '11 3333-4444', '+551133334444'],
    ['phone', '5511999999999', '+5511999999999'],
    ['phone', '+44 20 7946 0958', '+442079460958'],
    ['evp', '550E8400-E29B-41D4-A716-446655440000', '550e8400-e29b-41d4-a716-446655440000'],
  ]) assert.equal(normalizePixKey(type, value), expected);
});

test('PIX rejects invalid checksums, repeated digits, malformed keys and missing type', () => {
  for (const [type, value] of [
    ['cpf','52998224724'], ['cpf','11111111111'], ['cpf','x52998224725'], ['cpf','5299822472'],
    ['cnpj','11222333000180'], ['cnpj','00000000000000'], ['cnpj','00000000E08G11'],
    ['email','doctor@'], ['email','a b@example.com'], ['email','a'.repeat(70)+'@example.com'],
    ['phone','999999999'], ['phone','+0123456789'], ['phone','++5511999999999'], ['phone','11X999999999'],
    ['phone','+5501999999999'], ['phone','+1234567890123456'],
    ['evp','550e8400-e29b-11d4-a716-446655440000'], ['evp','550e8400-e29b-41d4-0716-446655440000'],
    ['', '52998224725'], ['other','52998224725'], ['cpf',''],
  ]) assert.throws(() => normalizePixKey(type, value), undefined, `${type}: ${value}`);
});

test('optional banking fields stay empty and account/branch leading zeros survive', () => {
  const base = { ...emptyBanking, pix_key_type: 'cpf', pix_key: '52998224725' };
  assert.deepEqual(normalizeBanking(base), base);
  const populated = normalizeBanking({ ...base, bank: ' Banco ', bank_code: '001', bank_ispb: '00000000', agency: ' 0001-X ', account_number: '00001234-0' });
  assert.equal(populated.agency, '0001-X');
  assert.equal(populated.account_number, '00001234-0');
  assert.equal(populated.bank_code, '001');
  assert.equal(populated.bank_ispb, '00000000');
  assert.throws(() => normalizeBanking({ ...base, agency: 'a'.repeat(31) }));
  assert.throws(() => normalizeBanking({ ...base, bank: 'Bank\nname' }));
  assert.throws(() => normalizeBanking({ ...base, bank_code: '1' }));
  const form = new FormData();
  form.set('pix_key_type','email'); form.set('pix_key','doc@example.com');
  assert.equal(bankingFromForm(form).account_number, '');
});

test('banking permissions are distinct from scheduling and finance access', () => {
  const coordinator = { type: 'tenant_user', role: 'Coordenador de Escalas', additionalPermissions: { financeiro: 'edit' } };
  for (const action of ['view','edit','history']) assert.equal(canPerformAction(coordinator,'dados_bancarios',action), false);
  const reader = { ...coordinator, additionalPermissions: { 'dados_bancarios.view': 'allow' } };
  assert.equal(canPerformAction(reader,'dados_bancarios','view'), true);
  assert.equal(canPerformAction(reader,'dados_bancarios','edit'), false);
  assert.equal(canPerformAction(reader,'dados_bancarios','history'), false);
  for (const role of ['Diretor','Gerente','Financeiro']) {
    const user = { ...coordinator, role, additionalPermissions: { 'dados_bancarios.edit': 'deny', 'dados_bancarios.history': 'deny' } };
    assert.equal(canPerformAction(user,'dados_bancarios','view'), true);
    assert.equal(canPerformAction(user,'dados_bancarios','edit'), false);
    assert.equal(canPerformAction(user,'dados_bancarios','history'), false);
    assert.equal(canPerformAction({ ...user, additionalPermissions: { 'dados_bancarios.view': 'deny', 'dados_bancarios.edit': 'allow' } },'dados_bancarios','edit'), false);
  }
  assert.deepEqual(sanitizeAdditionalPermissions({ 'dados_bancarios.view':'allow','dados_bancarios.history':'deny',dados_bancarios:'edit' },'tenant_user'), { 'dados_bancarios.view':'allow','dados_bancarios.history':'deny' });
});
