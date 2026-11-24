import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import { isStrongPassword } from '../src/lib/passwordPolicy.ts';
import { readBoundedBody } from '../src/lib/documentAccess.ts';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');
const origin = 'http://localhost:3000';

function fixture({ ready = true, user = true, factors = ['first', 'backup'], passwordError } = {}) {
  const calls = [];
  const client = { auth: {
    getUser: async () => ({ data: { user: user ? { id: 'staff' } : null } }),
    mfa: {
      listFactors: async () => ({ data: { totp: factors.map(id => ({ id })) } }),
      enroll: async () => ({ data: { id: 'pending', totp: {
        qr_code: 'data:image/svg+xml;utf-8,<svg></svg>', secret: 'not-in-response', uri: 'not-in-response',
      } } }),
      unenroll: async input => { calls.push(['remove', input]); return {}; },
    },
    updateUser: async input => { calls.push(['password', input]); return { error: passwordError }; },
    signOut: async input => { calls.push(['signOut', input]); return {}; },
  }, rpc: async (name, input) => { calls.push([name, input]); return { data: ready }; } };
  const file = '../src/app/api/account/security/route.ts';
  const { outputText } = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const sourceModule = { exports: {} };
  const imports = {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/passwordPolicy': { isStrongPassword },
    '@/lib/documentAccess': { readBoundedBody },
  };
  new Function('require', 'module', 'exports', outputText)(name => imports[name] ?? require(name), sourceModule, sourceModule.exports);
  const post = (body, requestOrigin = origin) => sourceModule.exports.POST(new NextRequest(origin + '/api/account/security', {
    method: 'POST', headers: { origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { post, calls };
}

test('sensitive account actions require an authenticated user, same origin and fresh server assurance', async () => {
  const unauthenticated = fixture({ user: false });
  assert.equal((await unauthenticated.post({ operation: 'revoke' })).status, 401);
  assert.equal((await unauthenticated.post({ operation: 'revoke' }, 'https://example.invalid')).status, 403);
  assert.deepEqual(unauthenticated.calls, []);
  const stale = fixture({ ready: false });
  const response = await stale.post({ operation: 'remove', factorId: 'first' });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'step_up');
  assert.deepEqual(stale.calls, [['nv_account_security_ready', { requires_mfa: true }]]);
});

test('factor replacement protects the last TOTP and publishes only the transient enrollment QR', async () => {
  const single = fixture({ factors: ['first'] });
  assert.equal((await single.post({ operation: 'remove', factorId: 'first' })).status, 409);
  assert.equal((await single.post({ operation: 'remove', factorId: 'someone-elses-factor' })).status, 404);
  assert.ok(single.calls.every(([method]) => method !== 'remove'));
  const dual = fixture();
  assert.equal((await dual.post({ operation: 'remove', factorId: 'backup' })).status, 200);
  assert.deepEqual(dual.calls.at(-1), ['remove', { factorId: 'backup' }]);
  const response = await dual.post({ operation: 'enroll' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = (await response.json()).enrollment;
  assert.deepEqual(Object.keys(result), ['id', 'qr']);
  assert.equal(result.id, 'pending');
});

test('password validation precedes Auth writes and session revocation uses the others scope', async () => {
  const { post, calls } = fixture();
  const password = 'NvMed!Sintetica2026';
  assert.equal((await post({ operation: 'password', password, confirmation: 'mismatch' })).status, 400);
  assert.equal((await post({ operation: 'password', password: 'Aa1!' + 'é'.repeat(40), confirmation: 'Aa1!' + 'é'.repeat(40) })).status, 400);
  assert.ok(calls.every(([method]) => method !== 'password'));
  assert.equal((await post({ operation: 'password', password, confirmation: password })).status, 200);
  assert.equal((await post({ operation: 'revoke', scope: 'global' })).status, 200);
  assert.deepEqual(calls.at(-1), ['signOut', { scope: 'others' }]);
  const required = fixture({ passwordError: { code: 'reauthentication_needed' } });
  const response = await required.post({ operation: 'password', password, confirmation: password });
  assert.equal((await response.json()).code, 'nonce');
});
