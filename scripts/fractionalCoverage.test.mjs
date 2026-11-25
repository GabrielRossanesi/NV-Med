import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateFractionalCoverage, coverageDate, coveragePlanInterval, coveragePositions } from '../src/lib/fractionalCoverage.ts';

const minute = 60_000;
const interval = (start, end) => ({ start: start * minute, end: end * minute });
const planned = interval(0, 720);

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
