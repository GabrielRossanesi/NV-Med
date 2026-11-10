import test from 'node:test';
import assert from 'node:assert/strict';
import { requestShiftLocation } from '../src/lib/shiftAttendance.ts';

test('distinguishes refused permission, unavailable GPS and timeout', async () => {
  for (const [code, message] of [[1, /recusada/], [2, /indisponível/], [3, /demorou/]]) {
    const geolocation = { getCurrentPosition(_success, failure) { failure({ code }); } };
    await assert.rejects(requestShiftLocation(geolocation, true), message);
  }
});

test('requests a fresh location only on an explicit action in a secure context', async () => {
  let calls = 0;
  const coords = { latitude: -23.55, longitude: -46.63, accuracy: 12 };
  const geolocation = { getCurrentPosition(success, _failure, options) {
    calls += 1;
    assert.equal(options.maximumAge, 0);
    success({ coords });
  } };
  await assert.rejects(requestShiftLocation(geolocation, false), /HTTPS/);
  assert.equal(calls, 0);
  assert.equal(await requestShiftLocation(geolocation, true), coords);
  assert.equal(calls, 1);
});
