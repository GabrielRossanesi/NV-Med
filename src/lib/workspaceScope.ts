export type WorkspacePeriod = { start: string; end: string } | null;
export type WorkspacePlan = {
  name: string; organizationId: string; doctorId?: string; unitId?: string; shiftId?: string;
  doctors: boolean; units: boolean; sectors: boolean; documents: boolean;
  users: false | 'company' | 'global'; audit: boolean; adminSummary: boolean;
  shifts: false | 'all' | Exclude<WorkspacePeriod, null>[];
};
export type WorkspacePeriods = Record<string, WorkspacePeriod>;
export type OrganizationCounts = { doctors: number | null; units: number | null; sectors: number | null;
  shifts: number | null; users: number | null; accounts: number | null; documents: number | null; pendingDocuments: number | null };
export function workspaceTotal(counts:Record<string,OrganizationCounts>,field:keyof OrganizationCounts){
 const values=Object.values(counts).map(item=>item[field]);return values.some(value=>value===null)?null:values.reduce<number>((sum,value)=>sum+(value||0),0);
}

export function workspaceDay(value = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
export function validWorkspaceDay(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
function routeId(value:string){try{return decodeURIComponent(value);}catch{return value;}}
export function offsetWorkspaceDay(value: string, amount: number) {
  const date = new Date(value + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
export function workspacePeriod(value: string, mode = 'month'): Exclude<WorkspacePeriod, null> {
  if (mode === 'day') return { start: value, end: value };
  if (mode === 'week') {
    const day = new Date(value + 'T12:00:00Z').getUTCDay();
    const start = offsetWorkspaceDay(value, -((day + 6) % 7)); return { start, end: offsetWorkspaceDay(start, 6) };
  }
  const start = value.slice(0, 7) + '-01';
  const end = new Date(start + 'T12:00:00Z'); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
  return { start, end: end.toISOString().slice(0, 10) };
}
export function mergeWorkspacePeriods(periods: Exclude<WorkspacePeriod, null>[]) {
  const merged: Exclude<WorkspacePeriod, null>[] = [];
  for (const period of [...periods].sort((a,b) => a.start.localeCompare(b.start))) {
    if (!validWorkspaceDay(period.start) || !validWorkspaceDay(period.end) || period.start > period.end) throw new Error('Período inválido.');
    const previous = merged.at(-1);
    if (previous && period.start <= offsetWorkspaceDay(previous.end, 1)) previous.end = previous.end > period.end ? previous.end : period.end;
    else merged.push({ ...period });
  }
  return merged;
}
export function workspacePlan(path: string, params: URLSearchParams, organizationId: string, periods: WorkspacePeriods = {}, today = workspaceDay()): WorkspacePlan {
  const plan: WorkspacePlan = { name: path, organizationId, doctors:false,units:false,sectors:false,documents:false,users:false,audit:false,adminSummary:false,shifts:false };
  const profile = /^\/(medicos|documentos)\/([^/]+)$/.exec(path);
  const date = validWorkspaceDay(params.get('date') || '') ? params.get('date')! : today;
  if (profile && profile[2] !== 'credenciamento') {
    plan.doctorId = routeId(profile[2]); plan.doctors=true;plan.units=true;plan.documents=true;plan.shifts='all';plan.audit=profile[1]==='documentos';
  } else if (path === '/dashboard') {
    plan.doctors=true;plan.units=true;plan.sectors=true;
    const coverage = periods.coverage || { start:today, end:offsetWorkspaceDay(today,6) };
    const agenda = periods.agenda || { start:today, end:today };
    plan.shifts=mergeWorkspacePeriods([coverage,agenda,{start:today,end:today}]);
  } else if (path === '/escala') {
    plan.doctors=true;plan.units=true;plan.sectors=true;
    const range = periods.main || workspacePeriod(date, ['day','week','month'].includes(params.get('view') || '') ? params.get('view')! : 'week');
    // Include adjacent operational dates for overnight coverage segments.
    plan.shifts=[{start:offsetWorkspaceDay(range.start,-1),end:offsetWorkspaceDay(range.end,1)}];
    plan.shiftId=params.get('shiftId') || undefined;
  } else if (path === '/financeiro' || path === '/relatorios') {
    plan.doctors=true;plan.units=true;plan.sectors=true;plan.documents=path==='/relatorios';
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get('month') || '') ? params.get('month')!+'-01' : today;
    const range = Object.hasOwn(periods,'main') ? periods.main : path==='/financeiro' && params.get('period')==='all' ? null : workspacePeriod(month);
    plan.shifts=range ? [range] : 'all'; plan.shiftId=params.get('shiftId') || undefined;
  } else if (path === '/documentos') {
    plan.doctors=true;plan.units=true;plan.documents=true;plan.shifts='all';
  } else if (path === '/admin' || path === '/admin/empresas' || path === '/empresas') {
    plan.adminSummary=true;
  } else if (path === '/admin/usuarios') plan.users='global';
  else if (path === '/unidades') plan.units=true;
  else if (path.startsWith('/unidades/')) {
    plan.unitId=routeId(path.split('/')[2]);plan.doctors=true;plan.units=true;plan.sectors=true;plan.shifts='all';
  } else if (path === '/medicos/credenciamento') plan.units=true;
  else if (path === '/escala/candidaturas') {plan.doctors=true;plan.units=true;plan.sectors=true;}
  else if (path.startsWith('/configuracoes')) {plan.units=true;plan.sectors=true;plan.doctors=path==='/configuracoes'||path==='/configuracoes/documentos';}
  return plan;
}
