import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAbortTimeout } from '../src/lib/requestTimeout.ts';

test('returns a request result before the timeout', async () => {
  const result = await withAbortTimeout(async () => 'saved', { timeoutMs: 50 });
  assert.equal(result, 'saved');
});

test('aborts a stalled request and returns the configured message', async () => {
  let aborted = false;
  const operation = (signal) => new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      aborted = true;
      resolve('late response');
    }, { once: true });
  });

  await assert.rejects(
    withAbortTimeout(operation, { timeoutMs: 5, message: 'Tempo limite atingido.' }),
    /Tempo limite atingido\./
  );
  assert.equal(aborted, true);
});
