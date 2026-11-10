import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { validateSupabaseEnvironment } from '../src/lib/supabase/environment.ts';

const env = process.env;
if (env.NVMED_RUN_HOMOLOGATION_TESTS !== 'yes') {
  throw new Error('Ative explicitamente os testes no projeto isolado conforme o guia.');
}
const { origin } = validateSupabaseEnvironment({
  NVMED_ENVIRONMENT: 'development',
  NVMED_SUPABASE_HOMOLOGATION_HOST: env.NVMED_SUPABASE_HOMOLOGATION_HOST,
  NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
if (!origin.startsWith('https://') || new URL(origin).hostname !== env.NVMED_TEST_PROJECT_HOST) {
  throw new Error('Confirme separadamente o hostname do projeto de teste.');
}

const roles = ['COORDINATOR', 'OPERATOR', 'VIEWER', 'PHYSICIAN', 'TEMPORARY', 'INACTIVE'];
function fixture(key) {
  const value = env['NVMED_TEST_' + key];
  if (!value) throw new Error('Fixture sintética ausente (' + key + ').');
  return value;
}
const org = fixture('ORG_A');
const foreignOrg = fixture('ORG_B');
const shift = fixture('SHIFT_ID');
const date = fixture('SHIFT_DATE');
const document = fixture('DOCUMENT_ID');
const documentPath = fixture('DOCUMENT_PATH');
const domain = fixture('EMAIL_DOMAIN');
if (org === foreignOrg) throw new Error('Use dois tenants sintéticos distintos.');
for (const role of roles) {
  const email = fixture(role + '_EMAIL');
  if (!email.endsWith('@' + domain) || !email.startsWith('nvmed-test-')) {
    throw new Error('Use apenas contas de teste no domínio autorizado.');
  }
  fixture(role + '_PASSWORD');
}

const clients = new Map();
const reportArgs = { org, from_date: date, to_date: date };
before(async () => {
  for (const role of roles) {
    const client = createClient(origin, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const result = await client.auth.signInWithPassword({
      email: fixture(role + '_EMAIL'), password: fixture(role + '_PASSWORD'),
    });
    assert.ok(result.data.session && !result.error, 'Login sintético falhou para ' + role);
    clients.set(role, client);
  }
});

test('temporary and inactive sessions cannot read profile, shift view or document target', async () => {
  for (const role of ['TEMPORARY', 'INACTIVE']) {
    const client = clients.get(role);
    const session = await client.rpc('nv_session_ready');
    assert.ok(!session.error && session.data === false, 'Sessão restrita ainda habilitada.');
    for (const table of ['user_accounts', 'nv_staff_shifts', 'medical_documents']) {
      const result = await client.from(table).select('id').limit(1);
      assert.ok(!result.error && result.data.length === 0, 'Leitura restrita indevida.');
    }
    assert.equal((await client.rpc('nv_report_shifts', reportArgs)).error?.code, '42501');
    const access = await client.rpc('nv_portal_document_target', { target: document });
    assert.ok(!access.error && access.data.length === 0, 'Documento liberado para sessão restrita.');
  }
});

test('finance reads are scoped and masked across table, view and RPC', async () => {
  const operator = clients.get('OPERATOR');
  const viewer = clients.get('VIEWER');
  const direct = await operator.from('shifts').select('payment_amount').eq('id', shift);
  assert.equal(direct.error?.code, '42501');
  const masked = await operator.from('nv_staff_shifts').select('payment_amount,payment_status').eq('id', shift).single();
  assert.ok(!masked.error && masked.data.payment_amount === null && masked.data.payment_status === null);
  const visible = await viewer.from('nv_staff_shifts').select('payment_amount').eq('id', shift).single();
  assert.ok(!visible.error && Number(visible.data.payment_amount) > 0, 'Fixture financeira vazia.');
  const report = await operator.rpc('nv_report_shifts', reportArgs);
  assert.ok(!report.error && report.data.finance === false && report.data.rows.some((row) => row.id === shift));
  assert.ok(report.data.rows.every((row) => row.agreed === null && row.paid_amount === null && row.payment === null));
  assert.equal((await operator.rpc('nv_report_shifts', { ...reportArgs, payment: 'paid' })).error?.code, '42501');
  assert.equal((await operator.rpc('nv_report_shifts', { ...reportArgs, org: foreignOrg })).error?.code, '42501');
});

test('authorized document resolves by record and direct Storage remains private', async () => {
  for (const role of ['PHYSICIAN', 'COORDINATOR', 'VIEWER']) {
    const client = clients.get(role);
    const allowed = await client.rpc('nv_portal_document_target', { target: document });
    assert.ok(!allowed.error && allowed.data.length === 1 && allowed.data[0].file_path === documentPath,
      'Fixture documental indisponível para papel autorizado.');
    const direct = await client.storage.from('medical-documents').createSignedUrl(documentPath, 60);
    assert.ok(direct.error && !direct.data, 'Storage emitiu URL direta.');
  }
  const denied = await clients.get('OPERATOR').rpc('nv_portal_document_target', { target: document });
  assert.ok(!denied.error && denied.data.length === 0, 'Escalista leu documento.');
  const readOnly = await clients.get('VIEWER').rpc('nv_portal_document_target', { target: document, operation: 'write' });
  assert.ok(!readOnly.error && readOnly.data.length === 0, 'Perfil de leitura obteve alvo de escrita.');
  const encodedPath = documentPath.split('/').map(encodeURIComponent).join('/');
  const publicObject = await fetch(origin + '/storage/v1/object/public/medical-documents/' + encodedPath, { redirect: 'error' });
  assert.equal(publicObject.ok, false, 'Objeto médico acessível pelo endereço público.');
});
