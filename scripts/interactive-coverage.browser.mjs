// Runs the real Next.js UI against a loopback-only fixture. PostgreSQL is covered separately.
import assert from 'node:assert/strict';
import { mkdir, open, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { calculateFractionalCoverage, coveragePlanInterval } from '../src/lib/fractionalCoverage.ts';
import { coverageClock, coverageLocalDate } from '../src/lib/coverageDraft.ts';

const require = createRequire(import.meta.url);
const moduleUrl = process.env.NVMED_PLAYWRIGHT_MODULE || pathToFileURL(path.join(homedir(), 'AppData/Local/NVMed-Backups/LabTools/nvmed-playwright/node_modules/playwright-core/index.mjs')).href;
const { chromium } = await import(moduleUrl);
const output = path.resolve(process.env.NVMED_COVERAGE_ARTIFACTS || 'Import/_interactive-coverage');
const pageUrl = 'http://127.0.0.1:3119';
const dataUrl = 'http://127.0.0.1:54329';
const zone = 'America/Sao_Paulo';
const day = coverageLocalDate(Date.now() + 90 * 86_400_000, zone);
const nextDay = coverageLocalDate(Date.parse(`${day}T12:00:00Z`) + 86_400_000, zone);
const actorId = '55000000-0000-4000-8000-000000000001';
const org = { id: 'fixture-org', name: 'Empresa de homologação', status: 'active', settings: { specialties: ['Cirurgia'] } };
const user = { id: actorId, email: 'coverage@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
const staff = { id: 'staff', auth_user_id: actorId, name: 'Coordenação de plantões', email: user.email, type: 'tenant_user', organization_id: org.id, role: 'Diretor', status: 'active', additional_permissions: {} };
const unit = { id: 'fixture-unit', organization_id: org.id, name: 'Hospital de homologação', status: 'active', type: 'hospital', time_zone: zone, specialties: ['Cirurgia'] };
const sector = { id: 'fixture-sector', organization_id: org.id, unit_id: unit.id, name: 'Cirurgia geral', status: 'active', primary_specialty: 'Cirurgia', specialties: ['Cirurgia'], required_doctors: 1, default_start_time: '07:00', default_end_time: '19:00',
  coverage_periods: [{kind:'day',startTime:'07:00',endTime:'19:00',requiredDoctors:1},{kind:'night',startTime:'19:00',endTime:'07:00',requiredDoctors:1}] };
const doctors = [ ['ana','Dra. Ana Ribeiro'], ['bruno','Dr. Bruno Reis'], ['clara','Dra. Clara Melo'] ].map(([id,name]) => ({ id,name,organization_id:org.id,crm:'1234',crm_uf:'SP',specialty:'Cirurgia',status:'active',linked_units:[unit.id] }));
const part = (id, start, end, doctor, extras = {}) => ({ id, doctor_id: doctor || null, date: day, start_time: start, end_time: end, status: doctor ? 'pending' : 'open',
  approval_source: 'pending', approval_revision: 0, organization_id: org.id, unit_id: unit.id, sector_id: sector.id, specialty: 'Cirurgia', type: 'onsite',
  coverage_mode: 'regular', employment_type: 'clt', payment_status: 'pending', payment_frequency: 'on_delivery', ...extras });
function span(row) { return coveragePlanInterval({date:row.date,startTime:row.start_time,endTime:row.end_time},zone); }
function withPost(row, id, revision, plan) {
  const scheduled = span(plan), segment = span(row);
  return { ...row, approval_ended_at: new Date(segment.end).toISOString(), coverage_post: {
    id, revision, date: plan.date, startTime: plan.start_time, endTime: plan.end_time, capacity: plan.capacity, timeZone: zone, published: false,
    startsAt: new Date(scheduled.start).toISOString(), endsAt: new Date(scheduled.end).toISOString(),
    segmentStartsAt: new Date(segment.start).toISOString(), segmentEndsAt: new Date(segment.end).toISOString(),
    segmentDate: row.date, segmentStartTime: row.start_time, segmentEndTime: row.end_time,
  } };
}
const plan = {date:day,start_time:'07:00',end_time:'19:00',capacity:1};
let rows = [];
let writes = [];
let excludedClock = '';
function seed(parts, planned = plan, id = 'post', linked = true) {
  rows = parts.map(row => linked ? withPost(row,id,1,planned) : row);
  writes = [];
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', pageUrl);
  response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.end(); return; }
  const send = value => response.end(JSON.stringify(value));
  const url = new URL(request.url, dataUrl);
  const name = url.pathname.split('/').at(-1);
  if (url.pathname === '/auth/v1/user') return send(user);
  if (url.pathname.startsWith('/auth/')) return send({ factors: [], all: [], totp: [], data: user });
  if (url.pathname.includes('/rpc/')) {
    let body = '';
    for await (const chunk of request) body += chunk;
    const args = body ? JSON.parse(body) : {};
    if (name === 'nv_eligible_shift_doctors') return send(doctors.filter(x => x.id !== 'ana' || args.candidate.start_time !== excludedClock).map(x => x.id));
    if (name === 'nv_session_ready') return send(true);
    if (name === 'nv_account_preferences') return send(null);
    if (name === 'nv_save_coverage_draft') {
      writes.push(args);
      const post = rows.find(r => r.id === args.anchor.id)?.coverage_post;
      const id = post?.id || args.anchor.id;
      const revision = (post?.revision || 0) + 1;
      const updated = new Map(rows.map(row => [row.id,row]));
      args.records.forEach(row => updated.set(row.id, {...updated.get(row.id),...row}));
      const allocations = [...updated.values()].filter(row => row.doctor_id && row.status !== 'cancelled');
      const totals = calculateFractionalCoverage(span(args.planned),args.planned.capacity,allocations.map(span));
      assert.ok(totals);
      const gaps = totals.gaps.map((gap,index) => part(`gap-${revision}-${index}`,coverageClock(gap.start,zone),coverageClock(gap.end,zone),null,{date:coverageLocalDate(gap.start,zone)}));
      const saved = [...allocations,...gaps,...[...updated.values()].filter(row => row.status==='cancelled')];
      rows = saved.map(row => withPost(row,id,revision,args.planned));
      return send(rows);
    }
    return send([]);
  }
  const data = ({ organizations:[org], user_accounts:[staff], doctors, units:[unit], sectors:[sector], nv_staff_shifts:rows })[name] || [];
  return send(request.headers.accept?.includes('vnd.pgrst.object') ? data[0] ?? null : data);
});

