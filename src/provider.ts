/**
 * A lazily-resolved value.
 *
 * Deliberately the same shape as the AWS SDK's `Provider<T>`: a provider is
 * nothing more than an async thunk, which is what lets anything at all — an
 * env var, a file, a `op read` subprocess, a vault round-trip — serve as a
 * link in a chain.
 */
export type Provider<T> = () => Promise<T>;
