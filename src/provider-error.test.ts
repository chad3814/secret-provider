import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ProviderError } from './provider-error.ts';

test('defaults tryNextLink to true so an absent source falls through', () => {
  const error = new ProviderError('POSTFUL_API_KEY not set');

  assert.equal(error.tryNextLink, true);
});

test('records tryNextLink false so a broken source halts the chain', () => {
  const error = new ProviderError('vault rejected the token', false);

  assert.equal(error.tryNextLink, false);
});

test('is an Error with a stable name and the given message', () => {
  const error = new ProviderError('POSTFUL_API_KEY not set');

  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ProviderError');
  assert.equal(error.message, 'POSTFUL_API_KEY not set');
});
