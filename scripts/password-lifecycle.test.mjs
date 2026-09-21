import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completePasswordChangeMetadata } from '../src/lib/passwordLifecycle.ts';

test('explicitly clears the required-password flag while preserving provider metadata', () => {
  const metadata = completePasswordChangeMetadata({
    provider: 'email',
    providers: ['email'],
    must_change_password: true,
    temporary_password_set_at: '2026-09-20T12:00:00.000Z',
  });

  assert.equal(metadata.must_change_password, false);
  assert.equal(metadata.temporary_password_set_at, null);
  assert.equal(metadata.provider, 'email');
  assert.deepEqual(metadata.providers, ['email']);
});
