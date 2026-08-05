import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  chain,
  fromEnv,
  fromFile,
  fromPrompt,
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

test('prefers the environment, then a file, then a static fallback', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'secret-provider-index-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.SECRET_PROVIDER_TEST_API_KEY;
  });
  const path = join(dir, 'api_key');

  const apiKey = () =>
    memoize(
      chain(
        fromEnv('SECRET_PROVIDER_TEST_API_KEY'),
        fromFile(path),
        fromStatic('from-static'),
      ),
    );

  delete process.env.SECRET_PROVIDER_TEST_API_KEY;
  assert.equal(await apiKey()(), 'from-static', 'nothing set yet');

  await writeFile(path, 'from-file\n');
  assert.equal(await apiKey()(), 'from-file', 'file beats the static fallback');

  process.env.SECRET_PROVIDER_TEST_API_KEY = 'from-env';
  assert.equal(await apiKey()(), 'from-env', 'the environment wins outright');
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

test('exposes fromPrompt as a chain link that falls through without a TTY', async () => {
  const notATty = {
    isTTY: false,
    on: () => undefined,
    off: () => undefined,
  };

  const apiKey = chain(
    fromPrompt('API key: ', { input: notATty }),
    fromStatic('from-static'),
  );

  assert.equal(await apiKey(), 'from-static');
});
