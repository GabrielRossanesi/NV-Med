export interface Organization {
  id: string;
  name: string;
  logo?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  address?: string;
  razaoSocial?: string;
  responsavelName?: string;
  responsavelRole?: string;
  city?: string;
  state?: string;
  plan?: 'bronze' | 'silver' | 'gold' | 'platinum';
  status?: 'active' | 'setup' | 'suspended' | 'cancelled';
  enabledModules?: string[];
  createdAt?: string;
  lastActive?: string;
  settings: {
    specialties: string[];
    requiredDocuments: DocumentRequirement[];
    documentGovernance?: DocumentGovernanceSettings;
  };
}

export interface DocumentRequirement {
  type: string;
  name: string;
  required: boolean;
  blocking?: boolean;
  expiryRequired?: boolean;
  specialties?: string[];
  unitIds?: string[];
}

export interface DocumentGovernanceSettings {
  expiryAlertDays: number[];
  blockSchedulingOnCritical: boolean;
  internalNotifications: boolean;
}

export type DoctorStatus = 'active' | 'pending' | 'inactive';

export interface Doctor {
  id: string;
  name: string;
  crm: string;
  crmUf: string;
  cpf: string;
  phone: string;
  email: string;
  specialty: string;
  address: string;
  status: DoctorStatus;
  linkedUnits: string[]; // Array of Unit IDs
  organizationId: string;
}

export type UnitType = 'hospital' | 'clinic' | 'er' | 'upa' | 'lab';
export type UnitStatus = 'active' | 'inactive';

export interface Unit {
  id: string;
  name: string;
  cnpj: string;
  address: string;
  city: string;
  state: string;
  type: UnitType;
  manager: string;
  phone: string;
  status: UnitStatus;
  specialties: string[]; // Specialties serviced at this unit
  organizationId: string;
}

export type SectorStatus = 'active' | 'inactive';

export interface Sector {
  id: string;
  organizationId: string;
  unitId: string;
  name: string;
  specialties: string[];
  status: SectorStatus;
  defaultStartTime: string;
  defaultEndTime: string;
  requiredDoctors: number;
}

export type DocumentType =
  | 'rg_cnh'
  | 'diploma_medicina'
  | 'diploma_residencia'
  | 'comprovante_residencia'
  | 'certidao_crm_etica'
  | 'certidao_crm_financeira';

export type DocumentStatus =
  | 'not_sent'
  | 'sent'
  | 'analyzing'
  | 'approved'
  | 'expired'
  | 'rejected';

export interface MedicalDocument {
  filePath?: string;
  id: string;
  doctorId: string;
  name: string; // Display name, e.g. "Diploma de Medicina"
  type: DocumentType;
  status: DocumentStatus;
  uploadDate?: string; // YYYY-MM-DD
  expiryDate?: string; // YYYY-MM-DD
  fileName?: string;
  organizationId: string;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  version?: number;
}

export type DocumentAuditAction = 'created' | 'file_uploaded' | 'file_replaced' | 'status_changed' | 'expiry_changed' | 'note_changed' | 'updated';

export interface DocumentAuditEntry {
  id: string;
  organizationId: string;
  doctorId: string;
  documentId: string;
  actorUserId?: string;
  actorName: string;
  action: DocumentAuditAction;
  fromStatus?: DocumentStatus;
  toStatus?: DocumentStatus;
  note?: string;
  changes: Record<string, unknown>;
  createdAt: string;
}

export type ShiftType = 'onsite' | 'oncall' | 'telemedicine';
export type ShiftStatus = 'open' | 'confirmed' | 'pending' | 'cancelled' | 'completed';
export type EmploymentType = 'clt' | 'concursado' | 'pj';
export type PaymentStatus = 'pending' | 'paid';
export type PaymentFrequency = 'on_delivery' | 'monthly';

export interface Shift {
  sectorId?: string;
  sector?: string;
  specialty?: string;
  employmentType?: EmploymentType;
  employerName?: string;
  paymentAmount?: number;
  paymentStatus?: PaymentStatus;
  paymentFrequency?: PaymentFrequency;
  paidAt?: string;
  id: string;
  doctorId?: string; // Empty while this staffing position is open
  unitId: string; // Linked Unit ID
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  type: ShiftType;
  status: ShiftStatus;
  notes?: string;
  organizationId: string;
}

export type AdditionalPermissions = Record<string, 'view' | 'edit'>;

export interface UserAccount {
  authUserId?: string;
  id: string;
  name: string;
  email: string;
  phone?: string;
  type: 'saas_admin' | 'tenant_user';
  organizationId: string | null; // null if saas_admin
  role: string; // e.g. CEO, Gerente, Diretor, Escalista, etc.
  status: 'active' | 'pending' | 'inactive';
  createdAt: string;
  lastActive?: string;
  avatar?: string;
  additionalPermissions?: AdditionalPermissions;
}
