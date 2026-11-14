/**
 * The HTTP client upstream adapters use: the global `fetch` by default. Tests
 * override the HTTP_FETCH provider with fixture responses, so the real adapters
 * run against controlled provider payloads without network access.
 */
export type HttpFetch = (input: URL, init?: RequestInit) => Promise<Response>;

export const HTTP_FETCH = Symbol('HTTP_FETCH');
