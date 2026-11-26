export const directoryColumns = ['crm', 'specialty', 'contract', 'units', 'status', 'documents'] as const;
export type DirectoryColumn = typeof directoryColumns[number];
export type DirectorySort = 'name' | 'crm' | 'specialty' | 'status' | 'pending';
export type DoctorListingPreferences = { pageSize: 25 | 50 | 100; sort: DirectorySort; descending: boolean; columns: DirectoryColumn[] };
export const defaultDoctorListing: DoctorListingPreferences = { pageSize: 25, sort: 'name', descending: false, columns: [...directoryColumns] };
export const directoryFilterLabels = {
  q: 'Busca', specialty: 'Especialidade', status: 'Status', rqe: 'RQE', unit: 'Unidade', contract: 'Contratação',
  signed: 'Contrato', documents: 'Documentação', portal: 'Portal Médico', lastShift: 'Último plantão realizado',
};
export type DirectoryFilter = keyof typeof directoryFilterLabels;
export type DirectoryFilters = Record<DirectoryFilter, string>;
export const emptyDirectoryFilters: DirectoryFilters = { q: '', specialty: 'all', status: 'all', rqe: 'all', unit: 'all', contract: 'all', signed: 'all', documents: 'all', portal: 'all', lastShift: 'all' };
export type DirectoryQuery = { filters: DirectoryFilters; page: number; pageSize: 25 | 50 | 100; sort: DirectorySort; descending: boolean };
export type DoctorRqe = { id: string | null; number: string; specialty: string | null; legacy: boolean };
export type DirectoryDoctor = {
  id: string; organizationId: string; name: string; crm: string; crmUf: string; specialty: string; specialties: string[]; rqes: DoctorRqe[];
  status: 'active' | 'pending' | 'inactive'; contractModel: 'pf' | 'pj' | 'scp'; contractSigned: boolean; revision: string;
  units: { id: string; name: string }[]; lastShift: string | null; enrollmentStatus: string;
  documents: { pending: number; missing: number; expired: number; near: number; complete: boolean } | null;
  portalStatus: 'not_released' | 'pending' | 'active' | 'blocked' | null;
};
export type DirectoryResult = {
  rows: DirectoryDoctor[]; total: number; page: number; pageSize: number;
  indicators: { total: number; active: number; pending: number; with_rqe: number; without_rqe: number; documents: number };
  specialties: string[]; units: { id: string; name: string }[];
  permissions: { documents: boolean; schedule: boolean; portal: boolean; edit: boolean; requestDocuments: boolean; export: boolean };
};
export const directoryStatusLabels = { active: 'Ativo', pending: 'Pendente', inactive: 'Inativo' };
export const directoryPortalLabels = { not_released: 'Não liberado', pending: 'Convite pendente', active: 'Ativo', blocked: 'Bloqueado' };
const choices: Partial<Record<DirectoryFilter, string[]>> = {
  status: ['all', 'active', 'pending', 'inactive'], rqe: ['all', 'with', 'without'], contract: ['all', 'pf', 'pj', 'scp'],
  signed: ['all', 'pending', 'signed'], documents: ['all', 'complete', 'pending', 'expired', 'near'],
  portal: ['all', 'not_released', 'pending', 'active', 'blocked'], lastShift: ['all', '30', '60', '90', 'none'],
};
export function parseDirectoryQuery(params: URLSearchParams, preferences = defaultDoctorListing): DirectoryQuery {
  const filters = { ...emptyDirectoryFilters };
  for (const key of Object.keys(filters) as DirectoryFilter[]) {
    let value = params.get(key) ?? (key === 'specialty' ? params.get('especialidade') : key === 'unit' ? params.get('unitId') : key === 'documents' ? params.get('documentStatus') : null);
    if (key === 'documents' && value === 'compliant') value = 'complete';
    if (value !== null && (!choices[key] || choices[key]?.includes(value))) filters[key] = value.slice(0, 150);
  }
  const size = Number(params.get('pageSize') || preferences.pageSize);
  const sort = params.get('sort') || preferences.sort;
  return { filters, page: Math.min(1_000_000, Math.max(1, Number(params.get('page')) || 1)) | 0,
    pageSize: ([25, 50, 100].includes(size) ? size : 25) as 25 | 50 | 100,
    sort: (['name', 'crm', 'specialty', 'status', 'pending'].includes(sort) ? sort : 'name') as DirectorySort,
    descending: params.has('descending') ? params.get('descending') === 'true' : preferences.descending };
}
export function directoryParams(query: DirectoryQuery, company?: string) {
  const params = new URLSearchParams();
  if (company) params.set('company', company);
  for (const key of Object.keys(query.filters) as DirectoryFilter[]) if (query.filters[key] !== emptyDirectoryFilters[key]) params.set(key, query.filters[key]);
  params.set('page', String(query.page)); params.set('pageSize', String(query.pageSize)); params.set('sort', query.sort);
  params.set('descending', String(query.descending));
  return params;
}
export function activeDirectoryFilters(filters: DirectoryFilters) {
  return (Object.keys(filters) as DirectoryFilter[]).filter(key => filters[key] !== emptyDirectoryFilters[key]);
}
export function directoryDocumentLabel(documents: DirectoryDoctor['documents']) {
  if (!documents) return 'Sem permissão';
  const parts = [documents.pending && `${documents.pending} pendência${documents.pending === 1 ? '' : 's'}`,
    documents.expired && `${documents.expired} vencido${documents.expired === 1 ? '' : 's'}`,
    documents.near && `${documents.near} próximo${documents.near === 1 ? '' : 's'} do vencimento`].filter(Boolean);
  return parts.join('; ') || 'Completa';
}
export const directoryBulkMessages: Record<string, string> = {
  success: 'Concluído', no_pending_documents: 'Sem pendências documentais', no_portal_account: 'Sem conta disponível no portal; não notificado',
  stale: 'Cadastro alterado; selecione novamente', unavailable: 'Cadastro indisponível', invalid: 'Confira as exigências cadastrais e bancárias', failed: 'Não foi possível concluir; tente novamente',
};

export function directoryExportError(status?: number) {
  if (status === 401) return 'Sessão expirada. Entre novamente para exportar.';
  if (status === 403) return 'A exportação exige permissão e verificação em duas etapas em Minha conta.';
  if (status === 413) return 'Refine os filtros ou exporte uma seleção menor para gerar um arquivo de até 4 MB.';
  return 'Não foi possível preparar a exportação. Confira os filtros e tente novamente.';
}
