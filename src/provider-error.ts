/**
 * Thrown by a link in a provider chain.
 *
 * `tryNextLink` distinguishes the two failure modes that matter: a source that
 * is simply absent (fall through to the next link) from a source that answered
 * and refused (halt, rather than silently degrading to a weaker credential).
 */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly tryNextLink: boolean;

  constructor(message: string, tryNextLink = true) {
    super(message);
    this.tryNextLink = tryNextLink;
  }
}
