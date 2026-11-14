import { Logger } from '@nestjs/common';
import { rejected } from '../../test/support/errors';
import { fixtureFetch, jsonResponse } from '../../test/support/fixture-fetch';
import { forLog, requestJson, UpstreamRequestError } from './json-request';

const URL_ = new URL('https://api.open-meteo.com/v1/forecast');
const logger = new Logger('json-request.spec');

function request(fetch: ReturnType<typeof fixtureFetch>, maxBytes?: number) {
  return requestJson(fetch, URL_, { label: 'Provider', timeoutMs: 5000, maxBytes, logger });
}

/** A body that arrives in chunks without a declared length, as a chunked transfer would. */
function streamed(...chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('requestJson', () => {
  it('parses a body within the limit, multi-byte characters included', async () => {
    const fetch = fixtureFetch(() => streamed('{"unit":"', '°C"}'));

    await expect(request(fetch, 64)).resolves.toEqual({ unit: '°C' });
  });

  it('rejects a declared length over the limit before reading the body', async () => {
    const fetch = fixtureFetch(
      () => new Response('{}', { status: 200, headers: { 'content-length': '100' } }),
    );

    const error = await rejected(request(fetch, 10), UpstreamRequestError);

    expect(error.kind).toBe('TOO_LARGE');
    expect(error.transient).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops reading a streamed body once it passes the limit', async () => {
    const fetch = fixtureFetch(() => streamed('{"a":"', 'x'.repeat(8), '"}'));

    const error = await rejected(request(fetch, 10), UpstreamRequestError);

    expect(error.kind).toBe('TOO_LARGE');
    expect(error.message).toBe('Provider answered with more than 10 bytes.');
  });

  it('keeps the error body for logs only, never in the message', async () => {
    const fetch = fixtureFetch(() => jsonResponse({ reason: 'secret detail' }, 400));

    const error = await rejected(request(fetch), UpstreamRequestError);

    expect(error.kind).toBe('HTTP_ERROR');
    expect(error.message).toBe('Provider answered HTTP 400.');
    expect(error.detail).toContain('secret detail');
  });
});

describe('forLog', () => {
  it('strips control and format characters and cuts the text short', () => {
    const logged = forLog(`a\nb\u001b[31m​c${'x'.repeat(300)}`);

    expect(logged.startsWith('a b [31m c')).toBe(true);
    expect(logged).toHaveLength(200);
  });
});
