import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRecurringDates, countDoctors, shiftTouchesDay, hasConflict, statusAfterDoctorSelection, summarizeSectorCoverage } from '../src/lib/scheduling.ts';
const base = { id:'a', organizationId:'org', doctorId:'doctor', unitId:'unit', date:'2026-09-20', startTime:'07:00', endTime:'19:00', type:'onsite', status:'confirmed' };
test('counts unique doctors and excludes cancelled shifts',()=>assert.equal(countDoctors([base,{...base,id:'b'},{...base,id:'c',doctorId:'other',status:'cancelled'}]),1));
test('overnight shift contributes to both covered days',()=>{const s={...base,startTime:'19:00',endTime:'07:00'};assert.equal(shiftTouchesDay(s,'2026-09-20'),true);assert.equal(shiftTouchesDay(s,'2026-09-21'),true);assert.equal(shiftTouchesDay(s,'2026-09-22'),false);});
test('midnight end does not cover the following day',()=>assert.equal(shiftTouchesDay({...base,startTime:'19:00',endTime:'00:00'},'2026-09-21'),false));
test('overnight counts across month and year boundaries',()=>assert.equal(shiftTouchesDay({...base,date:'2026-12-31',startTime:'19:00',endTime:'07:00'},'2027-01-01'),true));
test('adjacent shifts are allowed but overlap across midnight is rejected',()=>{const night={...base,startTime:'19:00',endTime:'07:00'};assert.equal(hasConflict({...base,id:'b',date:'2026-09-21'},[night]),false);assert.equal(hasConflict({...base,id:'b',date:'2026-09-21',startTime:'06:00'},[night]),true);});
test('editing a shift does not conflict with itself',()=>assert.equal(hasConflict(base,[base]),false));
test('cancellation and different doctors do not conflict',()=>{assert.equal(hasConflict({...base,id:'b',status:'cancelled'},[base]),false);assert.equal(hasConflict({...base,id:'b',doctorId:'other'},[base]),false);});
test('open positions do not count as doctors or create conflicts',()=>{const open={...base,id:'open',doctorId:undefined,status:'open'};assert.equal(countDoctors([base,open]),1);assert.equal(hasConflict(open,[base]),false);});
test('fortnightly recurrence keeps weekday and 14-day interval',()=>assert.deepEqual(buildRecurringDates('2026-09-24','2026-10-23','fortnightly'),['2026-09-24','2026-10-08','2026-10-22']));
test('weekly recurrence includes start and limit date',()=>assert.deepEqual(buildRecurringDates('2026-09-22','2026-10-06','weekly'),['2026-09-22','2026-09-29','2026-10-06']));
test('monthly recurrence keeps ordinal weekday',()=>assert.deepEqual(buildRecurringDates('2026-09-08','2026-12-31','monthly'),['2026-09-08','2026-10-13','2026-11-10','2026-12-08']));
test('monthly recurrence skips months without the fifth weekday',()=>assert.deepEqual(buildRecurringDates('2026-09-30','2026-12-31','monthly'),['2026-09-30','2026-12-30']));
test('coverage separates assigned doctors, open vacancies and positions not yet created',()=>{
  const sector={coveragePeriods:[{kind:'day',startTime:'07:00',endTime:'19:00',requiredDoctors:3},{kind:'night',startTime:'19:00',endTime:'07:00',requiredDoctors:3}],defaultStartTime:'07:00',defaultEndTime:'19:00',requiredDoctors:6};
  const shifts=[
    {...base,id:'day-assigned'},
    {...base,id:'day-open',doctorId:undefined,status:'open'},
    {...base,id:'night-assigned',startTime:'19:00',endTime:'07:00'},
  ];
  const summary=summarizeSectorCoverage(sector,shifts);
  assert.deepEqual({required:summary.required,created:summary.created,filled:summary.filled,open:summary.open,uncreated:summary.uncreated,deficit:summary.deficit},{required:6,created:3,filled:2,open:1,uncreated:3,deficit:4});
  assert.deepEqual(summary.periods.map(period=>({kind:period.period.kind,filled:period.filled,open:period.open,uncreated:period.uncreated})),[
    {kind:'day',filled:1,open:1,uncreated:1},
    {kind:'night',filled:1,open:0,uncreated:2},
  ]);
});
test('coverage assigns a custom-time shift to its closest day or night period',()=>{
  const sector={coveragePeriods:[{kind:'day',startTime:'07:00',endTime:'19:00',requiredDoctors:1},{kind:'night',startTime:'19:00',endTime:'07:00',requiredDoctors:1}],defaultStartTime:'07:00',defaultEndTime:'19:00',requiredDoctors:2};
  const summary=summarizeSectorCoverage(sector,[{...base,startTime:'20:00',endTime:'08:00'}]);
  assert.equal(summary.periods.find(period=>period.period.kind==='night')?.filled,1);
});
test('replacing a doctor requires confirmation while keeping the same doctor preserves status',()=>{
  assert.equal(statusAfterDoctorSelection('confirmed','doctor-a','doctor-b'),'pending');
  assert.equal(statusAfterDoctorSelection('confirmed','doctor-a','doctor-a'),'confirmed');
  assert.equal(statusAfterDoctorSelection('open',undefined,'doctor-a'),'pending');
  assert.equal(statusAfterDoctorSelection('confirmed','doctor-a',''),'open');
});
