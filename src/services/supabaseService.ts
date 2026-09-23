import { createClient } from '@/lib/supabase/client';
import { withAbortTimeout } from '@/lib/requestTimeout';
import { isSupabaseConfigured } from '@/lib/supabase/isConfigured';
import {
  Organization,
  Doctor,
  Unit,
  Sector,
  MedicalDocument,
  Shift,
  UserAccount,
  DocumentStatus,
  DocumentType,
  DoctorStatus,
  UnitType,
  UnitStatus,
  ShiftType,
  ShiftStatus,
  DocumentAuditEntry
} from '@/types';

// ==============================================================================
// MAPEAMENTO: DATABASE (snake_case) -> APP (camelCase)
// ==============================================================================

interface DbOrganization {
  id: string;
  name: string;
  razao_social?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  logo?: string;
  plan?: string;
  status?: string;
  enabled_modules?: string[];
  settings?: {
    specialties: string[];
    requiredDocuments: { type: string; name: string; required: boolean }[];
  };
  last_active?: string;
  created_at?: string;
}

interface DbDoctor {
  id: string;
  organization_id: string;
  name: string;
  crm: string;
  crm_uf: string;
  rqe?: string;
  cpf?: string;
  phone?: string;
  email?: string;
  specialty: string;
  address?: string;
  status: string;
  contract_model?: Doctor['contractModel'];
  contract_signed?: boolean;
  linked_units?: string[];
  created_at?: string;
}

interface DbUnit {
  id: string;
  organization_id: string;
  name: string;
  cnpj?: string;
  address?: string;
  city?: string;
  state?: string;
  type: string;
  manager?: string;
  phone?: string;
  status: string;
  specialties?: string[];
  created_at?: string;
}

interface DbSector {
  id: string;
  organization_id: string;
  unit_id: string;
  name: string;
  specialties?: string[];
  status: string;
  default_start_time: string;
  default_end_time: string;
  required_doctors: number;
  coverage_periods?: Array<{ kind: 'day' | 'night'; startTime: string; endTime: string; requiredDoctors: number }>;
}

interface DbMedicalDocument {
  id: string;
  organization_id: string;
  doctor_id: string;
  name: string;
  type: string;
  status: string;
  upload_date?: string;
  expiry_date?: string;
  file_name?: string;
  file_url?: string;
  file_path?: string;
  review_note?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  version?: number;
  created_at?: string;
}

interface DbDocumentAudit {
  id: string;
  organization_id: string;
  doctor_id: string;
  document_id: string;
  actor_user_id?: string;
  actor_name?: string;
  action: DocumentAuditEntry['action'];
  from_status?: DocumentStatus;
  to_status?: DocumentStatus;
  note?: string;
  changes?: Record<string, unknown>;
  created_at: string;
}

interface DbShift {
  sector_id?: string;
  sector?: string;
  specialty?: string;
  employment_type?: Shift['employmentType'];
  employer_name?: string;
  payment_amount?: number | string;
  payment_status?: Shift['paymentStatus'];
  payment_frequency?: Shift['paymentFrequency'];
  paid_at?: string | null;
  id: string;
  organization_id: string;
  doctor_id?: string | null;
  unit_id: string;
  date: string;
  start_time: string;
  end_time: string;
  type: string;
  status: string;
  notes?: string;
  created_at?: string;
}

interface DbUserAccount {
  id: string;
  auth_user_id?: string;
  name: string;
  email: string;
  phone?: string;
  type: string;
  organization_id?: string | null;
  role: string;
  status: string;
  avatar?: string;
  last_active?: string;
  created_at?: string;
  additional_permissions?: UserAccount['additionalPermissions'];
}

function mapOrgFromDb(row: DbOrganization): Organization {
  return {
    id: row.id,
    name: row.name,
    razaoSocial: row.razao_social,
    cnpj: row.cnpj,
    phone: row.phone,
    email: row.email,
    address: row.address,
    city: row.city,
    state: row.state,
    logo: row.logo,
    plan: row.plan as Organization['plan'],
    status: row.status as Organization['status'],
    enabledModules: row.enabled_modules || [],
    settings: row.settings || { specialties: [], requiredDocuments: [] },
    lastActive: row.last_active,
    createdAt: row.created_at?.split('T')[0]
  };
}

