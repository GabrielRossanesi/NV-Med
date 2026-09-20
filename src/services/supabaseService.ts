import { createClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/isConfigured';
import {
  Organization,
  Doctor,
  Unit,
  MedicalDocument,
  Shift,
  UserAccount,
  DocumentStatus,
  DocumentType,
  DoctorStatus,
  UnitType,
  UnitStatus,
  ShiftType,
  ShiftStatus
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
  cpf?: string;
  phone?: string;
  email?: string;
  specialty: string;
  address?: string;
  status: string;
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
  created_at?: string;
}

interface DbShift {
  sector?: string;
  employment_type?: Shift['employmentType'];
  employer_name?: string;
  id: string;
  organization_id: string;
  doctor_id: string;
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
    cpf: row.cpf || '',
    phone: row.phone || '',
    email: row.email || '',
    specialty: row.specialty,
    address: row.address || '',
    status: (row.status as DoctorStatus) || 'active',
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
    filePath: row.file_path
  };
}

function mapShiftFromDb(row: DbShift): Shift {
  return {
    sector: row.sector,
    employmentType: row.employment_type,
    employerName: row.employer_name,
    id: row.id,
    organizationId: row.organization_id,
    doctorId: row.doctor_id,
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
  const [orgs, doctors, units, documents, shifts, users] = await Promise.all([
    rows('organizations'), rows('doctors'), rows('units'), rows('medical_documents'), rows('shifts'),
    currentUser.type === 'saas_admin' ? rows('user_accounts') : Promise.resolve([profile])
  ]);
  return { currentUser, organizations: orgs.map(mapOrgFromDb), doctors: doctors.map(mapDoctorFromDb),
    units: units.map(mapUnitFromDb), documents: documents.map(mapDocumentFromDb), shifts: shifts.map(mapShiftFromDb), users: users.map(mapUserFromDb) };
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
    cpf: doctor.cpf,
    phone: doctor.phone,
    email: doctor.email,
    specialty: doctor.specialty,
    address: doctor.address,
    status: doctor.status,
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

  const payload: DbUnit = {
    id: unit.id,
    organization_id: unit.organizationId,
    name: unit.name,
    cnpj: unit.cnpj,
    address: unit.address,
    city: unit.city,
    state: unit.state,
    type: unit.type,
    manager: unit.manager,
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

export async function saveShiftToSupabase(shift: Shift) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const payload: DbShift = {
    id: shift.id,
    sector: shift.sector,
    employment_type: shift.employmentType,
    employer_name: shift.employerName,
    organization_id: shift.organizationId,
    doctor_id: shift.doctorId,
    unit_id: shift.unitId,
    date: shift.date,
    start_time: shift.startTime,
    end_time: shift.endTime,
    type: shift.type,
    status: shift.status,
    notes: shift.notes
  };

  const { error } = await supabase.from('shifts').upsert(payload).select('id').single();
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
}

export async function deleteShiftFromSupabase(shiftId: string) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const { error } = await supabase.from('shifts').delete().eq('id', shiftId).select('id').single();
  if (error) throw new Error('Não foi possível excluir: ' + error.message);
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
    file_path: doc.filePath
  };

  const { error } = await supabase.from('medical_documents').upsert(payload).select('id').single();
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
}

export async function saveOrganizationToSupabase(org: Organization) {
  const supabase = createClient();
  if (!supabase) throw new Error('Conexão não configurada.');

  const payload: DbOrganization = {
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

  const { error } = await supabase.from('organizations').upsert(payload).select('id').single();
  if (error) throw new Error('Não foi possível salvar: ' + error.message);
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
