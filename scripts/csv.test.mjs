import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from '../src/lib/csv.ts';

test('creates Excel-compatible UTF-8 semicolon CSV', () => {
  const csv = toCsv(['Médico', 'Valor'], [['Dra. Ana', 1250.5]]);
  assert.equal(csv.startsWith('\uFEFF'), true);
  assert.equal(csv.includes('"Médico";"Valor"\r\n"Dra. Ana";"1250.5"'), true);
});

test('escapes quotes and neutralizes spreadsheet formulas', () => {
  const csv = toCsv(['Nome'], [['=HYPERLINK("https://example.com")']]);
  assert.equal(csv.includes('"\'=HYPERLINK(""https://example.com"")"'), true);
});
