import test from 'node:test';
import assert from 'node:assert/strict';
import { companyReportCsv, companyReportWorkbook } from '../src/lib/companyFinanceExport.ts';
import { completeMonthRange } from '../src/lib/companyFinanceReport.ts';

test('company report preserves month boundaries including leap years', () => {
  assert.deepEqual(completeMonthRange('2024-01','2024-02'), { start: '2024-01-01', end: '2024-02-29' });
  assert.equal(completeMonthRange('2025-12','2025-11'), null);
  assert.equal(completeMonthRange('2025-13','2026-01'), null);
});

test('company report aggregates exact cents and leaves zero-revenue margin blank', async () => {
  const rows = [
    { id: 'first', date: '2026-02-01', client: '=FORMULA()', contract: 'A', assessed_revenue: '10000000000000.11', medical_cost: '10000000000000.02' },
    { id: 'second', date: '2026-02-03', client: '=FORMULA()', contract: 'A', assessed_revenue: '0.09', medical_cost: '0.01' },
    { id: 'third', date: '2026-02-05', client: 'OSS', contract: 'Zero', assessed_revenue: '0.00', medical_cost: '10.00' },
  ];
  const data = { shifts: rows, invoices: [], payments: [], receipts: [], periods: [] };
  const csv = companyReportCsv('gross_contract',data);
  assert.match(csv, /"Totais".*"10000000000000\.20".*"10000000000000\.03".*"0\.17"/);
  assert.match(csv, /"Totais".*"Zero".*"0\.00".*"10\.00".*"-10\.00"|"'\-10\.00"/);
  assert.match(csv, /"'=FORMULA\(\)"/);
  const xlsx = await companyReportWorkbook('gross_contract',data);
  assert.equal(Buffer.from(xlsx).subarray(0,2).toString(), 'PK');
});
