import type { Provider } from './provider.ts';

/**
 * Cache a provider's resolved value, optionally re-resolving once it goes stale.
 *
 * Concurrent callers share one in-flight resolution rather than each starting
 * their own — without that, ten requests arriving at cold start would make ten
 * round-trips to the underlying source. A rejection is not cached, so a failed
 * lookup can be retried.
 */
export function memoize<T>(
  provider: Provider<T>,
  isExpired?: (value: T) => boolean,
): Provider<T> {
  let pending: Promise<T> | undefined;
  let cached: { value: T } | undefined;

  return async () => {
    if (cached && isExpired?.(cached.value) !== true) {
      return cached.value;
    }

    pending ??= (async () => {
      try {
        const value = await provider();
        cached = { value };
        return value;
      } finally {
        pending = undefined;
      }
    })();

    return pending;
  };
}
