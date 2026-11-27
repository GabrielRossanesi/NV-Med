import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Execute the real server readers and mappers, with an in-memory Supabase boundary.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
let activeClient;
const overrides = new Map([
  ['server-only', {}],
  ['@/lib/supabase/client', { createClient: () => activeClient }],
  ['@/lib/supabase/server', { createClient: async () => activeClient }],
]);
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const sourceModule = { exports: {} }; modules.set(filename, sourceModule);
  const native = createRequire(filename);
  const local = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (!name.startsWith('.') && !name.startsWith('@/')) return native(name);
    const target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
    return load([target, target + '.ts', target + '.tsx'].find(p => existsSync(p)));
  };
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  new Function('require', 'module', 'exports', outputText)(local, sourceModule, sourceModule.exports);
  return sourceModule.exports;
}
const { loadStaffBootstrap } = load(path.join(root, 'src/lib/supabase/staffBootstrap.ts'));
const { workspaceOverviewReader } = load(path.join(root, 'src/lib/supabase/workspaceOverview.ts'));
const { fetchWorkspaceData } = load(path.join(root, 'src/services/supabaseService.ts'));
const { workspacePlan } = load(path.join(root, 'src/lib/workspaceScope.ts'));
const { GET } = load(path.join(root, 'src/app/api/workspace/overview/route.ts'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const calls = [], gates = {};
  const user = { id: 'actor-a', email: 'actor@example.invalid', app_metadata: {} };
  const staff = { id: 'staff-a', auth_user_id: user.id, organization_id: 'company-a', type: 'tenant_user', role: 'Diretor', status: 'active', name: 'Gestão fictícia', encrypted_password: 'must-not-leak' };
  const organization = { id: 'company-a', name: 'Empresa fictícia A', settings: { requiredDocuments: [{ type: 'unit_credential', name: 'Credencial', required: true, unitIds: ['unit-a'] }] } };
  const doctor = { id: 'doctor-a', organization_id: organization.id, name: 'Médico Fictício', crm: '123', crm_uf: 'SP', specialty: 'Cirurgia', status: 'active', linked_units: [], cpf: 'must-not-leak' };
  const shift = { id: 'shift-a', organization_id: organization.id, doctor_id: doctor.id, unit_id: 'unit-a', date: '2024-01-01', start_time: '07:00', end_time: '19:00', type: 'onsite', status: 'confirmed', employment_type: 'pj', payment_amount: 987, paid_amount: 87, payment_status: 'pending', payment_due_date: '2024-01-05' };
  const data = { user_accounts: [staff], organizations: [organization, { ...organization, id: 'company-b', name: 'Empresa fictícia B' }], doctors: [doctor], units: [], sectors: [], nv_staff_shifts: [shift] };
  const state = { ready: true, preferencesError: false, documentsError: false, denied: [], authError: false };
  const client = {
    auth: { getUser: async () => { calls.push({ name: 'auth' }); return { data: { user: state.authError ? null : user }, error: null }; } },
    from(table) {
      const request = { name: table, filters: [], start: 0, end: 499 };
      const query = {
        select(columns) { request.columns = columns; return this; },
        eq(field, value) { request.filters.push([field, value]); return this; },
        gte(field, value) { request.lower = [field, value]; return this; },
        lte(field, value) { request.upper = [field, value]; return this; },
        or(value) { request.or = value; return this; },
        order() { return this; }, range(start, end) { Object.assign(request, { start, end }); return this; },
        abortSignal(signal) { request.signal = signal; return this; }, overrideTypes() { return this; },
        maybeSingle() { request.single = true; return this; },
        async then(resolve, reject) {
          calls.push(request); if (gates[table]) await gates[table].promise;
          let rows = (data[table] || []).filter(row => request.filters.every(([field, value]) => row[field] === value)).slice(request.start, request.end + 1);
          return Promise.resolve({ data: request.single ? rows[0] || null : rows, error: null }).then(resolve, reject);
        },
      }; return query;
    },
    rpc(name, args) {
      calls.push({ name, args });
      let result = name === 'nv_session_ready' ? { data: state.ready, error: null }
        : name === 'nv_can_action' ? { data: !state.denied.includes(args.module), error: null }
        : name === 'nv_account_preferences' ? { data: null, error: state.preferencesError ? { message: 'private' } : null }
        : name === 'nv_workspace_documents' ? { data: [], error: state.documentsError ? { code: '42501', message: 'private' } : null }
        : { data: [], error: null };
      return { abortSignal() { return this; }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    },
    storage: { from: () => ({ createSignedUrl: async () => { calls.push({ name: 'avatar' }); return { data: { signedUrl: 'https://example.invalid/avatar' } }; } }) },
  };
  activeClient = client;
  return { client, calls, gates, user, staff, organization, doctor, data, state };
}
test('server bootstrap returns only the verified account and its tenant; no credentials or operational records', async () => {
  const f = fixture(); const result = await loadStaffBootstrap(f.client);
  assert.equal(result.data.currentUser.id, f.staff.id); assert.equal(result.data.currentUser.email, f.user.email);
  assert.deepEqual(result.data.organizations.map(o => o.id), ['company-a']);
  assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  assert.ok(!f.calls.some(c => ['doctors', 'nv_staff_shifts', 'nv_workspace_documents'].includes(c.name)));
  assert.equal(f.calls.filter(c => c.name === 'auth').length, 1);
});
test('bootstrap fails closed for missing auth, revoked session, inactive profile and required password change', async () => {
  let f = fixture(); f.state.authError = true; assert.equal((await loadStaffBootstrap(f.client)).redirect, '/login');
  f = fixture(); f.state.ready = false; assert.equal((await loadStaffBootstrap(f.client)).redirect, '/login');
  f = fixture(); f.staff.status = 'inactive'; assert.equal((await loadStaffBootstrap(f.client)).redirect, '/portal');
  f = fixture(); f.user.app_metadata.must_change_password = true;
  assert.equal((await loadStaffBootstrap(f.client)).redirect, '/definir-senha?required=1'); assert.ok(!f.calls.some(c => c.name === 'user_accounts'));
});
test('company reads, preferences and avatar start together; a preference failure remains recoverable', async () => {
  const f = fixture(); f.staff.avatar = 'actor-a/photo.webp'; f.gates.organizations = deferred(); f.state.preferencesError = true;
  const result = loadStaffBootstrap(f.client);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(c => c.name === 'nv_account_preferences')); assert.ok(f.calls.some(c => c.name === 'avatar'));
  f.gates.organizations.resolve(); const value = await result;
  assert.equal(value.preferencesError, true); assert.equal(value.data.currentUser.avatar, 'https://example.invalid/avatar');
});
test('SaaS bootstrap keeps authorized companies without reusing another session payload', async () => {
  const first = fixture(); first.staff.type = 'saas_admin'; first.staff.role = 'CEO';
  assert.equal((await loadStaffBootstrap(first.client)).data.organizations.length, 2);
  const second = fixture(); second.user.id = 'actor-b'; second.staff.auth_user_id = 'actor-b'; second.staff.id = 'staff-b';
  const result = await loadStaffBootstrap(second.client);
  assert.equal(result.data.currentUser.id, 'staff-b'); assert.equal(result.data.organizations.length, 1);
});
test('ordinary workspace catalogs and shifts start before the doctor request completes', async () => {
  const f = fixture(); f.gates.doctors = deferred();
  const plan = workspacePlan('/dashboard', new URLSearchParams(), 'company-a');
  const result = fetchWorkspaceData(plan, { type: 'tenant_user', role: 'Diretor' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.calls.some(c => c.name === 'units')); assert.ok(f.calls.some(c => c.name === 'nv_staff_shifts'));
  f.gates.doctors.resolve(); assert.equal((await result).doctors[0].id, f.doctor.id);
});
test('missing physician still prevents all dependent folder reads', async () => {
  const f = fixture(); const result = await fetchWorkspaceData(workspacePlan('/medicos/missing', new URLSearchParams(), 'company-a'), { type: 'tenant_user', role: 'Diretor' });
  assert.equal(result.doctors.length, 0); assert.ok(!f.calls.some(c => ['units', 'nv_staff_shifts', 'nv_workspace_documents'].includes(c.name)));
});
test('combined summaries share the historical shift read and preserve outstanding balances and unit requirements', async () => {
  const f = fixture(); const reader = workspaceOverviewReader(f.client, 'company-a', new AbortController().signal, { documents: true, schedule: true, finance: true });
  const [documents, money] = await Promise.all([reader.documents(), reader.finance()]);
  assert.equal(money.pending, 900); assert.equal(money.overdue, 900);
  assert.deepEqual(documents.units['doctor-a'], ['unit-a']); assert.equal(documents.issues[0].pending, 1);
  assert.ok(!JSON.stringify(documents).includes('must-not-leak')); assert.ok(!JSON.stringify(documents).includes('payment_amount'));
  assert.equal(f.calls.filter(c => c.name === 'nv_staff_shifts').length, 1);
  assert.ok(f.calls.filter(c => ['doctors','nv_staff_shifts'].includes(c.name)).every(c => c.filters.some(([key,value]) => key === 'organization_id' && value === 'company-a')));
});
test('document-only summary does not request finance fields or allow the finance reader', async () => {
  const f = fixture(); const reader = workspaceOverviewReader(f.client, 'company-a', new AbortController().signal, { documents: true, schedule: true, finance: false });
  await reader.documents(); await assert.rejects(reader.finance());
  assert.ok(f.calls.filter(c => c.name === 'nv_staff_shifts').every(c => !c.columns.includes('payment_amount')));
});
test('all-summary API preserves partial success and performs one live authorization sequence', async () => {
  const f = fixture(); f.state.documentsError = true;
  const response = await GET({ nextUrl: new URL('https://nvmed.example.invalid/api/workspace/overview?org=company-a&part=all'), signal: new AbortController().signal });
  assert.equal(response.status, 200); const value = await response.json();
  assert.equal(value.documents, null); assert.equal(value.finance.pending, 900); assert.ok(!JSON.stringify(value).includes('private'));
  assert.equal(f.calls.filter(c => c.name === 'auth').length, 1); assert.equal(f.calls.filter(c => c.name === 'nv_session_ready').length, 1);
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
});
test('all-summary API omits denied modules and never reads data before failed authorization', async () => {
  let f = fixture(); f.state.denied = ['financeiro'];
  const request = () => ({ nextUrl: new URL('https://nvmed.example.invalid/api/workspace/overview?org=company-a&part=all'), signal: new AbortController().signal });
  let response = await GET(request()); assert.equal(response.status, 200); assert.equal((await response.json()).finance, undefined);
  f = fixture(); f.state.denied = ['financeiro', 'escala', 'documentos']; response = await GET(request()); assert.equal(response.status, 403);
  assert.ok(!f.calls.some(c => ['doctors', 'nv_staff_shifts'].includes(c.name)));
  f = fixture(); f.state.ready = false; response = await GET(request()); assert.equal(response.status, 401);
  assert.ok(!f.calls.some(c => ['doctors', 'nv_staff_shifts'].includes(c.name)));
});