await mkdir(output,{recursive:true});
await new Promise((resolve,reject) => server.listen(54329,'127.0.0.1',resolve).once('error',reject));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SUPABASE|DATABASE|POSTGRES|^PG|^VERCEL|^NVMED_|^NODE_(ENV|OPTIONS)$/i.test(key)));
Object.assign(env, { NEXT_PUBLIC_SUPABASE_URL:dataUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture', SUPABASE_SERVICE_ROLE_KEY:'', NVMED_ENVIRONMENT:'development', VERCEL:'0', NEXT_TELEMETRY_DISABLED:'1' });
const log = await open(path.join(output,'next.log'),'w');
const web = spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3119'],{env,stdio:['ignore',log.fd,log.fd],windowsHide:true});
const checks = [];
let browser;
try {
  for (let i=0;;i++) {
    try { if ((await fetch(`${pageUrl}/login`)).ok) break; } catch { /* wait for Next */ }
    if (i>100 || web.exitCode !== null) throw new Error('Next local indisponível. Consulte next.log.');
    await new Promise(resolve => setTimeout(resolve,500));
  }
  browser = await chromium.launch({executablePath:process.env.NVMED_BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expires = Math.floor(Date.now()/1000)+3600;
  const token = `${encoded({alg:'HS256',typ:'JWT'})}.${encoded({sub:actorId,exp:expires,role:'authenticated',aud:'authenticated'})}.localtest`;
  await context.addCookies([{name:'sb-127-auth-token',value:'base64-'+encoded({access_token:token,refresh_token:'local-only',token_type:'bearer',expires_at:expires,user}),domain:'127.0.0.1',path:'/'}]);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => process.stderr.write(`${error.message}\n`));
  const native = [];
  page.on('dialog', dialog => { native.push(dialog.type()); void dialog.dismiss(); });
  const panel = page.getByRole('region',{name:'Cobertura do posto'});
  const bar = panel.getByLabel('Barra de cobertura');
  const intervals = panel.getByRole('list',{name:'Intervalos do posto'});
  const form = page.locator('#shift-entry-form');
  const button = (name) => form.getByRole('button',{name,exact:true});
  const add = () => panel.getByRole('button',{name:'Adicionar médico',exact:true}).click();
  const doctorField = form.getByRole('combobox',{name:/^Médico(?! do segundo)/});
  const location = `${pageUrl}/escala?view=list&date=${day}&unitId=${unit.id}&sectorId=${sector.id}`;
  const capture = name => page.screenshot({path:path.join(output,`${name}.png`),animations:'disabled'});
  async function openRow(index=0, vacancy=false) {
    await page.getByRole('button',{name:vacancy?'Preencher':'Ver ficha',exact:true}).nth(index).click();
    await panel.waitFor();
  }
  async function load() {
    await page.goto(location, {waitUntil:'commit'}).catch(error => {
      if (!error.message.includes('net::ERR_ABORTED')) throw error;
      return page.goto(location, {waitUntil:'commit'});
    });
    await page.getByRole('heading',{name:'Escala médica'}).waitFor();
    await page.getByRole('button',{name:/Edição bloqueada/}).click();
    await page.getByRole('button',{name:'Confirmar desbloqueio',exact:true}).click();
  }
  async function selectDoctor(label, value) {
    const select = label === 'Médico' ? doctorField : form.getByRole('combobox',{name:new RegExp(`^${label}`)});
    await select.locator(`option[value="${value}"]`).waitFor({state:'attached'});
    await select.selectOption(value);
  }
  async function save() {
    await page.getByRole('button',{name:'Salvar plantão',exact:true}).click();
    await page.locator('dialog').waitFor({state:'detached'});
  }

  seed([part('vacancy','07:00','10:00',null,{employment_type:null}),part('primary','10:00','19:00','ana',
    {status:'confirmed',approval_source:'manual',approval_revision:3,notes:'Registro sintético preservado'})]);
  const original = rows.find(row => row.id === 'primary');
  const withoutPost = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'coverage_post'));
  await load(); await openRow();
  await capture('01-painel-interativo');
  await bar.getByRole('button',{name:/Ana Ribeiro, 10:00–19:00/}).click();
  assert.equal(await doctorField.inputValue(),'ana');
  assert.equal(await form.getByLabel('Início do médico').inputValue(),'10:00');
  assert.equal(await form.getByLabel('Fim do médico').inputValue(),'19:00');
  assert.equal(await form.getByLabel('Data',{exact:true}).inputValue(),day);
  await capture('03-alocacao-verde');
  await bar.getByRole('button',{name:'Vaga aberta, 07:00–10:00',exact:true}).click();
  assert.equal(await doctorField.inputValue(),'');
  assert.equal(await form.getByLabel('Início da vaga').inputValue(),'07:00');
  assert.equal(await form.getByLabel('Fim da vaga').inputValue(),'10:00');
  await capture('02-vaga-vermelha');
  await selectDoctor('Médico','bruno');
  await intervals.getByRole('button',{name:/Bruno Reis.*07:00–10:00/}).waitFor();
  assert.equal(await panel.getByText('12h',{exact:true}).count(),2);
  assert.equal(await bar.getByRole('button',{name:/Vaga aberta/}).count(),0);
  await intervals.getByRole('button',{name:/Ana Ribeiro.*10:00–19:00/}).click();
  assert.equal(await doctorField.inputValue(),'ana');
  assert.equal(await form.getByLabel('Início do médico').inputValue(),'10:00');
  await selectDoctor('Médico','clara');
  await selectDoctor('Médico','ana');
  await intervals.getByRole('button',{name:/Bruno Reis.*07:00–10:00/}).click();
  assert.equal(await doctorField.inputValue(),'bruno');
  assert.equal(await form.getByLabel('Fim do médico').inputValue(),'10:00');
  assert.equal(writes.length,0);
  await capture('06-dois-medicos');
  await save();
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].records.map(r=>[r.id,r.start_time,r.end_time,r.doctor_id]),[['vacancy','07:00','10:00','bruno']]);
  assert.deepEqual(withoutPost(rows.find(row => row.id === 'primary')),withoutPost(original));
  assert.equal(await page.getByRole('button',{name:'Ver ficha',exact:true}).count(),2);
  await capture('04-escala-geral');
  await openRow();
  await intervals.getByRole('button',{name:/Ana Ribeiro.*10:00–19:00/}).click();
  assert.equal(await doctorField.inputValue(),'ana');
  await intervals.getByRole('button',{name:/Bruno Reis.*07:00–10:00/}).click();
  assert.equal(await doctorField.inputValue(),'bruno');
  checks.push('vaga 07:00–10:00, campos contextuais, alternância, gravação somente da vaga e reabertura com a alocação original intacta');

  seed([part('vacancy','07:00','08:00'),part('primary','08:00','19:00','ana')]);
  await load(); await openRow();
  await bar.getByRole('button',{name:'Vaga aberta, 07:00–08:00',exact:true}).click();
  await selectDoctor('Médico','bruno');
  await bar.getByRole('button',{name:/Ana Ribeiro, 08:00–19:00/}).click();
  await selectDoctor('Médico','clara');
  await save();
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].records.map(r=>[r.start_time,r.end_time,r.doctor_id]).sort(),[['07:00','08:00','bruno'],['08:00','19:00','clara']]);
  checks.push('vaga de uma hora e substituição com o mesmo horário em uma operação');

  seed([part('primary','07:00','19:00','ana')],plan,'post',false);
  await load(); await openRow();
  await bar.getByRole('button',{name:/Ana Ribeiro, 07:00–19:00/}).click();
  assert.equal(await doctorField.inputValue(),'ana');
  await button('Dividir plantão').click();
  const secondDoctor = form.getByRole('combobox',{name:/^Médico do segundo intervalo/});
  await secondDoctor.locator('option[value="bruno"]').waitFor({state:'attached'});
  assert.equal(await secondDoctor.inputValue(),'');
  await button('Aplicar divisão').click();
  await intervals.getByRole('button',{name:/Ana Ribeiro.*07:00–13:00/}).waitFor();
  await intervals.getByRole('button',{name:/Vaga aberta.*13:00–19:00/}).waitFor();
  assert.equal(writes.length,0);
  await save();
  assert.deepEqual(writes[0].records.map(row=>[row.start_time,row.end_time,row.doctor_id]),[['07:00','13:00','ana']]);
  assert.equal(rows.filter(row=>row.status==='open' && row.start_time==='13:00' && row.end_time==='19:00' && row.doctor_id===null).length,1);
  checks.push('divisão sem seleção mantém o médico no primeiro trecho e cria vaga no segundo');

  seed([part('primary','07:00','19:00','ana')],plan,'post',false);
  await load(); await openRow(); await add();
  await form.getByRole('heading',{name:'Dividir plantão',exact:true}).waitFor();
  assert.equal(await form.getByLabel('Horário da divisão').inputValue(),'13:00');
  assert.equal(await secondDoctor.inputValue(),'');
  await selectDoctor('Médico do segundo intervalo','bruno');
  await capture('05-divisao-rapida');
  await button('Aplicar divisão').click();
  await intervals.getByRole('button',{name:/Bruno Reis.*13:00–19:00/}).waitFor();
  await save();
  assert.deepEqual(writes[0].records.map(r=>[r.start_time,r.end_time,r.doctor_id]),[['07:00','13:00','ana'],['13:00','19:00','bruno']]);
  checks.push('divisão de 12 horas e inclusão sem redução manual');

  seed([part('primary','07:00','10:00','ana'),part('vacancy','10:00','13:00')],{...plan,end_time:'13:00'});
  await load(); await openRow(); await add();
  await form.getByLabel('Início da vaga').fill('10:45');
  await form.getByLabel('Fim da vaga').fill('12:15');
  await selectDoctor('Médico','bruno');
  await intervals.getByRole('button',{name:/Vaga aberta.*10:00–10:45/}).waitFor();
  await intervals.getByRole('button',{name:/Vaga aberta.*12:15–13:00/}).waitFor();
  await intervals.getByRole('button',{name:/Ana Ribeiro/}).focus(); await page.keyboard.press('Enter');
  await button('Remover alocação').click();
  await intervals.getByRole('button',{name:/Vaga aberta.*07:00–10:45/}).waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  const discard = page.getByRole('dialog',{name:'Alterações não salvas',exact:true});
  await discard.getByRole('button',{name:'Descartar e bloquear',exact:true}).click();
  assert.equal(writes.length,0);
  assert.equal(rows[0].doctor_id,'ana');
  assert.equal(rows[1].start_time,'10:00');
  assert.deepEqual(native,[]);
  checks.push('vaga parcial, posto de seis horas, lista por teclado, remoção e descarte sem gravação');

  seed([part('primary','19:00','07:00','ana')],{...plan,start_time:'19:00',end_time:'07:00'});
  await load(); await openRow(); await add();
  assert.equal(await form.getByLabel('Horário da divisão').inputValue(),'01:00');
  await selectDoctor('Médico do segundo intervalo','clara'); await button('Aplicar divisão').click();
  await page.setViewportSize({width:390,height:844});
  await panel.getByRole('heading',{name:'Cobertura do posto'}).scrollIntoViewIfNeeded();
  assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await capture('07-noturno-mobile-390');
  await page.setViewportSize({width:360,height:800});
  await panel.getByRole('heading',{name:'Cobertura do posto'}).scrollIntoViewIfNeeded();
  assert.equal(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await capture('08-noturno-mobile-360');
  await page.setViewportSize({width:1440,height:1000}); await save();
  assert.equal(writes[0].records.find(row=>row.doctor_id==='clara').date,nextDay);
  checks.push('noite atravessa meia-noite e se mantém utilizável em 390 e 360 px');

  seed([part('primary','07:00','13:00','ana'),part('second','13:00','19:00','bruno')]);
  await load(); await openRow();
  await bar.getByRole('button',{name:/Ana Ribeiro/}).click();
  excludedClock='08:00';
  await form.getByLabel('Início do médico').fill('08:00');
  await form.getByText(/médico selecionado não está elegível/).waitFor();
  await form.getByLabel('Início do médico').fill('07:00');
  await form.getByText(/médico selecionado não está elegível/).waitFor({state:'hidden'});
  await form.getByLabel('Fim do médico').fill('14:00');
  await form.getByRole('status').filter({hasText:'capacidade contratada'}).waitFor();
  await page.getByRole('button',{name:'Salvar plantão',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'capacidade contratada'}).waitFor();
  assert.equal(writes.length,0);
  checks.push('elegibilidade após mudança de horário, limpeza do aviso e bloqueio de sobreposição');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Descartar e bloquear',exact:true}).click();
  await page.getByRole('button',{name:/Edição bloqueada/}).waitFor();

  seed([part('primary','07:00','19:00','ana'),part('vacancy','07:00','19:00')],{...plan,capacity:2});
  await load(); await openRow(); await add();
  await selectDoctor('Médico','bruno');
  assert.equal(await panel.getByText('24h',{exact:true}).count(),2);
  await save();
  assert.equal(writes[0].planned.capacity,2);
  assert.equal(writes[0].records.length,1);
  checks.push('preenchimento da capacidade simultânea sem aumentar a capacidade');

  seed([part('primary','07:00','13:00','ana',{payment_status:'paid'}),part('second','13:00','19:00','bruno')]);
  await load(); await openRow();
  await bar.getByRole('button',{name:/Ana Ribeiro/}).click();
  await form.getByText(/fluxo financeiro.*pagamento registrado/).waitFor();
  assert.equal(await doctorField.isDisabled(),true);
  await bar.getByRole('button',{name:/Bruno Reis/}).click();
  await button('Remover alocação').click(); await save();
  assert.equal(writes[0].records.length,1);
  assert.equal(writes[0].records[0].id,'second');
  await page.getByRole('button',{name:'Preencher',exact:true}).first().waitFor();
  await capture('09-vaga-individual-na-escala');
  await openRow(0,true);
  await intervals.getByRole('button',{name:/Ana Ribeiro.*07:00–13:00/}).waitFor();
  await intervals.getByRole('button',{name:/Vaga aberta.*13:00–19:00/}).waitFor();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await openRow();
  await bar.getByRole('button',{name:/Ana Ribeiro/}).click();
  await form.getByText(/fluxo financeiro.*pagamento registrado/).waitFor();
  await intervals.getByRole('button',{name:/Vaga aberta.*13:00–19:00/}).click();
  assert.equal(await doctorField.inputValue(),'');
  await selectDoctor('Médico','clara');
  await save();
  assert.equal(writes.length,2);
  assert.deepEqual(writes[1].records.map(r=>[r.start_time,r.end_time,r.doctor_id]),[['13:00','19:00','clara']]);
  assert.equal(rows.find(row=>row.id==='primary').payment_status,'paid');
  checks.push('alocação paga mantém a restrição, remoção cria vaga individual e a ficha da vaga permite preenchê-la');

  await writeFile(path.join(output,'checks.json'),JSON.stringify(checks,null,2));
  process.stdout.write(`${checks.length} fluxos no navegador verificados.\n`);
} finally {
  await browser?.close();
  web.kill();
  await log.close();
  await new Promise(resolve => server.close(resolve));
}