function mapDoctorFromDb(row: DbDoctor): Doctor {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    crm: row.crm,
    crmUf: row.crm_uf,
    rqe: row.rqe || '',
    cpf: row.cpf || '',
    phone: row.phone || '',
    email: row.email || '',
    specialty: row.specialty,
    address: row.address || '',
    status: (row.status as DoctorStatus) || 'active',
    contractModel: row.contract_model || 'pf',
    contractSigned: row.contract_signed || false,
    linkedUnits: row.linked_units || []
  };
}

function mapUnitFromDb(row: DbUnit): Unit {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    cnpj: row.cnpj || '',
    address: row.address || '',
    city: row.city || '',
    state: row.state || 'SP',
    type: (row.type as UnitType) || 'clinic',
    manager: row.manager || '',
    phone: row.phone || '',
    status: (row.status as UnitStatus) || 'active',
    specialties: row.specialties || []
  };
}

function mapSectorFromDb(row: DbSector): Sector {
  const legacyPeriod = {
    kind: (row.default_end_time < row.default_start_time ? 'night' : 'day') as 'day' | 'night',
    startTime: row.default_start_time || '07:00',
    endTime: row.default_end_time || '19:00',
    requiredDoctors: Math.max(1, row.required_doctors || 1)
  };
  return {
    id: row.id,
    organizationId: row.organization_id,
    unitId: row.unit_id,
    name: row.name,
    specialties: row.specialties || [],
    status: row.status === 'inactive' ? 'inactive' : 'active',
    defaultStartTime: row.default_start_time || '07:00',
    defaultEndTime: row.default_end_time || '19:00',
    requiredDoctors: legacyPeriod.requiredDoctors,
    coveragePeriods: row.coverage_periods?.length ? row.coverage_periods : [legacyPeriod]
  };
}

function mapDocumentFromDb(row: DbMedicalDocument): MedicalDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    doctorId: row.doctor_id,
    name: row.name,
    type: row.type as DocumentType,
    status: row.status as DocumentStatus,
    uploadDate: row.upload_date,
    expiryDate: row.expiry_date,
    fileName: row.file_name,
    filePath: row.file_path,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    version: row.version || 1,
  };
}

function mapDocumentAuditFromDb(row: DbDocumentAudit): DocumentAuditEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    doctorId: row.doctor_id,
    documentId: row.document_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name || 'Sistema',
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    changes: row.changes || {},
    createdAt: row.created_at,
  };
}

function mapShiftFromDb(row: DbShift): Shift {
  return {
    sectorId: row.sector_id,
    sector: row.sector,
    specialty: row.specialty,
    employmentType: row.employment_type,
    employerName: row.employer_name,
    paymentAmount: Number(row.payment_amount || 0),
    paymentStatus: row.payment_status || 'pending',
    paymentFrequency: row.payment_frequency || 'on_delivery',
    paidAt: row.paid_at || undefined,
    id: row.id,
    organizationId: row.organization_id,
    doctorId: row.doctor_id || undefined,
    unitId: row.unit_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    type: (row.type as ShiftType) || 'onsite',
    status: (row.status as ShiftStatus) || 'confirmed',
    notes: row.notes
  };
}

export function mapUserFromDb(row: DbUserAccount): UserAccount {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    type: (row.type as 'saas_admin' | 'tenant_user') || 'tenant_user',
    organizationId: row.organization_id || null,
    role: row.role,
    status: (row.status as 'active' | 'pending' | 'inactive') || 'active',
    avatar: row.avatar || '',
    lastActive: row.last_active,
    additionalPermissions: row.additional_permissions || {},
    createdAt: row.created_at?.split('T')[0] || new Date().toISOString().split('T')[0]
  };
}

// ==============================================================================
// OPERAÇÕES DE LEITURA (BOOTSTRAP & REFRESH)
// ==============================================================================

