import type { DocumentGovernanceSettings, DocumentRequirement, Doctor, MedicalDocument, Organization } from '@/types';
import { documentIsCritical, documentIsNearExpiry } from './documentCompliance.ts';

export const DEFAULT_DOCUMENT_GOVERNANCE: DocumentGovernanceSettings = {
  expiryAlertDays: [90, 60, 30, 7],
  blockSchedulingOnCritical: false,
  internalNotifications: true,
};

export function getDocumentGovernance(organization?: Pick<Organization, 'settings'> | null): DocumentGovernanceSettings {
  const stored = organization?.settings.documentGovernance;
  const days = [...new Set((stored?.expiryAlertDays || DEFAULT_DOCUMENT_GOVERNANCE.expiryAlertDays)
    .map(Number)
    .filter(day => Number.isInteger(day) && day > 0 && day <= 365))]
    .sort((a, b) => b - a);
  return {
    expiryAlertDays: days.length ? days : DEFAULT_DOCUMENT_GOVERNANCE.expiryAlertDays,
    blockSchedulingOnCritical: stored?.blockSchedulingOnCritical ?? DEFAULT_DOCUMENT_GOVERNANCE.blockSchedulingOnCritical,
    internalNotifications: stored?.internalNotifications ?? DEFAULT_DOCUMENT_GOVERNANCE.internalNotifications,
  };
}

export function requirementApplies(requirement: DocumentRequirement, doctor: Pick<Doctor, 'specialty' | 'linkedUnits'>) {
  if (!requirement.required) return false;
  if (requirement.specialties?.length && !requirement.specialties.includes(doctor.specialty)) return false;
  if (requirement.unitIds?.length && !doctor.linkedUnits.some(unitId => requirement.unitIds?.includes(unitId))) return false;
  return true;
}

export function applicableRequirements(doctor: Pick<Doctor, 'specialty' | 'linkedUnits'>, requirements?: DocumentRequirement[]) {
  return (requirements || []).filter(requirement => requirementApplies(requirement, doctor));
}

export function applicableDocuments(
  doctor: Pick<Doctor, 'id' | 'specialty' | 'linkedUnits'>,
  documents: MedicalDocument[],
  requirements?: DocumentRequirement[],
) {
  const doctorDocuments = documents.filter(document => document.doctorId === doctor.id);
  if (!requirements?.length) return doctorDocuments;
  const types = new Set(applicableRequirements(doctor, requirements).map(requirement => requirement.type));
  return doctorDocuments.filter(document => types.has(document.type));
}

export function documentRequirement(document: Pick<MedicalDocument, 'type'>, requirements?: DocumentRequirement[]) {
  return requirements?.find(requirement => requirement.type === document.type);
}

export function isBlockingDocument(
  document: MedicalDocument,
  requirements: DocumentRequirement[] | undefined,
  referenceTime = Date.now(),
) {
  const requirement = documentRequirement(document, requirements);
  return requirement?.blocking !== false && documentIsCritical(document, referenceTime);
}

export function doctorScheduleCompliance(
  doctor: Pick<Doctor, 'id' | 'specialty' | 'linkedUnits'>,
  documents: MedicalDocument[],
  organization?: Pick<Organization, 'settings'> | null,
  referenceTime = Date.now(),
) {
  const governance = getDocumentGovernance(organization);
  const requirements = organization?.settings.requiredDocuments || [];
  const scopedDocuments = applicableDocuments(doctor, documents, requirements);
  const blocking = scopedDocuments.filter(document => isBlockingDocument(document, requirements, referenceTime));
  const nearExpiry = scopedDocuments.filter(document => documentIsNearExpiry(document, referenceTime, Math.max(...governance.expiryAlertDays)));
  return {
    blocking,
    nearExpiry,
    blocked: governance.blockSchedulingOnCritical && blocking.length > 0,
    warning: blocking.length > 0 || nearExpiry.length > 0,
  };
}

export function expiryAlertBand(document: MedicalDocument, alertDays: number[], referenceTime = Date.now()) {
  if (!document.expiryDate || document.status !== 'approved') return null;
  const days = Math.ceil((new Date(`${document.expiryDate}T12:00:00`).getTime() - referenceTime) / 86_400_000);
  if (days < 0) return { days, threshold: 0, label: 'Vencido' };
  const threshold = [...alertDays].sort((a, b) => a - b).find(value => days <= value);
  return threshold ? { days, threshold, label: days === 0 ? 'Vence hoje' : `Vence em ${days} dia${days === 1 ? '' : 's'}` } : null;
}
