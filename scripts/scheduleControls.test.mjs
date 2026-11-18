import test from 'node:test';
import assert from 'node:assert/strict';
import { canPerformAction, isScheduleAdministrator, sanitizeAdditionalPermissions } from '../src/lib/permissions.ts';
import { scheduleSectors, scheduleLeaseValid } from '../src/lib/scheduleScope.ts';
import { getScheduleDeletionTargets } from '../src/lib/scheduleDeletion.ts';

test('medical and medical coordinator profiles cannot acquire administrative powers through grants', () => {
  for (const role of ['Médico', 'Coordenador Médico', 'Medico', 'Unknown']) {
    const user = { type: 'tenant_user', role, additionalPermissions: { escala: 'edit', 'escala.edit': 'allow', 'escala.create': 'allow', 'escala.approve': 'allow', 'escala.history': 'allow' } };
    assert.equal(isScheduleAdministrator(user), false);
    for (const action of ['view', 'create', 'edit', 'delete', 'approve', 'history']) assert.equal(canPerformAction(user, 'escala', action), false);
  }
});
test('administrative audit is independent of editing and can be granted only to an administrative profile', () => {
  const user = { type: 'tenant_user', role: 'Financeiro', additionalPermissions: { 'escala.history': 'allow' } };
  assert.equal(canPerformAction(user, 'escala', 'history'), true);
  assert.equal(canPerformAction(user, 'escala', 'edit'), false);
  assert.deepEqual(sanitizeAdditionalPermissions({ 'escala.history': 'allow' }, 'tenant_user'), { 'escala.history': 'allow' });
});
const units = [{ id: 'u1', organizationId: 'org', status: 'active' }, { id: 'u2', organizationId: 'org', status: 'active' }];
const sectors = [{ id: 's1', unitId: 'u1', organizationId: 'org', status: 'active' }, { id: 's2', unitId: 'u1', organizationId: 'org', status: 'active' },
  { id: 'inactive', unitId: 'u1', organizationId: 'org', status: 'inactive' }, { id: 'foreign', unitId: 'u1', organizationId: 'other', status: 'active' }, { id: 's3', unitId: 'u2', organizationId: 'org', status: 'active' }];
test('all sectors is dynamic, explicit selections are deduplicated, and foreign/inactive sectors stay outside the scope', () => {
  assert.deepEqual(scheduleSectors('u1', 'all', units, sectors).map(s => s.id), ['s1', 's2']);
  assert.deepEqual(scheduleSectors('u1', ['s1', 's1', 's2', 'foreign', 's3'], units, sectors).map(s => s.id), ['s1', 's2']);
  assert.deepEqual(scheduleSectors('u1', [], units, sectors), []);
  assert.deepEqual(scheduleSectors('u2', ['s1'], units, sectors), []);
  assert.deepEqual(scheduleSectors('u1', 'all', units, [...sectors, { ...sectors[0], id: 'new' }]).map(s => s.id), ['s1', 's2', 'new']);
});
test('unlock lease expires by wall time and only defers expiration during a save', () => {
  assert.equal(scheduleLeaseValid(false, 0, 1, false), false);
  assert.equal(scheduleLeaseValid(true, 1000, 60999, false), true);
  assert.equal(scheduleLeaseValid(true, 1000, 61000, false), false);
  assert.equal(scheduleLeaseValid(true, 1000, 120000, false), false);
  assert.equal(scheduleLeaseValid(true, 1000, 120000, true), true);
  assert.equal(scheduleLeaseValid(false, 1000, 120000, true), false);
});
test('bulk removal stays inside the selected sectors and never widens an empty selection', () => {
  const shifts = ['s1', 's2', 's3'].map((sectorId, index) => ({ id: String(index), organizationId: 'org', unitId: 'u1', sectorId, date: '2026-12-01' }));
  const selected = { scope: 'period', from: '2026-12-01', to: '2026-12-01', unitId: 'u1', sectorId: '', sectorIds: ['s1', 's2'], kind: '', doctorId: '', shiftId: '' };
  assert.deepEqual(getScheduleDeletionTargets(shifts, sectors, 'org', selected).map(s => s.id), ['0', '1']);
  assert.deepEqual(getScheduleDeletionTargets(shifts, sectors, 'org', { ...selected, sectorIds: [] }), []);
});
