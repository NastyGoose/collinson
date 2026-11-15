import { rejected } from '../../support/errors';
import { fixtureFetch, jsonResponse } from '../../support/fixture-fetch';
import { jsonRequest } from '../../support/json-request';
import { JsonRequestService } from '../../../src/http/json-request.service';
import { UpstreamRequestError } from '../../../src/http/http.errors';

const URL_ = new URL('https://api.open-meteo.com/v1/forecast');
function request(fetch: ReturnType<typeof fixtureFetch>, maxBytes?: number) {
  return jsonRequest(fetch).get(URL_, { label: 'Provider', timeoutMs: 5000, maxBytes });
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

describe('JsonRequestService.get', () => {
  it('parses a body within the limit, multi-byte characters included', async () => {
    const fetch = fixtureFetch(() => streamed('{"unit":"', '°C"}'));

    await expect(request(fetch, 64)).resolves.toEqual({ unit: '°C' });
  });

  it('rejects a declared length over the limit without retrying', async () => {
    const fetch = fixtureFetch(
      () => new Response('{}', { status: 200, headers: { 'content-length': '100' } }),
    );

    const error = await rejected(request(fetch, 10), UpstreamRequestError);

    expect(error.kind).toBe('TOO_LARGE');
    expect(error.transient).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the status of an oversized error page, retrying a 5xx', async () => {
    const fetch = fixtureFetch(
      () => new Response('x'.repeat(100), { status: 503, headers: { 'content-length': '100' } }),
    );

    const error = await rejected(request(fetch, 10), UpstreamRequestError);

    expect(error.kind).toBe('HTTP_ERROR');
    expect(error.transient).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.detail).toHaveLength(100);
  });

  it('reports a timeout while the body streams as a timeout, and retries it', async () => {
    const stalled = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"partial":'));
          },
          pull(controller) {
            controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
          },
        }),
        { status: 200 },
      );
    const fetch = fixtureFetch(stalled);

    const error = await rejected(request(fetch), UpstreamRequestError);

    expect(error.kind).toBe('TIMEOUT');
    expect(fetch).toHaveBeenCalledTimes(2);
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

describe('JsonRequestService.forLog', () => {
  it('strips control and format characters and cuts the text short', () => {
    const logged = JsonRequestService.forLog(`a\nb\u001b[31m\u200bc${'x'.repeat(300)}`);

    expect(logged.startsWith('a b [31m c')).toBe(true);
    expect(logged).toHaveLength(200);
  });
});
