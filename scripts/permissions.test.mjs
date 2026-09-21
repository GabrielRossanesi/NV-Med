import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditPermission, canViewPermission, sanitizeAdditionalPermissions } from '../src/lib/permissions.ts';

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

test('role permission remains authoritative and redundant grants are removed', () => {
  const sanitized = sanitizeAdditionalPermissions({ escala: 'view', financeiro: 'edit', admin: 'edit' }, 'tenant_user', 'Coordenador de Escalas');
  assert.deepEqual(sanitized, { financeiro: 'edit' });
  assert.equal(canEditPermission(coordinator, 'escala'), true);
});

test('SaaS administrators cannot receive tenant permission exceptions', () => {
  assert.deepEqual(sanitizeAdditionalPermissions({ financeiro: 'edit' }, 'saas_admin', 'Coordenador'), {});
});