export async function fetchInitialDataFromSupabase() {
  const supabase = createClient();
  if (!supabase || !isSupabaseConfigured()) throw new Error('Conexão não configurada. Contate o administrador.');
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sua sessão expirou. Entre novamente.');
  const { data: profile, error: profileError } = await supabase.from('user_accounts').select('*').eq('auth_user_id', auth.user.id).eq('status', 'active').single();
  if (profileError || !profile) throw new Error('Seu acesso ainda não foi liberado. Contate o administrador.');
  const currentUser = mapUserFromDb(profile);
  if (currentUser.avatar) {
    const { data: avatar } = await supabase.storage.from('profile-avatars').createSignedUrl(currentUser.avatar, 3600);
    if (avatar?.signedUrl) currentUser.avatar = avatar.signedUrl;
  }
  async function rows(table: string) {
    const result = [];
    for (let offset = 0; ; offset += 500) {
      let query = supabase!.from(table).select('*').order('id').range(offset, offset + 499);
      if (currentUser.type !== 'saas_admin') {
        if (!currentUser.organizationId) throw new Error('Usuário sem empresa vinculada.');
        query = query.eq(table === 'organizations' ? 'id' : 'organization_id', currentUser.organizationId);
      }
      const { data, error } = await query;
      if (error) throw new Error('Não foi possível carregar ' + table + '. Tente novamente.');
      result.push(...data);
      if (data.length < 500) return result;
    }
  }
  const [orgs, doctors, units, sectors, documents, shifts, users, documentAudits] = await Promise.all([
    rows('organizations'), rows('doctors'), rows('units'), rows('sectors'), rows('medical_documents'), rows('shifts'),
    currentUser.type === 'saas_admin' ? rows('user_accounts') : Promise.resolve([profile]),
    fetchDocumentAuditLogsFromSupabase().catch(() => []),
  ]);
  return { currentUser, organizations: orgs.map(mapOrgFromDb), doctors: doctors.map(mapDoctorFromDb),
    units: units.map(mapUnitFromDb), sectors: sectors.map(mapSectorFromDb), documents: documents.map(mapDocumentFromDb), shifts: shifts.map(mapShiftFromDb), users: users.map(mapUserFromDb), documentAudits };
}

export async function fetchDocumentAuditLogsFromSupabase() {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const { data, error } = await supabase.from('document_audit_logs').select('*').order('created_at', { ascending: false }).limit(1000);
  if (error) throw new Error('Não foi possível carregar o histórico documental.');
  return (data as DbDocumentAudit[]).map(mapDocumentAuditFromDb);
}

export async function fetchMedicalDocumentsForOrganization(organizationId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const { data, error } = await supabase
    .from('medical_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .order('name');
  if (error) throw new Error('Não foi possível atualizar o checklist documental.');
  return (data as DbMedicalDocument[]).map(mapDocumentFromDb);
}

// ==============================================================================
// OPERAÇÕES DE ESCRITA ASSÍNCRONA (PERSISTÊNCIA EM SEGUNDO PLANO)
// ==============================================================================

export async function saveDoctorToSupabase(doctor: Doctor) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const payload: DbDoctor = {
    id: doctor.id,
    organization_id: doctor.organizationId,
    name: doctor.name,
    crm: doctor.crm,
    crm_uf: doctor.crmUf,
    rqe: doctor.rqe,
    cpf: doctor.cpf,
    phone: doctor.phone,
    email: doctor.email,
    specialty: doctor.specialty,
    address: doctor.address,
    status: doctor.status,
    contract_model: doctor.contractModel,
    contract_signed: doctor.contractSigned,
    linked_units: doctor.linkedUnits
  };

  const { error } = await supabase.from('doctors').upsert(payload).select('id').single();
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
}

export async function deleteDoctorFromSupabase(doctorId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { error } = await supabase.from('doctors').delete().eq('id', doctorId).select('id').single();
  if (error) throw new Error('Não foi possível excluir: ' + error.message);
}

export async function saveUnitToSupabase(unit: Unit) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('name,cnpj')
    .eq('id', unit.organizationId)
    .single();
  if (organizationError || !organization) throw new Error('Empresa responsável não encontrada.');
  const companyCnpj = organization.cnpj?.trim();
  if (!companyCnpj) throw new Error('O CNPJ da empresa responsável ainda não foi configurado. Solicite ao administrador SaaS a atualização do cadastro da empresa.');

  const payload: DbUnit = {
    id: unit.id,
    organization_id: unit.organizationId,
    name: unit.name,
    cnpj: companyCnpj,
    address: unit.address,
    city: unit.city,
    state: unit.state,
    type: unit.type,
    manager: organization.name,
    phone: unit.phone,
    status: unit.status,
    specialties: unit.specialties
  };

  const { error } = await supabase.from('units').upsert(payload).select('id').single();
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
}

