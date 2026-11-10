import test from 'node:test';
import assert from 'node:assert/strict';
import { documentTypeFromName, validateDocumentRequirement } from '../src/lib/documentRequirements.ts';
import { applicableDocuments, applicableRequirements, doctorScheduleCompliance } from '../src/lib/documentGovernance.ts';
import { getDoctorCompliance } from '../src/lib/documentCompliance.ts';

const units = [{ id: 'unit-a' }, { id: 'unit-b' }];
const base = { type: 'crm', name: 'Carteira do CRM', required: true, unitIds: [], specialties: [] };

test('a company requirement applies to existing and future units', () => {
  for (const unit of ['unit-a', 'unit-b', 'future-unit']) {
    assert.equal(applicableRequirements({ specialty: 'Pediatria', linkedUnits: [unit] }, [base]).length, 1);
  }
});
test('specific-unit requirements add to the company checklist only for matching doctors', () => {
  const local = { ...base, type: 'acls', name: 'ACLS', unitIds: ['unit-a'], specialties: ['Cardiologia'] };
  assert.deepEqual(applicableRequirements({ specialty: 'Cardiologia', linkedUnits: ['unit-a'] }, [base, local]).map(item => item.type), ['crm', 'acls']);
  assert.deepEqual(applicableRequirements({ specialty: 'Cardiologia', linkedUnits: ['unit-b'] }, [base, local]).map(item => item.type), ['crm']);
  assert.deepEqual(applicableRequirements({ specialty: 'Pediatria', linkedUnits: ['unit-a'] }, [base, local]).map(item => item.type), ['crm']);
});
test('specific-unit selection cannot silently become an all-unit requirement', () => {
  assert.match(validateDocumentRequirement(base, [], units, 'selected'), /Selecione pelo menos/);
  assert.equal(validateDocumentRequirement(base, [], units, 'all'), '');
});
test('requirements reject foreign units and duplicate names, while allowing edits', () => {
  assert.match(validateDocumentRequirement({ ...base, unitIds: ['foreign-unit'] }, [], units, 'selected'), /desta empresa/);
  assert.match(validateDocumentRequirement({ ...base, type: 'other', name: 'carteira do crm' }, [base], units, 'all'), /Já existe/);
  assert.equal(validateDocumentRequirement(base, [base], units, 'all'), '');
});
test('document keys remain safe and unique without changing existing keys', () => {
  const key = documentTypeFromName('Certidão Ética / CRM', []);
  assert.equal(key, 'custom_certidao_etica_crm');
  assert.equal(documentTypeFromName('Certidão Ética / CRM', [{ ...base, type: key }]), `${key}_2`);
});

test('removing the last requirement preserves uploads without continuing to require them', () => {
  const doctor = { id: 'doctor', specialty: 'Cardiologia', linkedUnits: ['unit-a'] };
  const documents = [{ id: 'old', doctorId: doctor.id, organizationId: 'org', type: 'crm', name: 'CRM', status: 'rejected' }];
  const organization = { settings: { specialties: [], requiredDocuments: [], documentGovernance: { blockSchedulingOnCritical: true, expiryAlertDays: [30], internalNotifications: true } } };
  assert.deepEqual(applicableDocuments(doctor, documents, []), []);
  assert.equal(documents.length, 1);
  assert.equal(getDoctorCompliance(doctor, documents, Date.now(), []).compliant, true);
  assert.equal(doctorScheduleCompliance(doctor, documents, organization).blocked, false);
});
