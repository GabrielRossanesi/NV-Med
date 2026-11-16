import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { assignmentConfirmation, isCriticalCoverage, scheduleConflictIds } from '../src/lib/scheduleCalendar.ts';
import { summarizeSectorCoverage } from '../src/lib/scheduling.ts';

// Render the real TSX components without starting Next or connecting to Supabase.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
function loadSource(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const sourceModule = { exports: {} };
  modules.set(filename, sourceModule);
  const nativeRequire = createRequire(filename);
  const requireSource = specifier => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return nativeRequire(specifier);
    const target = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
    const resolved = [target, `${target}.tsx`, `${target}.ts`].find(file => existsSync(file));
    if (!resolved) throw new Error(`Source not found: ${specifier}`);
    return loadSource(resolved);
  };
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  });
  new Function('require', 'module', 'exports', outputText)(requireSource, sourceModule, sourceModule.exports);
  return sourceModule.exports;
}
const Calendar = loadSource(path.join(root, 'src/components/schedule/ScheduleCalendarView.tsx')).default;
const day = '2026-11-16';
const week = Array.from({ length: 7 }, (_, index) => `2026-11-${16 + index}`);
const sector = { id: 'sector', organizationId: 'org', unitId: 'unit', name: 'Cirurgia Geral - PS', status: 'active', specialties: ['Cirurgia Geral'], requiredDoctors: 3, defaultStartTime: '07:00', defaultEndTime: '19:00' };
const doctors = ['Ana Carolina de Albuquerque', 'Bruno Mendes', 'Carla Silva'].map((name, index) => ({ id: `doctor-${index}`, name }));
const base = { id: 'shift-0', organizationId: 'org', sectorId: sector.id, unitId: 'unit', doctorId: doctors[0].id, date: day, startTime: '07:00', endTime: '19:00', type: 'onsite', status: 'confirmed' };
const assigned = doctors.map((doctor, index) => ({ ...base, id: `shift-${index}`, doctorId: doctor.id }));
const noop = () => {};
const props = { view: 'day', date: day, week, month: '2026-11', firstDayOffset: 0, daysInMonth: 30,
  units: [{ id: 'unit', name: 'Hospital de teste' }], sectors: [sector], doctors, shifts: assigned,
  employment: '', doctorId: '', periodKind: '', documentFilter: 'all', focus: null, coverageFilter: 'all', statusFilter: 'all', doctorWarnings: new Map(),
  canSeeFinancial: false, canEditSchedule: false, canCreateSchedule: false, canDeleteSchedule: false,
  onSelectDate: noop, onSelectSector: noop, onOpenShift: noop, onEditShift: noop, onDeleteShift: noop, onDeleteTurn: noop, onCopyPeriod: async () => '',
};
function render(overrides = {}) { return renderToStaticMarkup(createElement(Calendar, { ...props, ...overrides })); }
function table(overrides = {}) { return render(overrides).match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || ''; }
function count(text, value) { return text.split(value).length - 1; }

test('full coverage shows every full name and individual confirmation without redundant coverage text', () => {
  const html = table();
  for (const doctor of doctors) assert.ok(html.includes(doctor.name));
  assert.equal(count(html, '>Confirmado</span>'), 3);
  assert.ok(html.includes('3/3'));
  assert.ok(!html.includes('Vaga disponível'));
  assert.ok(!html.includes('em falta'));
  assert.ok(!html.includes('truncate'));
});

test('pending confirmations occupy positions and never create vacancies', () => {
  const html = table({ shifts: assigned.map(shift => ({ ...shift, status: 'pending' })) });
  assert.equal(count(html, 'Aguardando confirmação'), 3);
  assert.ok(html.includes('3/3'));
  assert.ok(!html.includes('Vaga disponível'));
});

test('partial and empty coverage list each saved and uncreated position', () => {
  const vacancy = { ...base, id: 'vacancy', doctorId: undefined, status: 'open' };
  const partial = table({ shifts: [base, vacancy] });
  assert.ok(partial.includes('1/3'));
  assert.equal(count(partial, 'Vaga disponível'), 2);
  assert.equal(count(partial, 'Posto previsto por criar'), 1);
  assert.equal(count(table({ shifts: [] }), 'Vaga disponível'), 3);
  assert.equal(count(table({ shifts: [vacancy, { ...vacancy, id: 'v2' }, { ...vacancy, id: 'v3' }] }), 'Vaga disponível'), 3);
});

test('vacancy quick actions respect edit and create permissions independently', () => {
  const shifts = [base, { ...base, id: 'vacancy', doctorId: undefined, status: 'open' }];
  assert.ok(!table({ shifts }).includes('aria-label="Preencher vaga'));
  assert.ok(!table({ shifts }).includes('aria-label="Criar postos'));
  assert.ok(table({ shifts, canEditSchedule: true }).includes('aria-label="Preencher vaga'));
  assert.ok(table({ shifts, canCreateSchedule: true }).includes('aria-label="Criar postos'));
  assert.ok(!table({ shifts: assigned, canEditSchedule: true, canCreateSchedule: true }).includes('aria-label="Preencher vaga'));
});

