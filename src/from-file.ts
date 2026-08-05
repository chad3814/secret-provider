import { readFile } from 'node:fs/promises';

import type { Provider } from './provider.ts';
import { ProviderError } from './provider-error.ts';

/**
 * Errno codes that mean "there is nothing at this path", as opposed to "there
 * is something here and it did not work out".
 */
const ABSENT_CODES = new Set(['ENOENT']);

/** Reads the errno code off a failed `fs` call, if it carries one. */
function codeOf(error: Error): string | undefined {
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

/**
 * Read a credential out of a file — a Docker or Kubernetes secret mount, a
 * `/run/secrets` entry, or anything else on disk.
 *
 * Trailing whitespace is trimmed, so a file written with a final newline (as
 * `echo` and most editors produce) yields the credential rather than one with a
 * stray `\n` that fails auth confusingly. Interior newlines are preserved, so a
 * multi-line credential such as a PEM key survives intact.
 *
 * A path that does not exist falls through to the next link in a chain, as does
 * a file that is empty once trimmed. Any other read failure — no permission, a
 * directory, a bad path prefix — halts the chain instead: the source is present
 * but broken, and silently degrading to a weaker credential would hide a real
 * misconfiguration.
 *
 * The file is read on every resolution rather than once at construction.
 */
export function fromFile(path: string): Provider<string> {
  return async () => {
    let contents: string;

    try {
      contents = await readFile(path, 'utf8');
    } catch (cause) {
      if (cause instanceof Error && ABSENT_CODES.has(codeOf(cause) ?? '')) {
        throw new ProviderError(`${path} does not exist`);
      }
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new ProviderError(`${path} could not be read: ${reason}`, false);
    }

    const value = contents.trimEnd();

    if (value === '') {
      throw new ProviderError(`${path} is empty`);
    }

    return value;
  };
}
