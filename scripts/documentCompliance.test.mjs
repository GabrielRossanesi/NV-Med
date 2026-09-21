import test from 'node:test';
import assert from 'node:assert/strict';
import { documentIsCritical, documentIsNearExpiry, getDoctorCompliance } from '../src/lib/documentCompliance.ts';

const doctor = { id: 'doctor-1', linkedUnits: ['unit-1'] };
const base = { organizationId: 'org-1', doctorId: doctor.id, name: 'Documento', type: 'rg_cnh' };

test('summarizes documentary compliance per doctor', () => {
  const documents = [
    { ...base, id: 'a', status: 'approved' },
    { ...base, id: 'b', status: 'not_sent' },
    { ...base, id: 'c', status: 'analyzing' },
    { ...base, id: 'd', status: 'expired' },
  ];
  assert.deepEqual(getDoctorCompliance(doctor, documents, Date.parse('2026-09-21T12:00:00')), {
    total: 4,
    approved: 1,
    critical: 2,
    review: 1,
    nearExpiry: 0,
    pending: 3,
    percentage: 25,
    compliant: false,
  });
});

test('treats missing, rejected and expired documents as critical', () => {
  for (const status of ['not_sent', 'rejected', 'expired']) assert.equal(documentIsCritical({ ...base, id: status, status }), true);
  assert.equal(documentIsCritical({ ...base, id: 'sent', status: 'sent' }), false);
});

test('flags approved documents expiring within thirty days', () => {
  const reference = Date.parse('2026-09-21T12:00:00');
  assert.equal(documentIsNearExpiry({ ...base, id: 'near', status: 'approved', expiryDate: '2026-10-15' }, reference), true);
  assert.equal(documentIsNearExpiry({ ...base, id: 'later', status: 'approved', expiryDate: '2026-11-15' }, reference), false);
});
