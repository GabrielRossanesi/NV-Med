import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableDocuments, doctorScheduleCompliance, expiryAlertBand, getDocumentGovernance } from '../src/lib/documentGovernance.ts';

const doctor = { id: 'doctor-1', specialty: 'Cardiologia', linkedUnits: ['unit-1'] };
const requirements = [
  { type: 'crm', name: 'CRM', required: true, blocking: true, specialties: ['Cardiologia'] },
  { type: 'pediatria', name: 'Título', required: true, specialties: ['Pediatria'] },
  { type: 'optional', name: 'Opcional', required: false },
];
const documents = [
  { id: 'doc-1', doctorId: 'doctor-1', organizationId: 'org-1', type: 'crm', name: 'CRM', status: 'rejected' },
  { id: 'doc-2', doctorId: 'doctor-1', organizationId: 'org-1', type: 'pediatria', name: 'Título', status: 'not_sent' },
  { id: 'doc-3', doctorId: 'doctor-1', organizationId: 'org-1', type: 'optional', name: 'Opcional', status: 'not_sent' },
];

test('scopes required documents by specialty and optional state', () => {
  assert.deepEqual(applicableDocuments(doctor, documents, requirements).map(item => item.id), ['doc-1']);
});

test('blocks scheduling only when organization policy is enabled', () => {
  const warning = doctorScheduleCompliance(doctor, documents, { settings: { specialties: [], requiredDocuments: requirements, documentGovernance: { expiryAlertDays: [30, 7], blockSchedulingOnCritical: false, internalNotifications: true } } });
  assert.equal(warning.warning, true);
  assert.equal(warning.blocked, false);
  const blocked = doctorScheduleCompliance(doctor, documents, { settings: { specialties: [], requiredDocuments: requirements, documentGovernance: { expiryAlertDays: [30, 7], blockSchedulingOnCritical: true, internalNotifications: true } } });
  assert.equal(blocked.blocked, true);
});

test('normalizes alert thresholds and reports the matching band', () => {
  const governance = getDocumentGovernance({ settings: { specialties: [], requiredDocuments: [], documentGovernance: { expiryAlertDays: [7, 30, 30, 400], blockSchedulingOnCritical: false, internalNotifications: true } } });
  assert.deepEqual(governance.expiryAlertDays, [30, 7]);
  const reference = new Date('2026-09-22T12:00:00').getTime();
  const band = expiryAlertBand({ id: 'a', doctorId: 'd', organizationId: 'o', type: 'crm', name: 'CRM', status: 'approved', expiryDate: '2026-10-02' }, governance.expiryAlertDays, reference);
  assert.equal(band?.threshold, 30);
  assert.equal(band?.days, 10);
});