export async function deleteUnitFromSupabase(unitId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { error } = await supabase.from('units').delete().eq('id', unitId).select('id').single();
  if (error) throw new Error('Não foi possível excluir: ' + error.message);
}

export async function saveSectorToSupabase(sector: Sector) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const payload: DbSector = {
    id: sector.id,
    organization_id: sector.organizationId,
    unit_id: sector.unitId,
    name: sector.name,
    specialties: sector.specialties,
    status: sector.status,
    default_start_time: sector.defaultStartTime,
    default_end_time: sector.defaultEndTime,
    required_doctors: sector.requiredDoctors,
    coverage_periods: sector.coveragePeriods
  };
  const { error } = await supabase.from('sectors').upsert(payload).select('id').single();
  if (error?.code === '23505' || error?.message.includes('sectors_unit_name_unique')) throw new Error('Já existe um setor com este nome nesta unidade. Edite o setor existente para incluir o período diurno ou noturno.');
  if (error) throw new Error('Não foi possível salvar o setor: ' + error.message);
}

export async function deleteSectorFromSupabase(sectorId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const { error } = await supabase.from('sectors').delete().eq('id', sectorId).select('id').single();
  if (error) throw new Error('Não foi possível excluir o setor. Desative-o se já houver plantões vinculados.');
}

export async function saveShiftToSupabase(shift: Shift) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const payload: DbShift = {
    id: shift.id,
    sector_id: shift.sectorId,
    sector: shift.sector,
    specialty: shift.specialty,
    employment_type: shift.employmentType,
    employer_name: shift.employerName,
    payment_amount: shift.paymentAmount || 0,
    payment_status: shift.paymentStatus || 'pending',
    payment_frequency: shift.paymentFrequency || 'on_delivery',
    paid_at: shift.paymentStatus === 'paid' ? shift.paidAt || new Date().toISOString() : null,
    organization_id: shift.organizationId,
    doctor_id: shift.doctorId || null,
    unit_id: shift.unitId,
    date: shift.date,
    start_time: shift.startTime,
    end_time: shift.endTime,
    type: shift.type,
    status: shift.status,
    notes: shift.notes
  };

  const { error } = await withAbortTimeout(
    async signal => await supabase.from('shifts').upsert(payload).select('id').abortSignal(signal).single(),
    { message: 'O servidor demorou para confirmar o plantão. Verifique sua conexão e tente novamente.' }
  );
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
}

export async function saveShiftsToSupabase(shifts: Shift[]) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const payload = shifts.map((shift): DbShift => ({
    id: shift.id,
    sector_id: shift.sectorId,
    sector: shift.sector,
    specialty: shift.specialty,
    employment_type: shift.employmentType,
    employer_name: shift.employerName,
    payment_amount: shift.paymentAmount || 0,
    payment_status: shift.paymentStatus || 'pending',
    payment_frequency: shift.paymentFrequency || 'on_delivery',
    paid_at: shift.paymentStatus === 'paid' ? shift.paidAt || new Date().toISOString() : null,
    organization_id: shift.organizationId,
    doctor_id: shift.doctorId || null,
    unit_id: shift.unitId,
    date: shift.date,
    start_time: shift.startTime,
    end_time: shift.endTime,
    type: shift.type,
    status: shift.status,
    notes: shift.notes
  }));
  const { error } = await withAbortTimeout(
    async signal => await supabase.from('shifts').upsert(payload).select('id').abortSignal(signal),
    { message: 'O servidor demorou para confirmar os postos. Verifique sua conexão e tente novamente.' }
  );
  if (error) throw new Error('Não foi possível salvar os postos: ' + error.message);
}

export async function deleteShiftFromSupabase(shiftId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { error } = await supabase.from('shifts').delete().eq('id', shiftId).select('id').single();
  if (error) throw new Error('Não foi possível excluir: ' + error.message);
}

export async function updateShiftPaymentInSupabase(shiftId: string, paymentStatus: Shift['paymentStatus']) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { data, error } = await supabase.rpc('nv_update_shift_payment', {
    target_id: shiftId,
    next_status: paymentStatus,
  });
  if (error) throw new Error('Não foi possível atualizar o pagamento: ' + error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Plantão não encontrado nesta empresa.');
  return mapShiftFromDb(row as DbShift);
}

