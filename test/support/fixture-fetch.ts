import type { HttpFetch } from '../../src/http/http.types';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The error `fetch` raises when AbortSignal.timeout() fires. */
export function timeoutError(): Error {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

/**
 * A stand-in for HTTP_FETCH. Each call runs the current handler, which returns a
 * Response or throws as fetch would. Calls are recorded for assertions.
 */
export function fixtureFetch(
  handler: (url: URL) => Response | Promise<Response> = () => {
    throw new Error('fixtureFetch: no handler set');
  },
): jest.MockedFunction<HttpFetch> {
  return jest.fn<Promise<Response>, Parameters<HttpFetch>>(async (input) => handler(input));
}
