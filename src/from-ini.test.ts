import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { fromIni } from './from-ini.ts';
import { ProviderError } from './provider-error.ts';

async function scratchDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'secret-provider-ini-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Write an ini file into a scratch dir and hand back its path. */
async function iniFile(t: TestContext, contents: string): Promise<string> {
  const dir = await scratchDir(t);
  const path = join(dir, 'credentials');
  await writeFile(path, contents);
  return path;
}

test('resolves a key from the default profile', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = s3cret\n');

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('resolves a key from a named profile', async (t) => {
  const path = await iniFile(
    t,
    '[default]\napi_key = default-key\n\n[staging]\napi_key = staging-key\n',
  );

  assert.equal(
    await fromIni(path, 'api_key', { profile: 'staging' })(),
    'staging-key',
  );
});

test('does not leak a key from one profile into another', async (t) => {
  const path = await iniFile(
    t,
    '[default]\napi_key = default-key\n\n[staging]\nother = x\n',
  );

  await assert.rejects(
    fromIni(path, 'api_key', { profile: 'staging' })(),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.tryNextLink, true);
      return true;
    },
  );
});

test('splits on the first equals only, so a value may contain one', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = abc==\n');

  assert.equal(await fromIni(path, 'api_key')(), 'abc==');
});

test('trims whitespace around the key and the value', async (t) => {
  const path = await iniFile(t, '[default]\n   api_key   =   s3cret   \n');

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('strips surrounding double quotes', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = "s3cret"\n');

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('strips surrounding single quotes', async (t) => {
  const path = await iniFile(t, "[default]\napi_key = 's3cret'\n");

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('leaves mismatched quotes alone', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = "s3cret\n');

  assert.equal(await fromIni(path, 'api_key')(), '"s3cret');
});

test('keeps a hash inside a value rather than treating it as a comment', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = s3c#ret\n');

  assert.equal(await fromIni(path, 'api_key')(), 's3c#ret');
});

test('keeps a semicolon inside a value', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = s3c;ret\n');

  assert.equal(await fromIni(path, 'api_key')(), 's3c;ret');
});

test('ignores whole-line comments', async (t) => {
  const path = await iniFile(
    t,
    '# a comment\n[default]\n; another comment\napi_key = s3cret\n',
  );

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('ignores lines that are neither a section nor an assignment', async (t) => {
  const path = await iniFile(
    t,
    '[default]\nthis line is junk\napi_key = s3cret\nmore junk\n',
  );

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('the last of a duplicated key wins', async (t) => {
  const path = await iniFile(
    t,
    '[default]\napi_key = first\napi_key = second\n',
  );

  assert.equal(await fromIni(path, 'api_key')(), 'second');
});

test('reads a file written with CRLF line endings', async (t) => {
  const path = await iniFile(t, '[default]\r\napi_key = s3cret\r\n');

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('tolerates whitespace around a section header', async (t) => {
  const path = await iniFile(t, '  [ default ]  \napi_key = s3cret\n');

  assert.equal(await fromIni(path, 'api_key')(), 's3cret');
});

test('looks up the key case-sensitively', async (t) => {
  const path = await iniFile(t, '[default]\nAPI_KEY = s3cret\n');

  await assert.rejects(fromIni(path, 'api_key')(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    return true;
  });
});

test('falls through when the profile is absent', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = s3cret\n');

  await assert.rejects(
    fromIni(path, 'api_key', { profile: 'nope' })(),
    (error) => {
      assert.ok(error instanceof ProviderError);
      assert.equal(error.tryNextLink, true);
      assert.match(error.message, /nope/);
      return true;
    },
  );
});

test('falls through when the key is absent from the profile', async (t) => {
  const path = await iniFile(t, '[default]\nother = x\n');

  await assert.rejects(fromIni(path, 'api_key')(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /api_key/);
    return true;
  });
});

test('falls through when the value is empty', async (t) => {
  const path = await iniFile(t, '[default]\napi_key =\n');

  await assert.rejects(fromIni(path, 'api_key')(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('falls through when the value is only empty quotes', async (t) => {
  const path = await iniFile(t, '[default]\napi_key = ""\n');

  await assert.rejects(fromIni(path, 'api_key')(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    assert.match(error.message, /empty/);
    return true;
  });
});

test('falls through when the file does not exist', async (t) => {
  const dir = await scratchDir(t);

  await assert.rejects(fromIni(join(dir, 'absent'), 'api_key')(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, true);
    return true;
  });
});

test('halts the chain when the path is present but unreadable', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'a_directory');
  await mkdir(path);

  await assert.rejects(fromIni(path, 'api_key')(), (error) => {
    assert.ok(error instanceof ProviderError);
    assert.equal(error.tryNextLink, false);
    return true;
  });
});

test('expands a leading tilde to the home directory', async (t) => {
  const home = await scratchDir(t);
  const previous = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previous;
    }
  });

  await mkdir(join(home, '.postful'));
  await writeFile(
    join(home, '.postful', 'credentials'),
    '[default]\napi_key = from-home\n',
  );

  assert.equal(
    await fromIni('~/.postful/credentials', 'api_key')(),
    'from-home',
  );
});

test('reads the file at resolution, not at construction', async (t) => {
  const dir = await scratchDir(t);
  const path = join(dir, 'credentials');

  const resolve = fromIni(path, 'api_key');
  await writeFile(path, '[default]\napi_key = written-later\n');

  assert.equal(await resolve(), 'written-later');
});
