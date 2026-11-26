// Browser smoke test against a loopback fixture. It never contacts a Supabase project.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const moduleUrl = process.env.NVMED_PLAYWRIGHT_MODULE || pathToFileURL(join(homedir(), 'AppData/Local/NVMed-Backups/LabTools/nvmed-playwright/node_modules/playwright-core/index.mjs')).href;
const { chromium } = await import(moduleUrl);
const appUrl = 'http://localhost:3137';
const dataUrl = 'http://127.0.0.1:54337';
const actorId = '58000000-0000-4000-8000-000000000001';
const org = { id: 'fixture-org', name: 'Empresa sintética', status: 'active', settings: { specialties: ['Cirurgia'] } };
const doctor = { id: 'fixture-doctor', organization_id: org.id, name: 'Médico de teste', status: 'pending', crm: '1234', crm_uf: 'SP', specialty: 'Cirurgia', linked_units: [] };
const user = { id: actorId, email: 'document@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const profile = { id: 'fixture-staff', auth_user_id: actorId, name: 'Administração sintética', email: user.email, type: 'saas_admin', role: 'CEO', status: 'active' };
let document = { id: 'fixture-crm', doctor_id: doctor.id, organization_id: org.id, type: 'crm', name: 'CRM de teste', status: 'not_sent', version: 1, file_path: null };
const snapshot = { used_bytes: 800_000_000, limit_bytes: 1_000_000_000, files: 881, unknown_sizes: 0, level: 1, reported_savings: 100_000,
  confirmed_savings: 120_000, refreshed_at: '2026-11-26T15:00:00Z', breakdown: [
    { dimension: 'bucket', label: 'medical-documents', key: 'medical-documents', bytes: 800_000_000, files: 881 },
    { dimension: 'company', label: org.name, key: org.id, bytes: 800_000_000, files: 881 },
  ] };
const uploadObjects = new Map();
let uploadRequests = 0;
const notice = { id: 'storage-notice', message: 'Armazenamento em atenção.' };

const api = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', appUrl);
  response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] || '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.end(); return; }
  const send = value => response.end(JSON.stringify(value));
  const url = new URL(request.url, dataUrl);
  const name = url.pathname.split('/').at(-1);
  if (url.pathname === '/auth/v1/user') return send(user);
  const raw = [];
  for await (const chunk of request) raw.push(chunk);
  const body = Buffer.concat(raw);
  if (url.pathname.includes('/rpc/')) {
    const args = body.length ? JSON.parse(body) : {};
    if (name === 'nv_session_ready' || name === 'nv_reserve_document_upload') return send(true);
    if (name === 'nv_storage_usage') return send(args.refresh ? { ...snapshot, used_bytes: 960_000_000, level: 3 } : snapshot);
    if (name === 'nv_portal_notifications') return send([notice]);
    if (name === 'nv_portal_document_target') {
      const target = args.target === document.id ? [{ doctor_id: doctor.id, organization_id: org.id, file_path: document.file_path }] : [];
      return send(target);
    }
    if (name === 'nv_document_delivery_status') return send('not_configured');
    if (name === 'nv_save_portal_document') {
      assert.equal(args.previous_path, document.file_path);
      assert.ok(uploadObjects.has(args.path));
      document = { ...document, file_path: args.path, file_name: args.filename, status: 'sent', version: document.version + 1 };
      return send(true);
    }
    if (name === 'nv_portal_enrollments') return send([{ doctor_id: doctor.id, organization_id: org.id, organization: org.name,
      name: doctor.name, status: 'pending', crm: doctor.crm, uf: doctor.crm_uf, specialties: ['Cirurgia'], legacy_link: false }]);
    if (name === 'nv_portal_documents') return send([{ ...document, has_file: Boolean(document.file_path) }]);
    if (name === 'nv_doctor_banking') return send({ complete: false, can_edit: false, can_history: false, details: {} });
    if (name === 'nv_account_preferences' || name === 'nv_notification_preferences') return send(null);
    return send([]);
  }
  const objectsPath = '/storage/v1/object/medical-documents/';
  if (url.pathname.startsWith(objectsPath) && request.method === 'POST') {
    uploadRequests++;
    const fields = await new Response(body, { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
    const file = [...fields.values()].find(value => value instanceof File);
    const path = url.pathname.slice(objectsPath.length);
    uploadObjects.set(path, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type });
    return send({ Key: `medical-documents/${path}`, Id: 'test' });
  }
  const signPath = '/storage/v1/object/sign/medical-documents/';
  if (url.pathname.startsWith(signPath)) {
    const path = url.pathname.slice(signPath.length);
    if (request.method === 'POST') return send({ signedURL: `/object/sign/medical-documents/${path}?token=synthetic` });
    const object = uploadObjects.get(path);
    if (!object) { response.writeHead(404); return response.end(); }
    response.setHeader('Content-Type', object.type);
    if (url.searchParams.has('download')) response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return response.end(object.bytes);
  }
  const rows = ({ user_accounts: [profile], organizations: [org], doctors: [doctor], medical_documents: [document] })[name] || [];
  return send(request.headers.accept?.includes('vnd.pgrst.object') ? rows[0] ?? null : rows);
});

