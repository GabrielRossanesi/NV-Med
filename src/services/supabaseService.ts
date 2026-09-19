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
  created_at?: string;
}

interface DbShift {
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
    fileName: row.file_name
  };
}

function mapShiftFromDb(row: DbShift): Shift {
  return {
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

function mapUserFromDb(row: DbUserAccount): UserAccount {
  return {
    id: row.id,
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

export async function fetchInitialDataFromSupabase(): Promise<{
  organizations?: Organization[];
  doctors?: Doctor[];
  units?: Unit[];
  documents?: MedicalDocument[];
  shifts?: Shift[];
  users?: UserAccount[];
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const supabase = createClient();
  if (!supabase) return null;

  try {
    const [orgsRes, doctorsRes, unitsRes, docsRes, shiftsRes, usersRes] = await Promise.all([
      supabase.from('organizations').select('*').order('name'),
      supabase.from('doctors').select('*').order('name'),
      supabase.from('units').select('*').order('name'),
      supabase.from('medical_documents').select('*'),
      supabase.from('shifts').select('*').order('date', { ascending: false }),
      supabase.from('user_accounts').select('*').order('name')
    ]);

    if (orgsRes.error) throw orgsRes.error;

    return {
      organizations: (orgsRes.data as DbOrganization[] | null)?.map(mapOrgFromDb) || [],
      doctors: (doctorsRes.data as DbDoctor[] | null)?.map(mapDoctorFromDb) || [],
      units: (unitsRes.data as DbUnit[] | null)?.map(mapUnitFromDb) || [],
      documents: (docsRes.data as DbMedicalDocument[] | null)?.map(mapDocumentFromDb) || [],
      shifts: (shiftsRes.data as DbShift[] | null)?.map(mapShiftFromDb) || [],
      users: (usersRes.data as DbUserAccount[] | null)?.map(mapUserFromDb) || []
    };
  } catch (error) {
    console.warn('[Supabase] Falha ao sincronizar dados em nuvem, usando cache local:', error);
    return null;
  }
}

// ==============================================================================
// OPERAÇÕES DE ESCRITA ASSÍNCRONA (PERSISTÊNCIA EM SEGUNDO PLANO)
// ==============================================================================

export async function saveDoctorToSupabase(doctor: Doctor) {
  const supabase = createClient();
  if (!supabase) return;

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

  await supabase.from('doctors').upsert(payload);
}

export async function deleteDoctorFromSupabase(doctorId: string) {
  const supabase = createClient();
  if (!supabase) return;

  await supabase.from('doctors').delete().eq('id', doctorId);
}

export async function saveUnitToSupabase(unit: Unit) {
  const supabase = createClient();
  if (!supabase) return;

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

  await supabase.from('units').upsert(payload);
}

export async function deleteUnitFromSupabase(unitId: string) {
  const supabase = createClient();
  if (!supabase) return;

  await supabase.from('units').delete().eq('id', unitId);
}

export async function saveShiftToSupabase(shift: Shift) {
  const supabase = createClient();
  if (!supabase) return;

  const payload: DbShift = {
    id: shift.id,
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

  await supabase.from('shifts').upsert(payload);
}

export async function deleteShiftFromSupabase(shiftId: string) {
  const supabase = createClient();
  if (!supabase) return;

  await supabase.from('shifts').delete().eq('id', shiftId);
}

export async function saveDocumentToSupabase(doc: MedicalDocument) {
  const supabase = createClient();
  if (!supabase) return;

  const payload: DbMedicalDocument = {
    id: doc.id,
    organization_id: doc.organizationId,
    doctor_id: doc.doctorId,
    name: doc.name,
    type: doc.type,
    status: doc.status,
    upload_date: doc.uploadDate,
    expiry_date: doc.expiryDate,
    file_name: doc.fileName
  };

  await supabase.from('medical_documents').upsert(payload);
}

export async function saveOrganizationToSupabase(org: Organization) {
  const supabase = createClient();
  if (!supabase) return;

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

  await supabase.from('organizations').upsert(payload);
}

export async function saveUserToSupabase(user: UserAccount) {
  const supabase = createClient();
  if (!supabase) return;

  const payload: DbUserAccount = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    type: user.type,
    organization_id: user.organizationId,
    role: user.role,
    status: user.status,
    avatar: user.avatar,
    last_active: user.lastActive
  };

  await supabase.from('user_accounts').upsert(payload);
}

// ==============================================================================
// STORAGE: UPLOAD DE DOCUMENTOS PARA O BUCKET 'medical-documents'
// ==============================================================================

export async function uploadDocumentFileToSupabase(
  file: File,
  organizationId: string,
  doctorId: string
): Promise<{ fileUrl: string; fileName: string } | null> {
  const supabase = createClient();
  if (!supabase) return null;

  try {
    const fileExt = file.name.split('.').pop();
    const cleanFileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = `${organizationId}/${doctorId}/${cleanFileName}`;

    const { error: uploadError } = await supabase.storage
      .from('medical-documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('medical-documents')
      .getPublicUrl(filePath);

    return {
      fileUrl: publicUrl,
      fileName: file.name
    };
  } catch (err) {
    console.error('[Supabase Storage] Erro ao fazer upload de documento:', err);
    return null;
  }
}
