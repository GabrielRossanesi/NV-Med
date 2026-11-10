import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSupabaseEnvironment } from '../src/lib/supabase/environment.ts';
import { isMedicalDocumentPath, readBoundedBody } from '../src/lib/documentAccess.ts';

const stageHost = 'aaaaaaaaaaaaaaaaaaaa.supabase.co';
const preview = {
  VERCEL: '1', VERCEL_ENV: 'preview', NVMED_ENVIRONMENT: 'preview',
  NVMED_SUPABASE_HOMOLOGATION_HOST: stageHost,
  NEXT_PUBLIC_SUPABASE_URL: 'https://' + stageHost,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_test',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
};
const jwt = (ref, role) => 'test.' + Buffer.from(JSON.stringify({ ref, role })).toString('base64url') + '.test';

test('accepts offline development, exact loopback and a separately configured Preview', () => {
  assert.deepEqual(validateSupabaseEnvironment({}), { mode: 'development', origin: '' });
  assert.equal(validateSupabaseEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture',
  }).origin, 'http://127.0.0.1:54321');
  assert.equal(validateSupabaseEnvironment(preview).mode, 'preview');
});

test('rejects wrong deployment scope, unsafe targets and mismatched key role or project', () => {
  for (const overrides of [
    { NVMED_ENVIRONMENT: 'production' }, { VERCEL_ENV: 'production' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://other.example' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://user@' + stageHost },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://' + stageHost + '/rest/v1' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.1:54321' },
    { NVMED_SUPABASE_HOMOLOGATION_HOST: 'bbbbbbbbbbbbbbbbbbbb.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_test' },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt('aaaaaaaaaaaaaaaaaaaa', 'service_role') },
    { SUPABASE_SERVICE_ROLE_KEY: jwt('bbbbbbbbbbbbbbbbbbbb', 'service_role') },
    { SUPABASE_SERVICE_ROLE_KEY: '' },
  ]) {
    assert.throws(() => validateSupabaseEnvironment({ ...preview, ...overrides }), /Configuração Supabase bloqueada/);
  }
});

test('accepts only an exact organization and doctor path with a supported file name', () => {
  assert.equal(isMedicalDocumentPath('tenant-a/doctor-a/old_1.pdf', 'tenant-a', 'doctor-a'), true);
  for (const path of [
    'tenant-b/doctor-a/old_1.pdf', 'tenant-a/doctor-b/old_1.pdf', 'tenant-a/doctor-a/../other.pdf',
    'tenant-a/doctor-a/%2e%2e.pdf', 'tenant-a/doctor-a//old_1.pdf', 'tenant-a/doctor-a/old_1.pdf\n',
    'tenant-a/doctor-a/old_1.pdf/extra', 'tenant-a/doctor-a/old_1.svg', 'tenant-a/doctor-a/old_1.pdf?token=x',
  ]) assert.equal(isMedicalDocumentPath(path, 'tenant-a', 'doctor-a'), false);
});

test('enforces body limit on chunked input without Content-Length', async () => {
  const request = new Request('http://127.0.0.1/upload', { method: 'POST', body: 'abc' });
  assert.equal(new TextDecoder().decode(await readBoundedBody(request, 3)), 'abc');
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2));
      controller.enqueue(new Uint8Array(2));
    },
    cancel() { cancelled = true; },
  });
  const streamed = new Request('http://127.0.0.1/upload', { method: 'POST', body, duplex: 'half' });
  assert.equal(streamed.headers.get('Content-Length'), null);
  assert.equal(await readBoundedBody(streamed, 3), null);
  assert.equal(cancelled, true);
});
