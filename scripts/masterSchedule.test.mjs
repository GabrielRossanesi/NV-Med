import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { masterDates, absenceOverlaps } from '../src/lib/masterSchedule.ts';

const spec = { doctor_id: 'doctor', unit_id: 'unit', sector_id: 'sector', specialty: 'Cirurgia',
  start_time: '07:00', end_time: '19:00', start_date: '2026-12-28', anchor_date: '2026-12-28', end_date: null,
  frequency: 'weeks', interval_weeks: 1, weekdays: [1], employment_type: 'clt', employer_name: null, type: 'onsite' };

test('weekly and fortnightly schedules keep the anchor across months and years', () => {
  assert.deepEqual(masterDates(spec, '2026-12-01', '2027-01-31'), ['2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']);
  assert.deepEqual(masterDates({ ...spec, interval_weeks: 2 }, '2026-12-01', '2027-01-31'), ['2026-12-28', '2027-01-11', '2027-01-25']);
  assert.deepEqual(masterDates({ ...spec, interval_weeks: 3, weekdays: [1, 4] }, '2026-12-28', '2027-01-22'), ['2026-12-28', '2026-12-31', '2027-01-18', '2027-01-21']);
});

test('monthly recurrence skips months without the fifth weekday and respects its end', () => {
  assert.deepEqual(masterDates({ ...spec, start_date: '2026-11-30', anchor_date: '2026-11-30', frequency: 'monthly', end_date: '2027-04-01' }, '2026-11-01', '2027-12-31'), ['2026-11-30', '2027-03-29']);
  assert.deepEqual(masterDates({ ...spec, start_date: '2027-01-01', interval_weeks: 2, end_date: '2027-01-25' }, '2026-12-01', '2027-06-01'), ['2027-01-11', '2027-01-25']);
  assert.deepEqual(masterDates({ ...spec, weekdays: [] }, '2026-12-28', '2027-01-31'), []);
});

test('full-day absence affects overnight work from the previous day, with exclusive boundaries', () => {
  const absence = { start_date: '2027-01-04', end_date: '2027-01-04', start_time: null, end_time: null, status: 'scheduled' };
  assert.equal(absenceOverlaps(absence, { date: '2027-01-03', startTime: '19:00', endTime: '07:00' }), true);
  assert.equal(absenceOverlaps(absence, { date: '2027-01-03', startTime: '19:00', endTime: '00:00' }), false);
  assert.equal(absenceOverlaps(absence, { date: '2027-01-05', startTime: '00:00', endTime: '07:00' }), false);
  assert.equal(absenceOverlaps({ ...absence, status: 'cancelled' }, { date: '2027-01-04', startTime: '07:00', endTime: '19:00' }), false);
});

test('partial windows repeat daily and may cross midnight without treating adjacent shifts as overlapping', () => {
  const absence = { start_date: '2027-01-04', end_date: '2027-01-06', start_time: '22:00', end_time: '06:00', status: 'scheduled' };
  assert.equal(absenceOverlaps(absence, { date: '2027-01-07', startTime: '05:00', endTime: '08:00' }), true);
  assert.equal(absenceOverlaps(absence, { date: '2027-01-07', startTime: '06:00', endTime: '08:00' }), false);
  assert.equal(absenceOverlaps(absence, { date: '2027-01-05', startTime: '07:00', endTime: '19:00' }), false);
  assert.equal(absenceOverlaps({ ...absence, start_time: '11:00', end_time: '12:00' }, { date: '2027-01-05', startTime: '07:00', endTime: '19:00' }), true);
});

// Render the actual view with an isolated RPC/hook boundary, without a database or Next server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let overview;
function loadView() {
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const native = createRequire(filename);
    const requireSource = name => {
      if (name === './useMasterSchedule') return { useMasterSchedule: () => ({ data: overview, reload: async () => {} }) };
      if (name === '@/services/masterScheduleService') return {};
      if (!name.startsWith('.') && !name.startsWith('@/')) return native(name);
      const target = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [target, `${target}.tsx`, `${target}.ts`].find(existsSync);
      return load(resolved);
    };
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: filename,
    });
    new Function('require', 'module', 'exports', outputText)(requireSource, module, module.exports);
    return module.exports;
  }
  return load(path.join(root, 'src/components/schedule/ScheduleMasterView.tsx')).default;
}
const Master = loadView();
const rule = { id: 'rule', organization_id: 'org', definition: spec, status: 'active', horizon_months: 3, revision: 1, effective_from: spec.start_date };
const props = { organization: 'org', unitId: 'unit', sectorId: 'sector', doctors: [{ id: 'doctor', name: 'Dra. Ana Carolina de Albuquerque' }],
  units: [], sectors: [], canCreate: false, canEdit: false, canApprove: false, canFinance: false, onChanged: async () => {}, onOpenShift: () => {} };
function render(extra = {}) { return renderToStaticMarkup(createElement(Master, { ...props, ...extra })); }
test('Master read access shows fixed doctors while management and private absences remain hidden', () => {
  overview = { rules: [rule], absences: [], occurrences: [], affected: [], audit: [], cron_enabled: true };
  const html = render();
  assert.ok(html.includes('Dra. Ana Carolina de Albuquerque'));
  for (const label of ['Cadastrar médico fixo', 'Editar recorrência', 'Registrar ausência', 'Suspender', 'Encerrar']) assert.ok(!html.includes(label));
  const admin = render({ canCreate: true, canEdit: true, canApprove: true });
  for (const label of ['Cadastrar médico fixo', 'Editar recorrência', 'Registrar ausência', 'Suspender', 'Encerrar']) assert.ok(admin.includes(label));
});
test('coverage publication state works for conflict vacancies without an absence link', () => {
  overview = { rules: [rule], absences: [], affected: [], audit: [], cron_enabled: true,
    occurrences: [{ rule_id: 'rule', date: '2027-01-04', shift_id: 'shift', state: 'coverage', issue: 'Revisar conflito do médico fixo', published: true }] };
  assert.ok(!render().includes('Manter pendente de cobertura'));
  assert.ok(render({ canEdit: true, canApprove: true }).includes('Manter pendente de cobertura'));
  overview.occurrences[0].published = false;
  assert.ok(render({ canEdit: true, canApprove: true }).includes('Abrir para candidaturas'));
});
