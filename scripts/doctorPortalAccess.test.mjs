import test from 'node:test';
import assert from 'node:assert/strict';
import { canPerformAction, sanitizeAdditionalPermissions } from '../src/lib/permissions.ts';

test('registry editing does not authorize portal credential management', () => {
  for (const role of ['Escalista', 'Coordenador de Escalas']) {
    const actor = { type: 'tenant_user', role, additionalPermissions: {} };
    assert.equal(canPerformAction(actor, 'medicos', 'edit'), true);
    assert.equal(canPerformAction(actor, 'portal_medico', 'edit'), false);
  }
  assert.equal(canPerformAction({ type: 'saas_admin', role: 'Administrativo' }, 'portal_medico', 'edit'), false);
});

test('portal access management is explicit and honors individual denials', () => {
  for (const [type, role] of [['tenant_user', 'Diretor'], ['tenant_user', 'Gerente'], ['saas_admin', 'CEO'], ['saas_admin', 'Gerente']]) {
    assert.equal(canPerformAction({ type, role }, 'portal_medico', 'edit'), true);
  }
  const actor = { type: 'tenant_user', role: 'Escalista', additionalPermissions: { 'portal_medico.view': 'allow', 'portal_medico.edit': 'allow' } };
  assert.equal(canPerformAction(actor, 'portal_medico', 'edit'), true);
  actor.additionalPermissions['portal_medico.view'] = 'deny';
  assert.equal(canPerformAction(actor, 'portal_medico', 'edit'), false);
  assert.deepEqual(sanitizeAdditionalPermissions({ portal_medico: 'edit', 'portal_medico.view': 'allow', 'portal_medico.edit': 'allow' }, 'tenant_user'), {
    'portal_medico.view': 'allow', 'portal_medico.edit': 'allow',
  });
});
