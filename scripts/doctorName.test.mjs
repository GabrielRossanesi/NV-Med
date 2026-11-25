import assert from 'node:assert/strict';
import test from 'node:test';
import {
  doctorNameInvalidError, doctorNameNumberError, doctorNameSearchKey, matchesDoctorSearch,
  normalizeDoctorName, validateDoctorName,
} from '../src/lib/doctorName.ts';

test('normaliza capitalização, nomes compostos, partículas e espaços Unicode', () => {
  const examples = [
    ['GABRIEL COSTA ROSSANESI', 'Gabriel Costa Rossanesi'],
    ['ana maria oliveira rossanesi', 'Ana Maria Oliveira Rossanesi'],
    ['JOÃO DA SILVA', 'João da Silva'],
    ['Mauricio Minoru Doi 82561', 'Mauricio Minoru Doi'],
    ['MARIA DOS SANTOS', 'Maria dos Santos'],
    ['DELCIO TORRES AMORIM JUNIOR', 'Delcio Torres Amorim Junior'],
    ['E ANA DOS SANTOS E SOUSA', 'E Ana dos Santos e Sousa'],
    ['  JOÃO  DA\t SILVA  ', 'João da Silva'],
    ['ANA-MARIA D’ÁVILA O\'CONNOR', 'Ana-Maria D’Ávila O\'Connor'],
    ['JOA\u0303O ١２²', 'João'],
    ['李 小龍', '李 小龍'],
    ['ΑΛΈΞΙΟΣ ΔΗΜΗΤΡΊΟΥ', 'Αλέξιος Δημητρίου'],
  ];
  for (const [original, expected] of examples) {
    assert.equal(normalizeDoctorName(original), expected);
    assert.equal(normalizeDoctorName(expected), expected);
    assert.doesNotThrow(() => validateDoctorName(expected));
  }
});

test('preserva capitalização estrangeira explícita e valida tentativas de cadastro', () => {
  assert.equal(normalizeDoctorName('  Siobhán McDonald  ', true), 'Siobhán McDonald');
  assert.equal(normalizeDoctorName('Siobhán McDonald'), 'Siobhán Mcdonald');
  for (const value of ['Ana 82561', 'Ana ١٢', 'ANA²']) {
    assert.throws(() => validateDoctorName(value), { message: doctorNameNumberError });
  }
  for (const value of ['', '  ', '---', 'Ana--Maria', 'Ana ! Lima', 'Ana_Clara']) {
    assert.throws(() => validateDoctorName(value), { message: doctorNameInvalidError });
  }
});

test('pesquisa ignora acentos, caixa e espaços e usa o CRM do cadastro', () => {
  assert.equal(doctorNameSearchKey('  JOÃO  DA  SILVA '), 'joao da silva');
  const doctor = { name: 'João da Silva', crm: '82561', rqe: '4422', specialty: 'Clínica Geral' };
  assert.equal(matchesDoctorSearch(doctor, ' JOÃO da   SILVA '), true);
  assert.equal(matchesDoctorSearch(doctor, ' 82561 '), true);
  assert.equal(matchesDoctorSearch(doctor, 'clinica geral'), true);
  assert.equal(matchesDoctorSearch({ ...doctor, name: 'João da Silva 82561', crm: '88888' }, '82561'), false);
  assert.equal(matchesDoctorSearch(doctor, 'João Costa'), false);
});