await new Promise((resolve, reject) => api.listen(54337, '127.0.0.1', resolve).once('error', reject));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|DATABASE|POSTGRES|^PG|^VERCEL|^NVMED_|^NODE_(ENV|OPTIONS)$/i.test(key)));
Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL: dataUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  NVMED_ENVIRONMENT: 'development', VERCEL: '0', NEXT_TELEMETRY_DISABLED: '1' });
const web = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3137'], { env, stdio: 'inherit', windowsHide: true });
let browser;
try {
  for (let attempt = 0;; attempt++) {
    try { if ((await fetch(`${appUrl}/login`, { signal: AbortSignal.timeout(30_000) })).ok) break; } catch { /* The fixture is booting. */ }
    if (attempt > 90 || web.exitCode !== null) throw new Error('Next local indisponível.');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ executablePath: process.env.NVMED_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const claims = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actorId, exp: expires, role: 'authenticated', aud: 'authenticated', session_id: actorId })}`;
  const token = `${claims}.${createHmac('sha256', 'fixture-jwt-signing-key').update(claims).digest('base64url')}`;
  await context.addCookies([{ name: 'sb-127-auth-token', value: 'base64-' + encode({ access_token: token, refresh_token: 'local-only', expires_at: expires, user }), url: appUrl }]);
  const page = await context.newPage();
  page.on('response', async response => {
    if (response.url().includes('/api/portal/documents/') && response.status() >= 400) {
      console.error('Fixture upload:', response.status(), await response.text().catch(() => ''));
    }
  });
  // QR version 1-L, mask 0, with the synthetic payload "NV MED QA".
  const qr = [
    '111111100101101111111', '100000100111001000001', '101110101101101011101', '101110100101001011101',
    '101110100010101011101', '100000100000101000001', '111111101010101111111', '000000001101100000000',
    '111011111111011000100', '001110011110010000000', '001101100010111110011', '001101001100000101011',
    '111100110100101010010', '000000001101010111010', '111111101101011010111', '100000101111110100000',
    '101110101011001110100', '101110100100001100110', '101110101000100111101', '100000101000001000010', '111111101100101110111',
  ];
  const sheet = '<svg width="720" height="460"><rect width="720" height="460" fill="white"/><text x="42" y="92" font-size="14">CRM 00000 SP  RQE 0000  CPF SINTÉTICO</text><rect x="35" y="135" width="610" height="1" fill="#555"/><circle cx="490" cy="240" r="70" stroke="#000" stroke-width="2" fill="none"/>';
  const modules = qr.flatMap((row, y) => [...row].map((bit, x) => bit === '1' ? `<rect x="${48 + x * 3}" y="${200 + y * 3}" width="3" height="3"/>` : '')).join('');
  const png = await sharp(Buffer.from(sheet + modules + '</svg>')).png({ compressionLevel: 0 }).toBuffer();
  await page.goto(`${appUrl}/documentos/${doctor.id}`);
  const input = page.getByLabel(/Selecionar arquivo de CRM de teste/);
  await input.waitFor();
  await input.setInputFiles({ name: 'credencial.png', mimeType: 'image/png', buffer: png });
  const posted = page.waitForResponse(result => result.url().endsWith('/api/portal/documents/fixture-crm') && result.request().method() === 'POST');
  await page.getByRole('button', { name: 'Enviar arquivo', exact: true }).click();
  const response = await posted;
  assert.equal(response.status(), 201, await response.text());
  await page.getByText('Documento enviado com sucesso.').waitFor();
  assert.equal(uploadRequests, 1);
  const first = uploadObjects.get(document.file_path);
  assert.equal(first.type, 'image/webp');
  assert.ok(first.bytes.length < png.length);
  assert.equal((await sharp(first.bytes).metadata()).width, 720);
  const raster = await sharp(first.bytes).raw().toBuffer({ resolveWithObject: true });
  for (const [y, row] of qr.entries()) for (const [x, bit] of [...row].entries()) {
    const pixel = ((201 + y * 3) * raster.info.width + 49 + x * 3) * raster.info.channels;
    assert.equal(raster.data[pixel] < 128, bit === '1');
  }

  await page.getByRole('button', { name: /CRM de teste.*credencial.webp/ }).click();
  await page.getByRole('img', { name: 'CRM de teste' }).waitFor();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click();
  assert.match((await downloaded).suggestedFilename(), /\.webp$/);

  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto(`${appUrl}/portal`);
  await page.getByText('Meus documentos', { exact: true }).click();
  const jpeg = await sharp(Buffer.from(sheet + '</svg>')).jpeg({ quality: 100, chromaSubsampling: '4:4:4' }).toBuffer();
  await input.waitFor();
  await input.setInputFiles({ name: 'crm.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  const uploadButton = page.getByRole('button', { name: 'Enviar nova versão', exact: true });
  await page.route('**/api/portal/documents/fixture-crm', route => route.request().method() === 'POST' ? route.abort() : route.continue(), { times: 1 });
  await uploadButton.click();
  await page.getByText('Não foi possível confirmar o envio. Atualize a pasta antes de tentar novamente.').waitFor();
  assert.equal(uploadRequests, 1);
  await uploadButton.click();
  await page.getByText('Documento enviado com sucesso.').waitFor();
  assert.equal(uploadRequests, 2);
  assert.equal(uploadObjects.get(document.file_path).type, 'image/webp');

  await input.setInputFiles({ name: 'original.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await page.getByRole('checkbox', { name: 'Manter arquivo original' }).check();
  await uploadButton.click();
  await uploadButton.waitFor({ state: 'hidden' });
  assert.equal(uploadRequests, 3);
  assert.deepEqual(uploadObjects.get(document.file_path).bytes, jpeg);

  await input.setInputFiles({ name: 'existente.webp', mimeType: 'image/webp', buffer: first.bytes });
  await uploadButton.click();
  await uploadButton.waitFor({ state: 'hidden' });
  assert.equal(uploadRequests, 4);
  assert.deepEqual(uploadObjects.get(document.file_path).bytes, first.bytes);

  await page.goto(`${appUrl}/admin#armazenamento`);
  await page.getByText('800 MB', { exact: false }).first().waitFor();
  await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
  await page.getByText('Crítico', { exact: true }).waitFor();
  await page.getByRole('button', { name: '1 notificação não lida' }).click();
  await page.getByText(notice.message, { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 820 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await page.evaluate(() => globalThis.document.documentElement.classList.add('dark'));
  assert.equal(await page.getByRole('progressbar', { name: 'Ocupação do armazenamento' }).isVisible(), true);
  console.log('PASS: JPG/PNG WebP, preservação de original e WebP existente, administrativo, Portal, substituição, retry, prévia/download e painel SaaS em 1440/390/360 px.');
} finally {
  await browser?.close();
  web.kill();
  api.closeAllConnections();
  api.close();
}
