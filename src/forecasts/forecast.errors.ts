/**
 * Why a source refresh failed. Values match the GraphQL `SourceFailureCode` enum
 * in the Technical Design, so ARC-48 maps them 1:1 into `SourceStatus`.
 */
export type SourceFailureCode =
  'TIMEOUT' | 'UPSTREAM_FAILURE' | 'RATE_LIMITED' | 'INVALID_PAYLOAD' | 'INSUFFICIENT_COVERAGE';

/**
 * A refresh of one weather source failed. It never escapes ForecastsService: it
 * becomes a STALE or UNAVAILABLE source status. The message is client-facing and
 * carries no provider text. Provider details stay in `cause` for logs: the
 * provider's own reason, or an UpstreamRequestError whose `detail` holds the body.
 */
export class SourceRefreshError extends Error {
  /** True for a timeout, a network error or HTTP 5xx: a second attempt may succeed. */
  readonly transient: boolean;

  constructor(
    readonly code: SourceFailureCode,
    message: string,
    options?: { cause?: unknown; transient?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'SourceRefreshError';
    this.transient = options?.transient ?? false;
  }
}

/**
 * PostgreSQL could not read or write a snapshot. `code` is the GraphQL
 * `extensions.code` the Technical Design assigns to storage failures.
 */
export class ForecastStorageUnavailableError extends Error {
  readonly code = 'STORAGE_UNAVAILABLE';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ForecastStorageUnavailableError';
  }
}
