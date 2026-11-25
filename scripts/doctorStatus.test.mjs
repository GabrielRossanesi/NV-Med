import test from 'node:test';
import assert from 'node:assert/strict';
import { doctorStatusActions, doctorStatusError } from '../src/lib/doctorStatus.ts';

test('doctor status errors expose only known, actionable business copy', () => {
  assert.match(doctorStatusError({ code: '22023', message: 'Preencha a chave PIX e seu tipo antes de concluir o cadastro.' }), /Dados bancários/);
  assert.match(doctorStatusError({ code: '42501', message: 'private table details' }), /permissão/);
  assert.match(doctorStatusError({ code: '22023', message: 'O cadastro mudou. Reabra o formulário antes de salvar.' }), /outra pessoa/);
  for (const error of [null, { code: '23505', message: 'private CPF=123' }, { code: '22023', message: 'private SQL' }, { message: 'TypeError: fetch failed' }]) {
    assert.equal(doctorStatusError(error), 'Não foi possível alterar o status do cadastro. Tente novamente.');
  }
  assert.match(doctorStatusError({ code: 'PGRST202' }), /atualização do sistema/);
});

test('each registration transition has contextual copy and semantic tone', () => {
  assert.equal(doctorStatusActions.active.tone, 'success');
  assert.equal(doctorStatusActions.inactive.tone, 'danger');
  assert.equal(doctorStatusActions.pending.tone, 'warning');
  assert.equal(doctorStatusActions.active.success, 'Cadastro do médico ativado com sucesso.');
});
