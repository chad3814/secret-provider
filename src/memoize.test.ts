import assert from 'node:assert/strict';
import { test } from 'node:test';

import { memoize } from './memoize.ts';

test('resolves through to the source only once for repeat callers', async () => {
  let calls = 0;
  const resolve = memoize(() => {
    calls += 1;
    return Promise.resolve('from-vault');
  });

  assert.equal(await resolve(), 'from-vault');
  assert.equal(await resolve(), 'from-vault');
  assert.equal(calls, 1);
});

test('de-dupes concurrent callers into a single round-trip', async () => {
  const gate = Promise.withResolvers<string>();
  let calls = 0;
  const resolve = memoize(() => {
    calls += 1;
    return gate.promise;
  });

  const inFlight = Promise.all([resolve(), resolve(), resolve()]);
  gate.resolve('from-vault');

  assert.deepEqual(await inFlight, ['from-vault', 'from-vault', 'from-vault']);
  assert.equal(calls, 1);
});

test('re-resolves while isExpired reports the cached value stale', async () => {
  let calls = 0;
  let expired = true;
  const resolve = memoize(
    () => {
      calls += 1;
      return Promise.resolve(`token-${String(calls)}`);
    },
    () => expired,
  );

  assert.equal(await resolve(), 'token-1');
  assert.equal(await resolve(), 'token-2');
  assert.equal(calls, 2);

  expired = false;
  assert.equal(await resolve(), 'token-2');
  assert.equal(calls, 2);
});

test('does not cache a rejection, so a later caller retries the source', async () => {
  let calls = 0;
  const resolve = memoize(() => {
    calls += 1;
    return calls === 1
      ? Promise.reject(new Error('vault unreachable'))
      : Promise.resolve('from-vault');
  });

  await assert.rejects(resolve(), { message: 'vault unreachable' });
  assert.equal(await resolve(), 'from-vault');
  assert.equal(calls, 2);
});
