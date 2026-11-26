// HTTP fixtures for browser wiring only. Real authorization/aggregation is tested in PostgreSQL.
const key = value => String(value || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function directoryFixture(doctors, args = {}, options = {}) {
 const permissions = { documents:true,schedule:true,portal:true,edit:true,requestDocuments:true,export:true,...options.permissions };
 const rows = doctors.map(doctor => ({id:doctor.id,organizationId:doctor.organization_id,name:doctor.name,crm:doctor.crm,crmUf:doctor.crm_uf,
  specialty:doctor.specialty,specialties:doctor.specialties || [doctor.specialty],rqes:doctor.rqes || (doctor.rqe?.trim() ? [{id:null,number:doctor.rqe.trim(),specialty:null,legacy:true}] : []),
  status:doctor.status,contractModel:doctor.contract_model || 'pf',contractSigned:doctor.contract_signed || false,revision:doctor.updated_at,
  units:doctor.units || [],lastShift:doctor.last_shift || null,enrollmentStatus:doctor.enrollment_status || 'not_started',
  documents:permissions.documents ? doctor.documents || {pending:0,missing:0,expired:0,near:0,complete:true} : null,
  portalStatus:permissions.portal ? doctor.portal_status || 'not_released' : null}));
 const f=args.filters || {};
 const filtered=rows.filter(row=>{
  if(f.q && ![row.name,row.crm,...row.rqes.map(r=>r.number),...row.specialties].some(value=>key(value).includes(key(f.q))))return false;
  if(f.status && f.status!=='all' && row.status!==f.status)return false;
  if(f.specialty && f.specialty!=='all' && !row.specialties.includes(f.specialty))return false;
  const hasRqe=row.rqes.some(r=>!f.specialty || f.specialty==='all' || r.specialty===f.specialty);
  if(f.rqe==='with'&&!hasRqe || f.rqe==='without'&&hasRqe)return false;
  if(f.unit && f.unit!=='all' && (f.unit==='none' ? row.units.length>0 : !row.units.some(unit=>unit.id===f.unit)))return false;
  if(f.contract && f.contract!=='all' && row.contractModel!==f.contract)return false;
  if(f.signed && f.signed!=='all' && row.contractSigned!==(f.signed==='signed'))return false;
  if(f.portal && f.portal!=='all' && row.portalStatus!==f.portal)return false;
  if(f.documents==='complete'&&!row.documents?.complete || f.documents==='pending'&&!(row.documents?.pending||row.documents?.near) || f.documents==='expired'&&!row.documents?.expired || f.documents==='near'&&!row.documents?.near)return false;
  if(f.lastShift==='none'&&row.lastShift || ['30','60','90'].includes(f.lastShift)&&(!row.lastShift||Date.now()-Date.parse(row.lastShift)>Number(f.lastShift)*86400000))return false;
  return true;
 });
 const sort=args.sort_by || 'name';
 filtered.sort((a,b)=>{const value=row=>sort==='pending' ? row.documents?.pending || 0 : sort==='crm' ? Number(row.crm) : key(row[sort]);
  const av=value(a),bv=value(b); return ((av<bv?-1:av>bv?1:0)*(args.descending?-1:1)) || a.id.localeCompare(b.id);});
 const size=args.page_size || 25,page=Math.max(1,Math.min(args.page || 1,Math.ceil(filtered.length/size)));
 return {rows:filtered.slice((page-1)*size,page*size),total:filtered.length,page,pageSize:size,permissions,
  indicators:{total:rows.length,active:rows.filter(r=>r.status==='active').length,pending:rows.filter(r=>r.status==='pending').length,
   with_rqe:rows.filter(r=>r.rqes.length).length,without_rqe:rows.filter(r=>!r.rqes.length).length,documents:rows.filter(r=>r.documents?.pending||r.documents?.near).length},
  specialties:[...new Set(rows.flatMap(r=>r.specialties))].sort(),units:[...new Map(rows.flatMap(r=>r.units).map(u=>[u.id,u])).values()]};
}
