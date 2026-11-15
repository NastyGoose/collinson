/** Injection token for the HttpFetch the upstream adapters use. */
export const HTTP_FETCH = Symbol('HTTP_FETCH');

/**
 * Largest body read from a provider. An eight-day hourly forecast is about 20 kB
 * and a geocoding search a few kB, so this only stops a runaway answer.
 */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
