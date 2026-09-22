import type { DocumentRequirement, DocumentStatus, Doctor, MedicalDocument } from '@/types';

export const documentStatusLabels: Record<DocumentStatus, string> = {
  approved: 'Aprovado',
  analyzing: 'Em análise',
  expired: 'Vencido',
  rejected: 'Reprovado',
  sent: 'Recebido',
  not_sent: 'Não enviado',
};

export const documentStatusOrder: Record<DocumentStatus, number> = {
  expired: 0,
  rejected: 1,
  not_sent: 2,
  sent: 3,
  analyzing: 4,
  approved: 5,
};

export const documentStatusClasses: Record<DocumentStatus, string> = {
  approved: 'bg-success/10 text-success border-success/20',
  analyzing: 'bg-primary/10 text-primary border-primary/20',
  expired: 'bg-danger/10 text-danger border-danger/20',
  rejected: 'bg-warning/10 text-warning border-warning/20',
  sent: 'bg-primary/10 text-primary border-primary/20',
  not_sent: 'bg-surface-muted text-text-muted border-border',
};

export function documentNeedsAction(document: MedicalDocument) {
  return document.status !== 'approved';
}

export function documentIsCritical(document: MedicalDocument, referenceTime = Date.now()) {
  const expiredByDate = Boolean(document.expiryDate) && new Date(`${document.expiryDate}T12:00:00`).getTime() < referenceTime;
  return document.status === 'expired' || document.status === 'rejected' || document.status === 'not_sent' || expiredByDate;
}

export function documentIsNearExpiry(document: MedicalDocument, referenceTime = Date.now(), days = 30) {
  if (!document.expiryDate || document.status !== 'approved') return false;
  const difference = new Date(`${document.expiryDate}T12:00:00`).getTime() - referenceTime;
  const remainingDays = Math.ceil(difference / 86_400_000);
  return remainingDays >= 0 && remainingDays <= days;
}

export function getDoctorCompliance(
  doctor: Pick<Doctor, 'id' | 'specialty' | 'linkedUnits'>,
  documents: MedicalDocument[],
  referenceTime = Date.now(),
  requirements?: DocumentRequirement[],
  nearExpiryDays = 30,
) {
  const scopedTypes = requirements?.length ? new Set(requirements
    .filter(requirement => requirement.required)
    .filter(requirement => !requirement.specialties?.length || requirement.specialties.includes(doctor.specialty))
    .filter(requirement => !requirement.unitIds?.length || doctor.linkedUnits.some(unitId => requirement.unitIds?.includes(unitId)))
    .map(requirement => requirement.type)) : null;
  const doctorDocuments = documents.filter(document => document.doctorId === doctor.id && (!scopedTypes || scopedTypes.has(document.type)));
  const approved = doctorDocuments.filter(document => document.status === 'approved' && !documentIsCritical(document, referenceTime)).length;
  const critical = doctorDocuments.filter(document => documentIsCritical(document, referenceTime)).length;
  const review = doctorDocuments.filter(document => document.status === 'sent' || document.status === 'analyzing').length;
  const nearExpiry = doctorDocuments.filter(document => documentIsNearExpiry(document, referenceTime, nearExpiryDays)).length;
  const pending = doctorDocuments.length - approved;
  const percentage = doctorDocuments.length ? Math.round((approved / doctorDocuments.length) * 100) : 0;
  return {
    total: doctorDocuments.length,
    approved,
    critical,
    review,
    nearExpiry,
    pending,
    percentage,
    compliant: doctorDocuments.length > 0 && pending === 0 && critical === 0 && nearExpiry === 0,
  };
}

export function doctorMatchesUnit(doctor: Pick<Doctor, 'linkedUnits'>, unitId: string) {
  return !unitId || doctor.linkedUnits.includes(unitId);
}
