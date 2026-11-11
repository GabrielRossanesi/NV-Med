import assert from 'node:assert/strict';
import test from 'node:test';
import { moveScheduleMonth } from '../src/lib/scheduleMonth.ts';

test('calendar month navigation clamps the selected day and crosses year boundaries', () => {
  assert.equal(moveScheduleMonth('2025-01-31', 1), '2025-02-28');
  assert.equal(moveScheduleMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(moveScheduleMonth('2026-12-12', 1), '2027-01-12');
  assert.equal(moveScheduleMonth('2026-01-31', -1), '2025-12-31');
});
