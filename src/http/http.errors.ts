/** Why an upstream JSON request failed, before an adapter maps it to its own error. */
export type UpstreamFailureKind =
  'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'HTTP_ERROR' | 'INVALID_JSON' | 'TOO_LARGE';

/**
 * A failed upstream request. `message` is client-facing and carries no provider
 * text; `detail` holds provider text (an error body) for logs only.
 */
export class UpstreamRequestError extends Error {
  constructor(
    readonly kind: UpstreamFailureKind,
    message: string,
    readonly transient: boolean,
    readonly detail?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'UpstreamRequestError';
  }
}
