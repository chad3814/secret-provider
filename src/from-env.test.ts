import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fromEnv } from './from-env.ts';
import { ProviderError } from './provider-error.ts';

test('resolves the value the reader pulls out of the environment', async (t) => {
  process.env.SECRET_PROVIDER_TEST_KEY = 'from-env';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv(
    (env) => env.SECRET_PROVIDER_TEST_KEY,
    'SECRET_PROVIDER_TEST_KEY',
  );

  assert.equal(await resolve(), 'from-env');
});

test('falls through with tryNextLink true when the variable is unset', async () => {
  delete process.env.SECRET_PROVIDER_TEST_KEY;

  const resolve = fromEnv(
    (env) => env.SECRET_PROVIDER_TEST_KEY,
    'SECRET_PROVIDER_TEST_KEY',
  );

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /SECRET_PROVIDER_TEST_KEY/);
    return true;
  });
});

test('falls through when the variable is set but empty', async (t) => {
  process.env.SECRET_PROVIDER_TEST_KEY = '';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv(
    (env) => env.SECRET_PROVIDER_TEST_KEY,
    'SECRET_PROVIDER_TEST_KEY',
  );

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /SECRET_PROVIDER_TEST_KEY/);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('reads the environment when resolved, not when constructed', async (t) => {
  delete process.env.SECRET_PROVIDER_TEST_KEY;
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv(
    (env) => env.SECRET_PROVIDER_TEST_KEY,
    'SECRET_PROVIDER_TEST_KEY',
  );
  process.env.SECRET_PROVIDER_TEST_KEY = 'set-after-construction';

  assert.equal(await resolve(), 'set-after-construction');
});

test('resolves a variable named directly, without a reader', async (t) => {
  process.env.SECRET_PROVIDER_TEST_KEY = 'from-env';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv('SECRET_PROVIDER_TEST_KEY');

  assert.equal(await resolve(), 'from-env');
});

test('falls through when a directly named variable is unset', async () => {
  delete process.env.SECRET_PROVIDER_TEST_KEY;

  const resolve = fromEnv('SECRET_PROVIDER_TEST_KEY');

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /SECRET_PROVIDER_TEST_KEY/);
    return true;
  });
});

test('falls through when a directly named variable is set but empty', async (t) => {
  process.env.SECRET_PROVIDER_TEST_KEY = '';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv('SECRET_PROVIDER_TEST_KEY');

  await assert.rejects(resolve(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('reads a directly named variable when resolved, not when constructed', async (t) => {
  delete process.env.SECRET_PROVIDER_TEST_KEY;
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv('SECRET_PROVIDER_TEST_KEY');
  process.env.SECRET_PROVIDER_TEST_KEY = 'set-after-construction';

  assert.equal(await resolve(), 'set-after-construction');
});

test('supports a reader that parses the variable into another type', async (t) => {
  process.env.SECRET_PROVIDER_TEST_KEY = '8080';
  t.after(() => {
    delete process.env.SECRET_PROVIDER_TEST_KEY;
  });

  const resolve = fromEnv((env) => {
    const raw = env.SECRET_PROVIDER_TEST_KEY;
    return raw === undefined ? undefined : Number.parseInt(raw, 10);
  }, 'SECRET_PROVIDER_TEST_KEY');

  assert.equal(await resolve(), 8080);
});