test('conflicts in another sector and overnight remain visible alongside confirmation and exchange', () => {
  const night = { ...base, id: 'night', sectorId: 'other-sector', date: '2026-11-15', startTime: '19:00', endTime: '08:00' };
  const shifts = [{ ...base, exchangeRequested: true }, night];
  assert.deepEqual([...scheduleConflictIds(shifts)].sort(), ['night', 'shift-0']);
  const html = table({ shifts });
  assert.ok(html.includes(doctors[0].name));
  assert.ok(html.includes('Confirmado'));
  assert.ok(html.includes('Troca solicitada'));
  assert.ok(html.includes('Conflito de horário'));
  assert.equal(scheduleConflictIds([base, { ...night, status: 'cancelled' }]).size, 0);
});

test('critical coverage includes upcoming vacancies, conflicts and blocking documents', () => {
  const period = summarizeSectorCoverage(sector, [base]).periods[0];
  const now = new Date('2026-11-16T06:00:00').getTime();
  assert.equal(isCriticalCoverage(period, day, new Set(), new Map(), now), true);
  assert.equal(isCriticalCoverage(period, '2026-11-18', new Set(), new Map(), now), false);
  const full = summarizeSectorCoverage(sector, assigned).periods[0];
  assert.equal(isCriticalCoverage(full, day, new Set(), new Map(), now), false);
  assert.equal(isCriticalCoverage(full, day, new Set([base.id]), new Map(), now), true);
  assert.equal(isCriticalCoverage(full, day, new Set(), new Map([[base.doctorId, { warning: true, blocked: true }]]), now), true);
  const html = table({ doctorWarnings: new Map([[base.doctorId, { warning: true, blocked: true }]]), coverageFilter: 'critical' });
  assert.ok(html.includes('Impedimento documental'));
  assert.ok(html.includes(doctors[0].name));
});

test('large teams and long names remain present in desktop and mobile markup', () => {
  const doctors = Array.from({ length: 18 }, (_, index) => ({ id: `many-${index}`, name: `Médico ${index} Nome Completo de Albuquerque` }));
  const shifts = doctors.map(doctor => ({ ...base, id: doctor.id, doctorId: doctor.id }));
  const html = render({ doctors, shifts });
  for (const doctor of doctors) assert.equal(count(html, doctor.name), 2);
  assert.ok(!table({ doctors, shifts }).includes('overflow-y'));
  assert.ok(html.includes('sticky top-0'));
  assert.ok(html.includes('sticky left-0'));
});

test('rerendering updated props reflects assignment, removal and confirmation immediately', () => {
  assert.equal(count(table({ shifts: [] }), 'Vaga disponível'), 3);
  assert.equal(count(table({ shifts: [{ ...base, status: 'pending' }] }), 'Vaga disponível'), 2);
  assert.ok(table({ shifts: [{ ...base, status: 'pending' }] }).includes('Aguardando confirmação'));
  assert.ok(table({ shifts: [base] }).includes('Confirmado'));
  assert.ok(!table({ shifts: [{ ...base, status: 'cancelled' }] }).includes(doctors[0].name));
});

test('filters locate matching teams without hiding teammates or counting pending as open', () => {
  const shifts = [base, { ...assigned[1], status: 'pending' }, assigned[2]];
  assert.ok(table({ shifts, coverageFilter: 'pending' }).includes(doctors[0].name));
  assert.ok(table({ shifts, doctorId: doctors[1].id }).includes(doctors[0].name));
  assert.ok(!table({ shifts, coverageFilter: 'open' }).includes(doctors[1].name));
  assert.ok(table({ shifts, coverageFilter: 'complete' }).includes(doctors[1].name));
});

test('inspector keeps assignments, copy, create and delete controls governed by permissions', () => {
  const focus = { day, sectorId: sector.id, kind: 'day', nonce: 1 };
  const viewer = render({ focus }).split('<dialog')[1];
  for (const doctor of doctors) assert.ok(viewer.includes(doctor.name));
  assert.ok(viewer.includes('disabled=""'));
  assert.ok(viewer.includes('Copiar dia anterior'));
  assert.ok(viewer.includes('Duplicar para amanhã'));
  assert.ok(!viewer.includes('Excluir este turno'));
  const editor = render({ focus, canEditSchedule: true, canCreateSchedule: true, canDeleteSchedule: true }).split('<dialog')[1];
  assert.ok(editor.includes('Excluir este turno'));
  assert.ok(!editor.includes('disabled=""'));
});

test('undefined confirmation remains neutral while occupancy uses doctor assignment', () => {
  assert.deepEqual(assignmentConfirmation('open'), { label: 'Confirmação não definida', tone: 'neutral' });
  const html = table({ shifts: [{ ...base, status: 'open' }] });
  assert.ok(html.includes('1/3'));
  assert.ok(html.includes('Confirmação não definida'));
  assert.equal(count(html, 'Vaga disponível'), 2);
});

test('weekly and daily views show the intended dates, including weeks across month boundaries', () => {
  assert.equal(count(render({ view: 'week' }), 'scope="col"'), 8);
  assert.equal(count(render({ view: 'day' }), 'scope="col"'), 2);
  const boundaryWeek = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
  assert.ok(render({ view: 'week', week: boundaryWeek, shifts: [{ ...base, date: '2026-12-01' }] }).includes(doctors[0].name));
});
