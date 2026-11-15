import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { HTTP_FETCH, MAX_RESPONSE_BYTES } from './http.constants';
import { UpstreamRequestError } from './http.errors';
import type { HttpFetch, JsonRequestOptions } from './http.types';

/**
 * Bounded JSON requests to upstream providers, through the HTTP_FETCH provider
 * that tests replace with fixtures. Logs retries and final failures itself, with
 * provider text sanitized for the log.
 */
@Injectable()
export class JsonRequestService {
  constructor(
    @Inject(HTTP_FETCH) private readonly fetch: HttpFetch,
    @InjectPinoLogger(JsonRequestService.name) private readonly logger: PinoLogger,
  ) {}

  /**
   * GETs a JSON body with a per-attempt timeout and at most one retry, only after a
   * timeout, a network error or HTTP 5xx. A rate limit, another HTTP error, an
   * invalid body or one over the size limit fails at once.
   */
  async get(url: URL, options: JsonRequestOptions): Promise<unknown> {
    try {
      return await requestOnce(this.fetch, url, options);
    } catch (error) {
      if (!(error instanceof UpstreamRequestError) || !error.transient) {
        this.logFailure(error, options.label);
        throw error;
      }
      this.logger.warn(`${options.label} attempt failed (${error.kind}); retrying once`);
      try {
        return await requestOnce(this.fetch, url, options);
      } catch (retryError) {
        this.logFailure(retryError, options.label);
        throw retryError;
      }
    }
  }

  /**
   * Provider text, cut short and stripped of control characters, for adapters that
   * log a provider's own reason next to their failure.
   */
  static forLog(text: string): string {
    return text.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').slice(0, 200);
  }

  private logFailure(error: unknown, label: string): void {
    if (!(error instanceof UpstreamRequestError)) {
      this.logger.warn(`${label} unavailable: ${String(error)}`);
      return;
    }
    const detail = error.detail ? `: ${JsonRequestService.forLog(error.detail)}` : '';
    this.logger.warn(`${label} unavailable (${error.kind})${detail}`);
  }
}

async function requestOnce(
  fetch: HttpFetch,
  url: URL,
  { label, timeoutMs, maxBytes = MAX_RESPONSE_BYTES }: JsonRequestOptions,
): Promise<unknown> {
  let text: string;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The status decides first, so an error page of any size keeps its own kind
    // and retry rule; its body is only read, cut short, for the log.
    if (response.status === 429) {
      throw new UpstreamRequestError(
        'RATE_LIMITED',
        `${label} rate limit reached (HTTP 429).`,
        false,
        await readPrefix(response),
      );
    }
    if (!response.ok) {
      throw new UpstreamRequestError(
        'HTTP_ERROR',
        `${label} answered HTTP ${response.status}.`,
        response.status >= 500,
        await readPrefix(response),
      );
    }
    text = await readBody(response, maxBytes, label);
  } catch (error) {
    if (error instanceof UpstreamRequestError) {
      throw error;
    }
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

/** Bytes of an error body kept for the log; the log line itself is cut further by `forLog`. */
const ERROR_DETAIL_BYTES = 4 * 1024;

/**
 * Reads a 2xx body as UTF-8, giving up as soon as it passes `maxBytes` — from the
 * declared length when there is one, otherwise while streaming — so an oversized
 * answer is never buffered whole.
 */
async function readBody(response: Response, maxBytes: number, label: string): Promise<string> {
  const tooLarge = new UpstreamRequestError(
    'TOO_LARGE',
    `${label} answered with more than ${maxBytes} bytes.`,
    false,
  );
  if (Number(response.headers.get('content-length')) > maxBytes) {
    discard(response.body?.cancel());
    throw tooLarge;
  }
  const { text, complete } = await readUpTo(response, maxBytes);
  if (!complete) {
    throw tooLarge;
  }
  return text;
}

/** The start of an error body, for the log: never fails on size. */
async function readPrefix(response: Response): Promise<string> {
  return (await readUpTo(response, ERROR_DETAIL_BYTES)).text;
}

/** Streams at most `limit` bytes; `complete` is false when the body went on past it. */
async function readUpTo(
  response: Response,
  limit: number,
): Promise<{ text: string; complete: boolean }> {
  if (response.body === null) {
    return { text: '', complete: true };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { text: text + decoder.decode(), complete: true };
    }
    received += value.byteLength;
    if (received > limit) {
      discard(reader.cancel());
      return { text, complete: false };
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Releases a body without waiting: cancelling one branch of a cloned (tee'd) stream
 * settles only once the other branch is cancelled too.
 */
function discard(cancel: Promise<void> | undefined): void {
  cancel?.catch(() => undefined);
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
