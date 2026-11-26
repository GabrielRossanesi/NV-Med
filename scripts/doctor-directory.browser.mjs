// Local Next UI + synthetic loopback API. Never uses production credentials or data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { directoryFixture } from './fixtures/doctor-directory.mjs';
import { parseDirectoryQuery } from '../src/lib/doctorDirectory.ts';
const require=createRequire(import.meta.url);
const { chromium }=await import(process.env.NVMED_PLAYWRIGHT_MODULE || pathToFileURL(path.join(homedir(),'AppData/Local/NVMed-Backups/LabTools/nvmed-playwright/node_modules/playwright-core/index.mjs')).href);
const artifact=new URL('../Import/_doctor-directory/',import.meta.url);fs.mkdirSync(artifact,{recursive:true});
const base='http://localhost:3120',api='http://127.0.0.1:54327';
const id='59000000-0000-4000-8000-000000000001';
const user={id,email:'directory-test@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},identities:[],created_at:'2026-01-01T00:00:00Z'};
const actor={id:'directory-admin',auth_user_id:id,name:'Administrativo fictício',email:user.email,type:'tenant_user',organization_id:'directory-org',role:'Diretor',status:'active',additional_permissions:{},created_at:user.created_at};
const org={id:'directory-org',name:'Corpo clínico fictício',status:'active',settings:{specialties:['Cirurgia','Pediatria'],requiredDocuments:[]}};
const names=['Breno Victor Brandão Almeida','Jair Morais de Paula','Cassio Humberto Rocha Solidade','Osvaldo de Lima','Aline Machado Cunha',' Dr. breno Victor ','Dra. aline Machado','Dr Jair Morais','Dra Osvalda Lima','','---','éRICA Souza',...Array.from({length:80},(_,i)=>`Zeno Fictício ${String.fromCharCode(65+i%26)}`)];
const doctors=names.map((name,index)=>({id:`directory-${index}`,organization_id:org.id,name,crm:String(24974+index),crm_uf:'SP',specialty:'Cirurgia',status:['active','pending','inactive'][index%3],contract_model:index===0?'pj':'pf',contract_signed:index===0,linked_units:[],address:null,phone:null,email:null,cpf:null,updated_at:'2026-01-01T00:00:00Z'}));
doctors[0].specialties=['Cirurgia','Pediatria'];doctors[0].rqes=[{id:'rqe-1',number:'36373',specialty:'Cirurgia',legacy:false},{id:'rqe-2',number:'44444',specialty:null,legacy:false}];
doctors[0].units=[{id:'unit-1',name:'Hospital Fictício A'},{id:'unit-2',name:'Clínica Fictícia B'}];doctors[0].last_shift=new Date(Date.now()-5*86400000).toISOString();doctors[0].portal_status='active';
doctors[1].rqe='3482';doctors[1].portal_status='pending';doctors[4].rqe='   ';
doctors[2].documents={pending:2,missing:1,expired:1,near:0,complete:false};doctors[2].portal_status='blocked';
doctors[3].documents={pending:0,missing:0,expired:0,near:1,complete:false};
let preferences=null,bulkFailure=false,slowQuery='',rqeRevision='rqes-initial',listingFailure=false,emptyDirectory=false;
const calls=[],reads=[],mutations=[];
const mock=http.createServer(async(request,response)=>{
 response.setHeader('Access-Control-Allow-Origin',base);response.setHeader('Access-Control-Allow-Headers','*');response.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');response.setHeader('Content-Type','application/json');
 if(request.method==='OPTIONS'){response.end();return;}
 const url=new URL(request.url,api),name=url.pathname.split('/').at(-1);
 const send=(data,status=200)=>{response.statusCode=status;response.end(JSON.stringify(data));};
 if(url.pathname==='/auth/v1/user')return send(user);
 if(url.pathname.startsWith('/auth/'))return send({factors:[],all:[],totp:[],data:user});
 if(url.pathname.includes('/rpc/')){
  let body='';for await(const chunk of request)body+=chunk;const args=body?JSON.parse(body):{};calls.push({name,args});
  const permissions=actor.role==='Diretor'?{}:{edit:false,requestDocuments:false,portal:false};
  if(name==='nv_doctor_directory'){
   if(listingFailure)return send({code:'XX000',message:'private synthetic SQL detail'},500);
   if(args.filters.q===slowQuery&&slowQuery)await new Promise(resolve=>setTimeout(resolve,700));
   return send(directoryFixture(emptyDirectory?[]:doctors,args,{permissions}));
  }
  if(name==='nv_account_preferences')return send(preferences);
  if(name==='nv_save_account_preferences'){preferences={theme:'light',sidebarCollapsed:true,density:'comfortable',scheduleView:'calendar',homePage:'',documentAlerts:true,applicationAlerts:true,doctorListing:{pageSize:25,sort:'name',descending:false,columns:['crm','specialty','contract','units','status','documents']},...preferences,...args.changes};return send(preferences);}
  if(name==='nv_session_ready')return send(true);
  if(name==='nv_doctor_profile'){const doctor=doctors.find(d=>d.id===args.target);return send({profile:doctor,can_read_personal:true,can_edit:actor.role==='Diretor',can_approve:true,specialties:doctor.specialties||[doctor.specialty],requested_specialties:[],has_enrollment:false});}
  if(name==='nv_doctor_rqes'){
   if(args.entries){mutations.push({name,args});doctors[0].rqes=args.entries.map((r,i)=>({...r,id:`rqe-${i}`,legacy:false}));rqeRevision='rqes-updated';}
   return send({entries:doctors[0].rqes.map(({number,specialty})=>({number,specialty})),legacy:null,revision:rqeRevision,canEdit:actor.role==='Diretor'});
  }
  if(name==='nv_doctor_access')return send({email:'doctor@example.invalid',status:'not_released',linked:false,can_manage:actor.role==='Diretor',revision:doctors[0].updated_at,record_inactive:false});
  if(name==='nv_doctor_banking')return send({complete:false,can_edit:false,can_history:false,details:{}});
  if(name==='nv_doctor_portal_role')return send(null);
  if(name==='nv_master_overview')return send({rules:[],absences:[],occurrences:[],exceptions:[],overrides:[]});
  if(name==='nv_doctor_directory_bulk'){
   mutations.push({name,args});const result=args.targets.map((target,index)=>{
    if(bulkFailure&&index===1)return{id:target.id,result:'stale'};
    if(args.operation==='status'){const doctor=doctors.find(d=>d.id===target.id);doctor.status=args.new_status;doctor.updated_at=new Date().toISOString();}
    return{id:target.id,result:args.operation==='request_documents'?'no_portal_account':'success'};
   });return send(result);
  }
  if(name==='nv_export_doctor_directory'){mutations.push({name,args});const data=directoryFixture(doctors,{filters:args.filters,page_size:100},{permissions}).rows;return send(args.ids?data.filter(d=>args.ids.includes(d.id)):data);}
  return send([]);
 }
 reads.push(name);
 const data=({doctors,organizations:[org],user_accounts:[actor],units:doctors[0].units,sectors:[],medical_documents:[],document_audit_logs:[],nv_staff_shifts:[]})[name]||[];
 return send(request.headers.accept?.includes('vnd.pgrst.object')?data[0]||null:data);
});
await new Promise(resolve=>mock.listen(54327,'127.0.0.1',resolve));
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/SUPABASE|DATABASE|POSTGRES|^PG|^VERCEL|^NVMED_|^NODE_(ENV|OPTIONS)$/i.test(key)));
Object.assign(env,{NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture',SUPABASE_SERVICE_ROLE_KEY:'',NVMED_ENVIRONMENT:'development',VERCEL:'0',NEXT_TELEMETRY_DISABLED:'1'});
const log=fs.openSync(new URL('browser-next.log',artifact),'w');
const app=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3120'],{env,stdio:['ignore',log,log],windowsHide:true});
let browser,debugPage;const checks=[];
try{
 for(let i=0;;i++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(i>100)throw Error('Local Next server unavailable');await new Promise(resolve=>setTimeout(resolve,500));}
 browser=await chromium.launch({executablePath:process.env.NVMED_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const token=`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),role:'authenticated',aud:'authenticated'})}.localtest`;
 await context.addCookies([{name:'sb-127-auth-token',value:'base64-'+encode({access_token:token,refresh_token:'local-only',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}),domain:'localhost',path:'/'}]);
 const external=[];await context.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)){external.push(url.hostname);return route.abort();}return route.continue();});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 debugPage=page;
 const loaded=async()=>{
  await page.waitForURL(url=>url.pathname==='/medicos');
  const expected=JSON.stringify(parseDirectoryQuery(new URLSearchParams(new URL(page.url()).search),preferences?.doctorListing));
  await page.waitForFunction(expected=>document.querySelector('[data-directory-query]')?.getAttribute('data-directory-query')===expected,expected);
 };
 const rows=page.locator('table tbody tr');const search=()=>page.getByRole('searchbox',{name:'Buscar médicos'});
 const metric=name=>page.getByRole('navigation',{name:'Indicadores do corpo clínico'}).getByRole('button',{name:new RegExp(name)});
 const clear=async()=>{await metric('Total de médicos').click();await loaded();};
 await page.goto(base+'/medicos');await loaded();
 assert.equal(await rows.count(),25);assert.match(await page.locator('main').innerText(),/Exibindo 1–25 de 92 médicos/);
 assert.equal(reads.includes('doctors'),false);assert.equal(reads.includes('medical_documents'),false);assert.equal(reads.includes('nv_staff_shifts'),false);checks.push('light bootstrap; 25 rows from server out of 92');
 for(const [text,initial] of [['Breno Victor','B'],['Jair Morais de Paula','J'],['Cassio Humberto','C'],['Osvaldo de Lima','O'],['Aline Machado','A'],['Dr. breno','B'],['Dra. aline','A'],['éRICA','É']]){
  const row=rows.filter({has:page.getByRole('link',{name:new RegExp(text)})}).first();assert.equal(await row.locator('td').nth(1).locator('span[aria-hidden="true"]').first().innerText(),initial);
 }
 checks.push('approved uppercase avatars, titles, accents and circular shared component retained');
 await metric('Com RQE').click();await loaded();assert.equal(await rows.count(),2);
 await page.getByLabel('Especialidade',{exact:true}).selectOption('Pediatria');await loaded();assert.equal(await rows.filter({hasText:'Breno'}).count(),0);
 await page.getByRole('button',{name:'Remover filtro Especialidade'}).click();await loaded();assert.equal(await rows.count(),2);
 checks.push('RQE metric, specialty association and removable filter chips');
 for(const [label,field,value,total] of [['Ativos','status','active',31],['Pendentes','status','pending',31],['Sem RQE','rqe','without',90],['Pendências documentais','documents','pending',2]]){
  await metric(label).click();await loaded();assert.equal(new URL(page.url()).searchParams.get(field),value);
  assert.match(await page.locator('main').innerText(),new RegExp(`${total} médicos encontrados`));assert.match(await metric('Total de médicos').innerText(),/92/);
 }
 checks.push('all indicator shortcuts apply their filters while counts keep the general company context');
 await clear();const beforeSearch=calls.filter(call=>call.name==='nv_doctor_directory').length;
 await search().fill('b');await search().fill('br');await search().fill('breno');await loaded();
 await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='breno');await loaded();
 assert.equal(await rows.count(),2);assert.equal(calls.filter(call=>call.name==='nv_doctor_directory').length,beforeSearch+1);
 await search().fill('24974');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='24974');await loaded();assert.equal(await rows.count(),1);
 await search().fill('36373');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='36373');await loaded();assert.equal(await rows.count(),1);
 await search().fill('erica');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='erica');await loaded();assert.match(await rows.innerText(),/éRICA/);
 checks.push('debounced name, CRM and RQE search; accent-insensitive lookup');
 slowQuery='breno';await search().fill('breno');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='breno');
 await search().fill('erica');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='erica');await loaded();
 await page.waitForTimeout(800);assert.match(await rows.innerText(),/éRICA/);slowQuery='';
 checks.push('late response is aborted and cannot replace the newest search results');
 await clear();await page.getByRole('button',{name:'Filtros avançados',exact:true}).click();
 await page.getByLabel('Unidades atendidas',{exact:true}).selectOption('unit-1');await loaded();assert.equal(await rows.count(),1);
 await page.getByLabel('Contratação',{exact:true}).selectOption('pj');await loaded();
 await page.getByLabel('Situação contratual',{exact:true}).selectOption('signed');await loaded();
 assert.match(await page.getByRole('button',{name:/Filtros avançados/}).innerText(),/3/);
 await page.getByRole('button',{name:'Filtros avançados (3)'}).click();assert.equal(await page.getByLabel('Contratação',{exact:true}).count(),0);
 await clear();await page.getByRole('button',{name:'Filtros avançados',exact:true}).click();
 await page.getByLabel('Documentação',{exact:true}).selectOption('expired');await loaded();assert.match(await rows.innerText(),/Cassio/);
 await page.getByRole('button',{name:'Limpar filtros',exact:true}).click();await loaded();
 await page.getByRole('button',{name:'Filtros avançados',exact:true}).click();await page.getByLabel('Portal Médico',{exact:true}).selectOption('active');await loaded();assert.equal(await rows.count(),1);
 await page.getByLabel('Último plantão realizado',{exact:true}).selectOption('30');await loaded();assert.equal(await rows.count(),1);
 await page.getByLabel('Portal Médico',{exact:true}).selectOption('not_released');await loaded();assert.match(await rows.innerText(),/Nenhum médico encontrado/);
 await page.getByRole('button',{name:'Limpar filtros',exact:true}).click();await loaded();
 checks.push('advanced filters combine, count stays visible while collapsed, document expiry and clear');
 await page.getByRole('button',{name:'Próxima página',exact:true}).click();await loaded();assert.match(await page.locator('main').innerText(),/Exibindo 26–50/);
 const target=rows.first().getByRole('link').first();const url=page.url();await target.click();await page.getByRole('button',{name:'Editar perfil',exact:true}).waitFor();
 await page.getByRole('link',{name:'Voltar para listagem',exact:true}).click();await loaded();assert.equal(page.url(),url);
 await page.getByRole('combobox',{name:'Por página',exact:true}).selectOption('50');await loaded();assert.equal(await rows.count(),50);
 await page.getByRole('button',{name:'CRM / UF',exact:true}).click();await loaded();assert.match(page.url(),/sort=crm/);assert.match(page.url(),/page=1/);
 await page.getByRole('button',{name:'CRM / UF',exact:true}).click();await loaded();assert.match(page.url(),/descending=true/);
 checks.push('server pagination, 50 rows, deterministic sort toggle, profile return preserves URL');
 await clear();await page.getByRole('button',{name:'Médico',exact:true}).click();await loaded();
 const checkbox=page.getByRole('checkbox',{name:'Selecionar médicos da página atual'});await checkbox.check();assert.match(await page.getByRole('region',{name:'Ações em massa'}).innerText(),/50 selecionado/);
 await page.getByRole('button',{name:'Próxima página',exact:true}).click();await loaded();assert.equal(await page.getByRole('region',{name:'Ações em massa'}).count(),0);
 await page.getByRole('checkbox',{name:'Selecionar médicos da página atual'}).check();
 const beforeBulk=mutations.length;await page.getByLabel('Alterar status dos selecionados').selectOption('inactive');
 await page.getByRole('dialog',{name:'Inativar médicos?'}).waitFor();await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(mutations.length,beforeBulk);
 await page.getByLabel('Alterar status dos selecionados').selectOption('inactive');bulkFailure=true;
 await page.getByRole('dialog').getByRole('button',{name:'Confirmar alteração',exact:true}).click();await page.getByRole('dialog',{name:'Resultado da operação'}).waitFor();assert.match(await page.getByRole('dialog').innerText(),/Cadastro alterado/);
 await page.getByRole('dialog').getByRole('button',{name:'Fechar',exact:true}).last().click();bulkFailure=false;await loaded();
 checks.push('page-only selection clears on navigation; bulk cancellation and partial result');
 await clear();await search().fill('36373');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='36373');await loaded();
 await rows.first().getByRole('button',{name:'Ações de Breno Victor Brandão Almeida'}).focus();await page.keyboard.press('ArrowDown');
 await page.getByRole('menu',{name:'Ações de Breno Victor Brandão Almeida'}).waitFor();await page.keyboard.press('End');assert.match(await page.evaluate(()=>document.activeElement.textContent),/Inativar|Reativar/);await page.keyboard.press('Escape');
 await rows.first().getByRole('button',{name:'Ações de Breno Victor Brandão Almeida'}).click();
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Ações de Breno Victor Brandão Almeida"]')?.getAttribute('aria-expanded')==='true');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.getByRole('menu',{name:'Ações de Breno Victor Brandão Almeida'}).waitFor({state:'hidden'});
 await rows.first().getByRole('button',{name:'Ações de Breno Victor Brandão Almeida'}).click();await page.getByRole('menuitem',{name:'Editar cadastro',exact:true}).click();
 await page.getByRole('dialog',{name:'Editar perfil',exact:true}).waitFor();await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByRole('button',{name:'Gerenciar RQEs',exact:true}).click();await page.getByRole('dialog',{name:'Gerenciar RQEs'}).waitFor();
 await page.getByRole('dialog').getByRole('button',{name:'Adicionar RQE',exact:true}).click();await page.getByLabel('RQE 3',{exact:true}).fill('77777');await page.getByLabel('Especialidade do RQE 3',{exact:true}).selectOption('Pediatria');
 await page.getByRole('dialog').getByRole('button',{name:'Salvar RQEs',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(doctors[0].rqes.length,3);
 await page.getByRole('link',{name:'Voltar para listagem',exact:true}).click();await loaded();
 checks.push('keyboard context menu, direct edit opens existing form, associated RQE editor and audit RPC');
 await rows.first().getByRole('button',{name:'Ações de Breno Victor Brandão Almeida'}).click();await page.getByRole('menuitem',{name:'Gerenciar contrato',exact:true}).click();
 await page.getByRole('dialog',{name:'Editar perfil',exact:true}).waitFor();await page.waitForFunction(()=>document.activeElement?.getAttribute('name')==='contractModel');
 await page.getByRole('dialog').getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('link',{name:'Voltar para listagem',exact:true}).click();await loaded();
 await rows.first().getByRole('button',{name:'Ações de Breno Victor Brandão Almeida'}).click();await page.getByRole('menuitem',{name:'Histórico de alterações',exact:true}).click();
 await page.waitForFunction(()=>{const node=document.getElementById('doctor-history');if(!node)return false;const rect=node.getBoundingClientRect();return rect.top>=0&&rect.top<innerHeight;});
 await page.getByRole('link',{name:'Voltar para listagem',exact:true}).click();await loaded();
 checks.push('contract action focuses existing contract field and history action scrolls to the correct section');
 await page.getByRole('button',{name:'RQEs de Breno Victor Brandão Almeida',exact:true}).click();const rqePopover=page.getByRole('region',{name:'RQEs de Breno Victor Brandão Almeida',exact:true});await rqePopover.waitFor();
 assert.match(await rqePopover.innerText(),/não representa validação oficial/);await page.keyboard.press('Tab');assert.equal(await rqePopover.evaluate(node=>node===document.activeElement),true);await page.keyboard.press('Escape');await rqePopover.waitFor({state:'hidden'});
 checks.push('RQE popover is keyboard-focusable and distinguishes registration from official validation');
 await page.getByRole('button',{name:'Exportar',exact:true}).click();await page.getByRole('dialog').getByLabel('Formato',{exact:true}).selectOption('csv');
 const downloadEvent=page.waitForEvent('download').catch(error=>error);await page.getByRole('dialog').getByRole('button',{name:'Exportar arquivo',exact:true}).click({noWaitAfter:true});const download=await downloadEvent;if(download instanceof Error)throw download;
 const csv=fs.readFileSync(await download.path(),'utf8');assert.match(csv,/Breno/);assert.ok(!csv.includes('Jair Morais'));assert.ok(!csv.includes('CPF'));
 checks.push('filtered CSV download through authenticated server route');
 await rows.first().getByRole('checkbox').check();await page.getByRole('button',{name:'Exportar selecionados',exact:true}).click();
 await page.getByRole('dialog').getByLabel('Formato',{exact:true}).selectOption('xlsx');
 const selectedDownload=page.waitForEvent('download');await page.getByRole('dialog').getByRole('button',{name:'Exportar arquivo',exact:true}).click();
 assert.equal(fs.readFileSync(await(await selectedDownload).path()).subarray(0,2).toString(),'PK');
 assert.equal(mutations.filter(m=>m.name==='nv_export_doctor_directory').at(-1).args.ids.length,1);
 await page.getByRole('button',{name:'Exportar',exact:true}).click();await page.getByRole('dialog').getByLabel('Médicos a exportar',{exact:true}).selectOption('all');await page.getByRole('dialog').getByLabel('Formato',{exact:true}).selectOption('csv');
 const allDownload=page.waitForEvent('download');await page.getByRole('dialog').getByRole('button',{name:'Exportar arquivo',exact:true}).click();assert.match(fs.readFileSync(await(await allDownload).path(),'utf8'),/Jair Morais/);
 const rejected=await context.request.post(base+'/api/reports/doctors',{headers:{origin:'https://example.invalid'},data:{}});assert.equal(rejected.status(),403);
 const malformed=await context.request.post(base+'/api/reports/doctors',{headers:{origin:base,'Content-Type':'application/json'},data:'null'});assert.equal(malformed.status(),400);
 checks.push('all-company CSV, selected XLSX, strict origin check and malformed JSON rejection');
 await page.getByRole('button',{name:'Preferências',exact:true}).click();const pref=page.getByRole('dialog',{name:'Preferências da listagem'});
 await pref.getByLabel('Médicos por página',{exact:true}).selectOption('100');await pref.getByLabel('Densidade da tabela',{exact:true}).selectOption('compact');await pref.getByRole('checkbox',{name:'Contratação',exact:true}).uncheck();await pref.getByRole('button',{name:'Salvar preferências',exact:true}).click();await pref.waitFor({state:'detached'});await loaded();
 assert.equal(preferences.doctorListing.pageSize,100);assert.equal(preferences.density,'compact');assert.equal(await page.getByRole('columnheader',{name:'Contratação',exact:true}).count(),0);
 checks.push('listing preferences saved through existing account RPC; columns and shared density applied');
 await page.goto(base+'/perfil#preferencias');await page.getByRole('heading',{name:'Listagem de médicos',exact:true}).waitFor();assert.equal(await page.getByLabel('Médicos por página',{exact:true}).inputValue(),'100');
 await page.goto(base+'/medicos');await loaded();
 checks.push('saved listing preferences are available in Minha conta without a separate preference store');
 const beforeCreate=calls.filter(call=>/create_doctor|invite|begin_doctor_access/.test(call.name)).length;
 await page.getByRole('button',{name:'Novo médico',exact:true}).click();const create=page.getByRole('dialog',{name:'Cadastrar médico',exact:true});await create.getByLabel('Nome completo',{exact:true}).waitFor();
 assert.equal(await create.getByRole('button',{name:'Salvar e enviar documentos',exact:true}).isVisible(),true);assert.match(await create.innerText(),/não cria acesso ao portal nem envia convites/);
 await create.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(calls.filter(call=>/create_doctor|invite|begin_doctor_access/.test(call.name)).length,beforeCreate);
 checks.push('reused registration form retains document-upload shortcut and cancellation sends no writes or invitations');
 await clear();
 for(const button of await page.getByRole('button',{name:'Dispensar notificação'}).all())await button.click();
 for(const dark of [false,true])for(const width of [1440,768,390,360]){
  await page.setViewportSize({width,height:1000});await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:fileURLToPath(new URL(`directory-${dark?'dark':'light'}-${width}.png`,artifact)),animations:'disabled'});
  await page.getByRole('region',{name:'Tabela de médicos'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL(`directory-table-${dark?'dark':'light'}-${width}.png`,artifact)),animations:'disabled'});
  if(width===360){await rows.first().getByRole('button',{name:/Ações de/}).click();const menu=page.getByRole('menu');const rect=await menu.boundingBox();assert.ok(rect.x>=0 && rect.x+rect.width<=width && rect.y>=0 && rect.y+rect.height<=1000);await page.screenshot({path:fileURLToPath(new URL(`directory-menu-${dark?'dark':'light'}-${width}.png`,artifact)),animations:'disabled'});await page.keyboard.press('Escape');}
 }
 checks.push('1440/768/390/360px and light/dark: responsive table region, no whole-page horizontal overflow');
 listingFailure=true;await page.reload();await page.getByRole('alert').filter({hasText:'Não foi possível carregar a listagem.'}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes('private synthetic'));
 listingFailure=false;await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();await loaded();
 emptyDirectory=true;await page.reload();await loaded();assert.match(await rows.innerText(),/Nenhum médico cadastrado nesta empresa/);assert.equal(await page.getByRole('checkbox',{name:'Selecionar médicos da página atual'}).isDisabled(),true);
 emptyDirectory=false;await page.reload();await loaded();
 checks.push('loading/error recovery and empty company keep safe messages and valid selection state');
 await search().fill('ficticio inexistente');await page.waitForFunction(()=>new URLSearchParams(location.search).get('q')==='ficticio inexistente');await loaded();assert.match(await rows.innerText(),/Nenhum médico encontrado/);
 await clear();actor.role='Jurídico';await page.reload();await loaded();await page.getByRole('button',{name:'Ações de Breno Victor Brandão Almeida'}).first().click();assert.equal(await page.getByRole('menuitem',{name:'Editar cadastro',exact:true}).count(),0);assert.equal(await page.getByRole('menuitem',{name:'Gerenciar acesso ao Portal Médico',exact:true}).count(),0);
 checks.push('empty results and read-only role hide editing and portal administration');
 assert.deepEqual(errors,[]);
 // The host antivirus may inject this script. All non-loopback requests are aborted above.
 assert.ok(external.every(host=>host==='me.kis.v2.scr.kaspersky-labs.com'),`Unexpected outbound attempt: ${external.join(', ')}`);
 assert.ok(!calls.some(call=>/begin_doctor_access|invite|reset/i.test(call.name)));
 fs.writeFileSync(new URL('browser-results.json',artifact),JSON.stringify({passed:checks.length,checks,requests:calls.length,mutations:mutations.map(m=>m.name),blockedExternal:external,productionContacted:false},null,2));
 console.log(JSON.stringify({passed:checks.length,checks}));
}catch(error){
 console.log(JSON.stringify({completed:checks,error:String(error)}));
 if(debugPage){fs.writeFileSync(new URL('browser-failure.html',artifact),await debugPage.content());await debugPage.screenshot({path:fileURLToPath(new URL('browser-failure.png',artifact))});}
 throw error;
}finally{await browser?.close();mock.closeAllConnections();await new Promise(resolve=>mock.close(resolve));app.kill();fs.closeSync(log);}
