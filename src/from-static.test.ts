import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromStatic } from './from-static.ts';

test('resolves the value it was given', async () => {
  const resolve = fromStatic('from-static');

  assert.equal(await resolve(), 'from-static');
});

test('resolves the same value on every call', async () => {
  const credential = { id: 'abc', secret: 'shh' };
  const resolve = fromStatic(credential);

  assert.equal(await resolve(), credential);
  assert.equal(await resolve(), credential);
});
