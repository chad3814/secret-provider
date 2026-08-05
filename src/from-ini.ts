import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Provider } from './provider.ts';
import { ProviderError } from './provider-error.ts';

export interface IniOptions {
  /** Which section to read. Defaults to `'default'`, as AWS's own files do. */
  profile?: string | undefined;
}

const DEFAULT_PROFILE = 'default';

/** Errno codes meaning "there is nothing at this path". */
const ABSENT_CODES = new Set(['ENOENT']);

/** Reads the errno code off a failed `fs` call, if it carries one. */
function codeOf(error: Error): string | undefined {
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/**
 * Expand a leading `~`, which a shell would have done but a Node process does
 * not. These files live in the home directory by convention.
 */
function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * Remove one layer of matching surrounding quotes.
 *
 * Values get quoted out of habit carried over from shell and `.env` files, and a
 * credential holding literal quote marks fails to authenticate in a way that is
 * genuinely hard to spot.
 */
function unquote(value: string): string {
  const first = value[0];
  if (
    value.length >= 2 &&
    (first === '"' || first === "'") &&
    value.endsWith(first)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Pull one key out of one section of an ini file.
 *
 * A deliberately small parser rather than a dependency. Unrecognised lines are
 * skipped: ini has no standard, real credential files accumulate stray content,
 * and failing over junk in an unrelated section would be disproportionate when
 * the lookup either finds the key or falls through.
 *
 * `#` and `;` begin a comment only at the start of a line, never mid-value —
 * truncating `s3c#ret` at the hash would silently mangle a credential.
 */
function lookup(
  contents: string,
  profile: string,
  key: string,
): string | undefined {
  let inProfile = false;
  let found: string | undefined;

  for (const rawLine of contents.split('\n')) {
    // Trailing \r covers files authored on Windows.
    const line = rawLine.trim().replace(/\r$/, '');

    if (line === '' || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      inProfile = line.slice(1, -1).trim() === profile;
      continue;
    }

    if (!inProfile) {
      continue;
    }

    const equals = line.indexOf('=');
    if (equals === -1) {
      continue;
    }

    // Split on the first `=` only, so a value may contain more of them.
    if (line.slice(0, equals).trim() === key) {
      // Keep going rather than returning: the last assignment wins.
      found = unquote(line.slice(equals + 1).trim());
    }
  }

  return found;
}

/**
 * Read a credential out of an ini-style file — the shape of `~/.aws/credentials`
 * and its many imitators, where each `[section]` is a named profile.
 *
 * A leading `~` in the path is expanded. Section and key lookups are
 * case-sensitive, and where a key is assigned more than once the last wins.
 * Surrounding quotes are stripped from the value.
 *
 * A path that does not exist falls through to the next link in a chain, as does
 * a missing profile, a missing key, or a value that is empty. Any other read
 * failure — no permission, a directory, a bad path prefix — halts the chain
 * instead: the source is present but broken, and silently degrading to a weaker
 * credential would hide a real misconfiguration.
 *
 * The file is read on every resolution rather than once at construction.
 */
export function fromIni(
  path: string,
  key: string,
  options: IniOptions = {},
): Provider<string> {
  const { profile = DEFAULT_PROFILE } = options;

  return async () => {
    const resolved = expandHome(path);
    let contents: string;

    try {
      contents = await readFile(resolved, 'utf8');
    } catch (cause) {
      if (cause instanceof Error && ABSENT_CODES.has(codeOf(cause) ?? '')) {
        throw new ProviderError(`${resolved} does not exist`);
      }
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ProviderError(`${resolved} could not be read: ${reason}`, false);
    }

    const value = lookup(contents, profile, key);

    if (value === undefined) {
      throw new ProviderError(
        `${key} not found in profile [${profile}] of ${resolved}`,
      );
    }

    if (value === '') {
      throw new ProviderError(
        `${key} in profile [${profile}] of ${resolved} is empty`,
      );
    }

    return value;
  };
}
