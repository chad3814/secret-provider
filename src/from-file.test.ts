import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { fromFile } from './from-file.ts';
import { ProviderError } from './provider-error.ts';

/** A temp directory that cleans itself up when the test ends. */
async function scratchDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'secret-provider-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('resolves the contents of the file', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');
  await writeFile(path, 'from-file');

  assert.equal(await fromFile(path)(), 'from-file');
});

test('trims a trailing newline', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');
  await writeFile(path, 'from-file\n');

  assert.equal(await fromFile(path)(), 'from-file');
});

test('trims all trailing whitespace, including CRLF, spaces and tabs', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');
  await writeFile(path, 'from-file \t\r\n\r\n');

  assert.equal(await fromFile(path)(), 'from-file');
});

test('preserves interior newlines so a multi-line credential survives', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'key.pem');
  const pem = '-----BEGIN EXAMPLE-----\nline-one\nline-two\n-----END EXAMPLE-----\n';
  await writeFile(path, pem);

  assert.equal(await fromFile(path)(), pem.trimEnd());
});

test('preserves leading whitespace, trimming only the trailing end', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');
  await writeFile(path, '  from-file  ');

  assert.equal(await fromFile(path)(), '  from-file');
});

test('falls through when the file does not exist', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'absent');

  await assert.rejects(fromFile(path)(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /absent/);
    return true;
  });
});

test('falls through when the file is empty', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');
  await writeFile(path, '');

  await assert.rejects(fromFile(path)(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('falls through when the file holds only whitespace', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');
  await writeFile(path, '\n\t  \n');

  await assert.rejects(fromFile(path)(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('halts the chain when the path is present but unreadable', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'a_directory');
  await mkdir(path);

  await assert.rejects(fromFile(path)(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(
      error.tryNextLink,
      false,
      'a present-but-broken source must not silently degrade',
    );
    return true;
  });
});

test('reads the file when resolved, not when constructed', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'api_key');

  const resolve = fromFile(path);
  await writeFile(path, 'written-after-construction');

  assert.equal(await resolve(), 'written-after-construction');
});
