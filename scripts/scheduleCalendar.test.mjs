import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { assignmentConfirmation, isCriticalCoverage, scheduleAllocations, scheduleConflictIds, selectedScheduleSector } from '../src/lib/scheduleCalendar.ts';
import { summarizeSectorCoverage } from '../src/lib/scheduling.ts';

// Render the real TSX components without starting Next or connecting to Supabase.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = new Map();
const sourceMocks = new Map();
function loadSource(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const sourceModule = { exports: {} };
  modules.set(filename, sourceModule);
  const nativeRequire = createRequire(filename);
  const requireSource = specifier => {
    if (sourceMocks.has(specifier)) return sourceMocks.get(specifier);
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
function count(text, value) { return text.replace(/ title="[^"]*"/g, '').split(value).length - 1; }

test('full coverage shows every full name without redundant coverage or administrative text', () => {
  const html = table();
  for (const doctor of doctors) assert.ok(html.includes(doctor.name));
  assert.ok(!html.includes('Confirmado'));
  assert.ok(html.includes('3/3'));
  assert.ok(!html.includes('Vaga disponível'));
  assert.ok(!html.includes('em falta'));
  assert.ok(!html.includes('truncate'));
});

test('pending confirmations occupy positions and never create vacancies', () => {
  const html = table({ shifts: assigned.map(shift => ({ ...shift, status: 'pending' })) });
  assert.equal(count(html, 'Aguardando confirmação'), 0);
  assert.equal(html, table());
  assert.ok(html.includes('3/3'));
  assert.ok(!html.includes('Vaga disponível'));
});

test('partial and empty coverage list each saved and uncreated position', () => {
  const vacancy = { ...base, id: 'vacancy', doctorId: undefined, status: 'open' };
  const partial = table({ shifts: [base, vacancy] });
  assert.ok(partial.includes('1/3'));
  assert.equal(count(partial, 'Vaga disponível'), 2);
  assert.equal(count(partial, 'Posto previsto por criar'), 0);
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

test('overnight conflicts and exchange remain in the inspector while allocation stays clean', () => {
  const night = { ...base, id: 'night', sectorId: 'other-sector', date: '2026-11-15', startTime: '19:00', endTime: '08:00' };
  const shifts = [{ ...base, exchangeRequested: true }, night];
  assert.deepEqual([...scheduleConflictIds(shifts)].sort(), ['night', 'shift-0']);
  const html = table({ shifts });
  assert.ok(html.includes(doctors[0].name));
  assert.ok(!html.includes('Confirmado'));
  assert.ok(!html.includes('Troca solicitada'));
  assert.ok(!html.includes('Conflito de horário'));
  const inspector = render({ shifts, focus: { day, sectorId: sector.id, kind: 'day', nonce: 1 } }).split('<dialog')[1];
  assert.ok(inspector.includes('Confirmado'));
  assert.ok(inspector.includes('Troca solicitada'));
  assert.ok(inspector.includes('Conflito de horário'));
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
  assert.ok(!html.includes('Impedimento documental'));
  const inspector = render({ doctorWarnings: new Map([[base.doctorId, { warning: true, blocked: true }]]), focus: { day, sectorId: sector.id, kind: 'day', nonce: 1 } }).split('<dialog')[1];
  assert.ok(inspector.includes('Impedimento documental'));
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
  assert.ok(table({ shifts: [{ ...base, status: 'pending' }] }).includes(doctors[0].name));
  assert.equal(table({ shifts: [base] }), table({ shifts: [{ ...base, status: 'pending' }] }));
  const focus = { day, sectorId: sector.id, kind: 'day', nonce: 1 };
  assert.ok(render({ shifts: [{ ...base, status: 'pending' }], focus }).split('<dialog')[1].includes('Aguardando confirmação'));
  assert.ok(render({ shifts: [base], focus }).split('<dialog')[1].includes('Confirmado'));
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
  assert.ok(!html.includes('Confirmação não definida'));
  assert.equal(count(html, 'Vaga disponível'), 2);
});

test('weekly and daily views show the intended dates, including weeks across month boundaries', () => {
  assert.equal(count(render({ view: 'week' }), 'scope="col"'), 8);
  assert.equal(count(render({ view: 'day' }), 'scope="col"'), 2);
  const boundaryWeek = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
  assert.ok(render({ view: 'week', week: boundaryWeek, shifts: [{ ...base, date: '2026-12-01' }] }).includes(doctors[0].name));
});

const activeUnit = { id: 'unit', organizationId: 'org', name: 'Hospital de teste', status: 'active' };
test('scope requires a selected active unit and sector from the same company', () => {
  assert.equal(selectedScheduleSector('', '', [activeUnit], [sector]), undefined);
  assert.equal(selectedScheduleSector('unit', '', [activeUnit], [sector]), undefined);
  assert.equal(selectedScheduleSector('', 'sector', [activeUnit], [sector]), undefined);
  assert.equal(selectedScheduleSector('unit', 'sector', [activeUnit], [sector]), sector);
  assert.equal(selectedScheduleSector('unit', 'sector', [{ ...activeUnit, status: 'inactive' }], [sector]), undefined);
  assert.equal(selectedScheduleSector('unit', 'sector', [activeUnit], [{ ...sector, status: 'inactive' }]), undefined);
  assert.equal(selectedScheduleSector('unit', 'sector', [activeUnit], [{ ...sector, unitId: 'foreign' }]), undefined);
  assert.equal(selectedScheduleSector('unit', 'sector', [activeUnit], [{ ...sector, organizationId: 'foreign' }]), undefined);
});

test('allocation entries separate filled positions from vacancies without administrative fields', () => {
  const period = summarizeSectorCoverage(sector, [{ ...base, status: 'pending' }, { ...base, id: 'vacancy', doctorId: undefined, status: 'open' }]).periods[0];
  const entries = scheduleAllocations(period, new Map(doctors.map(doctor => [doctor.id, doctor])));
  assert.equal(entries.length, 3);
  assert.equal(entries.filter(entry => entry.vacant).length, 2);
  assert.equal(entries[0].name, doctors[0].name);
  assert.ok(entries.every(entry => !('status' in entry) && !('exchangeRequested' in entry)));
});

test('monthly calendar shows names, times and vacancies throughout the month without administrative state', () => {
  const shifts = [base, { ...assigned[1], status: 'pending' }, { ...assigned[2], date: '2026-11-30', startTime: '19:00', endTime: '07:00' }];
  const html = table({ view: 'month', shifts, doctorWarnings: new Map([[base.doctorId, { warning: true, blocked: true }]]) });
  for (const doctor of doctors) assert.ok(html.includes(doctor.name));
  assert.ok(html.includes('Vaga disponível'));
  assert.ok(html.includes('19:00'));
  assert.ok(!html.includes('Aguardando confirmação'));
  assert.ok(!html.includes('Conflito de horário'));
  assert.ok(!html.includes('Impedimento documental'));
  assert.ok(!html.includes('postos por criar'));
  assert.ok(html.includes('title="Ana Carolina de Albuquerque'));
  assert.equal(count(render({ view: 'month', shifts }), 'scope="col"'), 7);
});

test('month and week both offer full operational details only in the inspector', () => {
  for (const view of ['week', 'month']) {
    const html = render({ view, shifts: [{ ...base, status: 'pending' }], doctorWarnings: new Map([[base.doctorId, { warning: true, blocked: false }]]), focus: { day, nonce: 1 } });
    const [grid, inspector] = html.split('<dialog');
    assert.ok(!grid.includes('Aguardando confirmação'));
    assert.ok(!grid.includes('Pendência documental'));
    assert.ok(inspector.includes('Aguardando confirmação'));
    assert.ok(inspector.includes('Pendência documental'));
    assert.ok(inspector.includes('Copiar dia anterior'));
    assert.ok(inspector.includes('Duplicar para amanhã'));
  }
});

test('weekly rows preserve multiple sectors and their assigned doctors', () => {
  const otherSector = { ...sector, id: 'other', name: 'UTI', requiredDoctors: 1 };
  const html = table({ view: 'week', sectors: [sector, otherSector], shifts: [base, { ...assigned[1], sectorId: 'other' }] });
  assert.ok(html.includes('Cirurgia Geral - PS'));
  assert.ok(html.includes('UTI'));
  assert.ok(html.includes(doctors[0].name));
  assert.ok(html.includes(doctors[1].name));
});

let routeParams = new URLSearchParams();
const pageStore = {
  activeOrganizationId: 'org', currentUser: { id: 'viewer', type: 'tenant_user', role: 'Financeiro', email: 'viewer@example.test' },
  organizations: [{ id: 'org', name: 'Empresa de teste', settings: { requiredDocuments: [] } }],
  units: [activeUnit], sectors: [sector], documents: [], shifts: assigned,
  doctors: doctors.map(doctor => ({ ...doctor, organizationId: 'org', email: `${doctor.id}@example.test`, specialty: 'Cirurgia Geral', linkedUnits: ['unit'] })),
};
sourceMocks.set('@/store/useStore', { useStore: selector => selector ? selector(pageStore) : pageStore });
sourceMocks.set('next/navigation', { useSearchParams: () => routeParams, useRouter: () => ({ back: noop }) });
sourceMocks.set('@/lib/supabase/client', { createClient: () => { throw new Error('Tests must not access Supabase'); } });
sourceMocks.set('@/services/supabaseService', {});
const SchedulePage = loadSource(path.join(root, 'src/app/(dashboard)/escala/page.tsx')).default;
function renderPage(query = '') {
  routeParams = new URLSearchParams(query);
  return renderToStaticMarkup(createElement(SchedulePage));
}

test('schedule page initially renders only scope selection, without a calendar or administrative controls', () => {
  const html = renderPage();
  assert.ok(html.includes('Selecione a unidade e o setor para visualizar a escala.'));
  assert.ok(html.includes('Selecione a unidade'));
  assert.ok(html.includes('Selecione o setor'));
  assert.ok(!html.includes('<table'));
  assert.ok(!html.includes('Gerenciar escala'));
  assert.ok(!html.includes('Pendências e cobertura'));
  assert.ok(!html.includes(doctors[0].name));
  assert.ok(!renderPage('unitId=unit').includes('<table'));
  assert.ok(!renderPage('unitId=unit&sectorId=foreign').includes('<table'));
});

test('a valid selected scope renders the actual calendar and keeps operational indicators outside it', () => {
  for (const view of ['week', 'month']) {
    const html = renderPage(`unitId=unit&sectorId=sector&date=${day}&view=${view}`);
    assert.ok(html.includes('<table'));
    assert.ok(html.includes(doctors[0].name));
    assert.ok(!html.includes('Selecione a unidade e o setor para visualizar a escala.'));
    assert.ok(html.includes('Pendências e cobertura'));
    const grid = html.match(/<table[\s\S]*?<\/table>/)?.[0];
    assert.ok(!grid.includes('Confirmação pendente'));
  }
});
