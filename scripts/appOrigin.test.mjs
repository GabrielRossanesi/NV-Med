import assert from 'node:assert/strict';
import test from 'node:test';
import { authFlowUrl, buildAppOrigin, officialAppOrigin } from '../src/lib/appOrigin.ts';

test('production builds require the exact official HTTPS origin', () => {
  assert.equal(buildAppOrigin('production', officialAppOrigin), officialAppOrigin);
  for (const value of [undefined, 'http://med.nvcore.com.br', 'https://nvmed.vercel.app', officialAppOrigin + '/login']) {
    assert.throws(() => buildAppOrigin('production', value), /origem oficial/);
  }
  assert.equal(buildAppOrigin('preview', officialAppOrigin), '');
});

test('new Auth flows use the official origin and preserve only valid company context', () => {
  const previous = process.env.NVMED_BUILT_APP_ORIGIN;
  try {
    process.env.NVMED_BUILT_APP_ORIGIN = officialAppOrigin;
    const legacyOrigin = 'https://nvmed.vercel.app';
    assert.equal(authFlowUrl('/auth/confirm', legacyOrigin, 'nv-pilot').href, officialAppOrigin + '/auth/confirm?empresa=nv-pilot');
    assert.equal(authFlowUrl('/definir-senha', legacyOrigin, 'x&next=outside').href, officialAppOrigin + '/definir-senha');
    delete process.env.NVMED_BUILT_APP_ORIGIN;
    assert.equal(authFlowUrl('/auth/confirm', 'http://localhost:3000').origin, 'http://localhost:3000');
  } finally {
    if (previous === undefined) delete process.env.NVMED_BUILT_APP_ORIGIN;
    else process.env.NVMED_BUILT_APP_ORIGIN = previous;
  }
});
