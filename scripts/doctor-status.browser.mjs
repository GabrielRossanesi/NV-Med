// Real UI, isolated loopback Auth/Data API fixtures. Never connects to Supabase production.
import assert from 'node:assert/strict';
import { directoryFixture } from './fixtures/doctor-directory.mjs';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const playwrightModule = process.env.NVMED_PLAYWRIGHT_MODULE || pathToFileURL(path.join(homedir(), 'AppData/Local/NVMed-Backups/LabTools/nvmed-playwright/node_modules/playwright-core/index.mjs')).href;
const { chromium } = await import(playwrightModule);
const artifact = new URL('../Import/_status-ui-20261125/', import.meta.url);
fs.mkdirSync(artifact, { recursive: true });
const id = '53000000-0000-4000-8000-000000000001';
const user = { id, email: 'status-test@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [], created_at: '2026-01-01T00:00:00Z' };
const doctor = { id: 'status-doctor', organization_id: 'status-org', name: 'Médico sintético', crm: '5353', crm_uf: 'SP', specialty: 'Cirurgia', status: 'pending', address: null, cpf: null, phone: null, email: null, contract_model: 'pf', contract_signed: false, linked_units: [], updated_at: '2026-01-01T00:00:00Z' };

const actor = { id: 'status-admin', auth_user_id: id, name: 'Administrativo sintético', email: user.email, type: 'tenant_user', organization_id: 'status-org', role: 'Diretor', status: 'active', additional_permissions: {}, created_at: '2026-01-01T00:00:00Z' };
const org = { id: 'status-org', name: 'Empresa sintética', status: 'active', settings: { specialties: ['Cirurgia'], requiredDocuments: [] } };
const audit = [];
let failure = null;
let statusCalls = 0;
let delay = 0;
let personalAccess = false;
let profileLoadFailure = false;
const profileWrites = [];
const mock = http.createServer(async (request, response) => {
 response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3108');
 response.setHeader('Access-Control-Allow-Headers', '*');
 response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
 response.setHeader('Content-Type', 'application/json');
 if (request.method === 'OPTIONS') { response.end(); return; }
 const url = new URL(request.url, 'http://127.0.0.1:54321');
 const send = (data, code = 200) => { response.statusCode = code; response.end(JSON.stringify(data)); };
 if (url.pathname === '/auth/v1/user') return send(user);
 if (url.pathname.startsWith('/auth/')) return send({ factors: [], all: [], totp: [], data: user });
 const name = url.pathname.split('/').at(-1);
 if (url.pathname.includes('/rpc/')) {
  let body = ''; for await (const chunk of request) body += chunk;
  const args = body ? JSON.parse(body) : {};
  if (name === 'nv_set_doctor_status') {
   statusCalls++; if (delay) await new Promise(resolve => setTimeout(resolve, delay));
   if (failure) return send(failure, failure.code === '42501' ? 403 : 400);
   const previous = doctor.status;
   doctor.status = args.new_status; doctor.updated_at = new Date().toISOString();
   audit.unshift({ id: audit.length + 1, actor_name: actor.name, action: 'profile_updated', changed_fields: ['status'], details: { previous_status: previous, status: doctor.status }, created_at: doctor.updated_at });
   return send(doctor);
  }
  if (name === 'nv_doctor_directory') return send(directoryFixture([doctor],args));
  if (name === 'nv_doctor_rqes') return send({entries:[],legacy:null,revision:'fixture',canEdit:false});
  if (name === 'nv_session_ready') return send(true);
  if (name === 'nv_can_action') return send(true);
  if (name === 'nv_workspace_documents' || name === 'nv_workspace_document_audit') return send([]);
  if (name === 'nv_account_preferences') return send(null);
  if (name === 'nv_doctor_profile') return profileLoadFailure ? send({code:'42501',message:'private SQL error'},403) : send({ profile: doctor, can_read_personal: personalAccess, can_edit: actor.role === 'Diretor', can_approve: false, specialties: [], requested_specialties: [], has_enrollment: false });
  if (name === 'nv_update_doctor_profile') {
   if (args.revision !== doctor.updated_at) return send({code:'22023',message:'O cadastro mudou. Reabra o formulário antes de salvar.'},400);
   profileWrites.push(args.profile); Object.assign(doctor,args.profile,{updated_at:new Date().toISOString()}); return send({});
  }
  if (name === 'nv_doctor_access') return send({ email: 'doctor@example.invalid', status: 'not_released', linked: false, can_manage: true, revision: doctor.updated_at, record_inactive: doctor.status === 'inactive' });
  if (name === 'nv_doctor_portal_role') return send(null);
  if (name === 'nv_doctor_history') return send(audit);
  if (name === 'nv_doctor_banking') return send({ complete: true, can_edit: true, can_history: true, details: { pix_key_type: 'cpf', pix_key: '***', bank: '', agency: '', account_number: '' } });
  if (name === 'nv_master_overview') return send({ rules: [], absences: [], occurrences: [], exceptions: [], overrides: [] });
  return send([]);
 }
 const data = ({ doctors: [doctor], organizations: [org], user_accounts: [actor], units: [], sectors: [], medical_documents: [], document_audit_logs: [], nv_staff_shifts: [] })[name] || [];
 send(request.headers.accept?.includes('vnd.pgrst.object') ? data[0] ?? null : data);
});
await new Promise(resolve => mock.listen(54321, '127.0.0.1', resolve));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|DATABASE|POSTGRES|^PG|^VERCEL|^NVMED_|^NODE_(ENV|OPTIONS)$/i.test(key)));
Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: '', NVMED_ENVIRONMENT: 'development', VERCEL: '0', NEXT_TELEMETRY_DISABLED: '1' });
const log = fs.openSync(new URL('browser-next.log', artifact), 'w');
const app = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...(process.env.NVMED_BROWSER_WEBPACK === '1' ? ['--webpack'] : []), '--hostname', '127.0.0.1', '--port', '3108'], { env, stdio: ['ignore', log, log], windowsHide: true });
let browser;
const checks = [];
try {
 for (let i = 0; ; i++) { try { const r = await fetch('http://127.0.0.1:3108/login'); if (r.status === 200) break; } catch {} if (i > 80) throw Error('Local Next server unavailable'); await new Promise(resolve => setTimeout(resolve, 500)); }
 browser = await chromium.launch({ executablePath: process.env.NVMED_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
 const token = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ sub: id, exp: Math.floor(Date.now()/1000)+3600, iat: Math.floor(Date.now()/1000), role: 'authenticated', aud: 'authenticated' })}.localtest`;
 await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-'+encoded({ access_token: token, refresh_token: 'local-only', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user }), domain: '127.0.0.1', path: '/' }]);
 const page = await context.newPage();
 const dialogs = []; page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await page.goto('http://127.0.0.1:3108/medicos/status-doctor');
 await page.getByRole('heading', { name: doctor.name, exact: true }).waitFor();
 const statusButton = label => page.getByRole('button', { name: label, exact: true });
 await statusButton('Pendente').click(); assert.equal(await page.locator('dialog[open]').count(), 0); checks.push('current status: no dialog');
 await statusButton('Ativo').click();
 await page.getByRole('dialog', { name: 'Ativar cadastro do médico?' }).waitFor();
 assert.match(await page.getByRole('dialog').innerText(), /não libera automaticamente/);
 await page.screenshot({ path: fileURLToPath(new URL('confirmation-light-1440.png', artifact)), animations: 'disabled' });
 await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
 await page.locator('dialog').waitFor({ state: 'detached' }); assert.equal(statusCalls, 0); checks.push('cancel: no backend write');
 await statusButton('Ativo').click(); await page.keyboard.press('Escape'); await page.locator('dialog').waitFor({state:'detached'});
 assert.equal(statusCalls,0); assert.equal(await statusButton('Ativo').evaluate(el=>el===document.activeElement),true); checks.push('Escape: cancels and restores focus');
 for (const [label, confirmLabel, expected, title] of [['Ativo','Ativar cadastro','active','Cadastro do médico ativado com sucesso.'],['Inativo','Inativar cadastro','inactive','Cadastro do médico inativado com sucesso.'],['Ativo','Ativar cadastro','active','Cadastro do médico ativado com sucesso.'],['Pendente','Alterar para pendente','pending','Cadastro do médico alterado para pendente.']]) {
  await statusButton(label).click(); delay = 600;
  const beforeCalls = statusCalls;
  await page.getByRole('dialog').getByRole('button', { name: confirmLabel, exact: true }).dblclick();
  await page.getByRole('dialog').getByRole('button', { name: 'Processando…' }).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: 'Processando…' }).isDisabled(), true);
  await page.locator('dialog').waitFor({ state: 'detached' });
  await page.getByText(title, { exact: true }).waitFor(); assert.equal(doctor.status, expected);
  assert.equal(statusCalls,beforeCalls+1);
  if(expected==='active' && audit.length===1){
   await page.screenshot({path:fileURLToPath(new URL('success-toast-light.png',artifact)),animations:'disabled'});
   await page.locator('[data-sonner-toast][data-type="success"]').getByRole('button',{name:'Dispensar notificação'}).click();
   await page.locator('[data-sonner-toast][data-type="success"]').waitFor({state:'detached'});
   checks.push('success toast: icon, title and dismiss button');
   await page.getByRole('link',{name:'Voltar para listagem',exact:true}).click();
   await page.getByRole('row').filter({hasText:doctor.name}).waitFor();
   assert.match(await page.getByRole('row').filter({hasText:doctor.name}).innerText(),/Ativo/);
   await page.goto('http://127.0.0.1:3108/medicos?status=inactive');
   await page.getByRole('heading',{name:'Médicos',exact:true}).waitFor();
   assert.equal(await page.getByRole('row').filter({hasText:doctor.name}).count(),0);
   checks.push('listing and status filter reflect persisted change');
   await page.goto('http://127.0.0.1:3108/medicos/status-doctor');
  }
  await page.reload(); await page.getByRole('heading', { name: doctor.name, exact: true }).waitFor();
  assert.match(await page.locator('main#conteudo').innerText(), new RegExp(`Cadastro: ${{ active: 'Ativo', pending: 'Pendente', inactive: 'Inativo' }[expected]}`)); checks.push(`${expected}: saved and survives reload`);
 }
 for (const error of [{ code:'22023', message:'Preencha a chave PIX e seu tipo antes de concluir o cadastro.' }, { code:'42501', message:'private database message' }, { code:'XX000', message:'private medical SQL detail' }]) {
  failure = error; await statusButton('Ativo').click(); await page.getByRole('dialog').getByRole('button', { name:'Ativar cadastro', exact:true }).click();
  await page.locator('[data-sonner-toast][data-type="error"]').waitFor();
  assert.equal(doctor.status, 'pending'); assert.ok(!(await page.getByRole('dialog').innerText()).includes('private'));
  if(error.code==='22023')assert.match(await page.getByRole('dialog').innerText(),/Dados bancários/);
  if(error.code==='22023')await page.screenshot({path:fileURLToPath(new URL('business-error-toast.png',artifact)),animations:'disabled'});
  if(error.code==='42501')assert.match(await page.getByRole('dialog').innerText(),/permissão/);
  await page.getByRole('dialog').getByRole('button', { name:'Cancelar', exact:true }).click(); await page.locator('dialog').waitFor({state:'detached'});
  checks.push(`failure ${error.code}: toast, no status change, no raw error`);
 }
 failure = null;
 await page.route('**/rest/v1/rpc/nv_set_doctor_status', route => route.abort('failed'));
 await statusButton('Ativo').click(); await page.getByRole('dialog').getByRole('button', {name:'Ativar cadastro',exact:true}).click();
 await page.locator('[data-sonner-toast][data-type="error"]').waitFor(); assert.equal(doctor.status,'pending');
 await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click(); await page.locator('dialog').waitFor({state:'detached'});
 await page.unroute('**/rest/v1/rpc/nv_set_doctor_status'); checks.push('network failure: visible feedback and previous state');
 for (const width of [390,360]) {
  await page.setViewportSize({width,height:844}); await statusButton('Inativo').click();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth<=el.clientWidth),true);
  await page.screenshot({path:fileURLToPath(new URL(`confirmation-dark-${width}.png`,artifact)),animations:'disabled'});
  await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click(); await page.locator('dialog').waitFor({state:'detached'});
  checks.push(`dark ${width}px: modal fits`);
 }
 actor.role='Jurídico'; await page.reload(); await page.getByRole('heading',{name:doctor.name,exact:true}).waitFor();
 assert.equal(await statusButton('Ativo').isDisabled(),true); checks.push('read-only role: status actions disabled');
 actor.role='Diretor'; personalAccess=true;
 for (const width of [1440,390]) {
  await page.setViewportSize({width,height:900}); await page.reload();
  await page.getByRole('button',{name:'Editar perfil',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'Editar perfil',exact:true});
  await editor.getByLabel('Logradouro',{exact:true}).waitFor();
  assert.equal(await editor.getByLabel('Logradouro',{exact:true}).inputValue(),'');
  assert.equal(await editor.getByLabel('Nome completo',{exact:true}).inputValue(),doctor.name);
  await editor.getByRole('button',{name:'Usar endereço livre',exact:true}).click();
  assert.equal(await editor.locator('textarea[name="address"]').inputValue(),'');
  await page.screenshot({path:fileURLToPath(new URL(`profile-null-address-${width}.png`,artifact)),animations:'disabled'});
  await editor.getByRole('button',{name:'Cancelar',exact:true}).click(); await editor.waitFor({state:'detached'});
  assert.equal(profileWrites.length,0); checks.push(`profile ${width}px: null imported address opens and cancels without mutation`);
 }
 await page.getByRole('button',{name:'Editar perfil',exact:true}).click();
 const editor=page.getByRole('dialog',{name:'Editar perfil',exact:true});
 await editor.getByLabel('Telefone',{exact:true}).fill('11911112222');
 await editor.getByRole('button',{name:'Salvar alterações',exact:true}).click(); await editor.waitFor({state:'detached'});
 assert.equal(profileWrites.length,1); assert.deepEqual(profileWrites[0],{phone:'11911112222'}); assert.equal(doctor.address,null);
 await page.reload(); await page.getByRole('button',{name:'Editar perfil',exact:true}).click();
 await page.getByRole('dialog').getByLabel('Telefone',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').getByLabel('Telefone',{exact:true}).inputValue(),'11911112222');
 await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click(); await page.locator('dialog').waitFor({state:'detached'});
 checks.push('profile: saves changed field and survives reload without replacing null address');
 profileLoadFailure=true; await page.getByRole('button',{name:'Editar perfil',exact:true}).click();
 await page.getByRole('dialog').getByRole('alert').waitFor();
 assert.match(await page.getByRole('dialog').innerText(),/Não foi possível carregar o perfil/);
 assert.ok(!(await page.getByRole('dialog').innerText()).includes('private SQL'));
 await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).click(); await page.locator('dialog').waitFor({state:'detached'});
 checks.push('profile: permission/load failure stays inside modal without exposing raw error');

 assert.equal(dialogs.length,0); assert.deepEqual(errors,[]); checks.push('no native dialogs or browser runtime errors');
 fs.writeFileSync(new URL('browser-results.json',artifact),JSON.stringify({checks,statusCalls,auditCount:audit.length,profileWrites,productionContacted:false},null,2));
 console.log(JSON.stringify({passed:checks.length,checks}));
} finally {
 await browser?.close(); mock.closeAllConnections(); await new Promise(resolve=>mock.close(resolve)); app.kill(); fs.closeSync(log);
}
