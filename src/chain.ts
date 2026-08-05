import type { Provider } from './provider.ts';
import { ProviderError } from './provider-error.ts';

/**
 * Compose providers so the first one to resolve wins.
 *
 * A link that fails because its source is absent is skipped. A link that
 * throws a {@link ProviderError} with `tryNextLink: false` short-circuits the
 * whole chain — later links are not consulted. If every link fails, the
 * rejection aggregates their messages so the caller can see each source that
 * was tried and why it did not answer.
 */
export function chain<T>(...providers: Provider<T>[]): Provider<T> {
  return async () => {
    const failures: string[] = [];

    for (const provider of providers) {
      try {
        return await provider();
      } catch (error) {
        if (error instanceof ProviderError && !error.tryNextLink) {
          throw error;
        }
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }

    throw new ProviderError(
      `no provider resolved a value (${failures.join('; ')})`,
      false,
    );
  };
}
