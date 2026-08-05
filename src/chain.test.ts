import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chain } from './chain.ts';
import { ProviderError } from './provider-error.ts';

test('falls through an absent source to the next one that resolves', async () => {
  const resolve = chain<string>(
    () => Promise.reject(new ProviderError('POSTFUL_API_KEY not set')),
    () => Promise.reject(new ProviderError('/run/secrets/api_key does not exist')),
    () => Promise.resolve('from-static'),
  );

  assert.equal(await resolve(), 'from-static');
});

test('returns the first resolving value without consulting later links', async () => {
  const consulted: string[] = [];
  const resolve = chain<string>(
    () => {
      consulted.push('env');
      return Promise.resolve('from-env');
    },
    () => {
      consulted.push('file');
      return Promise.resolve('from-file');
    },
  );

  assert.equal(await resolve(), 'from-env');
  assert.deepEqual(consulted, ['env']);
});

test('halts on a ProviderError with tryNextLink false', async () => {
  const consulted: string[] = [];
  const resolve = chain<string>(
    () => {
      consulted.push('env');
      return Promise.reject(new ProviderError('POSTFUL_API_KEY not set'));
    },
    () => {
      consulted.push('vault');
      return Promise.reject(new ProviderError('vault rejected the token', false));
    },
    () => {
      consulted.push('static');
      return Promise.resolve('from-static');
    },
  );

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.message, 'vault rejected the token');
    return true;
  });
  assert.deepEqual(consulted, ['env', 'vault']);
});

test('throws aggregating every failure once the links are exhausted', async () => {
  const resolve = chain<string>(
    () => Promise.reject(new ProviderError('POSTFUL_API_KEY not set')),
    () => Promise.reject(new Error('file read failed')),
  );

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, false);
    assert.match(error.message, /POSTFUL_API_KEY not set/);
    assert.match(error.message, /file read failed/);
    return true;
  });
});

test('throws rather than hanging when given no links at all', async () => {
  const resolve = chain<string>();

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, false);
    return true;
  });
});
