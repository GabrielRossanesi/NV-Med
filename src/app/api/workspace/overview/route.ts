import { createClient } from '@/lib/supabase/server';
import { getAuthorizedUser } from '@/lib/supabase/authorizedUser';
import { dashboardPayments,doctorsWithDocumentIssues } from '@/lib/dashboardOverview';
import { doctorScheduleCompliance,getDocumentGovernance } from '@/lib/documentGovernance';
import { mapDoctorFromDb,mapDocumentFromDb,mapShiftFromDb } from '@/services/supabaseService';
import { workspaceDay } from '@/lib/workspaceScope';
import { workspaceDocuments } from '@/lib/workspaceQueries';
import type { NextRequest } from 'next/server';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(request:NextRequest){
 const org=request.nextUrl.searchParams.get('org'),part=request.nextUrl.searchParams.get('part');
 if(!org||org.length>150||!['documents','finance'].includes(part||''))return Response.json({error:'Consulta inválida.'},{status:400,headers});
 const client=await createClient();if(!client||!await getAuthorizedUser(client))return Response.json({error:'Entre novamente para continuar.'},{status:401,headers});
 const [documentAccess,scheduleAccess,financeAccess]=await Promise.all(['documentos','escala','financeiro'].map(module=>client.rpc('nv_can_action',{org,module,action:'view'})));
 if([documentAccess,scheduleAccess,financeAccess].some(result=>result.error))return Response.json({error:'Não foi possível verificar as permissões.'},{status:503,headers});
 if((part==='finance'&&financeAccess.data!==true)||(part==='documents'&&documentAccess.data!==true&&scheduleAccess.data!==true))return Response.json({error:'Consulta indisponível.'},{status:403,headers});
 async function read(table:string,columns:string){
  const rows=[];
  for(let offset=0;;offset+=500){const result=await client!.from(table).select(columns).eq('organization_id',org!).order('id').range(offset,offset+499).abortSignal(request.signal);
   if(result.error)throw new Error('Query failed');rows.push(...result.data);if(result.data.length<500)return rows;}
 }
 try{
  if(part==='finance'){
   const raw=await read('nv_staff_shifts','id,organization_id,doctor_id,unit_id,date,start_time,end_time,type,status,employment_type,payment_amount,payment_status,paid_amount,payment_due_date,payment_frequency');
   return Response.json(dashboardPayments(raw.map(row=>mapShiftFromDb(row as unknown as Parameters<typeof mapShiftFromDb>[0])),workspaceDay()),{headers});
  }
  const documents=async()=>{
   if(documentAccess.data!==true)return [] as Parameters<typeof mapDocumentFromDb>[0][];
   return workspaceDocuments<Parameters<typeof mapDocumentFromDb>[0]>(client!,org!,null,request.signal);
  };
  const [doctors,docs,shifts,organization]=await Promise.all([
   read('doctors','id,organization_id,name,crm,crm_uf,specialty,status,contract_model,contract_signed,linked_units'),documents(),
   scheduleAccess.data===true?read('nv_staff_shifts','id,organization_id,doctor_id,unit_id,date,start_time,end_time,type,status'):[],
   client.from('organizations').select('settings').eq('id',org).abortSignal(request.signal).maybeSingle(),
  ]);
  if(organization.error||!organization.data)throw new Error('Query failed');
  const mappedDoctors=doctors.map(row=>mapDoctorFromDb(row as unknown as Parameters<typeof mapDoctorFromDb>[0]));
  const mappedDocuments=docs.map(mapDocumentFromDb),mappedShifts=shifts.map(row=>mapShiftFromDb(row as unknown as Parameters<typeof mapShiftFromDb>[0]));
  const company=organization.data;
  const reference=Date.now(),governance=getDocumentGovernance(company);
  const schedule=Object.fromEntries(mappedDoctors.map(doctor=>{const value=doctorScheduleCompliance(doctor,mappedDocuments,company,reference);return [doctor.id,{warning:value.warning,blocked:value.blocked}];}));
  const units:Record<string,string[]>={};for(const shift of mappedShifts)if(shift.doctorId){const ids=units[shift.doctorId]||=[];if(!ids.includes(shift.unitId))ids.push(shift.unitId);}
  const issues=documentAccess.data===true?doctorsWithDocumentIssues(mappedDoctors,mappedDocuments,mappedShifts,reference,company.settings?.requiredDocuments,Math.max(...governance.expiryAlertDays)).map(({doctor,...issue})=>({...issue,doctor:{id:doctor.id,name:doctor.name,specialty:doctor.specialty}})):[];
  return Response.json({issues,schedule,units},{headers});
 }catch{return Response.json({error:'Não foi possível consultar os indicadores. Tente novamente.'},{status:503,headers});}
}
