import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { buildReportCsv, buildReportWorkbook } from '../src/lib/shiftReportExport.ts';
import { financeState } from '../src/lib/financeState.ts';
import { summarizeReport } from '../src/lib/reportSummary.ts';
import { buildReportPdf } from '../src/lib/shiftReportPdf.ts';
import { PDFDocument } from 'pdf-lib';

const row = {
  id: 'test', organization: 'Clínica A', unit: 'Hospital A', sector: 'Pediatria', specialty: 'Clínica geral',
  doctor: '  =1+1', date: '2026-11-09', start_time: '19:00', end_time: '07:00', status: 'confirmed',
  presence: 'checked_in', check_in: '2026-11-09T22:00:00.000Z', check_out: null,
  payment: 'overdue', agreed: 1400, due: '2026-11-10', paid_on: null, paid_amount: null,
};
const report = { finance: true, attendance: true, rows: [row] };

test('generates UTF-8 CSV, escapes formula-like cells and omits unauthorized columns', () => {
  const csv = buildReportCsv(report);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes(`"'  =1+1"`));
  assert.ok(csv.includes('"1400,00"'));
  const limited = buildReportCsv({ ...report, finance: false, attendance: false });
  assert.doesNotMatch(limited, /1400|Check-in|Vencimento/);
});

test('generates a filterable XLSX with typed values, separate financial totals and a frozen header', async () => {
  const files = unzipSync(new Uint8Array(await buildReportWorkbook(report)));
  const operational = strFromU8(files['xl/worksheets/sheet1.xml']);
  const financial = strFromU8(files['xl/worksheets/sheet2.xml']);
  const styles = strFromU8(files['xl/styles.xml']);
  assert.match(operational, /<autoFilter ref="A1:M2"\/>/);
  assert.match(financial, /<autoFilter ref="A1:S2"\/>/);
  assert.match(strFromU8(files['xl/worksheets/sheet5.xml']), /<autoFilter ref="A1:E2"\/>/);
  assert.match(operational, /state="frozen"/);
  assert.match(financial, /<v>1400<\/v>/);
  assert.match(styles, /R\$/);
  assert.doesNotMatch(operational + financial, /<f(?:\s|>)/);
  const restricted = unzipSync(new Uint8Array(await buildReportWorkbook({ ...report, finance: false, attendance: false })));
  assert.equal(restricted['xl/worksheets/sheet2.xml'], undefined);
});

test('preserves the agreed, settled and outstanding values in financial breakdowns', () => {
  const summary = summarizeReport({ ...report, rows: [
    { ...row, doctor_id: 'one', agreed: 120.10, paid_amount: 115.01, payment: 'paid', balance: 0 },
    { ...row, doctor_id: 'two', agreed: 0.22, paid_amount: null, balance: 0.22, date: '2026-12-02' },
  ] });
  assert.deepEqual(summary.totals, { agreed: '120.32', paid: '115.01', balance: '0.22' });
  assert.equal(summary.doctors.length, 2);
  assert.deepEqual(summary.months.map(item => item.name), ['11/2026', '12/2026']);
  assert.equal(summarizeReport({ ...report, finance: false }), null);
});

test('generates a paginated landscape PDF with wrapped text and a separate financial breakdown', async () => {
  const rows = Array.from({ length: 36 }, (_, index) => ({ ...row, id: String(index), unit: 'Hospital de São José da Região Metropolitana'.repeat(3), doctor: 'Médica fictícia 🩺' }));
  const opts = { from: '2026-11-01', to: '2026-11-30', filters: ['Especialidade: Clínica geral'], financial: true };
  const financial = await PDFDocument.load(await buildReportPdf({ ...report, rows }, opts));
  const limited = await PDFDocument.load(await buildReportPdf({ ...report, rows, finance: false }, { ...opts, financial: false }));
  assert.equal(financial.getTitle(), 'Relatório financeiro de plantões');
  assert.ok(financial.getPageCount() >= 5);
  assert.ok(limited.getPageCount() >= 2);
  assert.ok(financial.getPages().every(page => page.getWidth() > page.getHeight()));
});

test('distinguishes scheduled, overdue, cancelled, settled and unset payments', () => {
  assert.equal(financeState({ status: 'confirmed' }, '2026-11-09'), 'pending');
  assert.equal(financeState({ status: 'confirmed', paymentDueDate: '2026-11-09' }, '2026-11-09'), 'scheduled');
  assert.equal(financeState({ status: 'confirmed', paymentDueDate: '2026-11-08' }, '2026-11-09'), 'overdue');
  assert.equal(financeState({ status: 'cancelled', paymentDueDate: '2026-11-08' }, '2026-11-09'), 'cancelled');
  assert.equal(financeState({ status: 'confirmed', paymentStatus: 'paid' }, '2026-11-09'), 'paid');
});
