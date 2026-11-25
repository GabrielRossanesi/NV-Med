import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFractionalCoverage, coverageDate, coveragePlanInterval, coveragePositions, coverageSaveMessage, fractionalWritePlan } from '../src/lib/fractionalCoverage.ts';
import { scheduleAllocations } from '../src/lib/scheduleCalendar.ts';

const minute = 60_000;
const interval = (start, end) => ({ start: start * minute, end: end * minute });
const planned = interval(0, 720);

test('uses the original post automatically when an assigned interval changes', () => {
  const original = { date: '2026-12-11', startTime: '07:00', endTime: '19:00', capacity: 1 };
  const full = { ...original, doctorId: 'ana', status: 'pending' };
  const partial = { ...full, startTime: '09:00' };
  assert.equal(fractionalWritePlan(full, original, null, false), undefined);
  assert.equal(fractionalWritePlan(partial, original, null, false), original);
  assert.equal(fractionalWritePlan({ ...partial, doctorId: undefined }, original, null, false), undefined);
  assert.equal(fractionalWritePlan(partial, original, null, true), undefined);
  const advanced = { ...original, capacity: 2 };
  assert.equal(fractionalWritePlan(partial, original, advanced, true), advanced);
  const fullDay = { ...original, endTime: '07:00' };
  assert.equal(fractionalWritePlan({ ...full, endTime: '07:00' }, fullDay, null, false), fullDay);
});

test('makes each uncovered interval clickable and ordered across midnight', () => {
  const makeShift = (id, date, startTime, endTime, doctorId) => ({
    id, date, doctorId, startTime, endTime, status: doctorId ? 'pending' : 'open',
    coveragePost: {
      id: 'overnight', segmentStartsAt: `${date}T${startTime}:00Z`, segmentEndsAt: `${date}T${endTime}:00Z`,
    },
  });
  const firstGap = makeShift('gap-1', '2026-12-14', '19:00', '21:00');
  const secondGap = makeShift('gap-2', '2026-12-15', '06:00', '07:00');
  const doctor = { ...makeShift('assignment', '2026-12-14', '21:00', '06:00', 'ana'),
    coveragePost: { id: 'overnight', segmentStartsAt: '2026-12-14T21:00:00Z', segmentEndsAt: '2026-12-15T06:00:00Z' } };
  const entries = scheduleAllocations({
    period: { kind: 'night', startTime: '19:00', endTime: '07:00' }, assigned: [doctor], vacancies: [secondGap, firstGap], uncreated: 0,
  }, new Map([['ana', { name: 'Ana de Teste' }]]));
  assert.deepEqual(entries.map(item => [item.shiftId, item.name, item.duration]), [
    ['gap-1', 'Vaga aberta', '2h'], ['assignment', 'Ana de Teste', undefined], ['gap-2', 'Vaga aberta', '1h'],
  ]);
  assert.equal(entries[0].vacancyState, 'available');
  assert.equal(coverageSaveMessage('Plantão atualizado.', [doctor, firstGap], [doctor]),
    'Plantão atualizado. Uma vaga de 2 horas foi gerada automaticamente.');
  assert.equal(coverageSaveMessage('Plantão atualizado.', [doctor, firstGap, secondGap], [doctor]),
    'Plantão atualizado. Duas vagas descobertas foram geradas automaticamente.');
  assert.equal(coverageSaveMessage('Plantão atualizado.', [doctor, firstGap, secondGap], [doctor, firstGap, secondGap]),
    'Plantão atualizado.');
});

test('calculates full and partial coverage in minutes, with gaps at either boundary', () => {
  for (const [allocations, gaps, covered] of [
    [[planned], [], 720],
    [[interval(0, 360)], [interval(360, 720)], 360],
    [[interval(355, 720)], [interval(0, 355)], 365],
    [[interval(60, 660)], [interval(0, 60), interval(660, 720)], 600],
    [[], [planned], 0],
  ]) {
    const result = calculateFractionalCoverage(planned, 1, allocations);
    assert.equal(result.coveredMinutes, covered);
    assert.equal(result.uncoveredMinutes, 720 - covered);
    assert.deepEqual(result.gaps, gaps);
  }
});

test('allows adjacent allocations and merges only adjacent uncovered intervals', () => {
  const complete = calculateFractionalCoverage(planned, 1, [interval(0, 360), interval(360, 720)]);
  assert.equal(complete.fullyCoveredLanes, 1);
  assert.deepEqual(complete.gaps, []);
  const separated = calculateFractionalCoverage(planned, 1, [interval(0, 180), interval(300, 540), interval(600, 720)]);
  assert.deepEqual(separated.gaps, [interval(180, 300), interval(540, 600)]);
  assert.equal(separated.coveredMinutes, 540);
});

test('respects simultaneous staffing capacity, empty capacity and invalid spans', () => {
  const result = calculateFractionalCoverage(planned, 3, [interval(0, 720), interval(30, 90)]);
  assert.equal(result.fullyCoveredLanes, 1);
  assert.equal(result.plannedMinutes, 2160);
  assert.deepEqual(result.gaps, [interval(0, 30), planned, interval(90, 720)]);
  assert.equal(calculateFractionalCoverage(planned, 1, [planned, interval(30, 90)]), null);
  assert.equal(calculateFractionalCoverage(planned, 1, [interval(-1, 90)]), null);
  assert.equal(calculateFractionalCoverage(planned, 1, [interval(30, 30)]), null);
});

test('supports custom minutes, overnight and 24 hours in the unit timezone', () => {
  const date = '2026-11-28';
  const zone = 'America/Manaus';
  const overnight = coveragePlanInterval({ date, startTime: '23:23', endTime: '05:53' }, zone);
  assert.equal(new Date(overnight.start).toISOString(), '2026-11-29T03:23:00.000Z');
  assert.equal((overnight.end - overnight.start) / minute, 390);
  const fullDay = coveragePlanInterval({ date, startTime: '07:15', endTime: '07:15' }, zone);
  assert.equal((fullDay.end - fullDay.start) / minute, 1440);
  const dst = coveragePlanInterval({ date: '2026-03-08', startTime: '02:30', endTime: '09:30' }, 'America/New_York');
  assert.equal(dst, undefined);
  assert.equal(coveragePlanInterval({ date: '2026-02-31', startTime: '07:15', endTime: '13:15' }, zone), undefined);
});

test('counts split allocations as a single post on its operational date and preserves legacy posts', () => {
  const asTime = value => new Date(value).toISOString();
  const post = { id: 'post', date: '2026-11-28', startsAt: asTime(0), endsAt: asTime(720 * minute), capacity: 1 };
  const shift = (id, doctors, start, end, status = 'pending') => ({
    id, doctorId: doctors, status, date: '2026-11-29',
    coveragePost: { ...post, segmentStartsAt: asTime(start * minute), segmentEndsAt: asTime(end * minute) },
  });
  const first = shift('first', 'a', 0, 360);
  const second = shift('second', 'b', 360, 720);
  assert.equal(coverageDate(second), post.date);
  assert.deepEqual(coveragePositions([first, second, { id: 'legacy', doctorId: 'a', status: 'pending' }]), { created: 2, filled: 2 });
  assert.deepEqual(coveragePositions([first, { ...second, status: 'cancelled' }, shift('gap', undefined, 360, 720, 'open')]), { created: 1, filled: 0 });
});
