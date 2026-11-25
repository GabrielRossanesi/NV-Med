import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');

function loadModule(path, imports) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const sourceModule = { exports: {} };
  const load = runInThisContext(`(function(require, module, exports) { ${outputText}\n})`, { filename: path });
  load(name => imports[name] ?? require(name), sourceModule, sourceModule.exports);
  return sourceModule.exports;
}

const routes = [
  ['/api/admin/users', 'POST'], ['/api/admin/users', 'PATCH'], ['/api/admin/users', 'DELETE'],
  ['/api/admin/users/password', 'PATCH'], ['/api/admin/organizations', 'DELETE'], ['/api/admin/doctors/[id]/access', 'POST'],
];

test('administrative routes require a live MFA session before creating a privileged client', async () => {
  const auth = loadModule('../src/lib/supabase/authorizedUser.ts', { 'server-only': {} });
  const origin = 'https://nvmed.example.invalid';
  const profile = { id: 'synthetic-profile', type: 'saas_admin', role: 'CEO', status: 'active' };
  const profileQuery = { select: () => profileQuery, eq: () => profileQuery, single: async () => ({ data: profile }) };
  let serviceClientRequests = 0;
  let mfaSession = null;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-actor' } } }) },
    from: () => profileQuery,
    rpc: async fn => ({ data: fn === 'nv_session_ready' ? true : mfaSession }),
  };

  for (const [path, method] of routes) {
    const handler = loadModule(`../src/app${path}/route.ts`, {
      '@/lib/supabase/server': { createClient: async () => client },
      '@/lib/supabase/authorizedUser': auth,
      '@/lib/supabase/admin': { createAdminClient: () => { serviceClientRequests++; return null; } },
      '@/services/supabaseService': {}, '@/lib/permissions': {}, '@/lib/passwordPolicy': {},
      '@/lib/appOrigin': {}, '@/lib/doctorPortal': {},
    })[method];
    const request = () => new NextRequest(origin + path.replace('[id]', 'synthetic'), { method, headers: { origin } });
    const context = { params: Promise.resolve({ id: 'synthetic' }) };

    mfaSession = null;
    const previousRequests = serviceClientRequests;
    const denied = await handler(request(), context);
    assert.equal(denied.status, 403, `${method} ${path}`);
    assert.deepEqual(await denied.json(), { error: auth.administrativeMfaMessage });
    assert.equal(serviceClientRequests, previousRequests);

    mfaSession = '41000000-0000-4000-8000-000000000021';
    const verified = await handler(request(), context);
    assert.equal(verified.status, 503, 'verified request reached the unconfigured admin client');
    assert.equal(serviceClientRequests, previousRequests + 1);
  }
});
