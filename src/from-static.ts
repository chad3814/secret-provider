import type { Provider } from './provider.ts';

/**
 * Wrap an already-known value as a provider.
 *
 * Useful as the last link in a chain — an explicit default — and for supplying
 * a credential directly in tests.
 */
export function fromStatic<T>(value: T): Provider<T> {
  return () => Promise.resolve(value);
}
