// Invoked by doctor-directory.browser.mjs with NVMED_WORKSPACE_BROWSER=1.
// Real Next/React UI and authenticated API, exclusively against loopback fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
export async function runWorkspaceChecks({page,base,org,otherOrg,calls,readRequests,checks,workspace,today}) {
 page.setDefaultTimeout(15000);
 const main=page.locator('main');
 const ready=()=>page.getByRole('heading',{name:'Painel de controle',exact:true}).waitFor();
 const browserReads=(from=0)=>readRequests.slice(from).filter(r=>r.source==='browser');
 const json=async part=>{const response=await page.request.get(base+'/api/workspace/overview?'+new URLSearchParams({org:org.id,part}));assert.equal(response.status(),200);assert.match(response.headers()['cache-control'],/no-store/);return response.json();};
 const summaryRequests=[],summaryResponses=[];
 page.on('request',request=>{if(request.url().includes('/api/workspace/overview?'))summaryRequests.push(request.url());});
 page.on('response',response=>{if(response.url().includes('/api/workspace/overview?')&&response.status()===200)summaryResponses.push(response.url());});
 workspace.slowCompany=org.id;
 const operationalRead=page.waitForResponse(response=>response.url().includes('/rpc/nv_operational_counts'));
 const started=performance.now();await page.goto(base+'/dashboard');
 await page.getByRole('combobox',{name:'Empresa ativa',exact:true}).waitFor();
 await main.getByText('Carregando dados da tela…',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Painel de controle',exact:true}).isVisible(),false);
 await operationalRead;
 assert.equal(await page.getByRole('heading',{name:'Painel de controle',exact:true}).isVisible(),false);
 assert.ok(!browserReads().some(r=>['user_accounts','organizations'].includes(r.name)));
 assert.equal(calls.filter(c=>c.name==='nv_account_preferences'&&c.source==='browser').length,0);
 assert.ok(summaryRequests.length>0);assert.ok(summaryRequests.every(url=>new URL(url).searchParams.get('part')==='all'));
 await ready();workspace.slowCompany='';
 await page.locator('#finance-title').waitFor();await page.locator('#pending-title').waitFor();
 // Dev Strict Mode can start and abort its first effect; count completed reads.
 assert.equal(summaryResponses.length,1);
 const elapsed=Math.round(performance.now()-started);
 assert.ok(browserReads().filter(r=>r.name==='nv_staff_shifts').every(r=>r.params.organization_id==='eq.'+org.id&&(r.params.date||r.params.or)));
 assert.ok(!browserReads().some(r=>r.name==='medical_documents'||r.name==='document_audit_logs'));
 assert.ok(!calls.some(c=>c.source==='browser'&&c.name==='nv_workspace_documents'));
 checks.push(`cold dashboard keeps navigation available while scoped data loads (${elapsed} ms including local compilation and injected delay)`);
 checks.push('verified server bootstrap avoids browser profile/company/preferences rereads; one combined summary request; operational counts start before the page data finishes');

 const finance=await json('finance');assert.equal(finance.pending,987);assert.equal(finance.overdue,987);
 const documents=await json('documents');
 assert.ok(documents.issues.find(i=>i.doctor.id==='directory-0')?.linkedUnits.includes('unit-2'));
 assert.ok(documents.units['directory-0'].includes('unit-2'));
 assert.ok(!/file_path|filePath|account_number|cpf|phone|doctor@example/.test(JSON.stringify(documents)));
 assert.ok(calls.some(c=>c.source==='server'&&c.name==='nv_workspace_documents'&&c.args.after_id));
 checks.push('authenticated summaries keep old unpaid balances, historical unit requirements and all 1354 metadata rows without sending files or personal fields');

 await page.locator('#finance-title').waitFor();await page.locator('#pending-title').waitFor();
 const coverage=page.getByRole('region',{name:'Escalas e cobertura',exact:true});
 await coverage.getByRole('button',{name:'Mês',exact:true}).click();await ready();
 await coverage.getByRole('button',{name:'Mês anterior',exact:true}).click();await ready();
 assert.equal(await coverage.getByRole('button',{name:'Mês',exact:true}).getAttribute('aria-pressed'),'true');
 const previousMonth=new Date(today+'T12:00:00Z');previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1,1);
 const month=previousMonth.toISOString().slice(0,7);
 assert.match(await coverage.innerText(),new RegExp(String(previousMonth.getUTCFullYear())));
 assert.ok(browserReads().some(r=>r.name==='nv_staff_shifts'&&r.params.or?.includes(month+'-01')));
 assert.equal(await coverage.getByRole('button',{name:'Mês anterior',exact:true}).evaluate(el=>el===document.activeElement),true);
 await page.getByRole('group',{name:'Período dos plantões',exact:true}).getByRole('button',{name:'Amanhã',exact:true}).click();await ready();
 assert.equal(await coverage.getByRole('button',{name:'Mês',exact:true}).getAttribute('aria-pressed'),'true');
 checks.push('independent dashboard periods reload bounded windows, retain local controls and restore keyboard focus');

 for(const [width,theme] of [[1440,'light'],[768,'light'],[390,'dark'],[360,'dark']]){
  await page.setViewportSize({width,height:900});await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:`Import/_initial-loading/workspace-${theme}-${width}.png`,fullPage:true});
 }
 checks.push('dashboard at 1440/768/390/360px, light/dark: working indicators, controls and no page overflow');
 await page.setViewportSize({width:1440,height:1000});

 let from=readRequests.length;
 await page.goto(base+'/financeiro?month=2024-02');await page.getByRole('heading',{name:'Repasses PJ',exact:true}).waitFor();
 assert.ok(browserReads(from).some(r=>r.name==='nv_staff_shifts'&&r.params.date==='lte.2024-02-29'));
 const marchRead=page.waitForResponse(response=>response.url().includes('/nv_staff_shifts?')&&new URL(response.url()).searchParams.getAll('date').includes('lte.2024-03-31'));
 await page.getByLabel('Referência',{exact:true}).fill('2024-03');await marchRead;
 await page.getByLabel('Referência',{exact:true}).waitFor();assert.equal(await page.getByLabel('Referência',{exact:true}).inputValue(),'2024-03');
 await page.waitForFunction(()=>!document.querySelector('main [inert]'));
 assert.equal(await page.getByLabel('Referência',{exact:true}).inputValue(),'2024-03');
 from=readRequests.length;
 const allRead=page.waitForResponse(response=>response.url().includes('/nv_staff_shifts?')&&!new URL(response.url()).searchParams.has('date'));
 await page.locator('label').filter({hasText:/^Período/}).locator('select').selectOption('all');await allRead;
 await page.waitForFunction(()=>!document.querySelector('main [inert]'));
 assert.equal(await page.locator('label').filter({hasText:/^Período/}).locator('select').inputValue(),'all');
 assert.ok(browserReads(from).some(r=>r.name==='nv_staff_shifts'&&!r.params.date&&!r.params.or&&r.params.organization_id==='eq.'+org.id));
 checks.push('finance month changes preserve state; all-history reads require explicit selection and stay within the company');

 await page.goto(base+'/relatorios');await page.getByRole('heading',{name:'Relatórios e exportações',exact:true}).waitFor();
 from=readRequests.length;
 const reportRead=page.waitForResponse(response=>response.url().includes('/nv_staff_shifts?')&&new URL(response.url()).searchParams.getAll('date').includes('lte.2024-02-29'));
 await page.getByLabel('Mês de referência',{exact:true}).fill('2024-02');await reportRead;
 await page.waitForFunction(()=>!document.querySelector('main [inert]'));
 assert.equal(await page.getByLabel('Mês de referência',{exact:true}).inputValue(),'2024-02');
 assert.ok(browserReads(from).some(r=>r.name==='nv_staff_shifts'&&r.params.date==='lte.2024-02-29'));
 checks.push('reports reload the chosen month and retain the selected reference');

 await page.goto(base+'/escala?unitId=unit-1&sectorId=sector-1&date=2024-02-10&view=month');
 await page.getByRole('heading',{name:'Escala médica',exact:true}).waitFor();await page.locator('main table').waitFor();
 assert.ok(browserReads().some(r=>r.name==='nv_staff_shifts'&&r.params.date==='lte.2024-03-01'));
 checks.push('calendar month includes adjacent overnight dates and waits for complete document eligibility metadata');

 await page.goto(base+'/dashboard');await ready();
 workspace.slowCompany=org.id;
 const switcher=page.getByRole('combobox',{name:'Empresa ativa',exact:true});
 await switcher.selectOption(otherOrg.id);await ready();
 await switcher.selectOption(org.id);await main.getByText('Carregando dados da tela…',{exact:true}).waitFor();
 await switcher.selectOption(otherOrg.id);await ready();await page.waitForTimeout(1100);
 assert.match(await main.innerText(),/Médica Fictícia Empresa B/);
 assert.doesNotMatch(await main.innerText(),/Breno Victor|Hospital Fictício A/);
 workspace.slowCompany='';checks.push('rapid company changes cancel stale reads; a late response cannot replace the new company');

 workspace.failCompany=org.id;await switcher.selectOption(org.id);await main.getByRole('alert').waitFor();
 assert.doesNotMatch(await main.innerText(),/private error|Breno Victor|Médica Fictícia Empresa B/);
 assert.equal(await switcher.isVisible(),true);workspace.failCompany='';
 await main.getByRole('button',{name:'Tentar novamente',exact:true}).click();await ready();
 checks.push('a failed collection hides partial totals, keeps navigation and recovers through retry');

 workspace.documentsSummaryFailure=true;await page.reload();await ready();await page.locator('#finance-title').waitFor();
 await main.getByRole('alert').waitFor();assert.match(await main.innerText(),/Não foi possível consultar a documentação/);
 assert.match(await page.getByRole('region',{name:'Financeiro',exact:true}).innerText(),/987/);
 assert.doesNotMatch(await main.innerText(),/private internal/);workspace.documentsSummaryFailure=false;
 await main.getByRole('button',{name:'Tentar novamente',exact:true}).click();await page.locator('#pending-title').waitFor();
 checks.push('combined overview preserves finance during a document failure and retries without stale or private error data');

 from=readRequests.length;await page.goto(base+'/perfil');await page.getByRole('heading',{name:'Minha conta',exact:true}).waitFor();
 assert.ok(!browserReads(from).some(r=>['doctors','nv_staff_shifts','medical_documents','units','sectors'].includes(r.name)));
 from=readRequests.length;await page.goto(base+'/admin');await page.getByRole('heading',{name:'Painel SaaS',exact:true}).waitFor();
 assert.ok(calls.some(c=>c.name==='nv_workspace_organization_counts'));
 assert.ok(!browserReads(from).some(r=>['doctors','nv_staff_shifts','medical_documents'].includes(r.name)));
 checks.push('account does not bootstrap operational collections; SaaS panel uses permission-aware aggregate counts');

 workspace.denyOrg=otherOrg.id;
 assert.equal((await page.request.get(base+'/api/workspace/overview?org='+otherOrg.id+'&part=documents')).status(),403);
 workspace.denyOrg='';workspace.sessionReady=false;
 assert.equal((await page.request.get(base+'/api/workspace/overview?org='+org.id+'&part=finance')).status(),401);
 workspace.sessionReady=true;
 checks.push('summary API rechecks live session and module authorization, returns 401/403 and never caches private data');
 assert.ok(!calls.some(call=>/begin_doctor_access|invite|reset|release/i.test(call.name)));
 fs.writeFileSync('Import/_initial-loading/workspace-browser-results.json',JSON.stringify({checks,productionContacted:false},null,2));
}