export async function updateShiftFinancialsInSupabase(
  shiftId: string,
  paymentAmount: number,
  paymentFrequency: NonNullable<Shift['paymentFrequency']>,
  paymentStatus: NonNullable<Shift['paymentStatus']>,
) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { data, error } = await supabase.rpc('nv_update_shift_financials', {
    target_id: shiftId,
    next_amount: paymentAmount,
    next_frequency: paymentFrequency,
    next_status: paymentStatus,
  });
  if (error) throw new Error('Não foi possível atualizar os dados financeiros: ' + error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('Plantão não encontrado nesta empresa.');
  return mapShiftFromDb(row as DbShift);
}

export async function saveDocumentToSupabase(doc: MedicalDocument) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const payload: DbMedicalDocument = {
    id: doc.id,
    organization_id: doc.organizationId,
    doctor_id: doc.doctorId,
    name: doc.name,
    type: doc.type,
    status: doc.status,
    upload_date: doc.uploadDate,
    expiry_date: doc.expiryDate,
    file_name: doc.fileName,
    file_path: doc.filePath,
    review_note: doc.reviewNote,
  };

  const { data, error } = await supabase.from('medical_documents').upsert(payload).select('*').single();
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
  return mapDocumentFromDb(data as DbMedicalDocument);
}

export async function saveDocumentsToSupabase(documents: MedicalDocument[]) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const payload = documents.map(doc => ({
    id: doc.id,
    organization_id: doc.organizationId,
    doctor_id: doc.doctorId,
    name: doc.name,
    type: doc.type,
    status: doc.status,
    upload_date: doc.uploadDate,
    expiry_date: doc.expiryDate,
    file_name: doc.fileName,
    file_path: doc.filePath,
    review_note: doc.reviewNote,
  }));
  const { data, error } = await supabase.from('medical_documents').upsert(payload).select('*');
  if (error) throw new Error('Não foi possível atualizar os documentos: ' + error.message);
  return (data as DbMedicalDocument[]).map(mapDocumentFromDb);
}

function mapOrganizationToDb(org: Organization): DbOrganization {
  return {
    id: org.id,
    name: org.name,
    razao_social: org.razaoSocial,
    cnpj: org.cnpj,
    phone: org.phone,
    email: org.email,
    address: org.address,
    city: org.city,
    state: org.state,
    logo: org.logo,
    plan: org.plan,
    status: org.status,
    enabled_modules: org.enabledModules,
    settings: org.settings,
    last_active: org.lastActive
  };
}

export async function createOrganizationInSupabase(org: Organization) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { error } = await supabase
    .from('organizations')
    .insert(mapOrganizationToDb(org))
    .select('id')
    .single();
  if (error) throw new Error('Não foi possível criar a empresa: ' + error.message);
}

export async function updateOrganizationInSupabase(org: Organization) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const changes: Partial<DbOrganization> = mapOrganizationToDb(org);
  delete changes.id;
  const { error } = await supabase
    .from('organizations')
    .update(changes)
    .eq('id', org.id)
    .select('id')
    .single();
  if (error) throw new Error('Não foi possível atualizar a empresa: ' + error.message);
}

// ==============================================================================
// STORAGE: UPLOAD DE DOCUMENTOS PARA O BUCKET 'medical-documents'
// ==============================================================================

export async function uploadDocumentFileToSupabase(file: File, organizationId: string, doctorId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024 || file.size === 0) {
    throw new Error('Selecione um PDF, JPG ou PNG de até 10 MB.');
  }
  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[file.type];
  const filePath = organizationId + '/' + doctorId + '/' + crypto.randomUUID() + '.' + ext;
  const { error } = await supabase.storage.from('medical-documents').upload(filePath, file, { upsert: false, contentType: file.type });
  if (error) throw new Error('Não foi possível enviar o arquivo: ' + error.message);
  return { filePath, fileName: file.name };
}

export async function openDocument(filePath: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');
  const { data, error } = await supabase.storage.from('medical-documents').createSignedUrl(filePath, 60);
  if (error) throw new Error('Não foi possível abrir o documento.');
  return data.signedUrl;
}
