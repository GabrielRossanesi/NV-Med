import type { CoveragePlan, Shift } from '../types/index.ts';

export interface CoverageSpan {
  start: number;
  end: number;
}

const minute = 60_000;

export function coverageDate(shift: Pick<Shift, 'date' | 'coveragePost'>) {
  return shift.coveragePost?.date || shift.date;
}

export function coverageSpan(shift: Pick<Shift, 'coveragePost'>): CoverageSpan | undefined {
  const post = shift.coveragePost;
  if (post) return { start: Date.parse(post.segmentStartsAt), end: Date.parse(post.segmentEndsAt) };
}

function calendarStamp(date: string, time: string, nextDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  const stamp = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== date) return NaN;
  return stamp + (nextDay ? 86_400_000 : 0);
}

// Match PostgreSQL AT TIME ZONE for overlapping wall times. The later instant is
// used for ambiguous boundaries, while a nonexistent wall time has no preview.
export function coveragePlanInterval(plan: Pick<CoveragePlan, 'date' | 'startTime' | 'endTime'>, zone: string): CoverageSpan | undefined {
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  });
  function instant(stamp: number) {
    if (!Number.isFinite(stamp)) return NaN;
    const wall = (value: number) => Date.parse(format.format(value).replace(' ', 'T') + 'Z');
    const candidates = [-86_400_000, 86_400_000].map(delta => stamp - (wall(stamp + delta) - (stamp + delta)));
    return Math.max(...candidates.filter(value => wall(value) === stamp));
  }
  const start = instant(calendarStamp(plan.date, plan.startTime));
  const end = instant(calendarStamp(plan.date, plan.endTime, plan.endTime <= plan.startTime));
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return { start, end };
}

export function coverageMinutes(span: CoverageSpan) {
  return Math.round((span.end - span.start) / minute);
}

export function coverageDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h${remainder ? String(remainder).padStart(2, '0') : ''}` : `${remainder} min`;
}

export function calculateFractionalCoverage(planned: CoverageSpan, capacity: number, allocations: CoverageSpan[]) {
  const boundaries = [...new Set([planned.start, planned.end, ...allocations.flatMap(span => [span.start, span.end])])].sort((a, b) => a - b);
  const valid = Number.isInteger(capacity) && capacity >= 1 && capacity <= 20 && planned.start < planned.end
    && allocations.every(span => span.start >= planned.start && span.end <= planned.end && span.start < span.end);
  if (!valid) return null;
  const gapLanes: CoverageSpan[][] = Array.from({ length: capacity }, () => []);
  let fullyCoveredLanes = capacity;
  let coveredMinutes = 0;
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const filled = allocations.filter(span => span.start <= start && span.end > start).length;
    if (filled > capacity) return null;
    fullyCoveredLanes = Math.min(fullyCoveredLanes, filled);
    coveredMinutes += filled * coverageMinutes({ start, end });
    for (const gaps of gapLanes.slice(0, capacity - filled)) {
      const last = gaps.at(-1);
      if (last?.end === start) last.end = end;
      else gaps.push({ start, end });
    }
  }
  const plannedMinutes = coverageMinutes(planned) * capacity;
  return {
    plannedMinutes,
    coveredMinutes,
    uncoveredMinutes: plannedMinutes - coveredMinutes,
    fullyCoveredLanes,
    gaps: gapLanes.flat().sort((a, b) => a.start - b.start || a.end - b.end),
  };
}

export function coverageGroups(shifts: Shift[]) {
  const groups = new Map<string, Shift[]>();
  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const key = shift.coveragePost?.id || shift.id;
    const group = groups.get(key);
    if (group) group.push(shift);
    else groups.set(key, [shift]);
  }
  return groups;
}

export function coveragePositions(shifts: Shift[]) {
  let created = 0;
  let filled = 0;
  for (const group of coverageGroups(shifts).values()) {
    const post = group[0].coveragePost;
    if (!post) {
      created++;
      if (group[0].doctorId) filled++;
      continue;
    }
    const spans = group.filter(item => item.doctorId).flatMap(item => coverageSpan(item) || []);
    created += post.capacity;
    filled += calculateFractionalCoverage({ start: Date.parse(post.startsAt), end: Date.parse(post.endsAt) }, post.capacity, spans)?.fullyCoveredLanes || 0;
  }
  return { created, filled };
}

export function summarizeRegisteredCoverage(shifts: Shift[]) {
  const summary = { plannedMinutes: 0, coveredMinutes: 0, uncoveredMinutes: 0, complete: 0, partial: 0, empty: 0 };
  for (const group of coverageGroups(shifts).values()) {
    const first = group[0];
    const post = first.coveragePost;
    const interval = post
      ? { start: Date.parse(post.startsAt), end: Date.parse(post.endsAt) }
      : { start: calendarStamp(first.date, first.startTime), end: calendarStamp(first.date, first.endTime, first.endTime < first.startTime) };
    const spans = post ? group.filter(item => item.doctorId).flatMap(item => coverageSpan(item) || [])
      : first.doctorId ? [interval] : [];
    const totals = calculateFractionalCoverage(interval, post?.capacity || 1, spans);
    if (!totals) continue;
    summary.plannedMinutes += totals.plannedMinutes;
    summary.coveredMinutes += totals.coveredMinutes;
    summary.uncoveredMinutes += totals.uncoveredMinutes;
    if (!totals.uncoveredMinutes) summary.complete++;
    else if (totals.coveredMinutes) summary.partial++;
    else summary.empty++;
  }
  return summary;
}
