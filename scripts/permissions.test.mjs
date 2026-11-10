import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditPermission, canPerformAction, canViewPermission, permissionDecision, sanitizeAdditionalPermissions } from '../src/lib/permissions.ts';

const coordinator = {
  type: 'tenant_user',
  role: 'Coordenador de Escalas',
  additionalPermissions: {},
};

test('additional permission grants finance read access without edit access', () => {
  const user = { ...coordinator, additionalPermissions: { financeiro: 'view' } };
  assert.equal(canViewPermission(user, 'financeiro'), true);
  assert.equal(canEditPermission(user, 'financeiro'), false);
});

test('additional edit permission grants finance view and edit access', () => {
  const user = { ...coordinator, additionalPermissions: { financeiro: 'edit' } };
  assert.equal(canViewPermission(user, 'financeiro'), true);
  assert.equal(canEditPermission(user, 'financeiro'), true);
});

test('valid legacy grants survive an edit and non-module grants are ignored', () => {
  const sanitized = sanitizeAdditionalPermissions({ escala: 'view', financeiro: 'edit', admin: 'edit' }, 'tenant_user');
  assert.deepEqual(sanitized, { escala: 'view', financeiro: 'edit' });
  assert.equal(canEditPermission(coordinator, 'escala'), true);
});

test('SaaS administrators cannot receive tenant permission exceptions', () => {
  assert.deepEqual(sanitizeAdditionalPermissions({ financeiro: 'edit' }, 'saas_admin'), {});
});

test('individual denials remove inherited actions independently and report their origin', () => {
  const user = { ...coordinator, additionalPermissions: { 'escala.edit': 'deny', 'escala.approve': 'deny' } };
  assert.equal(canViewPermission(user, 'escala'), true);
  assert.equal(canPerformAction(user, 'escala', 'create'), true);
  assert.deepEqual(permissionDecision(user, 'escala', 'approve'), { allowed: false, origin: 'Negado individualmente' });
  assert.equal(canEditPermission(user, 'escala'), false);
});

test('a module view denial also blocks explicit grants for its other actions', () => {
  const user = { ...coordinator, additionalPermissions: { 'escala.view': 'deny', 'escala.approve': 'allow' } };
  assert.equal(canPerformAction(user, 'escala', 'approve'), false);
  assert.equal(canViewPermission(user, 'escala'), false);
});

test('a schedule approval grant does not enable editing or financial access', () => {
  const user = { ...coordinator, role: 'Financeiro', additionalPermissions: { 'escala.approve': 'allow', 'financeiro.view': 'deny' } };
  assert.equal(canPerformAction(user, 'escala', 'approve'), true);
  assert.equal(canEditPermission(user, 'escala'), false);
  assert.equal(canEditPermission(user, 'financeiro'), false);
});
