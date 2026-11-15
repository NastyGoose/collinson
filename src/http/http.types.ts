import type { Logger } from '@nestjs/common';

/**
 * The HTTP client upstream adapters use: the global `fetch` by default. Tests
 * override the HTTP_FETCH provider with fixture responses, so the real adapters
 * run against controlled provider payloads without network access.
 */
export type HttpFetch = (input: URL, init?: RequestInit) => Promise<Response>;

/** Why an upstream JSON request failed, before an adapter maps it to its own error. */
export type UpstreamFailureKind =
  'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'HTTP_ERROR' | 'INVALID_JSON' | 'TOO_LARGE';

export interface JsonRequestOptions {
  /** Names the provider in messages and logs, e.g. "Geocoding" or "Marine forecast". */
  label: string;
  /** Limit for each attempt, covering the response body as well as the headers. */
  timeoutMs: number;
  /** Largest body accepted, in bytes; defaults to MAX_RESPONSE_BYTES. */
  maxBytes?: number;
  logger: Logger;
}
