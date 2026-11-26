import assert from 'node:assert/strict';
import test from 'node:test';
import { coverageAssignmentChanged, coverageDraftInterval, editCoverageSegment, mergeCoverageDraft } from '../src/lib/coverageDraft.ts';
import { coveragePlanInterval } from '../src/lib/fractionalCoverage.ts';

const zone = 'America/Sao_Paulo';
const day = '2027-02-15';
const full = { date: day, startTime: '07:00', endTime: '19:00', capacity: 1 };
const shift = (id, startTime, endTime, doctorId, options = {}) => ({
  id, date: day, startTime, endTime, doctorId, status: doctorId ? 'pending' : 'open', ...options,
});

test('a one-hour vacancy keeps its identity when the saved vacancy covers the draft interval', () => {
  const present = editCoverageSegment(full, zone, [shift('assigned', '08:00', '19:00', 'ana'), shift('real-vacancy', '07:00', '08:00')]);
  assert.equal(present.segments[0].key, 'real-vacancy');
  assert.equal(present.totals.uncoveredMinutes, 60);
  const filled = mergeCoverageDraft(present.segments.map(item => item.shift), [shift('real-vacancy', '07:15', '07:45', 'bruno')]);
  const draft = editCoverageSegment(full, zone, filled);
  assert.equal(draft.totals.uncoveredMinutes, 30);
  assert.deepEqual(draft.totals.gaps.map(item => item.end - item.start), [900_000, 900_000]);
  assert.equal(filled.length, 2);
});

test('a full shift can be split, removed and reconstructed without changing the original data', () => {
  const original = [shift('first', '07:00', '19:00', 'ana')];
  const second = shift('second', '13:00', '19:00', 'bruno');
  const split = mergeCoverageDraft(original, [{ ...original[0], endTime: '13:00' }, second]);
  assert.equal(editCoverageSegment(full, zone, split).totals.coveredMinutes, 720);
  const removed = mergeCoverageDraft(split, [{ ...second, status: 'cancelled' }]);
  assert.equal(editCoverageSegment(full, zone, removed).totals.uncoveredMinutes, 360);
  assert.equal(original[0].endTime, '19:00');
  assert.equal(coverageAssignmentChanged(original[0], split[0]), true);
});

test('custom shifts respect simultaneous capacity without increasing contracted hours', () => {
  const plan = { ...full, startTime: '09:30', endTime: '15:30', capacity: 2 };
  const assignments = [shift('first','09:30','15:30','ana'),shift('second','10:30','12:00','bruno')];
  const result = editCoverageSegment(plan,zone,assignments);
  assert.equal(result.totals.plannedMinutes,720);
  assert.equal(result.totals.coveredMinutes,450);
  assert.equal(editCoverageSegment(plan,zone,[...assignments,shift('extra','11:00','11:30','clara')]),null);
  assert.equal(editCoverageSegment({...plan,capacity:1},zone,assignments),null);
});

test('overnight editor finds the operational and following calendar dates', () => {
  const interval = coveragePlanInterval({...full,startTime:'19:00',endTime:'07:00'},zone);
  assert.equal(coverageDraftInterval('19:00','01:00',interval,zone).date,day);
  assert.equal(coverageDraftInterval('01:00','07:00',interval,zone).date,'2027-02-16');
  assert.equal(coverageDraftInterval('01:00','08:00',interval,zone),undefined);
  assert.equal(coverageDraftInterval('13:00','13:00',interval,zone),undefined);
});
