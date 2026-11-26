import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeWorkspacePeriods,workspacePlan,workspacePeriod,workspaceTotal,validWorkspaceDay} from '../src/lib/workspaceScope.ts';
import {workspaceDocuments} from '../src/lib/workspaceQueries.ts';
const plan=(path,query='',periods={})=>workspacePlan(path,new URLSearchParams(query),'company-a',periods,'2026-11-26');
test('account, permissions and server-owned reports do not bootstrap operational collections',()=>{
 for(const path of ['/perfil','/admin/permissoes','/financeiro/empresa','/financeiro/relatorio','/relatorios/plantoes','/escala/presenca']){
  const value=plan(path);for(const key of ['doctors','units','sectors','documents','users','shifts','audit','adminSummary'])assert.equal(value[key],false,`${path}: ${key}`);
 }
});
test('dashboard loads its displayed dates without documents or user accounts',()=>{
 const value=plan('/dashboard');assert.deepEqual(value.shifts,[{start:'2026-11-26',end:'2026-12-02'}]);assert.equal(value.documents,false);assert.equal(value.users,false);
});
test('independent dashboard periods stay bounded and do not fill years between windows',()=>{
 const value=plan('/dashboard','',{coverage:{start:'2024-02-01',end:'2024-02-29'},agenda:{start:'2026-11-26',end:'2026-11-26'}});
 assert.deepEqual(value.shifts,[{start:'2024-02-01',end:'2024-02-29'},{start:'2026-11-26',end:'2026-11-26'}]);
});
test('schedule includes overnight boundary dates and reacts to a different month',()=>{
 assert.deepEqual(plan('/escala','date=2026-11-26&view=week').shifts,[{start:'2026-11-22',end:'2026-11-30'}]);
 assert.deepEqual(plan('/escala','',{main:{start:'2024-02-01',end:'2024-02-29'}}).shifts,[{start:'2024-01-31',end:'2024-03-01'}]);
});
test('finance and reports use selected period; all history requires an explicit selection',()=>{
 assert.deepEqual(plan('/financeiro','month=2025-02').shifts,[{start:'2025-02-01',end:'2025-02-28'}]);
 assert.equal(plan('/financeiro','period=all').shifts,'all');assert.equal(plan('/financeiro','',{main:null}).shifts,'all');
 assert.deepEqual(plan('/relatorios','',{main:{start:'2026-01-01',end:'2026-01-31'}}).shifts,[{start:'2026-01-01',end:'2026-01-31'}]);
});
test('doctor folders keep exact company and doctor; only document folders request audit',()=>{
 assert.equal(plan('/medicos/legacy%20doctor').doctorId,'legacy doctor');assert.equal(plan('/medicos/legacy-doctor').audit,false);
 const folder=plan('/documentos/legacy-doctor');assert.equal(folder.organizationId,'company-a');assert.equal(folder.doctorId,'legacy-doctor');assert.equal(folder.audit,true);
 assert.equal(plan('/medicos/credenciamento').doctors,false);
});
test('company administration uses aggregates; user management is the only global account list',()=>{
 for(const path of ['/admin','/admin/empresas','/empresas']){const value=plan(path);assert.equal(value.adminSummary,true);assert.equal(value.doctors,false);assert.equal(value.documents,false);assert.equal(value.shifts,false);}
 assert.equal(plan('/admin/usuarios').users,'global');assert.equal(plan('/unidades').units,true);assert.equal(plan('/unidades').doctors,false);
});
test('invalid calendar input cannot crash the bootstrap or build a filter expression',()=>{
 assert.equal(validWorkspaceDay('2026-02-29'),false);assert.equal(validWorkspaceDay('2024-02-29'),true);
 assert.deepEqual(plan('/escala','date=2026-99-99').shifts,plan('/escala').shifts);
 assert.throws(()=>mergeWorkspacePeriods([{start:'2026-01-01),id.eq.secret',end:'2026-02-01'}]));
 assert.equal(plan('/medicos/%broken').doctorId,'%broken');
 assert.deepEqual(workspacePeriod('2024-02-12'),{start:'2024-02-01',end:'2024-02-29'});
});
test('global totals cannot silently add only the authorized subset',()=>{
 assert.equal(workspaceTotal({a:{doctors:10},b:{doctors:null}},'doctors'),null);
 assert.equal(workspaceTotal({a:{doctors:10},b:{doctors:20}},'doctors'),30);
});
test('document keyset reads every page while keeping company and doctor fixed',async()=>{
 const rows=Array.from({length:1354},(_,i)=>({id:String(i).padStart(5,'0')})),calls=[];
 const client={rpc(name,args){calls.push({name,args});return{abortSignal(){return this;},then(resolve){resolve({data:rows.filter(row=>!args.after_id||row.id>args.after_id).slice(0,args.page_limit),error:null});}};}};
 assert.deepEqual(await workspaceDocuments(client,'company-a','doctor-a',new AbortController().signal),rows);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.args.org==='company-a'&&c.args.target==='doctor-a'&&c.args.page_limit===500));
});
test('a broken or forbidden metadata page cannot become partial success',async()=>{
 const repeated=Array.from({length:500},(_,i)=>({id:String(i).padStart(5,'0')}));
 await assert.rejects(workspaceDocuments({rpc:()=>Promise.resolve({data:repeated,error:null})},'company-a'),/concluir/);
 await assert.rejects(workspaceDocuments({rpc:()=>Promise.resolve({data:null,error:{code:'42501',message:'private'}})},'company-a'),error=>!error.message.includes('private'));
});
