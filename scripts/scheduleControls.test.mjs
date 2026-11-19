import test from 'node:test';
import assert from 'node:assert/strict';
import { canPerformAction, isScheduleAdministrator, sanitizeAdditionalPermissions } from '../src/lib/permissions.ts';
import { scheduleSectors, scheduleLeaseValid } from '../src/lib/scheduleScope.ts';
import { getScheduleDeletionTargets } from '../src/lib/scheduleDeletion.ts';
import { canUseScheduleEditor } from '../src/lib/scheduleEditAccess.ts';

test('editor permission is rechecked against the current user and company without granting medical roles', () => {
  const user = { id: 'admin', authUserId: 'auth-admin', organizationId: 'org', type: 'tenant_user', role: 'Diretor', status: 'active', additionalPermissions: {} };
  const session = { userId: 'auth-admin', organizationId: 'org' };
  assert.equal(canUseScheduleEditor(user, 'org', session), true);
  for (const patch of [{ additionalPermissions: { 'escala.edit': 'deny' } }, { status: 'inactive' }, { authUserId: 'another-user' }, { organizationId: 'other-company' }, { role: 'Médico', additionalPermissions: { 'escala.edit': 'allow' } }, { role: 'Coordenador Médico', additionalPermissions: { escala: 'edit' } }]) {
    assert.equal(canUseScheduleEditor({ ...user, ...patch }, 'org', session), false);
  }
  assert.equal(canUseScheduleEditor(user, 'other-company', session), false);
  assert.equal(canUseScheduleEditor(user, '', session), false);
  // Restoring a legitimate permission allows a fresh explicit unlock, not an
  // automatic unlock or an assignment of administrative powers to a doctor.
  assert.equal(canUseScheduleEditor({ ...user, role: 'Escalista' }, 'org', session), true);
});

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
test('the edit lease expires after five minutes of elapsed time, even after a long timer suspension', () => {
  const unlockedAt = 1_000;
  assert.equal(scheduleLeaseValid(false, unlockedAt, unlockedAt + 1), false);
  assert.equal(scheduleLeaseValid(true, unlockedAt, unlockedAt + 299_999), true);
  assert.equal(scheduleLeaseValid(true, unlockedAt, unlockedAt + 300_000), false);
  assert.equal(scheduleLeaseValid(true, unlockedAt, unlockedAt + 900_000), false);
});
test('an edit moves the deadline, so returning before the renewed deadline keeps the lease', () => {
  const unlockedAt = 1_000;
  const lastEdit = unlockedAt + 240_000;
  const returnAt = unlockedAt + 400_000;
  assert.equal(scheduleLeaseValid(true, unlockedAt, returnAt), false);
  assert.equal(scheduleLeaseValid(true, lastEdit, returnAt), true);
  assert.equal(scheduleLeaseValid(true, lastEdit, lastEdit + 300_000), false);
});
test('bulk removal stays inside the selected sectors and never widens an empty selection', () => {
  const shifts = ['s1', 's2', 's3'].map((sectorId, index) => ({ id: String(index), organizationId: 'org', unitId: 'u1', sectorId, date: '2026-12-01' }));
  const selected = { scope: 'period', from: '2026-12-01', to: '2026-12-01', unitId: 'u1', sectorId: '', sectorIds: ['s1', 's2'], kind: '', doctorId: '', shiftId: '' };
  assert.deepEqual(getScheduleDeletionTargets(shifts, sectors, 'org', selected).map(s => s.id), ['0', '1']);
  assert.deepEqual(getScheduleDeletionTargets(shifts, sectors, 'org', { ...selected, sectorIds: [] }), []);
});
