import assert from 'node:assert/strict';
import test from 'node:test';
import { portalError } from '../src/lib/doctorPortal.ts';

test('explains the approval block when the medical registration is inactive or pending', () => {
  assert.equal(
    portalError({ code: 'P0001', message: 'Selecione um médico ativo da mesma empresa.' }),
    'O cadastro do médico precisa estar ativo. Para vínculos provisórios, conclua o cadastro e o credenciamento.',
  );
});

test('keeps unexpected database errors and technical permission details private', () => {
  const genericMessage = 'Não foi possível concluir a operação. Tente novamente.';
  assert.equal(portalError({ code: 'P0001', message: 'Detalhe interno.' }), genericMessage);
  assert.equal(portalError({ code: '42501', message: 'permission denied for relation shifts' }), genericMessage);
});
