import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chain,
  fromEnv,
  fromStatic,
  memoize,
  ProviderError,
  type Provider,
} from './index.ts';

test('composes a memoized chain that prefers the environment', async (t) => {
  process.env.SECRET_PROVIDER_TEST_API_KEY = 'from-env';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_API_KEY;
  });

  const apiKey: Provider<string> = memoize(
    chain(
      fromEnv('SECRET_PROVIDER_TEST_API_KEY'),
      fromStatic('fallback'),
    ),
  );

  assert.equal(await apiKey(), 'from-env');
});

test('composes a memoized chain that falls back when the environment is bare', async () => {
  delete process.env.SECRET_PROVIDER_TEST_API_KEY;

  let fallbackReads = 0;
  const apiKey = memoize(
    chain(fromEnv('SECRET_PROVIDER_TEST_API_KEY'), () => {
      fallbackReads += 1;
      return Promise.resolve('from-fallback');
    }),
  );

  assert.equal(await apiKey(), 'from-fallback');
  assert.equal(await apiKey(), 'from-fallback');
  assert.equal(fallbackReads, 1, 'the resolved value should be cached');
});

test('falls past an empty environment variable to the next link', async (t) => {
  process.env.SECRET_PROVIDER_TEST_API_KEY = '';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_API_KEY;
  });

  const apiKey = chain(
    fromEnv('SECRET_PROVIDER_TEST_API_KEY'),
    fromStatic('from-fallback'),
  );

  assert.equal(await apiKey(), 'from-fallback');
});

test('surfaces ProviderError so callers can distinguish a halted chain', async () => {
  delete process.env.SECRET_PROVIDER_TEST_API_KEY;

  const apiKey = chain(fromEnv('SECRET_PROVIDER_TEST_API_KEY'));

  await assert.rejects(apiKey(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, false);
    return true;
  });
});
