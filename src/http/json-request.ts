import type { Logger } from '@nestjs/common';
import type { HttpFetch } from './http-fetch';

/** Why an upstream JSON request failed, before an adapter maps it to its own error. */
export type UpstreamFailureKind =
  'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'HTTP_ERROR' | 'INVALID_JSON';

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

export interface JsonRequestOptions {
  /** Names the provider in messages and logs, e.g. "Geocoding" or "Marine forecast". */
  label: string;
  /** Limit for each attempt, covering the response body as well as the headers. */
  timeoutMs: number;
  logger: Logger;
}

/**
 * GETs a JSON body with a per-attempt timeout and at most one retry, only after a
 * timeout, a network error or HTTP 5xx. A rate limit, another HTTP error or an
 * invalid body fails at once. The final failure is logged with provider text
 * sanitized for the log.
 */
export async function requestJson(
  fetch: HttpFetch,
  url: URL,
  options: JsonRequestOptions,
): Promise<unknown> {
  try {
    return await requestOnce(fetch, url, options);
  } catch (error) {
    if (!(error instanceof UpstreamRequestError) || !error.transient) {
      logFailure(error, options);
      throw error;
    }
    options.logger.warn(`${options.label} attempt failed (${error.kind}); retrying once`);
    try {
      return await requestOnce(fetch, url, options);
    } catch (retryError) {
      logFailure(retryError, options);
      throw retryError;
    }
  }
}

async function requestOnce(
  fetch: HttpFetch,
  url: URL,
  { label, timeoutMs }: JsonRequestOptions,
): Promise<unknown> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await response.text();
  } catch (error) {
    if (errorName(error) === 'TimeoutError') {
      throw new UpstreamRequestError(
        'TIMEOUT',
        `${label} did not answer within ${timeoutMs} ms.`,
        true,
        undefined,
        { cause: error },
      );
    }
    throw new UpstreamRequestError('NETWORK', `${label} request failed.`, true, undefined, {
      cause: error,
    });
  }

  if (response.status === 429) {
    throw new UpstreamRequestError(
      'RATE_LIMITED',
      `${label} rate limit reached (HTTP 429).`,
      false,
      text,
    );
  }
  if (!response.ok) {
    throw new UpstreamRequestError(
      'HTTP_ERROR',
      `${label} answered HTTP ${response.status}.`,
      response.status >= 500,
      text,
    );
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    throw new UpstreamRequestError(
      'INVALID_JSON',
      `${label} answered with invalid JSON.`,
      false,
      undefined,
      { cause: error },
    );
  }
}

function logFailure(error: unknown, { label, logger }: JsonRequestOptions): void {
  if (!(error instanceof UpstreamRequestError)) {
    logger.warn(`${label} unavailable: ${String(error)}`);
    return;
  }
  const detail = error.detail ? `: ${forLog(error.detail)}` : '';
  logger.warn(`${label} unavailable (${error.kind})${detail}`);
}

/** Provider text, cut short and stripped of control characters so it cannot forge log lines. */
export function forLog(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').slice(0, 200);
}

// Not `instanceof Error`: fetch's DOMException can come from another realm (e.g. under Jest).
function errorName(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
    ? error.name
    : undefined;
}
