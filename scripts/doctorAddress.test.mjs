import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../src/app/api/cep/route.ts';
import {
  applyCepAddress, doctorAddressFieldLimits, doctorAddressLimit, emptyDoctorAddress, formatDoctorAddress,
  normalizeDoctorCep, parseDoctorAddress,
} from '../src/lib/doctorAddress.ts';

const postalAddress = { street: 'Praça da Sé', district: 'Sé', city: 'São Paulo', state: 'SP' };
const endpoint = cep => new Request(`http://localhost/api/cep?${new URLSearchParams({ cep })}`);

test('CEP keeps leading zeros and validates the full input without stripping invalid characters', () => {
  assert.equal(normalizeDoctorCep('01001-000'), '01001000');
  assert.equal(normalizeDoctorCep(' 01001000 '), '01001000');
  for (const invalid of ['0100100', '010010000', '0100A000', '01001 000', '01-001000']) {
    assert.equal(normalizeDoctorCep(invalid), '');
  }
});

test('structured addresses round-trip in the existing text field and distinguish legacy records', () => {
  const address = { ...postalAddress, number: '12-A', complement: 'Bloco A, 2º andar', cep: '01001-000' };
  const stored = formatDoctorAddress(address);
  assert.deepEqual(parseDoctorAddress(stored), address);
  assert.deepEqual(parseDoctorAddress(stored.replaceAll('\n', '\r\n')), address);
  assert.equal(parseDoctorAddress('Rua Doutor Lima, 52, apto. 3'), null);
  assert.equal(parseDoctorAddress('Logradouro: Rua Antiga\nEndereço livre'), null);
  assert.equal(formatDoctorAddress({ ...emptyDoctorAddress, cep: '123' }), '');

  const longest = Object.fromEntries(Object.entries(doctorAddressFieldLimits).map(([field, length]) => [field, 'a'.repeat(length)]));
  assert.ok(formatDoctorAddress({ ...longest, cep: '01001-000' }).length <= doctorAddressLimit);
});

test('missing imported addresses are treated as empty without rewriting legacy text', () => {
  for (const value of [null, undefined, '']) assert.equal(parseDoctorAddress(value), null);
  assert.equal(parseDoctorAddress('Rua legada, 10'), null);
  assert.deepEqual(parseDoctorAddress('Logradouro: Rua Fictícia'), { ...emptyDoctorAddress, street: 'Rua Fictícia' });
});

test('lookup fills available fields and preserves number, complement and edits made while loading', () => {
  const before = { ...emptyDoctorAddress, street: 'Rua anterior', district: 'Bairro anterior', number: '12', complement: 'Casa 2' };
  const edited = { ...before, street: 'Rua corrigida', number: '14' };
  assert.deepEqual(applyCepAddress(edited, before, { ...postalAddress, district: '' }), {
    ...edited, city: 'São Paulo', state: 'SP',
  });
});

test('CEP endpoint rejects invalid input locally and forwards only the normalized CEP', async context => {
  const upstream = context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://viacep.com.br/ws/01001000/json/');
    assert.equal(options.next.revalidate, 86400);
    return Response.json({ cep: '01001-000', logradouro: ' Praça da Sé ', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP', complemento: 'lado ímpar' });
  });
  assert.equal((await GET(endpoint('01x01-000'))).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
  const found = await GET(endpoint('01001-000'));
  assert.deepEqual(await found.json(), postalAddress);
  assert.equal(upstream.mock.callCount(), 1);
});

test('CEP endpoint supports partial addresses, nonexistent CEPs and service failures', async context => {
  const upstream = context.mock.method(globalThis, 'fetch', async () => Response.json({ cep: '01001-000', localidade: 'São Paulo', uf: 'SP' }));
  assert.deepEqual(await (await GET(endpoint('01001000'))).json(), { ...postalAddress, street: '', district: '' });

  for (const erro of [true, 'true']) {
    upstream.mock.mockImplementationOnce(async () => Response.json({ erro }));
    assert.equal((await GET(endpoint('99999999'))).status, 404);
  }
  upstream.mock.mockImplementationOnce(async () => { throw new Error('offline'); });
  assert.equal((await GET(endpoint('01001000'))).status, 503);
  upstream.mock.mockImplementationOnce(async () => Response.json({ cep: '02002-000' }));
  assert.equal((await GET(endpoint('01001000'))).status, 503);
});
