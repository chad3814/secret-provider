import type { Environment } from './environment.ts';
import type { Provider } from './provider.ts';
import { ProviderError } from './provider-error.ts';

/** Reads a value out of an environment, or `undefined` when it is not there. */
type EnvReader<T> = (env: Environment) => T | undefined;

/**
 * Both `fromEnv` forms resolve through this, so a directly named variable and a
 * reader-supplied one fall through on exactly the same conditions.
 */
function readingEnv<T>(read: EnvReader<T>, label: string): Provider<T> {
  return () => {
    const value = read(process.env);

    if (value === undefined) {
      return Promise.reject(
        new ProviderError(`${label} not set in the environment`),
      );
    }

    if (typeof value === 'string' && value === '') {
      return Promise.reject(new ProviderError(`${label} is set but empty`));
    }

    return Promise.resolve(value);
  };
}

/**
 * Read the named variable out of the process environment.
 *
 * @param name The variable to read, which also names it in the fall-through
 *   message.
 */
export function fromEnv(name: string): Provider<string>;

/**
 * Read a value out of the process environment via a reader, which is free to
 * parse the raw string into another type.
 *
 * @param read Pulls the value out of the environment, or returns `undefined`
 *   when it is not there.
 * @param label Names the source in the fall-through message.
 */
export function fromEnv<T>(read: EnvReader<T>, label: string): Provider<T>;

/**
 * Read a value out of the process environment.
 *
 * The environment is consulted on every resolution rather than once at
 * construction, so a variable set later — or changed between resolutions of an
 * expiring {@link memoize} — is picked up.
 *
 * A variable that is unset *or* set to the empty string is treated as absent
 * and falls through to the next link in a chain: an empty credential is
 * effectively always a misconfiguration, and accepting it would surface as a
 * confusing downstream auth failure instead of trying the next source.
 */
export function fromEnv<T>(
  source: string | EnvReader<T>,
  label?: string,
): Provider<T | string> {
  if (typeof source === 'string') {
    return readingEnv((env) => env[source], source);
  }

  return readingEnv(source, label ?? 'an environment value');
}
